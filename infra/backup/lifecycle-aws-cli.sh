#!/usr/bin/env bash
# lifecycle-aws-cli.sh — Apply S3 lifecycle rules without Terraform.
#
# Use this if you prefer aws CLI over Terraform, or if your bucket
# was created manually and you want a one-shot apply.
#
# Required:
#   BACKUP_S3_BUCKET  — bucket name
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#
# Optional:
#   AWS_ENDPOINT_URL  — for R2 (lifecycle rules will fail on R2 — see note below)
#   AWS_DEFAULT_REGION
#
# R2 NOTE: Cloudflare R2 does NOT support S3 lifecycle rules (PutBucketLifecycleConfiguration).
# For R2, use lifecycle-r2-manual.sh to run nightly delete sweeps instead.

set -euo pipefail

BUCKET="${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET must be set}"

AWS_ARGS=()
if [[ -n "${AWS_ENDPOINT_URL:-}" ]]; then
  echo "WARNING: AWS_ENDPOINT_URL is set — R2 does not support lifecycle rules." >&2
  echo "Run lifecycle-r2-manual.sh for R2 cleanup instead." >&2
  exit 1
fi
if [[ -n "${AWS_DEFAULT_REGION:-}" ]]; then
  AWS_ARGS+=("--region" "${AWS_DEFAULT_REGION}")
fi

LIFECYCLE_JSON=$(cat <<'EOF'
{
  "Rules": [
    {
      "ID": "daily-7d-retention",
      "Status": "Enabled",
      "Filter": { "Prefix": "daily/" },
      "Expiration": { "Days": 7 }
    },
    {
      "ID": "weekly-30d-retention",
      "Status": "Enabled",
      "Filter": { "Prefix": "weekly/" },
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "monthly-365d-retention",
      "Status": "Enabled",
      "Filter": { "Prefix": "monthly/" },
      "Expiration": { "Days": 365 }
    }
  ]
}
EOF
)

echo "[lifecycle] Applying lifecycle rules to s3://${BUCKET} ..."
aws s3api "${AWS_ARGS[@]}" put-bucket-lifecycle-configuration \
  --bucket "${BUCKET}" \
  --lifecycle-configuration "${LIFECYCLE_JSON}"

echo "[lifecycle] SUCCESS: lifecycle rules applied"
echo "[lifecycle] Verify with: aws s3api get-bucket-lifecycle-configuration --bucket ${BUCKET}"
