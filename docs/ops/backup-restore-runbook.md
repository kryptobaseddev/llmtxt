# Backup & Restore Runbook

**Audience**: You, at 3 AM, after an incident.
**Goal**: Restore LLMtxt production Postgres in under 60 minutes.
**Last updated**: 2026-04-16

---

## Quick Reference

| Item | Value |
|------|-------|
| Backup schedule | Nightly 03:00 UTC |
| Retention | Daily 7d, Weekly 30d, Monthly 365d |
| Encryption | `age` (public-key, recipient-based) |
| Storage | S3 or Cloudflare R2 |
| Private key | 1Password vault: `LLMtxt Backup age Identity` |
| Bucket env var | `BACKUP_S3_BUCKET` |
| Restore time target | < 60 minutes |

---

## Part 1: Prerequisites

Before starting the restore, gather these credentials. Do not skip this step —
missing a credential mid-restore wastes time.

### 1.1 Retrieve the age private key

The age private key decrypts all backup files. It lives in 1Password.

```
1Password > Vaults > LLMtxt > "LLMtxt Backup age Identity"
```

Copy the key to a local file. The key format looks like:

```
# created: 2026-04-15T00:00:00Z
# public key: age1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AGE-SECRET-KEY-1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Save it:

```bash
vi /tmp/restore-identity.key   # paste the full key block
chmod 600 /tmp/restore-identity.key
```

Expected output: no errors, file is 600 permissions.

### 1.2 Configure S3/R2 access

From 1Password > "LLMtxt Backup S3 Credentials":

```bash
export AWS_ACCESS_KEY_ID="<from 1Password>"
export AWS_SECRET_ACCESS_KEY="<from 1Password>"
export BACKUP_S3_BUCKET="llmtxt-backups"

# If using Cloudflare R2 (check which was configured):
# export AWS_ENDPOINT_URL="https://<account_id>.r2.cloudflarestorage.com"
```

Verify access:

```bash
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ | tail -5
```

Expected output:

```
2026-04-14 03:07:22   4194304 2026-04-14.sql.age
2026-04-15 03:05:41   4198912 2026-04-15.sql.age
```

If you see `Access Denied`, double-check the credentials from 1Password.

### 1.3 Install required tools

```bash
# age (https://github.com/FiloSottile/age)
curl -fsSL https://github.com/FiloSottile/age/releases/download/v1.2.0/age-v1.2.0-linux-amd64.tar.gz \
  | tar -xz --strip-components=1 -C /usr/local/bin/ age/age age/age-keygen
age --version
# Expected: age v1.2.0

# aws CLI
aws --version
# Expected: aws-cli/2.x.x ...

# psql
psql --version
# Expected: psql (PostgreSQL) 16.x
```

---

## Part 2: Choose the Backup to Restore

### 2.1 List available backups

```bash
# Daily backups (last 7 days)
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ | sort -r | head -7

# Weekly backups (last 4 weeks)
aws s3 ls s3://${BACKUP_S3_BUCKET}/weekly/ | sort -r | head -4

# Monthly backups (last 12 months)
aws s3 ls s3://${BACKUP_S3_BUCKET}/monthly/ | sort -r | head -12
```

### 2.2 Select the target backup

For most incidents: use the most recent daily backup.

```bash
# Set the backup key to restore:
RESTORE_KEY="daily/2026-04-15.sql.age"   # <-- change to desired key
```

---

## Part 3: Download and Verify

### 3.1 Create a working directory

```bash
mkdir -p /tmp/llmtxt-restore
cd /tmp/llmtxt-restore
```

### 3.2 Download backup and hash

```bash
aws s3 cp "s3://${BACKUP_S3_BUCKET}/${RESTORE_KEY}" ./backup.sql.age
aws s3 cp "s3://${BACKUP_S3_BUCKET}/${RESTORE_KEY}.sha256" ./backup.sql.age.sha256
```

Expected output:

```
download: s3://llmtxt-backups/daily/2026-04-15.sql.age to ./backup.sql.age
download: s3://llmtxt-backups/daily/2026-04-15.sql.age.sha256 to ./backup.sql.age.sha256
```

### 3.3 Verify SHA256 integrity

```bash
EXPECTED=$(cat backup.sql.age.sha256)
ACTUAL=$(sha256sum backup.sql.age | awk '{print $1}')
echo "Expected: ${EXPECTED}"
echo "Actual:   ${ACTUAL}"
[[ "${EXPECTED}" == "${ACTUAL}" ]] && echo "INTEGRITY OK" || echo "INTEGRITY MISMATCH — DO NOT PROCEED"
```

Expected output:

```
Expected: a3f8b2...
Actual:   a3f8b2...
INTEGRITY OK
```

If you see `INTEGRITY MISMATCH`: do not restore this file. Try the previous day's backup or the DR bucket. See Part 6 (Rollback).

### 3.4 Decrypt the backup

```bash
age --decrypt \
  --identity /tmp/restore-identity.key \
  --output ./dump.sql \
  ./backup.sql.age

ls -lh dump.sql
```

Expected output:

```
-rw-r--r-- 1 user user 12M Apr 15 03:08 dump.sql
```

---

## Part 4: Restore to Production

**IMPORTANT**: Read all sub-steps before executing. Once you overwrite production data, the rollback path is a second restore from backup.

### 4.1 Decide: restore to existing DB or new DB?

**Option A (recommended): Restore to new Railway Postgres service**

1. Create a new Railway Postgres service in the same project.
2. Railway provides a `DATABASE_URL` for the new service.
3. Restore into the new DB, verify, then update `DATABASE_URL_PG` to point at it.

**Option B: Drop and restore in-place**

Only use this if Railway cannot provision a second Postgres quickly.
This means downtime from now until restore completes.

### 4.2 Option A — Restore to new Postgres

```bash
# Get the DATABASE_URL from Railway dashboard for the new service
NEW_DB_URL="postgres://user:pass@newhost:5432/railway"

# Restore
psql "${NEW_DB_URL}" -f dump.sql

# Check restore success
psql "${NEW_DB_URL}" -c "SELECT COUNT(*) FROM documents;"
psql "${NEW_DB_URL}" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public';"
```

Expected output:

```
 count
-------
    42
(1 row)

   table_name
--------------
 documents
 versions
 api_keys
 users
 rate_limits
(5 rows)
```

### 4.3 Option B — In-place restore

```bash
# Get production DATABASE_URL_PG from Railway dashboard > Variables
PROD_DB_URL="<Railway production DATABASE_URL_PG>"

# Drop and recreate schema (THIS DESTROYS CURRENT PRODUCTION DATA)
psql "${PROD_DB_URL}" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Restore
psql "${PROD_DB_URL}" -f dump.sql
```

### 4.4 Update Railway to use the restored database

For Option A (new service):

1. Go to Railway Dashboard > LLMtxt project > llmtxt-api service
2. Click Variables
3. Update `DATABASE_URL_PG` to the new service's `DATABASE_URL`
4. Redeploy the service (Railway auto-redeploys on variable change)

For Option B: no Railway change needed — same connection string.

### 4.5 Verify production is healthy

```bash
# Health check
curl -s https://api.llmtxt.my/api/health | jq .

# Expected:
# { "status": "ok", "db": "connected" }
```

---

## Part 5: Post-Restore Verification

Run these checks after production is restored:

```bash
# 1. API health
curl -s https://api.llmtxt.my/api/health

# 2. List documents (requires valid API key from 1Password)
curl -s -H "Authorization: Bearer <api_key>" https://api.llmtxt.my/api/documents | jq 'length'

# 3. Confirm row counts match expectations
# (Compare against known counts or the restore smoke test output)
```

If all checks pass: production is restored. Proceed to Part 7 (post-incident).

---

## Part 6: Rollback

If the restore corrupted production or the smoke tests fail:

### 6.1 Revert to previous Railway Postgres (Option A only)

1. Go to Railway Dashboard > Variables
2. Revert `DATABASE_URL_PG` to the previous service's URL
3. Redeploy

### 6.2 Try a different backup

```bash
# List backups and try the next most recent
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ | sort -r | head -5
# Repeat Part 3-5 with RESTORE_KEY set to a different date
```

### 6.3 Use the DR bucket (secondary region)

If the primary bucket is unavailable, use the secondary/DR bucket:

```bash
export BACKUP_S3_BUCKET="llmtxt-backups-dr"
# or for R2 cross-region: adjust AWS_ENDPOINT_URL
aws s3 ls s3://${BACKUP_S3_BUCKET}/daily/ | sort -r | head -5
```

---

## Part 7: Post-Incident Checklist

After production is restored and stable:

- [ ] Close the GitHub backup-failure issue (or it auto-closes on next successful backup)
- [ ] Write a brief incident summary (what failed, when, how long, root cause if known)
- [ ] Verify the nightly backup job runs successfully the next day at 03:00 UTC
- [ ] Check `gh run list --workflow backup-nightly.yml` next morning
- [ ] Delete local temp files: `rm -rf /tmp/llmtxt-restore /tmp/restore-identity.key`
- [ ] If you rotated any credentials during the incident, update GH secrets and 1Password

---

## Part 8: Secrets Reference

| Secret | Where | Purpose |
|--------|-------|---------|
| `BACKUP_AGE_IDENTITY` | GitHub Actions + 1Password | Private key for decryption |
| `BACKUP_AGE_RECIPIENT` | GitHub Actions | Public key for encryption (in backups) |
| `BACKUP_AWS_ACCESS_KEY_ID` | GitHub Actions | S3/R2 access key |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | GitHub Actions | S3/R2 secret key |
| `BACKUP_S3_BUCKET` | GitHub Actions | Bucket name |
| `BACKUP_AWS_ENDPOINT_URL` | GitHub Actions (optional) | R2 endpoint URL |
| `DATABASE_URL_PG` | GitHub Actions | Production Postgres URL (for backup) |

### Adding secrets to GitHub Actions

```bash
gh secret set BACKUP_AGE_IDENTITY < /tmp/restore-identity.key
gh secret set BACKUP_AGE_RECIPIENT --body "age1xxxx..."
gh secret set BACKUP_AWS_ACCESS_KEY_ID --body "AKIA..."
gh secret set BACKUP_AWS_SECRET_ACCESS_KEY --body "..."
gh secret set BACKUP_S3_BUCKET --body "llmtxt-backups"
# For R2:
# gh secret set BACKUP_AWS_ENDPOINT_URL --body "https://<id>.r2.cloudflarestorage.com"
```

---

## Part 9: First-Time Setup

Before the first backup runs, you must:

1. **Generate an age keypair**:

```bash
age-keygen -o /tmp/backup-identity.key
# Output: Public key: age1xxxx...
```

2. **Store the private key in 1Password** (vault: LLMtxt, item: "LLMtxt Backup age Identity").

3. **Set GitHub secrets** (see Part 8).

4. **Create the S3/R2 bucket**:

```bash
# AWS S3:
aws s3 mb s3://llmtxt-backups --region us-east-1
aws s3 mb s3://llmtxt-backups-dr --region us-west-2

# Apply lifecycle rules:
cd infra/backup
BACKUP_S3_BUCKET=llmtxt-backups bash lifecycle-aws-cli.sh

# Apply replication (optional, requires Terraform):
terraform init
terraform apply -var="primary_bucket=llmtxt-backups" -var="dr_bucket=llmtxt-backups-dr"
```

5. **Trigger a manual backup** to verify setup:

```bash
gh workflow run backup-nightly.yml
gh run list --workflow backup-nightly.yml --limit 1
```

Expected: run completes with status `success`.
