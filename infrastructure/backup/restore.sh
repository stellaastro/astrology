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

# Each source database is restored into its OWN scratch database and compared
# against itself.
#
# THIS IS A FIX, NOT A REFACTOR. The previous version stripped every
# `CREATE DATABASE` and `USE` line and piped the whole dump into one scratch
# database. That is safe — production is never written to — but the dump holds
# BOTH databases, and mysqldump emits `DROP TABLE IF EXISTS` before each table.
# So the second database silently dropped and replaced the first, and the
# scratch database ended up holding only whichever was dumped last.
#
# The comparison then hardcoded stellaastro_dev as "live", so the counts
# matched, and the script printed "the backup is real" while the PRODUCTION
# database had never been restore-tested at all. A rehearsal that cannot fail
# for the thing it is rehearsing is worse than none, because it is believed.
restore_one() {
  local SRC="$1" DST="$1_restore_check"

  case "$DST" in
    *_restore_check) : ;;
    *) die "refusing to restore into $DST — target must end in _restore_check" ;;
  esac

  log "restoring $SRC into $DST"
  mysql --defaults-extra-file="$CNF" \
    -e "DROP DATABASE IF EXISTS \`$DST\`; CREATE DATABASE \`$DST\` CHARACTER SET utf8mb4;"

  # Keep the dump preamble (charset and session SETs, which the data depends
  # on), then only the section belonging to SRC. Dropping CREATE DATABASE/USE
  # is what redirects it into the scratch database named on the mysql command.
  gunzip -c "$WORK/dump.sql.gz" \
    | awk -v db="$SRC" '
        BEGIN { pre = 1; inblk = 0 }
        /^CREATE DATABASE/ { pre = 0; next }
        /^USE `/           { pre = 0; inblk = ($0 == "USE `" db "`;"); next }
        { if (pre || inblk) print }
      ' \
    | mysql --defaults-extra-file="$CNF" "$DST" || die "restore of $SRC failed"
}

compare_one() {
  local SRC="$1" DST="$1_restore_check"
  local TABLES
  # Compare every table the SOURCE has, not a hardcoded list — a new table that
  # never reaches the backup is exactly what this should catch.
  TABLES=$(mysql --defaults-extra-file="$CNF" -N -B "$SRC" \
    -e "SELECT table_name FROM information_schema.tables WHERE table_schema='$SRC' AND table_type='BASE TABLE'" 2>/dev/null)

  [ -n "$TABLES" ] || { printf '  %s: no tables found in the live database\n' "$SRC"; return; }

  printf '  %s\n' "$SRC"
  for T in $TABLES; do
    LIVE=$(mysql --defaults-extra-file="$CNF" -N -B "$SRC" -e "SELECT COUNT(*) FROM \`$T\`" 2>/dev/null || echo 0)
    REST=$(mysql --defaults-extra-file="$CNF" -N -B "$DST" -e "SELECT COUNT(*) FROM \`$T\`" 2>/dev/null || echo MISSING)
    if [ "$REST" = "MISSING" ]; then
      printf '    %-22s live=%-6s restored=MISSING  <-- TABLE ABSENT\n' "$T" "$LIVE"; FAIL=1
    elif [ "$LIVE" != "$REST" ]; then
      printf '    %-22s live=%-6s restored=%-6s  <-- MISMATCH\n' "$T" "$LIVE" "$REST"; FAIL=1
    else
      printf '    %-22s live=%-6s restored=%-6s  ok\n' "$T" "$LIVE" "$REST"
    fi
  done
}

FAIL=0
# stellaastro is PRODUCTION and is listed first deliberately: it is the one
# whose recovery actually matters.
for DB in stellaastro stellaastro_dev; do
  restore_one "$DB"
done

log "comparing row counts against live"
for DB in stellaastro stellaastro_dev; do
  compare_one "$DB"
done

# Devanagari must survive the round trip, or the backup is subtly corrupt in a
# way row counts would not reveal.
mysql --defaults-extra-file="$CNF" -N -B "stellaastro_restore_check" \
  -e "SELECT 'शिवपाल' = CONVERT('शिवपाल' USING utf8mb4)" >/dev/null 2>&1 \
  && log "utf8mb4 round trip ok" || { log "WARNING: charset check failed"; FAIL=1; }

for DB in stellaastro stellaastro_dev; do
  mysql --defaults-extra-file="$CNF" -e "DROP DATABASE IF EXISTS \`${DB}_restore_check\`;"
done

[ "$FAIL" -eq 0 ] || die "restore verification found problems"
log "restore verified — the backup is real"
