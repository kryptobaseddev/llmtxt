# GDPR Erasure — Deep Cascade (Article 17)

**Status**: Implemented (T168.4 / T168.5 / T168.6)
**Date**: 2026-04-18
**Owner**: Engineering / Data Protection

---

## Overview

This document covers the **deep erasure** implementation in LLMtxt — the
right-to-erasure (Article 17 GDPR) cascade across all PII-bearing tables,
the Subject Access Request (SAR) endpoint, and the retention event audit trail.

For the standard 30-day soft-delete flow, see
[right-to-deletion.md](right-to-deletion.md).

---

## Deep Erase Endpoint

```
DELETE /api/v1/users/me/erase
Authorization: Bearer <token>
```

### Authentication requirement

Fresh auth is required. The session must have been created within the last
5 minutes (enforced in `isFreshAuth()`).

### Cascade actions (immediate)

The endpoint executes the following cascade synchronously in a single request:

| Step | Target | Action |
|------|--------|--------|
| 1 | `documents` owned by user | Soft-delete (`expires_at = now + 30 days`) |
| 2 | `audit_logs` for user | Pseudonymize `actor_id` → `[deleted:<sha256_prefix>]` |
| 3 | `webhooks` for user | Revoke (`active = false`) |
| 4 | `webhook_deliveries` for user's webhooks | Hard-delete immediately |
| 5 | `api_keys` for user | Revoke + nullify `key_hash` to sentinel SHA-256 |
| 6 | `users` row | Soft-delete (`deleted_at = now`) if not already pending |
| 7 | `audit_logs` | Emit `retention.erasure` event |

### Audit chain preservation (T164)

Audit log rows are **never hard-deleted**. Instead, the `actor_id` column is
replaced with a pseudonym: `[deleted:<first 16 hex chars of SHA-256(userId)>]`.
This preserves the tamper-evident hash chain (the `chain_hash` column is not
recomputed) while removing the direct identifier.

This approach is consistent with GDPR recital 65 and the T164 audit integrity
requirement.

### Response

```json
HTTP 202 Accepted
{
  "success": true,
  "erasureId": "abc123...",
  "message": "Right-to-erasure cascade initiated. ...",
  "pseudonymizedAuditLog": true,
  "webhooksRevoked": 3,
  "hardDeleteAt": "2026-05-18T20:00:00.000Z"
}
```

---

## Subject Access Request Endpoint

```
GET /api/v1/users/me/sar
Authorization: Bearer <token>
```

Returns a **machine-readable PII bundle** covering all data categories per
[pii-inventory.md](pii-inventory.md).

### Response shape

```json
{
  "sar_version": 1,
  "generated_at": "2026-04-18T20:00:00.000Z",
  "user": {
    "id": "usr_...",
    "name": "Alice Example",
    "email": "alice@example.com",
    "created_at": "2025-01-01T00:00:00.000Z",
    "account_status": "active"
  },
  "data_categories": [
    {
      "category": "profile",
      "table": "users",
      "fields": ["id", "name", "email", "created_at"],
      "pii_classification": "direct_identifier",
      "lawful_basis": "contract_performance",
      "retention_period": "account lifetime + 30 day grace",
      "count": 1
    },
    {
      "category": "documents",
      "table": "documents",
      "fields": ["id", "slug", "state", "created_at", "owner_id"],
      "pii_classification": "user_generated_content",
      "lawful_basis": "contract_performance",
      "retention_period": "account lifetime + 30 day grace",
      "count": 42
    },
    {
      "category": "api_keys",
      "table": "api_keys",
      "fields": ["id", "name", "key_prefix", "key_hash", "created_at"],
      "pii_classification": "credential_metadata",
      "lawful_basis": "contract_performance",
      "retention_period": "365 days from revocation",
      "count": 3
    },
    {
      "category": "audit_log",
      "table": "audit_logs",
      "fields": ["id", "action", "actor_id", "resource_type", "timestamp"],
      "pii_classification": "activity_log",
      "lawful_basis": "legal_obligation",
      "retention_period": "90 days hot + 7 years cold (pseudonymized after erasure)",
      "count": 1500
    },
    {
      "category": "webhooks",
      "table": "webhooks",
      "fields": ["id", "url", "events", "active", "created_at"],
      "pii_classification": "integration_config",
      "lawful_basis": "legitimate_interests",
      "retention_period": "account lifetime",
      "count": 2
    }
  ],
  "data": {
    "profile": { ... },
    "documents": [ ... ],
    "api_keys": [ ... ],
    "audit_log": [ ... ],
    "webhooks": [ ... ]
  }
}
```

### Security guarantees

- Raw API key secrets are **never** returned — only `key_prefix` and `key_hash`.
- Webhook signing secrets are **never** returned.
- The endpoint emits a `user.sar` audit log event.
- No rate-limiting by default (unlike `/users/me/export` which is 1/day).

---

## Retention Policy DSL

The canonical PII policies are defined in Rust:

```
crates/llmtxt-core/src/retention.rs
```

Key types:

| Type | Description |
|------|-------------|
| `RetentionPolicy` | Per-table policy with tier, max_age_days, lawful_basis, action |
| `RetentionRow` | A single row (id + timestamp_ms + legal_hold) |
| `EvictionSet` | Result of apply_retention: evict[], retain[], action, cutoff_ms |
| `RetentionAction` | Pseudonymize / HardDelete / Archive |
| `RetentionTier` | Critical / Standard / Operational / Anonymous |
| `LawfulBasis` | Consent / ContractPerformance / LegalObligation / LegitimateInterests / Anonymous |

### WASM binding

The retention DSL is WASM-exported as `retention_apply_wasm(rows_json, policy_json, now_ms)`.
This allows TypeScript callers to evaluate retention policies without a DB round-trip:

```typescript
import init, { retention_apply_wasm } from 'llmtxt/wasm';
await init();
const result = JSON.parse(retention_apply_wasm(
  JSON.stringify(rows),
  JSON.stringify(policy),
  Date.now()
));
console.log(result.evict); // IDs to evict
```

### canonical_policies()

The Rust function `canonical_policies()` returns the 9 authoritative policies
matching this inventory. The nightly retention job in TypeScript mirrors these
constants as `SESSIONS_MAX_AGE_DAYS`, `API_KEYS_MAX_AGE_DAYS`, etc.

---

## Retention Event Audit (T168.6)

Every eviction from the nightly retention job emits a `retention.eviction`
audit log entry. The entry contains:

```json
{
  "id": "<uuid>",
  "actor_id": "system:retention-job",
  "action": "retention.eviction",
  "resource_type": "<table_name>",
  "timestamp": 1713481200000,
  "details": {
    "table": "sessions",
    "policy": "sessions",
    "rowCount": 47,
    "cutoffMs": 1713481200000,
    "action": "hard_delete"
  }
}
```

**No raw PII is written to the audit details field** — only the table name,
policy name, row count, cutoff timestamp, and action type.

The `actor_id` is set to `system:retention-job` (not a user UUID), so these
entries are exempt from user-level pseudonymization cascades.

### Erasure audit entry

The deep erase endpoint (`DELETE /users/me/erase`) also emits a
`retention.erasure` entry:

```json
{
  "action": "retention.erasure",
  "actor_id": "system:erasure",
  "details": {
    "erasureId": "abc123",
    "webhooksRevoked": 3,
    "auditPseudonymized": true,
    "apiKeysNullified": true,
    "initiatedAt": "2026-04-18T20:00:00.000Z"
  }
}
```

---

## Background Retention Job

File: `apps/backend/src/jobs/retention.ts`

Runs nightly via `setInterval` (24-hour period). Can be called directly in
tests as `runRetentionJob(nowMs)`.

| Phase | Table | Policy | Action |
|-------|-------|--------|--------|
| 1 | `sessions` | 30 days post-expiry | HardDelete |
| 2 | `api_keys` (revoked) | 365 days from revocation | HardDelete |
| 3 | `webhook_deliveries` | 30 days | HardDelete |
| 4 | `agent_signature_nonces` | 1 day | HardDelete |
| 5 | `agent_inbox_messages` | 7 days post-expiry | HardDelete |
| 6 | `section_embeddings` | 90 days | HardDelete |

All phases are sequential to avoid DB overload. Each phase logs its eviction
count to the audit chain.

For audit log archival (hot→cold, 7-year retention), see
`apps/backend/src/jobs/audit-retention.ts` (T186).

---

## Cross-References

- [PII Inventory](pii-inventory.md) — Complete table/column mapping
- [Right-to-Deletion](right-to-deletion.md) — Standard 30-day soft-delete flow
- [Retention Policy](retention-policy.md) — Audit log hot/cold archival
- [SOC 2 Type 1](soc2-type1-readiness.md) — Control CC6.7 (data disposal)
- Rust source: `crates/llmtxt-core/src/retention.rs`
- TypeScript source:
  - `apps/backend/src/jobs/retention.ts`
  - `apps/backend/src/routes/user-data.ts` (DELETE /users/me/erase, GET /users/me/sar)
