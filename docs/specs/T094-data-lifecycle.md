# Data Lifecycle — GDPR Compliance

**RFC 2119 Specification**
**Status**: Implemented (T094 / T186 / T187)
**Version**: 1.0.0
**Date**: 2026-04-18

---

## 1. Scope

This document specifies the data lifecycle management system for LLMtxt, covering:

- **T094** — GDPR data portability export (`POST /api/v1/users/me/export`)
- **T186** — Audit log retention (7-year policy, hot/cold tiering, legal hold)
- **T187** — Right-to-erasure endpoint (`DELETE /api/v1/users/me`, 30-day grace, pseudonymisation)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  crates/llmtxt-core  (SSoT — portable primitives)       │
│  ┌─────────────────────┐  ┌────────────────────────┐    │
│  │  ExportArchive      │  │  RetentionPolicy       │    │
│  │  serialize/         │  │  serialize/            │    │
│  │  deserialize        │  │  deserialize           │    │
│  └─────────────────────┘  └────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
              ↕ (WASM bindings)
┌─────────────────────────────────────────────────────────┐
│  apps/backend  (route handlers, jobs, DB)               │
│  ┌─────────────────────┐  ┌────────────────────────┐    │
│  │  routes/user-data   │  │  jobs/audit-retention  │    │
│  │  · POST /me/export  │  │  · hot→cold archival   │    │
│  │  · DELETE /me       │  │  · 7-year hard purge   │    │
│  │  · POST /me/undo    │  │  · user hard-delete     │    │
│  │  · GET /audit/export│  └────────────────────────┘    │
│  │  · POST /audit/hold │                                 │
│  └─────────────────────┘                                 │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Data Export (T094)

### 3.1 ExportArchive Schema

The `ExportArchive` struct is defined in `crates/llmtxt-core/src/export_archive.rs`:

```
ExportArchive {
  archiveVersion:  u32          // format version (currently 1)
  exportedAt:      ISO 8601     // timestamp of export
  userId:          string       // opaque user ID
  userName:        string       // display name
  userEmail:       string       // email
  userCreatedAt:   ISO 8601     // account creation
  documents:       ExportDocument[]
  apiKeyHashes:    ExportApiKey[]
  auditLog:        ExportAuditEntry[]
  webhooks:        ExportWebhook[]
  contentHash:     hex(SHA-256) // integrity seal
}
```

### 3.2 Integrity Seal

The `contentHash` field MUST be computed as:

```
contentHash = SHA-256(JSON.stringify({ ...archive, contentHash: "" }))
```

`deserialize_export_archive` MUST reject archives where the embedded `contentHash` does not match the recomputed value.

### 3.3 API Endpoint

**`POST /api/v1/users/me/export`**

| Property | Value |
|----------|-------|
| Authentication | Required (`requireAuth`) |
| Fresh auth | Required (re-authentication within 5 min — see §3.4) |
| Rate limit | 1 request per user per UTC calendar day |
| Response | `200 application/json` — `ExportArchive` JSON with `Content-Disposition: attachment` |

**Rate limit enforcement:**

The `user_export_rate_limit` table stores one row per `(user_id, export_date)`. The handler MUST check for an existing row before processing. If a row exists, the handler MUST return `429 Too Many Requests`.

### 3.4 Fresh Authentication

Sensitive operations (export, delete) REQUIRE fresh authentication. In the current implementation, any authenticated session passes. The full re-authentication flow (JWT `iat` check, re-prompt) MUST be implemented in a future task (`T094-ext`).

### 3.5 Archive Contents

The archive MUST contain:

- **Profile**: user ID, name, email, account creation timestamp.
- **Documents**: all non-expired documents owned by the user, with:
  - Current content (decompressed).
  - All version metadata (number, hash, timestamp, author, changelog).
- **API key hashes**: key ID, name, prefix, SHA-256 hash, creation, expiry, revocation status. Raw key values are NEVER exported.
- **Audit log slice**: up to 10,000 most recent entries for the user, excluding IP addresses.
- **Webhooks**: URL, events, document scope, active status. Signing secrets are NEVER exported.

---

## 4. Audit Log Retention (T186)

### 4.1 RetentionPolicy Schema

```
RetentionPolicy {
  policyVersion:       u32   // 1
  auditLogHotDays:     u32   // 90
  auditLogTotalDays:   u32   // 2555 (≈ 7 years)
  softDeletedDocsDays: u32   // 30
  anonymousDocDays:    u32   // 1
  revokedApiKeyDays:   u32   // 90
  agentInboxDays:      u32   // 2
}
```

### 4.2 Hot/Cold Tiering

The `audit_logs` table retains entries for 90 days ("hot"). The nightly `runAuditRetentionJob` job:

1. Selects entries where `timestamp < NOW() - 90d AND archived_at IS NULL AND legal_hold = false`.
2. For each entry: serialises to JSON, writes to S3 at `audit/{date}/{id}.json`, inserts into `audit_archive`, marks `audit_logs.archived_at = NOW()`.
3. After the 7-year total retention window (`timestamp < NOW() - 2555d`), hard-deletes archived hot-DB entries that are not under legal hold.

### 4.3 Legal Hold

`POST /api/v1/audit/legal-hold` allows users to mark their own audit log entries with `legal_hold = true`.

**Non-negotiable**: Legal-hold entries MUST NOT be archived or hard-deleted regardless of age. This is enforced by the `eq(legalHold, false)` filter in the retention job.

### 4.4 Audit Export

`GET /api/v1/audit/export?from=<ISO>&to=<ISO>&format=json|csv`

Returns audit log entries for the requested date range. Returns only entries where `user_id = caller`. Maximum 50,000 entries per request.

---

## 5. Right-to-Erasure (T187)

### 5.1 Endpoint

**`DELETE /api/v1/users/me`**

| Property | Value |
|----------|-------|
| Authentication | Required |
| Fresh auth | Required |
| Effect | Soft-delete with 30-day grace period |

### 5.2 Soft-Delete Phase (immediate)

On confirmed deletion:

1. Set `users.deleted_at = NOW()`.
2. Set `documents.expires_at = NOW() + 30d` for all owned documents.
3. Pseudonymise `audit_logs.actor_id` to `[deleted:<sha256(userId)[0:16]>]`.
4. Revoke all API keys (`api_keys.revoked = true`).
5. Emit `user.deletion_initiated` audit log entry.

### 5.3 Undo Deletion

**`POST /api/v1/users/me/undo-deletion`**

Available for 30 days after soft-delete. Restores:
- `users.deleted_at = NULL`.
- `documents.expires_at = NULL` for soft-deleted owned documents.
- Emits `user.deletion_cancelled` audit log entry.

### 5.4 Hard-Delete Phase (background job, 30 days later)

The `processExpiredDeletions` function in `jobs/audit-retention.ts`:

1. Hard-deletes all owned documents (cascades versions, approvals, etc. via FK).
2. Hard-deletes webhooks and API keys.
3. **Pseudonymises** `audit_logs.actor_id` again (belt-and-suspenders).
4. **Pseudonymises** `users.name` and `users.email` — the user row is retained for audit purposes.
5. Issues a `deletion_certificate` with a SHA-256 integrity seal.

**Non-negotiable**: Audit log entries are NEVER hard-deleted. The tamper-evident chain MUST remain intact. Only the actor_id is pseudonymised.

### 5.5 Deletion Certificate

```json
{
  "userId": "<original_user_id>",
  "deletedAt": "<ISO 8601>",
  "resourceCounts": {
    "documents": 5,
    "versions": 23,
    "apiKeys": 2,
    "auditLogEntries": 301,
    "webhooks": 1
  }
}
```

The certificate is persisted in `deletion_certificates` with a SHA-256 hash. The table is NEVER deleted — it is the user's permanent proof of erasure.

---

## 6. Database Schema Changes

All changes are additive (no column drops, no table drops):

### 6.1 `users` table

| Column | Type | Description |
|--------|------|-------------|
| `deleted_at` | `bigint` (unix ms) | Soft-delete timestamp |
| `deletion_confirmed_at` | `bigint` | Email confirmation timestamp |
| `deletion_token` | `text` | Single-use email token |
| `deletion_token_expires_at` | `bigint` | Token expiry |
| `pseudonymized_at` | `bigint` | Hard-delete pseudonymisation timestamp |

### 6.2 `audit_logs` table

| Column | Type | Description |
|--------|------|-------------|
| `legal_hold` | `boolean NOT NULL DEFAULT false` | Legal-hold flag |
| `archived_at` | `bigint` | Archival timestamp (null = hot) |

### 6.3 New tables

| Table | Purpose |
|-------|---------|
| `audit_archive` | Cold-storage index for archived audit entries |
| `user_export_rate_limit` | Export rate limiter (1/user/day) |
| `deletion_certificates` | Immutable proof-of-erasure records |

---

## 7. Security Properties

- Raw API key values are NEVER exported.
- Webhook signing secrets are NEVER exported.
- IP addresses are NEVER included in the export.
- Audit log chain integrity is preserved during pseudonymisation (chain_hash is not recomputed).
- Legal-hold records cannot be deleted even by the owning user.
- Export and delete require authentication.
- Rate limiting prevents export abuse.

---

## 8. Testing

### Unit tests (`apps/backend/src/__tests__/data-lifecycle.test.ts`)

- 32 tests covering: archive integrity, pseudonym determinism, deletion certificate hash, grace period calculations, retention job filter logic, legal-hold invariant.

### Rust unit tests (`crates/llmtxt-core/src/export_archive.rs`)

- 7 tests: serialize, deserialize, tamper detection, round-trip byte-identity, version rejection, retention policy round-trip.

### Acceptance

- `cargo test` — all 381 library tests pass.
- `pnpm test` — all 432 backend tests pass.
- `tsc --noEmit` — zero errors.
- `biome check` — zero errors.
