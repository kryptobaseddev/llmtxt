# Backup & DR Strategy — RCASD+IVTR Output

**Date**: 2026-04-16
**Epic**: T247 (Backup & DR strategy, child of T144)
**Status**: complete
**Agent**: CLEO Team Lead

---

## Summary

Full disaster recovery posture for LLMtxt production Postgres (Railway). Delivers:
- Nightly encrypted pg_dump to S3/R2 at 03:00 UTC
- 7/30/365 retention tiers (daily/weekly/monthly)
- Monthly automated restore drill in CI with smoke assertions
- Production restore runbook targeting <60 minute RTO
- Off-platform redundancy via cross-region S3 replication IaC
- SHA256 integrity manifest per backup
- GH issue alerting on backup failure

---

## Task Completion Map

| Task | ID | Description | File(s) |
|------|----|-------------|---------|
| B.1 | T249 | pg-backup.sh | apps/backend/scripts/pg-backup.sh |
| B.2 | T250 | Retention IaC | infra/backup/lifecycle.tf, lifecycle-aws-cli.sh, lifecycle-r2-manual.sh |
| B.3 | T252 | Nightly workflow | .github/workflows/backup-nightly.yml |
| B.4 | T254 | Weekly promotion | .github/workflows/backup-weekly.yml |
| B.5 | T255 | Monthly promotion | .github/workflows/backup-monthly.yml |
| B.6 | T260 | Restore drill | .github/workflows/restore-drill-monthly.yml |
| B.7 | T261 | Runbook | docs/ops/backup-restore-runbook.md |
| B.8 | T263 | Cross-region IaC | infra/backup/replication.tf, replication-r2-note.md |
| B.9 | T265 | SHA256 integrity | integrated into pg-backup.sh + restore-drill-monthly.yml |
| B.10 | T272 | Alerting | integrated into backup-nightly.yml |

---

## Design Decisions

- **Encryption**: `age` v1.2.0 — public key in `BACKUP_AGE_RECIPIENT` secret, private key in 1Password + `BACKUP_AGE_IDENTITY` GH secret
- **Storage**: S3-compatible with `AWS_ENDPOINT_URL` env for R2 override (no R2 secrets existed at creation time, scripts work with both)
- **Retention enforcement**: Terraform + aws CLI scripts for S3; manual sweep script for R2 (R2 does not support S3 lifecycle API)
- **Ephemeral PG for drill**: GitHub postgres service container (matches ci.yml pattern, postgres:16-alpine)
- **Hash chain**: SHA256 of `.age` file stored as `.sha256` alongside each backup; restore drill verifies before decrypt
- **Alerting**: GH issue creation on failure; auto-close on next success

---

## Dependency Graph

```
B.1 (script)
├── B.2 (lifecycle IaC)
├── B.3 (nightly cron) → B.4 (weekly promo)
│                      → B.5 (monthly promo)
│                      → B.8 (cross-region)
│                      → B.10 (alerting, integrated)
├── B.9 (integrity, integrated into B.1 + B.6)
└── B.6 (restore drill, depends on B.1 + B.7)

B.7 (runbook, standalone)
```

---

## Secrets Required (GH Actions)

Owner must provision these before the first backup run:

| Secret Name | Description |
|-------------|-------------|
| `DATABASE_URL_PG` | Production Postgres connection string |
| `BACKUP_AGE_RECIPIENT` | age public key for encryption |
| `BACKUP_AGE_IDENTITY` | age private key for decryption (drill only) |
| `BACKUP_AWS_ACCESS_KEY_ID` | S3 or R2 access key |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | S3 or R2 secret key |
| `BACKUP_S3_BUCKET` | Bucket name (e.g. llmtxt-backups) |
| `BACKUP_AWS_ENDPOINT_URL` | (optional) R2 endpoint |

---

## Validation Results

- `shellcheck apps/backend/scripts/pg-backup.sh` — PASS
- `shellcheck infra/backup/lifecycle-aws-cli.sh` — PASS
- `shellcheck infra/backup/lifecycle-r2-manual.sh` — PASS
- YAML validation (4 workflows) — PASS
- Runbook smoke test (rollback, expected-output, aws s3, age, curl, psql, rollback section, DATABASE_URL_PG) — ALL PASS

---

## What Owner Must Do Before First Backup Runs

1. Generate age keypair: `age-keygen -o identity.key` — store private key in 1Password
2. Create S3 or R2 bucket: `aws s3 mb s3://llmtxt-backups --region us-east-1`
3. Apply lifecycle rules: `cd infra/backup && bash lifecycle-aws-cli.sh` (S3 only; for R2 use lifecycle-r2-manual.sh as cron)
4. Set all 7 GH secrets (see table above)
5. Optional: apply cross-region replication via `infra/backup/replication.tf`
6. Trigger manual backup: `gh workflow run backup-nightly.yml` and verify success

---

## Files Created

```
apps/backend/scripts/pg-backup.sh
infra/backup/lifecycle.tf
infra/backup/lifecycle-aws-cli.sh
infra/backup/lifecycle-r2-manual.sh
infra/backup/replication.tf
infra/backup/replication-r2-note.md
.github/workflows/backup-nightly.yml
.github/workflows/backup-weekly.yml
.github/workflows/backup-monthly.yml
.github/workflows/restore-drill-monthly.yml
docs/ops/backup-restore-runbook.md
claudedocs/agent-outputs/backup-strategy.md
```
