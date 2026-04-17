# CRR Column Type Strategy — LLMtxt LocalBackend

**Decision Record**: DR-P2-04 (extended detail)
**Version**: 1.0.0
**Status**: APPROVED
**Date**: 2026-04-17
**Parent Spec**: docs/specs/P2-cr-sqlite.md §4
**RFC 2119 Key words**: MUST, MUST NOT, SHOULD, MAY

---

## 1. Purpose

This document assigns a cr-sqlite merge semantic to every column of every
LocalBackend table (all 13 tables from
`packages/llmtxt/src/local/schema-local.ts`, validated 2026-04-17).

It is the authoritative reference for implementors of T400 (P2.2) through
T402–P2.11. The rules here drive:

- Which tables receive `crsql_as_crr()` calls (§3.2 of P2-cr-sqlite.md).
- Which columns require application-level merge instead of cr-sqlite LWW.
- Which columns carry post-sync semantic constraints.

---

## 2. Merge Semantic Reference

| Semantic | Notation | cr-sqlite mechanism |
|---|---|---|
| Last-Write-Wins | `LWW` | Default CRR behaviour — logical clock wins per row |
| Counter (recomputed) | `CTR-DERIVED` | NOT a cr-sqlite counter CRR; recomputed at sync time |
| Append-only OR-set | `OR-SET` | LWW on immutable-PK rows; duplicate UUIDs negligible |
| Application merge (Loro) | `LORO` | **Application-level `doc.import()` MANDATORY** (DR-P2-04) |
| Local sequence | `LOCAL-SEQ` | LWW; post-sync consumers MUST sort by timestamp, NOT this column |

---

## 3. Table-by-Table Column Strategy

### 3.1 `documents`

SQL table name: `documents`

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `slug` | text | `LWW` | Deterministic from title; later write wins |
| `title` | text | `LWW` | Later write wins |
| `state` | text | `LWW` | Lifecycle enum (DRAFT/REVIEW/LOCKED/ARCHIVED); later write wins |
| `created_by` | text | `LWW` | Set on creation; immutable in practice |
| `visibility` | text | `LWW` | Later write wins |
| `created_at` | integer | `LWW` | Set on creation; immutable |
| `updated_at` | integer | `LWW` | Later write wins; used as tiebreaker |
| `version_count` | integer | `CTR-DERIVED` | **MUST NOT** use cr-sqlite counter CRR. MUST be recomputed from the `versions` table after sync (COUNT of rows per `document_id`). Treating it as LWW is acceptable as a cache; the authoritative value is always derived. |
| `labels_json` | text (JSON) | `LWW` | Later write wins; agents merge intentionally via re-write |
| `expires_at` | integer | `LWW` | Later write wins |
| `event_seq_counter` | integer | `LOCAL-SEQ` | Monotonically increasing local to each agent. **MUST NOT** be used as a global event sequence after cross-agent sync. Post-sync consumers MUST sort events by `created_at`, not this counter. |
| `bft_f` | integer | `LWW` | Document-level BFT fault-tolerance parameter; later write wins |
| `required_approvals` | integer | `LWW` | Later write wins |
| `approval_timeout_ms` | integer | `LWW` | Later write wins |

### 3.2 `versions`

SQL table name: `versions`

Version rows are write-once after creation. LWW on the PK resolves any
concurrent creation of the same `(document_id, version_number)` pair by logical
timestamp.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `document_id` | text | `LWW` | Set on creation; immutable |
| `version_number` | integer | `LWW` | Set on creation; immutable |
| `compressed_data` | blob | `LWW` | Binary content blob. LWW is correct because a version row is write-once; the blob does not change after initial write. |
| `content_hash` | text | `LWW` | SHA-256 of content; immutable |
| `token_count` | integer | `LWW` | Set on creation |
| `created_at` | integer | `LWW` | Set on creation; immutable |
| `created_by` | text | `LWW` | Set on creation; immutable |
| `changelog` | text | `LWW` | Set on creation; immutable |
| `patch_text` | text | `LWW` | Set on creation; immutable |
| `base_version` | integer | `LWW` | Set on creation; immutable |
| `storage_type` | text | `LWW` | `inline` or `filesystem`; set on creation |
| `storage_key` | text | `LWW` | Set on creation; immutable |

### 3.3 `state_transitions`

SQL table name: `state_transitions`

Append-only audit records. The same state transition MUST NOT be written twice
(transition is idempotent by document lifecycle rules). LWW on PK is safe.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `document_id` | text | `OR-SET` | Append-only; LWW on immutable PK |
| `from_state` | text | `OR-SET` | Set on creation; immutable |
| `to_state` | text | `OR-SET` | Set on creation; immutable |
| `changed_by` | text | `OR-SET` | Set on creation; immutable |
| `changed_at` | integer | `OR-SET` | Set on creation; immutable |
| `reason` | text | `OR-SET` | Set on creation; immutable |
| `at_version` | integer | `OR-SET` | Set on creation; immutable |

### 3.4 `approvals`

SQL table name: `approvals`

If two peers independently approve or reject the same approval slot, the later
write wins. This is the intended behaviour for async BFT approval workflows.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `document_id` | text | `LWW` | Set on creation; immutable |
| `reviewer_id` | text | `LWW` | Set on creation; immutable |
| `status` | text | `LWW` | PENDING/APPROVED/REJECTED/STALE; later write wins |
| `timestamp` | integer | `LWW` | Later write wins |
| `reason` | text | `LWW` | Later write wins |
| `at_version` | integer | `LWW` | Set on creation; immutable |
| `sig_hex` | text | `LWW` | Set atomically with `status`; never updated |
| `canonical_payload` | text | `LWW` | Set atomically with `status`; never updated |
| `chain_hash` | text | `LWW` | Set atomically with `status`; never updated |
| `prev_chain_hash` | text | `LWW` | Set atomically with `status`; never updated |
| `bft_f` | integer | `LWW` | Document-level parameter snapshot; set on creation |

### 3.5 `section_crdt_states`

SQL table name: `section_crdt_states`

**This table contains the critical DR-P2-04 column.**

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `document_id` | PK component text | — | Composite primary key component |
| `section_id` | PK component text | — | Composite primary key component |
| `clock` | integer | `LWW` | Logical clock; later write wins |
| `updated_at` | integer | `LWW` | Timestamp; later write wins |
| `crdt_state` | blob | `LORO` | **MANDATORY application-level merge. MUST NOT use cr-sqlite LWW.** See §4. |

### 3.6 `section_crdt_updates`

SQL table name: `section_crdt_updates`

Rows are append-only (identified by `id` primary key). The update blob is
written once and never modified. LWW on the row PK is safe because the blob
itself is never updated in-place.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `document_id` | text | `OR-SET` | Set on creation; immutable |
| `section_id` | text | `OR-SET` | Set on creation; immutable |
| `update_blob` | blob | `OR-SET` | Raw Loro/Yjs update binary. Append-only rows: LWW on immutable PK is safe. The blob is never updated in-place. |
| `client_id` | text | `OR-SET` | Set on creation; immutable |
| `seq` | integer | `LOCAL-SEQ` | Local sequence per `(document_id, section_id, client_id)`. **MUST NOT** be used as global ordering after cross-agent sync. Sort by `created_at` instead. |
| `created_at` | integer | `OR-SET` | Set on creation; immutable |

### 3.7 `document_events`

SQL table name: `document_events`

Append-only event log. Events are immutable once created. UUID collision
probability is negligible; LWW is acceptable if it occurs.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `document_id` | text | `OR-SET` | Set on creation; immutable |
| `seq` | integer | `LOCAL-SEQ` | **Post-sync constraint**: consumers MUST sort events by `created_at`, NOT by `seq`. `seq` is local-monotonic per agent and is meaningless as a global order after cross-agent sync. |
| `event_type` | text | `OR-SET` | Set on creation; immutable |
| `actor_id` | text | `OR-SET` | Set on creation; immutable |
| `payload_json` | text | `OR-SET` | Set on creation; immutable |
| `idempotency_key` | text | `OR-SET` | Set on creation; immutable |
| `created_at` | integer | `OR-SET` | Set on creation; global sort key after sync |
| `prev_hash` | text | `OR-SET` | Hash chain integrity; set on creation |

### 3.8 `agent_pubkeys`

SQL table name: `agent_pubkeys`

A revocation (setting `revoked_at`) MUST win over a concurrent "still active"
write. LWW by logical timestamp achieves this.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `agent_id` | text | `LWW` | Set on creation; immutable |
| `pubkey_hex` | text | `LWW` | Set on creation; immutable |
| `label` | text | `LWW` | Later write wins |
| `created_at` | integer | `LWW` | Set on creation; immutable |
| `revoked_at` | integer | `LWW` | Revocation MUST win over null; LWW by logical timestamp is correct. A non-null `revoked_at` written later MUST supersede any concurrent null. |

### 3.9 `agent_signature_nonces`

SQL table name: `agent_signature_nonces`

Append-only anti-replay records. Once a nonce is recorded, its row is
immutable. LWW on `(nonce)` PK is safe.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `nonce` | PK text | — | Primary key; CRR key |
| `agent_id` | text | `OR-SET` | Set on creation; immutable |
| `first_seen` | integer | `OR-SET` | Set on creation; immutable |
| `expires_at` | integer | `OR-SET` | Set on creation; immutable |

### 3.10 `section_leases`

SQL table name: `section_leases`

Lease conflicts are expected. Last writer wins by logical timestamp because the
lease holder that writes last has the most recent TTL.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `resource` | text | `LWW` | Unique index enforced; set on creation |
| `holder` | text | `LWW` | Later write wins (new holder acquires after expiry or release) |
| `acquired_at` | integer | `LWW` | Set on each acquire; later write wins |
| `expires_at` | integer | `LWW` | Later write wins (renewal updates TTL). `exp=0` means "never expires" — guard in ALL time comparisons. |

### 3.11 `agent_inbox_messages`

SQL table name: `agent_inbox_messages`

Messages are immutable once created. LWW on PK is safe for append-only rows.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `to_agent_id` | text | `OR-SET` | Set on creation; immutable |
| `envelope_json` | text | `OR-SET` | Full signed A2A envelope; set on creation; immutable |
| `created_at` | integer | `OR-SET` | Set on creation; immutable |
| `exp` | integer | `OR-SET` | Set on creation; immutable. `exp=0` means "never expires" — guard in ALL time comparisons. |

### 3.12 `scratchpad_entries`

SQL table name: `scratchpad_entries`

Messages are immutable once created. LWW on PK is safe for append-only rows.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `to_agent_id` | text | `OR-SET` | Set on creation; immutable |
| `from_agent_id` | text | `OR-SET` | Set on creation; immutable |
| `payload_json` | text | `OR-SET` | Set on creation; immutable |
| `created_at` | integer | `OR-SET` | Set on creation; immutable |
| `exp` | integer | `OR-SET` | Set on creation; immutable. `exp=0` means "never expires" — guard in ALL time comparisons. |

### 3.13 `section_embeddings`

SQL table name: `section_embeddings`

LWW is correct because embeddings are recomputed deterministically from
content. Merging two float32 vectors would produce nonsense. After a version
merge, callers MUST re-embed to avoid stale vectors.

| Column | Type | Merge semantic | Rationale / constraint |
|---|---|---|---|
| `id` | PK text | — | Primary key; CRR key |
| `document_id` | text | `LWW` | Set on creation; immutable |
| `version_number` | integer | `LWW` | Set on creation; immutable |
| `section_key` | text | `LWW` | Set on creation; immutable |
| `embedding_blob` | blob | `LWW` | Float32Array vector. LWW on `(document_id, section_key)` unique index. LWW is correct because embeddings are deterministic from content; blending two vectors is wrong. After a version merge, callers MUST re-embed. |
| `dimensions` | integer | `LWW` | Set on creation; immutable |
| `model_id` | text | `LWW` | Set on creation; immutable |
| `created_at` | integer | `LWW` | Set on creation |

---

## 4. Loro Blob Merge: DR-P2-04 (MANDATORY)

**Owner mandate (2026-04-17)**: cr-sqlite LWW MUST NOT be used on Loro CRDT
blob columns. This is a correctness requirement, not optional. Violating it
silently corrupts collaborative editing state.

### 4.1 Affected Columns

| Table | Column | Column name (SQL) | Status |
|---|---|---|---|
| `section_crdt_states` | `crdt_state` | `crdt_state` | ACTIVE (post-P1.7 rename from `yrs_state`) |

Note: `section_crdt_updates.update_blob` stores append-only Loro update
messages, not consolidated state. Because rows are append-only (never updated
in-place), LWW on the row PK is safe. The blob itself does not participate in
cr-sqlite merge as a field-level conflict.

### 4.2 Required Merge Path in `applyChanges`

The implementation of `applyChanges(changeset: Uint8Array)` MUST:

1. Apply the changeset via cr-sqlite's native mechanism.
2. After applying, iterate rows where `crdt_state` was updated by the
   changeset.
3. For each such row, fetch both the local blob and the incoming blob.
4. Call `crdt_merge_updates([local_blob, remote_blob])` using the Loro API
   (provided by `crates/llmtxt-core` WASM after P1 ships).
5. Write the merged result back to `crdt_state`.
6. Steps 1–5 MUST execute inside a single SQLite transaction to be atomic.

### 4.3 Prohibition

The following pattern is PROHIBITED and MUST NOT appear in any implementation:

```typescript
// PROHIBITED — violates DR-P2-04
db.exec(`INSERT INTO crsql_changes SELECT * FROM crsql_deserialize(?)`);
// crdt_state is now overwritten by LWW — this corrupts Loro state
```

The integration test P2.11 MUST verify this prohibition by confirming that if
cr-sqlite LWW were applied to `crdt_state`, the two-peer convergence test
fails. This test MUST pass (proving LWW is disabled for blob columns).

---

## 5. Post-Sync Sorting Requirement

### 5.1 `event_seq` / `seq` columns

The following columns are local-monotonic sequences that become meaningless as
global ordering signals after cross-agent sync:

| Table | Column | Post-sync sort key |
|---|---|---|
| `documents` | `event_seq_counter` | Not used for ordering — internal counter only |
| `document_events` | `seq` | Sort by `created_at` (unix ms) |
| `section_crdt_updates` | `seq` | Sort by `created_at` (unix ms) |

**Rule**: consumers of `document_events` MUST sort by `created_at`, NOT by
`seq`, after cross-agent sync. This MUST be documented in all query helpers
that expose events to callers.

A lint rule SHOULD be added to the codebase to detect `ORDER BY seq` on the
`document_events` table and emit a warning.

---

## 6. `version_count` Derivation

`documents.version_count` is a cached counter. After cross-agent sync,
implementors MUST recompute it:

```sql
UPDATE documents
SET version_count = (
  SELECT COUNT(*) FROM versions WHERE document_id = documents.id
)
WHERE id IN (SELECT DISTINCT document_id FROM crsql_changes WHERE db_version > ?);
```

This recomputation MUST happen in the same transaction as `applyChanges`.

---

## 7. `exp = 0` Guard

The following columns use `exp = 0` to mean "never expires":

| Table | Column |
|---|---|
| `section_leases` | `expires_at` |
| `agent_inbox_messages` | `exp` |
| `scratchpad_entries` | `exp` |

Every time comparison on these columns MUST guard:

```typescript
// CORRECT
const isActive = lease.expiresAt === 0 || lease.expiresAt > Date.now();

// PROHIBITED — misses the never-expires case
const isActive = lease.expiresAt > Date.now();
```

This guard applies both in LocalBackend query logic and in any cr-sqlite
changeset filtering that considers expiry.

---

## 8. Summary: Columns Requiring Special Handling

The following columns require attention beyond simple LWW. All other columns
use LWW and need no special treatment.

| Table.Column | Rule | Risk if violated |
|---|---|---|
| `section_crdt_states.crdt_state` | `LORO` application merge MANDATORY | Silent collaborative state corruption |
| `documents.version_count` | Recompute from `versions` after sync | Stale count; incorrect version display |
| `documents.event_seq_counter` | Local only; do not expose as global | Incorrect event ordering |
| `document_events.seq` | Sort by `created_at`; not `seq` | Incorrect event ordering across agents |
| `section_crdt_updates.seq` | Sort by `created_at` | Incorrect update ordering |
| `section_leases.expires_at` | `exp=0` guard required | Active lease incorrectly treated as expired |
| `agent_inbox_messages.exp` | `exp=0` guard required | Permanent messages incorrectly dropped |
| `scratchpad_entries.exp` | `exp=0` guard required | Permanent messages incorrectly dropped |
| `agent_pubkeys.revoked_at` | LWW; non-null MUST win over null | Revoked key accepted as active |
| `section_embeddings.embedding_blob` | Re-embed after version merge | Stale vectors; incorrect semantic search |
