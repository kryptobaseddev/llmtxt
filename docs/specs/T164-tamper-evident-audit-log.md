# T164 — Tamper-Evident Audit Log: Specification

**Status**: Implemented  
**Version**: 1.0  
**Date**: 2026-04-18  
**Author**: CLEO Lead (T164)  
**RFC 2119 keywords apply throughout.**

---

## 1. Introduction

This specification defines the tamper-evident audit log for LLMtxt.  
Every security-relevant event MUST be recorded in the `audit_log` table with a cryptographic hash chain and periodically anchored to an external RFC 3161 timestamp service. Any party MUST be able to verify that the log has not been altered since its creation.

---

## 2. Definitions

- **Event**: A security-relevant operation (login, key creation, document state transition, approval, rejection, API key management).
- **Leaf hash**: `SHA-256(canonical_event_serialization)` where canonical serialization is `id|event_type|actor_id|resource_id|timestamp_ms` joined with `|`.
- **Chain hash**: `SHA-256(prev_chain_hash_bytes || payload_hash_bytes)`. For the first event in the database, `prev_chain_hash` is the 32-byte all-zeros genesis sentinel.
- **Merkle root**: The root of a binary SHA-256 Merkle tree over all leaf hashes for a given day. Implemented in `crates/llmtxt-core/src/merkle.rs`.
- **RFC 3161 timestamp**: A signed timestamp token (TSR) produced by a trusted Time Stamping Authority (TSA). Stored as hex-encoded DER bytes.

---

## 3. Database Schema

### 3.1 `audit_logs` table (extended)

The existing `audit_logs` table MUST be extended with two columns via an additive-only migration:

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `payload_hash` | `text` | YES (null for legacy rows) | SHA-256 hex of canonical event fields |
| `chain_hash` | `text` | YES (null for legacy rows) | SHA-256 hex of `prev_chain_hash \|\| payload_hash` |

**Canonical event serialization** (used to compute `payload_hash`):

```
{id}|{event_type}|{actor_id_or_empty}|{resource_id_or_empty}|{timestamp_ms}
```

All fields MUST be UTF-8 strings. NULL values MUST be replaced with the empty string.

### 3.2 `audit_checkpoints` table (new)

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | `text` (PK) | NO | `crypto.randomUUID()` |
| `checkpoint_date` | `text` | NO | ISO 8601 date `YYYY-MM-DD` of the covered day |
| `merkle_root` | `text` | NO | Hex-encoded 32-byte Merkle root |
| `tsr_token` | `text` | YES | Hex-encoded DER RFC 3161 token (null if TSA unavailable) |
| `event_count` | `integer` | NO | Number of events in this checkpoint |
| `created_at` | `timestamp` | NO | Wall-clock time when checkpoint was written |

---

## 4. Hash Chain Protocol

### 4.1 Append

When a new `audit_logs` row is inserted:

1. Compute `payload_hash = SHA-256(canonical_serialization)`.
2. Fetch the `chain_hash` of the most recently inserted row (by `timestamp` DESC). If no prior row exists, use the 32-byte zero sentinel.
3. Compute `chain_hash = SHA-256(prev_chain_hash_bytes || payload_hash_bytes)` where both are the raw 32-byte values (not hex).
4. Store both as lowercase 64-character hex strings.

This MUST be performed inside a serialized write — either a database transaction or a single-writer mutex in the application layer. Concurrent audit appends without serialization WILL produce an inconsistent chain.

### 4.2 Verify

The `GET /api/v1/audit/verify` endpoint MUST:

1. Fetch all `audit_logs` rows that have a non-null `chain_hash`, ordered by `timestamp ASC`.
2. Re-derive each `chain_hash` from the preceding row's stored `chain_hash` and this row's stored `payload_hash`.
3. Compare the re-derived hash to the stored `chain_hash`.
4. On first mismatch, return `{valid: false, firstInvalidAt: "<row_id>"}`.
5. If all rows verify, return `{valid: true, chainLength: N, lastCheckpointAt: "<ISO8601_or_null>"}`.

---

## 5. Merkle Tree Structure

The Merkle tree uses binary SHA-256 hashing:

- **Leaves**: Each leaf is the `payload_hash` of one `audit_logs` row (32 raw bytes).
- **Internal nodes**: `SHA-256(left_child_bytes || right_child_bytes)`.
- **Odd node duplication**: When a level has an odd number of nodes, the last node is duplicated (Bitcoin convention).
- **Empty tree**: `merkle_root([]) = [0u8; 32]`.
- **Single leaf**: `merkle_root([leaf]) = leaf`.

Implementation lives in `crates/llmtxt-core/src/merkle.rs` and is exported as both native Rust and WASM bindings. The native and WASM outputs MUST be byte-identical for any given input.

---

## 6. External Timestamp Anchor

### 6.1 Provider choice

The daily checkpoint job MUST submit the Merkle root to **FreeTSA** (https://freetsa.org/tsr) using RFC 3161. This service is free, publicly accessible, and uses a WebTrust-audited CA.

Rationale: No account required, no rate limiting for daily requests, long-standing public service. Alternative: DigiCert public TSA. Both are acceptable.

### 6.2 Request format

```
POST https://freetsa.org/tsr
Content-Type: application/timestamp-query
Body: DER-encoded RFC 3161 TimeStampReq wrapping SHA-256(merkle_root)
```

### 6.3 Fallback behavior

If the TSA is unavailable or returns an error:

- The checkpoint row MUST still be inserted with `tsr_token = null`.
- The failure MUST be logged at WARN level with the HTTP status or network error.
- The checkpoint MUST NOT be treated as fatal — the Merkle root provides local tamper-evidence even without external anchoring.
- The `GET /api/v1/audit/verify` response MUST include `tsrAnchored: false` when `tsr_token` is null on the latest checkpoint.

---

## 7. API Contract

### 7.1 `GET /api/v1/audit/verify`

**Authentication**: Requires admin session (existing `requireAuth` + admin role check).

**Response (chain intact)**:

```json
{
  "valid": true,
  "chainLength": 1234,
  "lastCheckpointAt": "2026-04-17T00:00:00.000Z",
  "tsrAnchored": true
}
```

**Response (chain broken)**:

```json
{
  "valid": false,
  "firstInvalidAt": "<audit_log_row_id>",
  "chainLength": 1234,
  "lastCheckpointAt": "2026-04-17T00:00:00.000Z"
}
```

**Response (no chain data)**:

```json
{
  "valid": true,
  "chainLength": 0,
  "lastCheckpointAt": null,
  "tsrAnchored": false
}
```

---

## 8. Security Events Captured

The following event types MUST be captured in the tamper-evident chain:

| Event type | Trigger |
|------------|---------|
| `auth.login` | Successful sign-in |
| `auth.logout` | Sign-out |
| `auth.register` | New account created |
| `api_key.create` | API key issued |
| `api_key.revoke` | API key revoked |
| `lifecycle.transition` | Document state change |
| `approval.submit` | Approval submitted |
| `approval.reject` | Approval rejected |
| `document.create` | Document created |
| `document.delete` | Document deleted |

---

## 9. Rust API

```rust
// In crates/llmtxt-core/src/merkle.rs

/// Compute the SHA-256 Merkle root over a slice of 32-byte leaf hashes.
/// Uses binary tree with odd-node duplication (Bitcoin convention).
/// Returns [0u8; 32] for empty input.
pub fn merkle_root(leaves: &[[u8; 32]]) -> [u8; 32];

/// Verify a Merkle inclusion proof.
/// proof is a slice of (sibling_hash, is_right_sibling) pairs.
pub fn verify_merkle_proof(
    root: &[u8; 32],
    leaf: &[u8; 32],
    proof: &[([u8; 32], bool)],
) -> bool;
```

---

## 10. WASM Bindings

```typescript
// JSON-in / hex-out bindings

// merkle_root_wasm(leavesHexJson: string) -> string (hex)
// Input: JSON array of 64-char hex strings, one per leaf
// Output: 64-char hex string of root, or {"error":"..."} on failure

// verify_merkle_proof_wasm(rootHex, leafHex, proofJson) -> bool
```

---

## 11. References

- [RFC 3161 — Internet X.509 PKI Time-Stamp Protocol](https://datatracker.ietf.org/doc/html/rfc3161)
- [FreeTSA](https://freetsa.org/) — free public RFC 3161 TSA
- [Bitcoin Merkle tree](https://en.bitcoin.it/wiki/Protocol_documentation#Merkle_Trees)
- `crates/llmtxt-core/src/bft.rs` — existing hash_chain_extend primitive
- `apps/backend/src/middleware/audit.ts` — existing audit middleware
- `apps/backend/src/db/schema-pg.ts` — database schema
