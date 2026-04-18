# Audit Log Retention Policy

**Status**: Implemented (T186)
**Date**: 2026-04-18

---

## Overview

This document describes how LLMtxt retains, archives, and eventually purges audit log data in compliance with enterprise data-governance requirements. The system implements a two-tier (hot/cold) retention model with a 7-year total retention window, configurable per-resource policies, and a legal-hold mechanism that prevents deletion of records relevant to active legal proceedings.

---

## Hot and Cold Storage Tiers

### Hot Tier (PostgreSQL)

Audit log entries live in the `audit_logs` table in the primary PostgreSQL database for the first **90 days** after they are created. Hot-tier entries are immediately queryable and support the real-time tamper-evident hash chain (see `docs/security/audit-chain.md`).

### Cold Tier (S3 archive index)

After 90 days, entries are moved to the `audit_archive` table (a cold-storage index). In production, the full entry JSON is written to the configured S3/R2 bucket at the key pattern:

```
audit/<YYYY-MM-DD>/<entry-id>.json
```

The `audit_archive` row retains the metadata needed for date-range export queries (`event_timestamp`, `user_id`, `legal_hold`) without keeping the full payload in the hot database.

### Total Retention Window (7 years)

Archived entries older than **2555 days (~7 years)** are eligible for permanent deletion from both the hot database and the cold archive. The deletion is subject to the legal-hold invariant — entries under legal hold are **never hard-deleted** regardless of age.

---

## Nightly Retention Job

The background job `apps/backend/src/jobs/audit-retention.ts` runs every 24 hours (first run deferred 5 seconds after server startup). On each run it:

1. **Archives** hot `audit_log` entries older than 90 days that are not already archived and not under legal hold (batch limit: 1000 per run to avoid long-running transactions).
2. **Hard-deletes** hot rows that are both archived and beyond the 7-year total retention window, excluding legal-hold entries.
3. **Finalises user deletions** — finds users whose soft-delete grace period (30 days) has elapsed, hard-deletes all their owned resources, and issues a `deletion_certificate`.

The job is idempotent — running it multiple times produces the same result.

---

## Legal Hold

Audit log entries can be placed under a legal hold by an administrator:

```
POST /api/v1/audit/legal-hold
```

Body:
```json
{
  "eventIds": ["evt_abc123", "evt_def456"],
  "reason": "Active litigation — case #2026-1234"
}
```

Legal-hold entries are:

- **Excluded from hot-to-cold archival** — they remain in the hot database.
- **Excluded from hard deletion** — even after the 7-year retention window.
- **Copied with `legal_hold = true`** into `audit_archive` if the archival job encounters them while processing an earlier batch.

Removing a legal hold is a manual operation performed by the database administrator after legal clearance.

---

## Configurable Retention Policy

The retention policy is stored in the `retention_policy` table as a singleton row. Default values:

| Setting | Default | Description |
|---------|---------|-------------|
| `auditLogHotDays` | 90 | Days in hot DB before archiving |
| `auditLogTotalDays` | 2555 | Total days before hard delete (~7 years) |
| `softDeletedDocsDays` | 30 | Grace period for user-deleted documents |
| `anonymousDocDays` | 1 | Lifespan of anonymous session documents |
| `revokedApiKeyDays` | 90 | Days before purging revoked API key metadata |
| `agentInboxDays` | 2 | TTL for agent inbox messages |

### Admin API

**View current policy:**

```
GET /api/v1/admin/retention
```

Returns the active retention policy (or defaults if not yet configured).

**Update policy:**

```
PUT /api/v1/admin/retention
Content-Type: application/json

{
  "auditLogHotDays": 60,
  "auditLogTotalDays": 3650
}
```

All fields are optional. Constraints: all values must be positive integers; `auditLogTotalDays` must be `>= auditLogHotDays`. Both endpoints require admin authentication.

---

## Audit Export

Users can export their own audit log entries for a date range:

```
GET /api/v1/audit/export?from=2026-01-01T00:00:00Z&to=2026-04-01T00:00:00Z&format=json
```

Supported formats: `json` (default) and `csv`. The export includes entries from the hot `audit_logs` table only. Admin-scope exports (full corpus) are available via `admin.ts`.

---

## Right-to-Deletion Interaction

When a user requests account deletion (`DELETE /api/v1/users/me`), audit log entries that reference their account are **pseudonymised** (actor ID replaced with `[deleted:<hash>]`) rather than hard-deleted. This preserves the tamper-evident hash chain while removing the user's direct identifier.

See [right-to-deletion.md](right-to-deletion.md) for the full GDPR erasure flow.

---

## Deletion Certificate

After a user's 30-day grace period elapses and all owned resources are hard-deleted, a `deletion_certificate` row is created containing:

- Original user ID
- Deletion timestamp (ISO 8601)
- Count of each resource type deleted
- SHA-256 integrity hash of the certificate payload

The certificate row is retained indefinitely as verifiable proof of erasure. It is never deleted.

---

## S3 Storage Details

Cold archive objects are stored in the same S3/R2 bucket configured by `S3_BUCKET_NAME`. Server-side encryption (SSE-S3 or SSE-KMS, depending on bucket configuration) is enforced at the bucket level. The migration job verifies encryption is enabled before writing to the bucket in a hardened deployment.

Object path format:
```
audit/<ISO-date>/<entry-id>.json
```

Retrieval of archived entries is available via the export endpoint when querying date ranges that extend beyond 90 days.

---

## Summary Timeline

| Event | Timing |
|-------|--------|
| Audit entry created | Immediately in hot DB |
| Hot → cold archival | After 90 days (nightly job) |
| Total retention expires | After 2555 days (~7 years) |
| Hard delete from cold tier | After total retention (legal-hold exempt) |
| User deletion soft-delete | Immediately on DELETE /api/v1/users/me |
| User deletion hard-delete | 30 days after soft-delete (nightly job) |
| Deletion certificate issued | Same time as hard delete |

---

## Questions

For questions about data retention, legal holds, or compliance exports, contact: privacy@llmtxt.my
