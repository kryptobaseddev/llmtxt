# T107 — Signed Audit Chain: Specification

**Status**: Implemented
**Version**: 1.0
**Date**: 2026-04-18
**Author**: CLEO Lead (T107)
**RFC 2119 keywords apply throughout.**

---

## 1. Scope and Relationship to T164

T164 delivered the tamper-evident audit log foundation:
- `crates/llmtxt-core/src/merkle.rs` — `merkle_root` + `verify_merkle_proof` (native + WASM)
- `audit_logs.payload_hash` + `chain_hash` columns (additive migration)
- `audit_checkpoints` table with `merkle_root` + `tsr_token` (RFC 3161)
- Daily Merkle root checkpoint job
- `GET /api/v1/audit/verify` chain integrity endpoint
- `apps/backend/src/lib/rfc3161.ts` — FreeTSA client

T107 adds on top of T164:
- Server **ed25519 signing** of Merkle roots (cryptographic server attestation)
- `GET /api/v1/audit-logs/merkle-root/:date` — public signed root retrieval
- `POST /api/v1/audit-logs/verify` — range-verify with claimed root comparison
- `hash_audit_entry` + `verify_audit_chain` Rust convenience helpers
- Rust consumer example (`examples/audit-verifier/`)

---

## 2. T107 Acceptance Criteria — Reconciliation Table

| AC | Criterion | Status | Evidence |
|----|-----------|--------|----------|
| 1 | `hash_audit_entry` in `crates/llmtxt-core` | NEW (alias) | `merkle.rs::hash_audit_entry` (T164 payload_hash logic, Rust form) |
| 2 | `verify_chain` in `crates/llmtxt-core` | NEW (alias) | `merkle.rs::verify_audit_chain` (audit-specific wrapper, uses bft::verify_chain pattern) |
| 3 | `merkle_root` in `crates/llmtxt-core` | COVERED BY T164 | `merkle.rs::merkle_root` — commit covered by T164 |
| 4 | WASM bindings | COVERED BY T164 | `merkle_root_wasm`, `verify_merkle_proof_wasm` — covered by T164 |
| 5 | `audit_logs.prev_hash` + `entry_hash` columns | COVERED BY T164 (naming differs) | See §3 — T164 uses `chain_hash`/`payload_hash`; T107 adopts T164 names |
| 6 | Genesis entry with `prev_hash = zero` | COVERED BY T164 | `GENESIS_HASH = '0'.repeat(64)` in audit.ts |
| 7 | Periodic Merkle root (daily) | COVERED BY T164 | `audit-checkpoint.ts::createCheckpointForDate` |
| 8 | Merkle roots SIGNED with server ed25519 key | NEW | `audit-signing-key.ts` + `merkle.rs::sign_merkle_root` + updated checkpoint job |
| 9 | `GET /api/v1/audit-logs/merkle-root/:date` | NEW | `audit-verify.ts::auditMerkleRootRoutes` |
| 10 | `POST /api/v1/audit-logs/verify` range-verify | NEW | `audit-verify.ts::auditRangeVerifyRoutes` |
| 11 | Background job validates chain integrity | COVERED BY T164 | `audit-checkpoint.ts` daily job |
| 12 | Tests: tamper detection + Rust consumer | NEW | `audit.test.ts` + `merkle.rs` unit tests |

---

## 3. Column Naming Decision (T107 vs T164)

**Decision: ADOPT T164 column names. No rename. No breaking change.**

T107's original spec used `prev_hash` and `entry_hash`. T164 was implemented with:
- `payload_hash` — the SHA-256 of the canonical event serialization (= T107's `entry_hash`)
- `chain_hash` — SHA-256(prev_chain_hash || payload_hash) (= T107's intended "chain link")

T164's naming is clearer and is already in production. All T107 code uses T164's names.
The Rust `hash_audit_entry` function computes `payload_hash` (same algorithm).
The Rust `verify_audit_chain` function verifies the `chain_hash` sequence.

---

## 4. ed25519 Signing Protocol

### 4.1 Key Management

The server ed25519 signing key is managed via the `AUDIT_SIGNING_KEY` environment variable:

- **Format**: 64-char lowercase hex (32-byte raw private key seed, ed25519-dalek convention)
- **Production**: MUST be set to a stable key (e.g., stored in Railway Secrets). If unset in production, the server MUST log a WARNING and auto-generate an ephemeral key (roots will not be independently verifiable across restarts).
- **Development**: Auto-generates a fresh ephemeral key on startup if `AUDIT_SIGNING_KEY` is unset. Logs the public key hex for local testing.
- **Key ID**: First 16 hex chars of SHA-256(pubkey_hex) — deterministic, public-safe fingerprint.

### 4.2 Signature Format

The signed message is the canonical payload:

```
{merkle_root_hex}|{checkpoint_date_YYYY-MM-DD}
```

Both are ASCII. The signature is computed over `SHA-512(payload)` using ed25519-dalek (Schnorr over Curve25519). The signature is returned as 128-char lowercase hex (64 raw bytes).

### 4.3 Schema Extension (additive)

`audit_checkpoints` gains two nullable columns via migration:

| Column | Type | Description |
|--------|------|-------------|
| `signed_root_sig` | `text` | 128-char hex ed25519 signature, or null if key not configured |
| `signing_key_id` | `text` | 16-char key fingerprint, or null |

---

## 5. API Contract

### 5.1 `GET /api/v1/audit-logs/merkle-root/:date`

**Authentication**: Admin required.

**Path parameter**: `date` — ISO 8601 date string `YYYY-MM-DD`.

**Response (checkpoint exists)**:
```json
{
  "checkpoint_date": "2026-04-18",
  "root": "<64-char hex>",
  "signature": "<128-char hex | null>",
  "signing_key_id": "<16-char hex | null>",
  "timestamp_token": "<hex DER | null>",
  "event_count": 42
}
```

**Response (no checkpoint)**:
```
HTTP 404  { "error": "NO_CHECKPOINT", "message": "No checkpoint for 2026-04-18" }
```

### 5.2 `POST /api/v1/audit-logs/verify`

**Authentication**: Admin required.

**Request body**:
```json
{
  "from_id": "<audit_log row UUID>",
  "to_id":   "<audit_log row UUID>",
  "claimed_root": "<64-char hex>"
}
```

**Response (valid)**:
```json
{
  "valid": true,
  "matched_root": "<64-char hex>",
  "event_count": 10
}
```

**Response (invalid)**:
```json
{
  "valid": false,
  "matched_root": "<64-char hex>",
  "first_invalid_at": "<row UUID | null>",
  "event_count": 10
}
```

**Response (400)**:
```json
{ "error": "INVALID_REQUEST", "message": "from_id, to_id, and claimed_root are required" }
```

---

## 6. Rust API Extensions

```rust
// In crates/llmtxt-core/src/merkle.rs

/// Compute the payload_hash for a single audit log entry.
/// Format: SHA-256("{id}|{event_type}|{actor_id}|{resource_id}|{timestamp_ms}")
/// NULL fields are represented as empty strings.
pub fn hash_audit_entry(
    id: &str,
    event_type: &str,
    actor_id: &str,
    resource_id: &str,
    timestamp_ms: u64,
) -> [u8; 32];

/// Verify the audit log hash chain for a slice of entries.
/// Each entry is (id, event_type, actor_id, resource_id, timestamp_ms, stored_chain_hash_hex).
/// Returns true if all chain hashes are consistent with the genesis sentinel.
pub fn verify_audit_chain(
    entries: &[AuditEntry],
) -> bool;

/// Sign a Merkle root with an ed25519 private key.
/// Returns (signature_hex: String, key_id: String).
pub fn sign_merkle_root(
    sk_bytes: &[u8; 32],
    root_hex: &str,
    date_str: &str,
) -> Result<(String, String), String>;
```

---

## 7. Rust Consumer Example

`examples/audit-verifier/` — standalone Rust binary that:
1. Fetches audit log rows from `GET /api/v1/audit-logs` (paginated)
2. Fetches the signed checkpoint from `GET /api/v1/audit-logs/merkle-root/:date`
3. Recomputes `payload_hash` for each entry using `hash_audit_entry`
4. Verifies the chain using `verify_audit_chain`
5. Recomputes the Merkle root using `merkle_root`
6. Verifies the server signature using `verify_submission` (identity.rs)
7. Prints a pass/fail summary

---

## 8. Security Properties

| Property | Mechanism |
|----------|-----------|
| Append-only integrity | chain_hash links: tamper of any row invalidates all subsequent rows |
| Daily anchoring | RFC 3161 TSR from FreeTSA (external, auditable clock) |
| Server attestation | ed25519 signature on Merkle root — proves server saw this root |
| Independent verifiability | Any party with the public key can verify without trusting the server |
| Public key discovery | Signing key_id in response; full pubkey retrievable via `/.well-known/audit-pubkey.json` (future) |

---

## 9. References

- `docs/specs/T164-tamper-evident-audit-log.md` — T164 foundation spec
- `crates/llmtxt-core/src/merkle.rs` — Merkle tree + audit helpers
- `crates/llmtxt-core/src/identity.rs` — ed25519 sign/verify primitives
- `apps/backend/src/lib/audit-signing-key.ts` — server key management
- `apps/backend/src/jobs/audit-checkpoint.ts` — daily checkpoint job
- `apps/backend/src/routes/audit-verify.ts` — all audit routes
- `examples/audit-verifier/` — Rust independent verifier
