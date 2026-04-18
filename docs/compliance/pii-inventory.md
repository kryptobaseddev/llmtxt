# PII Inventory

**Status**: Implemented (T168.1)
**Date**: 2026-04-18
**Owner**: Engineering / Data Protection

---

## Purpose

This document is the authoritative inventory of all personally identifiable
information (PII) stored by LLMtxt. It maps every table and column that holds
PII to its:

- **PII category** — the type of personal data
- **Retention tier** — urgency of enforcement (Critical / Standard / Operational / Anonymous)
- **Lawful basis** — GDPR Article 6 justification for processing
- **Retention period** — maximum age before eviction
- **Deletion action** — how data is disposed of (pseudonymize / hard-delete / archive)

This inventory drives the canonical retention policies in
`crates/llmtxt-core/src/retention.rs` (`canonical_policies()`) and the
nightly retention job at `apps/backend/src/jobs/retention.ts`.

---

## Tables and Columns

### `users` — Account profile

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text (UUID) | Persistent identifier | Critical | Contract performance | Account lifetime | Pseudonymize (row kept) |
| `name` | text | Direct identifier | Critical | Contract performance | Account lifetime + 30-day grace | Pseudonymize on erasure |
| `email` | text | Direct identifier | Critical | Contract performance | Account lifetime + 30-day grace | Pseudonymize on erasure |
| `created_at` | timestamp | Metadata | Operational | Contract performance | Account lifetime | Pseudonymize (row kept) |
| `deleted_at` | bigint (ms) | Deletion marker | Operational | Legal obligation | 30-day grace then hard-delete user row | Null after grace |

---

### `sessions` — Browser/API session tokens

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text | Session identifier | Critical | Contract performance | 30 days post-expiry | Hard-delete |
| `user_id` | text (FK) | Linked identifier | Critical | Contract performance | 30 days post-expiry | Hard-delete (cascade) |
| `token` | text | Secret credential | Critical | Contract performance | Expires at `expires_at` | Hard-delete |
| `ip_address` | text | Network identifier | Critical | Legitimate interests | 30 days post-expiry | Hard-delete |
| `user_agent` | text | Device fingerprint | Standard | Legitimate interests | 30 days post-expiry | Hard-delete |
| `expires_at` | timestamp | Metadata | Operational | Contract performance | 30 days post-expiry | Hard-delete |

**Retention job**: `sessions` — max 30 days post-expiry, hard-delete.

---

### `api_keys` — API key credentials

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text | Key identifier | Critical | Contract performance | 365 days from revocation | Hard-delete |
| `user_id` | text (FK) | Linked identifier | Critical | Contract performance | 365 days from revocation | Hard-delete |
| `key_hash` | text | Credential hash | Critical | Contract performance | 365 days from revocation; nullified on erasure | Hard-delete / Nullify |
| `key_prefix` | text | Display prefix | Standard | Contract performance | 365 days from revocation | Hard-delete |
| `name` | text | User-provided label | Standard | Contract performance | 365 days from revocation | Hard-delete |

**Note**: On right-to-erasure (`DELETE /users/me/erase`), `key_hash` is
replaced with a sentinel hash so the original secret cannot be recovered.
The full row is hard-deleted after the 365-day post-revocation window.

---

### `audit_logs` — Tamper-evident event log (T164)

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text (UUID) | Event identifier | Operational | Legal obligation | 7 years (90 days hot + rest cold) | Archive then retain |
| `user_id` | text | Actor reference | Operational | Legal obligation | 7 years | Pseudonymize only — NEVER hard-delete |
| `actor_id` | text | Actor identity | Operational | Legal obligation | 7 years | Pseudonymize on erasure (`[deleted:<hash>]`) |
| `action` | text | Action type | Operational | Legal obligation | 7 years | Archive (no PII) |
| `timestamp` | bigint | Event time | Operational | Legal obligation | 7 years | Archive (no PII) |
| `chain_hash` | text | Integrity proof | Operational | Legal obligation | 7 years | Archive (never modify) |

**Non-negotiable**: Audit log rows are NEVER hard-deleted. The `actor_id`
field is pseudonymized (`[deleted:<sha256_prefix>]`) on erasure to preserve
hash chain integrity per the T164 tamper-evident audit protocol.

---

### `webhooks` — Webhook configuration

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text | Integration identifier | Standard | Legitimate interests | Account lifetime | Hard-delete on erasure |
| `user_id` | text (FK) | Linked identifier | Standard | Legitimate interests | Account lifetime | Hard-delete |
| `url` | text | Target URL (may contain domain PII) | Standard | Legitimate interests | Account lifetime | Hard-delete on erasure |
| `secret` | text | Signing secret | Critical | Contract performance | Account lifetime | Hard-delete on erasure |

---

### `webhook_deliveries` — Delivery log

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text | Delivery identifier | Standard | Legitimate interests | 30 days | Hard-delete |
| `webhook_id` | text (FK) | Integration reference | Standard | Legitimate interests | 30 days | Hard-delete (cascade) |
| `event_id` | text | Event reference | Standard | Legitimate interests | 30 days | Hard-delete |

**Retention job**: `webhook_deliveries` — max 30 days, hard-delete.

---

### `documents` — User-authored documents

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text | Document identifier | Standard | Contract performance | Account lifetime + 30-day grace | Soft-delete then hard-delete |
| `owner_id` | text (FK) | Linked identifier | Standard | Contract performance | Account lifetime + 30-day grace | Hard-delete (cascade) |
| `slug` | text | User-chosen identifier | Standard | Contract performance | Account lifetime + 30-day grace | Hard-delete |
| `expires_at` | bigint | Deletion marker | Standard | Contract performance | 30-day grace period | Set on erasure |

---

### `versions` — Document version history

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | text (UUID) | Version identifier | Standard | Contract performance | Account lifetime + 30-day grace | Hard-delete (FK cascade from documents) |
| `created_by` | text | Author reference | Standard | Contract performance | Account lifetime + 30-day grace | Hard-delete (cascade) |
| `compressed_data` | bytea | User content | Standard | Contract performance | Account lifetime + 30-day grace | Hard-delete (cascade) |
| `content_hash` | text | Integrity proof | Operational | Legal obligation | Account lifetime + 30-day grace | Hard-delete (cascade) |

---

### `agent_pubkeys` — Agent Ed25519 identity keys

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | UUID | Key identifier | Standard | Contract performance | Until revoked | Hard-delete (FK cascade) |
| `agent_id` | text | Agent identity | Standard | Contract performance | Until revoked | Hard-delete |
| `pubkey` | bytea | Public key bytes | Standard | Contract performance | Until revoked | Hard-delete |
| `revoked_at` | timestamp | Revocation marker | Standard | Contract performance | Until revoked | Hard-delete |

---

### `agent_signature_nonces` — Replay attack prevention

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `nonce` | text | Cryptographic nonce | Standard | Legal obligation | 1 day | Hard-delete |
| `agent_id` | text | Agent reference | Standard | Legal obligation | 1 day | Hard-delete |
| `first_seen` | timestamp | Seen-at time | Standard | Legal obligation | 1 day | Hard-delete |

**Retention job**: `agent_signature_nonces` — max 1 day, hard-delete.

---

### `agent_inbox_messages` — Ephemeral A2A messages

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | UUID | Message identifier | Standard | Legitimate interests | 7 days | Hard-delete |
| `to_agent_id` | text | Recipient agent | Standard | Legitimate interests | 7 days | Hard-delete |
| `from_agent_id` | text | Sender agent | Standard | Legitimate interests | 7 days | Hard-delete |
| `envelope_json` | jsonb | Message payload | Standard | Legitimate interests | 7 days | Hard-delete |
| `expires_at` | bigint | Expiry time | Standard | Legitimate interests | 7 days | Hard-delete |

**Retention job**: `agent_inbox_messages` — max 7 days post-expiry, hard-delete.

---

### `section_embeddings` — pgvector semantic embeddings

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | UUID | Embedding identifier | Standard | Legitimate interests | 90 days | Hard-delete |
| `document_id` | text (FK) | Document reference | Standard | Legitimate interests | 90 days (FK cascade) | Hard-delete |
| `embedding` | text (vector JSON) | Derived from user content | Standard | Legitimate interests | 90 days | Hard-delete |
| `computed_at` | bigint | Computation time | Standard | Legitimate interests | 90 days | Hard-delete |

**Retention job**: `section_embeddings` — max 90 days, hard-delete.

---

### `usage_events` — Billing usage records

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| `id` | UUID | Event identifier | Operational | Legal obligation | 2 years (730 days) | Archive then hard-delete at 7 years |
| `user_id` | text (FK) | Linked identifier | Operational | Legal obligation | 2 years hot | Archive |
| `event_type` | text | Action type | Operational | Legal obligation | 2 years hot | Archive |
| `created_at` | bigint | Event time | Operational | Legal obligation | 2 years hot | Archive |

---

### `usage_rollups` — Aggregated billing metrics

| Column | Data Type | PII Category | Retention Tier | Lawful Basis | Retention Period | Deletion Action |
|--------|-----------|-------------|----------------|--------------|------------------|-----------------|
| All columns | various | Aggregated metrics (no direct PII) | Anonymous | Legitimate interests | No limit | Retain indefinitely |

**Note**: Rollup rows contain no direct identifiers — they are aggregated
counts per time bucket. No retention eviction applies.

---

## Summary by Tier

| Tier | Tables | Action |
|------|--------|--------|
| **Critical** | `users`, `sessions`, `api_keys` | Pseudonymize or hard-delete within defined windows |
| **Standard** | `documents`, `versions`, `webhooks`, `webhook_deliveries`, `agent_pubkeys`, `agent_signature_nonces`, `agent_inbox_messages`, `section_embeddings` | Hard-delete within defined windows |
| **Operational** | `audit_logs`, `usage_events`, `audit_archive` | Archive + pseudonymize; 7-year total retention |
| **Anonymous** | `usage_rollups` | Retain indefinitely |

---

## Related Documents

- [Right-to-Deletion](right-to-deletion.md) — GDPR Article 17 procedures
- [Retention Policy](retention-policy.md) — Audit log hot/cold archival
- [GDPR Erasure Deep](gdpr-erasure.md) — Deep erase cascade, SAR endpoint
- [SOC 2 Type 1 Readiness](soc2-type1-readiness.md) — Control mapping

---

## Canonical Policy Implementation

The machine-readable version of these policies lives in:

```
crates/llmtxt-core/src/retention.rs  →  canonical_policies()
apps/backend/src/jobs/retention.ts   →  runRetentionJob()
apps/backend/src/routes/user-data.ts →  DELETE /users/me/erase
                                         GET /users/me/sar
```
