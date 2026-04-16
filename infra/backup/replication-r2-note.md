# Cloudflare R2 Cross-Region Replication

As of 2026-04, Cloudflare R2 replication is configured through the Cloudflare
Dashboard, not via the S3-compatible API. The `replication.tf` file targets AWS S3
and will not work with R2.

## R2 Replication Options

### Option 1: Cloudflare R2 Replication (recommended if staying on R2)

R2 replication is available for paid R2 plans:

1. Go to Cloudflare Dashboard > R2 > your bucket > Settings > Replication
2. Add a replication rule pointing to a second R2 bucket in a different Cloudflare region
3. Cloudflare handles the cross-region copy automatically

Reference: https://developers.cloudflare.com/r2/buckets/replication/

### Option 2: Manual cross-account copy script

If R2 replication is not available on your plan, run `lifecycle-r2-manual.sh`
modified to copy to a second bucket instead of deleting old objects:

```bash
# Copy latest daily to a second bucket in different region
aws s3 cp \
  --endpoint-url "${R2_ENDPOINT_PRIMARY}" \
  "s3://${BUCKET_PRIMARY}/daily/${TODAY}.sql.age" \
  "s3://${BUCKET_DR}/daily/${TODAY}.sql.age"
```

Schedule this as a GitHub Actions step after the nightly backup completes.

### Option 3: R2 -> AWS S3 hybrid

Store primary backups in R2 (cheap egress) and replicate to AWS S3 Standard-IA
(different platform, different failure domain):

```bash
# In backup-nightly.yml, add a second upload step after the R2 upload:
aws s3 cp \
  --endpoint-url "${AWS_S3_ENDPOINT}" \
  "s3://${R2_BUCKET}/daily/${TODAY}.sql.age" \
  "s3://${S3_DR_BUCKET}/daily/${TODAY}.sql.age"
```

This is the recommended posture for the "off-platform redundancy" requirement.
