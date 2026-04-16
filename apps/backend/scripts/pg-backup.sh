#!/usr/bin/env bash
# pg-backup.sh — Nightly Postgres logical dump with age encryption + S3/R2 upload
#
# Required env vars:
#   DATABASE_URL_PG        — postgres://user:pass@host:port/db
#   BACKUP_AGE_RECIPIENT   — age public key (recipient) for encryption
#   BACKUP_S3_BUCKET       — bucket name (e.g. llmtxt-backups)
#   AWS_ACCESS_KEY_ID      — S3 or R2 access key
#   AWS_SECRET_ACCESS_KEY  — S3 or R2 secret key
#
# Optional env vars:
#   AWS_ENDPOINT_URL       — set to Cloudflare R2 endpoint for R2 support
#                            e.g. https://<account_id>.r2.cloudflarestorage.com
#   AWS_DEFAULT_REGION     — defaults to auto (required for S3, ignored for R2)
#   BACKUP_PREFIX          — defaults to "daily" (daily|weekly|monthly)
#   BACKUP_DATE_KEY        — defaults to YYYY-MM-DD (override for promotions)
#
# Usage:
#   BACKUP_PREFIX=daily ./pg-backup.sh
#   BACKUP_PREFIX=weekly BACKUP_DATE_KEY=2026-W15 ./pg-backup.sh

set -euo pipefail

# ---- guard: never log DATABASE_URL ----
if [[ -z "${DATABASE_URL_PG:-}" ]]; then
  echo "ERROR: DATABASE_URL_PG is not set" >&2
  exit 1
fi
if [[ -z "${BACKUP_AGE_RECIPIENT:-}" ]]; then
  echo "ERROR: BACKUP_AGE_RECIPIENT is not set" >&2
  exit 1
fi
if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
  echo "ERROR: BACKUP_S3_BUCKET is not set" >&2
  exit 1
fi
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]] || [[ -z "${AWS_SECRET_ACCESS_KEY:-}" ]]; then
  echo "ERROR: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set" >&2
  exit 1
fi

PREFIX="${BACKUP_PREFIX:-daily}"
DATE_KEY="${BACKUP_DATE_KEY:-$(date -u +%Y-%m-%d)}"
FILENAME="${DATE_KEY}.sql.age"
HASH_FILE="${DATE_KEY}.sql.age.sha256"
S3_KEY="${PREFIX}/${FILENAME}"
S3_HASH_KEY="${PREFIX}/${HASH_FILE}"
TMPDIR_WORK="$(mktemp -d)"
DUMP_PATH="${TMPDIR_WORK}/dump.sql"
ENCRYPTED_PATH="${TMPDIR_WORK}/${FILENAME}"
HASH_PATH="${TMPDIR_WORK}/${HASH_FILE}"

# cleanup on exit (traps both success and error)
cleanup() {
  rm -rf "${TMPDIR_WORK}"
}
trap cleanup EXIT

echo "[backup] Starting ${PREFIX} backup for key=${DATE_KEY}"
echo "[backup] Bucket: ${BACKUP_S3_BUCKET}, Prefix: ${PREFIX}"

# ---- 1. pg_dump ----
echo "[backup] Running pg_dump..."
pg_dump \
  --no-password \
  --format=plain \
  --no-owner \
  --no-privileges \
  "${DATABASE_URL_PG}" > "${DUMP_PATH}"

DUMP_SIZE=$(du -sh "${DUMP_PATH}" | cut -f1)
echo "[backup] Dump size: ${DUMP_SIZE}"

# ---- 2. Encrypt with age ----
echo "[backup] Encrypting with age..."
if ! command -v age &>/dev/null; then
  echo "ERROR: 'age' binary not found. Install from https://github.com/FiloSottile/age" >&2
  exit 1
fi

age \
  --recipient "${BACKUP_AGE_RECIPIENT}" \
  --output "${ENCRYPTED_PATH}" \
  "${DUMP_PATH}"

# Remove plaintext dump immediately after encryption
rm -f "${DUMP_PATH}"

ENC_SIZE=$(du -sh "${ENCRYPTED_PATH}" | cut -f1)
echo "[backup] Encrypted size: ${ENC_SIZE}"

# ---- 3. SHA256 integrity hash (B.9) ----
echo "[backup] Computing SHA256..."
sha256sum "${ENCRYPTED_PATH}" | awk '{print $1}' > "${HASH_PATH}"
HASH_VALUE=$(cat "${HASH_PATH}")
echo "[backup] SHA256: ${HASH_VALUE}"

# ---- 4. Upload to S3/R2 ----
AWS_ARGS=()
if [[ -n "${AWS_ENDPOINT_URL:-}" ]]; then
  AWS_ARGS+=("--endpoint-url" "${AWS_ENDPOINT_URL}")
  echo "[backup] Using custom endpoint (R2 mode): ${AWS_ENDPOINT_URL}"
fi
if [[ -n "${AWS_DEFAULT_REGION:-}" ]]; then
  AWS_ARGS+=("--region" "${AWS_DEFAULT_REGION}")
fi

echo "[backup] Uploading encrypted dump to s3://${BACKUP_S3_BUCKET}/${S3_KEY} ..."
aws s3 cp \
  "${AWS_ARGS[@]}" \
  "${ENCRYPTED_PATH}" \
  "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" \
  --storage-class STANDARD

echo "[backup] Uploading SHA256 manifest to s3://${BACKUP_S3_BUCKET}/${S3_HASH_KEY} ..."
aws s3 cp \
  "${AWS_ARGS[@]}" \
  "${HASH_PATH}" \
  "s3://${BACKUP_S3_BUCKET}/${S3_HASH_KEY}"

echo "[backup] SUCCESS: ${PREFIX} backup complete"
echo "[backup] s3://${BACKUP_S3_BUCKET}/${S3_KEY}"
echo "[backup] sha256=${HASH_VALUE}"
