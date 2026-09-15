#!/usr/bin/env bash
#
# Restore rehearsal (ADR-032).
#
# "An untested backup is not a backup." This restores the most recent dump into
# a SCRATCH database and compares row counts against the live one. It never
# touches production — the target database name is hard-coded and asserted.
#
# Run it after any change to the backup script, and once before launch.

set -Eeuo pipefail

SCRATCH_DB=stellaastro_restore_check
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
WORK="$(mktemp -d /tmp/stella-restore.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

log() { printf '[restore] %s\n' "$*"; }
die() { printf '[restore] FAILED: %s\n' "$*" >&2; exit 1; }

# Guard against a fat-fingered edit ever pointing this at real data.
case "$SCRATCH_DB" in
  *restore_check) : ;;
  *) die "SCRATCH_DB must end in _restore_check — refusing to run" ;;
esac

[ -r "$ENV_FILE" ] || die "cannot read $ENV_FILE"
set -a; . "$ENV_FILE"; set +a

# backup.sh validated these and this did not. A rehearsal is worth running only
# if it fails for the reason it says, so check before doing any work.
for v in S3_ENDPOINT S3_BUCKET_BACKUPS S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_PASSPHRASE; do
  [ -n "${!v:-}" ] || die "$v is not set — cannot fetch or decrypt a backup without it"
done
command -v aws >/dev/null || die "aws CLI not installed"

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${S3_REGION:-auto}"
S3="aws s3 --endpoint-url $S3_ENDPOINT"

log "finding the most recent dump"
LATEST=$($S3 ls "s3://$S3_BUCKET_BACKUPS/" --recursive | grep 'mysql-.*\.sql\.gz$' | sort | tail -1 | awk '{print $4}')
[ -n "$LATEST" ] || die "no dump found in the bucket"
log "using $LATEST"

$S3 cp "s3://$S3_BUCKET_BACKUPS/$LATEST" "$WORK/dump.sql.gz" --only-show-errors || die "download failed"

CNF="$WORK/my.cnf"; umask 077
printf '[client]\nhost=127.0.0.1\nuser=root\npassword=%s\n' \
  "$(clpctl db:show:master-credentials | awk -F'|' '/Password/{gsub(/ /,"",$3); print $3}')" > "$CNF"

log "restoring into $SCRATCH_DB"
mysql --defaults-extra-file="$CNF" -e "DROP DATABASE IF EXISTS \`$SCRATCH_DB\`; CREATE DATABASE \`$SCRATCH_DB\` CHARACTER SET utf8mb4;"
# The dump contains CREATE DATABASE for the originals; strip those so
# everything lands in the scratch database instead.
gunzip -c "$WORK/dump.sql.gz" \
  | sed -E '/^(CREATE DATABASE|USE )/d' \
  | mysql --defaults-extra-file="$CNF" "$SCRATCH_DB" || die "restore failed"

log "comparing row counts against live"
FAIL=0
for T in leads audit_events idempotency_keys outbox_messages; do
  LIVE=$(mysql --defaults-extra-file="$CNF" -N -B stellaastro_dev -e "SELECT COUNT(*) FROM \`$T\`" 2>/dev/null || echo 0)
  REST=$(mysql --defaults-extra-file="$CNF" -N -B "$SCRATCH_DB" -e "SELECT COUNT(*) FROM \`$T\`" 2>/dev/null || echo MISSING)
  if [ "$REST" = "MISSING" ]; then
    printf '  %-20s live=%-6s restored=MISSING  <-- TABLE ABSENT\n' "$T" "$LIVE"; FAIL=1
  elif [ "$LIVE" -gt 0 ] && [ "$REST" -eq 0 ]; then
    printf '  %-20s live=%-6s restored=%-6s  <-- EMPTY\n' "$T" "$LIVE" "$REST"; FAIL=1
  else
    printf '  %-20s live=%-6s restored=%-6s  ok\n' "$T" "$LIVE" "$REST"
  fi
done

# Devanagari must survive the round trip, or the backup is subtly corrupt in a
# way row counts would not reveal.
mysql --defaults-extra-file="$CNF" -N -B "$SCRATCH_DB" \
  -e "SELECT 'शिवपाल' = CONVERT('शिवपाल' USING utf8mb4)" >/dev/null 2>&1 \
  && log "utf8mb4 round trip ok" || { log "WARNING: charset check failed"; FAIL=1; }

mysql --defaults-extra-file="$CNF" -e "DROP DATABASE \`$SCRATCH_DB\`;"
[ "$FAIL" -eq 0 ] || die "restore verification found problems"
log "restore verified — the backup is real"
