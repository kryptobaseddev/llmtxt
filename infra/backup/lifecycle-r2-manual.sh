#!/usr/bin/env bash
# lifecycle-r2-manual.sh — Manual retention cleanup for Cloudflare R2.
#
# R2 does NOT support the S3 Lifecycle API (PutBucketLifecycleConfiguration).
# Instead, this script deletes objects older than the retention window using
# aws s3 ls + aws s3 rm with the R2 endpoint.
#
# Run this script as a GitHub Actions cron job or alongside the backup jobs.
# Recommended schedule: daily at 06:00 UTC after backups complete.
#
# Required:
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — R2 API token pair
#   AWS_ENDPOINT_URL                          — R2 endpoint URL
#   BACKUP_S3_BUCKET                          — bucket name
#
# Retention tiers:
#   daily/   — keep 7 days
#   weekly/  — keep 30 days
#   monthly/ — keep 365 days

set -euo pipefail

BUCKET="${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET must be set}"
ENDPOINT="${AWS_ENDPOINT_URL:?AWS_ENDPOINT_URL must be set for R2}"

delete_older_than() {
  local prefix="$1"
  local days="$2"
  local cutoff
  cutoff=$(date -u -d "${days} days ago" +%Y-%m-%d 2>/dev/null \
    || date -u -v"-${days}d" +%Y-%m-%d)  # macOS fallback

  echo "[r2-lifecycle] Pruning s3://${BUCKET}/${prefix} (older than ${days} days, cutoff=${cutoff})"

  aws s3 ls \
    --endpoint-url "${ENDPOINT}" \
    "s3://${BUCKET}/${prefix}" \
  | awk '{print $4}' \
  | while read -r obj; do
    # Extract date portion from filename (YYYY-MM-DD.sql.age or YYYY-Www.sql.age or YYYY-MM.sql.age)
    obj_date=$(echo "${obj}" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
    if [[ -n "${obj_date}" ]] && [[ "${obj_date}" < "${cutoff}" ]]; then
      echo "[r2-lifecycle] Deleting ${prefix}${obj} (date=${obj_date})"
      aws s3 rm \
        --endpoint-url "${ENDPOINT}" \
        "s3://${BUCKET}/${prefix}${obj}"
    fi
  done
}

delete_older_than "daily/"   7
delete_older_than "weekly/"  30
delete_older_than "monthly/" 365

echo "[r2-lifecycle] Cleanup complete"
