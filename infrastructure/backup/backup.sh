#!/usr/bin/env bash
#
# Nightly backup to Cloudflare R2 (ADR-032).
#
# Backs up three things, because losing any one of them is unrecoverable:
#   1. MySQL  — every database, with routines, triggers and events
#   2. Secrets — /home/stellaastro/secrets, the ONLY copy of every credential
#   3. Binlogs — for point-in-time recovery between nightly dumps
#
# The secrets file is the one people forget. It is not in git by design, so if
# this server dies it is gone, and with it every vendor credential the project
# holds. It is encrypted before upload — a backup of plaintext credentials in
# object storage is a worse exposure than the one it protects against.
#
# Exits non-zero on any failure so systemd records it. A backup that fails
# silently is worse than no backup, because you believe you have one.

set -Eeuo pipefail

# Configuration comes from the SECRETS DIRECTORY, not the repo .env.
#
# .env is the development default: it points at stellaastro_dev and is the file
# a contributor edits freely. R2 credentials and the backup passphrase do not
# belong in a file that lives inside a git working tree, however well
# .gitignore is behaving today — the same reasoning that put the API's
# production environment in /home/stellaastro/secrets/api.production.env.
#
# The repo .env is still accepted as a fallback so a developer can rehearse a
# restore locally without root.
ENV_FILE="${BACKUP_ENV_FILE:-/home/stellaastro/secrets/backup.env}"
[ -r "$ENV_FILE" ] || ENV_FILE=/home/stellaastro/htdocs/www.stellaastro.com/.env
SECRETS_DIR=/home/stellaastro/secrets
STAMP="$(date -u +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d /tmp/stella-backup.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup] FAILED: %s\n' "$*" >&2; exit 1; }

[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE"
set -a; . "$ENV_FILE"; set +a

for v in S3_ENDPOINT S3_BUCKET_BACKUPS S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_PASSPHRASE; do
  [ -n "${!v:-}" ] || die "$v is not set — refusing to run a backup that cannot be stored or protected"
done

command -v aws >/dev/null || die "aws CLI not installed"
command -v mysqldump >/dev/null || die "mysqldump not found"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${S3_REGION:-auto}"
S3="aws s3 --endpoint-url $S3_ENDPOINT"

# ── 1. MySQL ─────────────────────────────────────────────────────
log "dumping MySQL"
DB_USER="$(grep -m1 '^MYSQL_DATABASE_USER=' "$SECRETS_DIR/config.txt" | cut -d= -f2- | tr -d '\r\n')"
DB_PASS="$(grep -m1 '^MYSQL_DATABASE_USER_PWD=' "$SECRETS_DIR/config.txt" | cut -d= -f2- | tr -d '\r\n')"
DUMP_CNF="$WORK/my.cnf"; umask 077
printf '[client]\nhost=127.0.0.1\nuser=%s\npassword=%s\n' "$DB_USER" "$DB_PASS" > "$DUMP_CNF"

# --single-transaction: a consistent snapshot without locking the tables, so a
# booking mid-flight is not blocked by the backup.
mysqldump --defaults-extra-file="$DUMP_CNF" \
  --single-transaction --quick --routines --triggers --events \
  --databases stellaastro stellaastro_dev \
  | gzip -9 > "$WORK/mysql-$STAMP.sql.gz" || die "mysqldump failed"

# A dump that is silently empty is the classic failure. 1 KB is generous for a
# gzipped schema and catches a truncated or permission-denied dump.
SIZE=$(stat -c%s "$WORK/mysql-$STAMP.sql.gz")
[ "$SIZE" -gt 1024 ] || die "dump is only ${SIZE} bytes — refusing to upload a probably-empty backup"
log "dump ok (${SIZE} bytes)"

# ── 2. Secrets, encrypted ────────────────────────────────────────
log "archiving secrets (encrypted)"
tar -czf - -C "$(dirname "$SECRETS_DIR")" "$(basename "$SECRETS_DIR")" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
      -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
      -out "$WORK/secrets-$STAMP.tar.gz.enc" || die "secrets archive failed"

# ── 3. Binlogs, for point-in-time recovery ───────────────────────
if compgen -G "/home/mysql/binlog.[0-9]*" > /dev/null; then
  log "archiving binlogs"
  tar -czf "$WORK/binlogs-$STAMP.tar.gz" -C /home/mysql $(cd /home/mysql && ls binlog.[0-9]*) \
    || log "WARNING: binlog archive failed — dumps still uploaded"
else
  log "WARNING: no binlog files found — point-in-time recovery is NOT available"
fi

# ── Upload ───────────────────────────────────────────────────────
PREFIX="s3://$S3_BUCKET_BACKUPS/$(date -u +%Y/%m/%d)"
for f in "$WORK"/*; do
  [ -f "$f" ] || continue
  log "uploading $(basename "$f")"
  $S3 cp "$f" "$PREFIX/$(basename "$f")" --only-show-errors || die "upload failed for $(basename "$f")"
done

# ── Verify it is actually there ──────────────────────────────────
# Upload success is not proof of storage. Read the listing back.
REMOTE=$($S3 ls "$PREFIX/" | wc -l)
LOCAL=$(find "$WORK" -maxdepth 1 -type f | wc -l)
[ "$REMOTE" -ge "$LOCAL" ] || die "expected $LOCAL objects at $PREFIX, found $REMOTE"
log "verified $REMOTE object(s) at $PREFIX"

# ── Retention ────────────────────────────────────────────────────
# 30 days. Set a lifecycle rule on the bucket too — this loop only runs if the
# backup itself runs, so a broken backup would also stop pruning.
CUTOFF=$(date -u -d '30 days ago' +%Y/%m/%d)
$S3 ls "s3://$S3_BUCKET_BACKUPS/" --recursive 2>/dev/null \
  | awk -v c="$CUTOFF" '{ if (substr($4,1,10) < c) print $4 }' \
  | while read -r old; do
      [ -n "$old" ] && $S3 rm "s3://$S3_BUCKET_BACKUPS/$old" --only-show-errors || true
    done

log "complete: $PREFIX"
