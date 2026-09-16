#!/usr/bin/env bash
#
# R2 preflight (task 1.4).
#
# Run this the moment the R2 credentials land, and after any change to them.
# It answers one question — "will tonight's backup actually work?" — without
# waiting for the timer to fail at 3am, which is the usual way you find out.
#
# It does a real round trip: put an object, read it back, compare the bytes,
# delete it. Listing a bucket proves you can list a bucket; only a write-then-
# read proves a backup can be stored and a restore can fetch it.
#
# Verified against Cloudflare's S3 compatibility table (2026-09-15): PutObject,
# GetObject, ListObjectsV2, DeleteObject, HeadBucket and the multipart family
# are all implemented. Object TAGGING is not — nothing here uses it.

set -Eeuo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/home/stellaastro/secrets/backup.env}"
[ -r "$ENV_FILE" ] || ENV_FILE=/home/stellaastro/htdocs/www.stellaastro.com/.env

ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; FAILED=1; }
note() { printf '        %s\n' "$*"; }
FAILED=0

printf '\nR2 preflight — %s\n\n' "$ENV_FILE"

if [ ! -r "$ENV_FILE" ]; then
  bad "cannot read $ENV_FILE"
  exit 1
fi
set -a; . "$ENV_FILE"; set +a

# ── 1. Configuration ─────────────────────────────────────────────
MISSING=0
for v in S3_ENDPOINT S3_BUCKET_BACKUPS S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY BACKUP_ENCRYPTION_PASSPHRASE; do
  if [ -n "${!v:-}" ]; then ok "$v is set"; else bad "$v is EMPTY"; MISSING=1; fi
done

if [ "$MISSING" = "1" ]; then
  printf '\n'
  note "Create an R2 API token: Cloudflare dashboard -> R2 -> API -> Manage API Tokens."
  note "Permission 'Object Read & Write', scoped to the backup bucket only."
  note "'Admin Read & Write' is only needed to CREATE a bucket, and the backup"
  note "job should not hold a token that can delete the bucket it writes to."
  note "Cloudflare shows the Secret Access Key ONCE."
  printf '\n'
  exit 1
fi

command -v aws >/dev/null && ok "aws CLI present ($(aws --version 2>&1 | cut -d' ' -f1))" \
  || { bad "aws CLI not installed"; exit 1; }

# The endpoint must belong to the account. A mismatch here is a copy-paste
# error that would otherwise surface as an opaque 403.
if [ -n "${S3_ACCOUNT_ID:-}" ]; then
  case "$S3_ENDPOINT" in
    *"$S3_ACCOUNT_ID"*) ok "endpoint matches the account id" ;;
    *) bad "endpoint does not contain S3_ACCOUNT_ID — check for a copy-paste error" ;;
  esac
fi

export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${S3_REGION:-auto}"   # R2 is always 'auto'
S3API="aws s3api --endpoint-url $S3_ENDPOINT"

# ── 2. Does the bucket exist and can we reach it? ────────────────
if $S3API head-bucket --bucket "$S3_BUCKET_BACKUPS" >/dev/null 2>&1; then
  ok "bucket '$S3_BUCKET_BACKUPS' exists and the credentials reach it"
else
  bad "cannot reach bucket '$S3_BUCKET_BACKUPS'"
  note "Either it does not exist, or this token is not scoped to it."
  note "Create it: wrangler r2 bucket create $S3_BUCKET_BACKUPS"
  note "or in the dashboard (R2 -> Create bucket). Names are lowercase"
  note "letters, digits and hyphens, 3-63 chars, no leading/trailing hyphen."
  note "Consider a Location Hint near your users when creating it."
  exit 1
fi

# ── 3. A real round trip ─────────────────────────────────────────
KEY="preflight/$(date -u +%Y%m%d-%H%M%S)-$$.txt"
TMP="$(mktemp)"; OUT="$(mktemp)"
trap 'rm -f "$TMP" "$OUT"' EXIT
# Distinctive content so a silently-truncated or cached read is visible.
printf 'stella r2 preflight %s\n' "$(date -u +%FT%TZ)" > "$TMP"

if $S3API put-object --bucket "$S3_BUCKET_BACKUPS" --key "$KEY" --body "$TMP" >/dev/null 2>&1; then
  ok "PutObject"
else
  bad "PutObject failed — the token probably lacks write permission"; exit 1
fi

if $S3API get-object --bucket "$S3_BUCKET_BACKUPS" --key "$KEY" "$OUT" >/dev/null 2>&1; then
  if cmp -s "$TMP" "$OUT"; then ok "GetObject, and the bytes match"
  else bad "GetObject returned DIFFERENT bytes — do not trust this bucket"; fi
else
  bad "GetObject failed — a backup could be written but never restored"
fi

# The nightly job prunes old backups, so delete must work or storage grows
# without limit and the retention policy is fiction.
if $S3API delete-object --bucket "$S3_BUCKET_BACKUPS" --key "$KEY" >/dev/null 2>&1; then
  ok "DeleteObject (pruning old backups will work)"
else
  bad "DeleteObject failed — retention pruning would silently never happen"
fi

# ── 4. Encryption round trip ─────────────────────────────────────
# The passphrase is only useful if it can actually decrypt. Proving that here
# is cheap; discovering it during a real restore is not.
ENC="$(mktemp)"; DEC="$(mktemp)"
trap 'rm -f "$TMP" "$OUT" "$ENC" "$DEC"' EXIT
if openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$TMP" -out "$ENC" 2>/dev/null \
   && openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_PASSPHRASE -in "$ENC" -out "$DEC" 2>/dev/null \
   && cmp -s "$TMP" "$DEC"; then
  ok "encrypt/decrypt round trip with BACKUP_ENCRYPTION_PASSPHRASE"
else
  bad "could not decrypt what we just encrypted — check the passphrase"
fi

printf '\n'
if [ "$FAILED" = "0" ]; then
  printf '  All checks passed. Backups can be stored, fetched and decrypted.\n'
  note ""
  note "Remaining owner action: copy BACKUP_ENCRYPTION_PASSPHRASE into a"
  note "password manager OFF this server. It currently lives in the same"
  note "directory it protects — if this box is lost you would hold an"
  note "encrypted backup and no way to open it."
  printf '\n'
else
  printf '  Some checks FAILED — see above.\n\n'
  exit 1
fi
