# SPEC-T147: Ed25519 Verified Agent Identity

**Version**: 1.0.0
**Date**: 2026-04-15
**Epic**: T147 — Multi-Agent: Verified agent identity Phase 2
**RFC 2119 keywords**: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in RFC 2119.

---

## 1. Scope

This specification covers:
- The Ed25519 sign and verify primitives in `crates/llmtxt-core`
- The `agent_pubkeys` DB schema and registration API
- The `verifyAgentSignature` server middleware
- The `AgentIdentity` class in `packages/llmtxt`
- The cryptographic receipt in write response bodies
- The `/.well-known/agents/:id` public key discovery endpoint (stub only; MA-3 owns full impl)

Out of scope: key rotation (T086), Byzantine quorum (MA-8), PII/GDPR (SEC-7).

---

## 2. Rust Core: `crates/llmtxt-core`

### 2.1 Module

A new module `src/identity.rs` MUST be created alongside the existing `src/crypto.rs`.

### 2.2 Functions

**S-RUST-01**: The `identity.rs` module MUST export:

```rust
pub fn sign_submission(private_key_bytes: &[u8; 32], payload_bytes: &[u8]) -> [u8; 64]
pub fn verify_submission(public_key_bytes: &[u8; 32], payload_bytes: &[u8], sig_bytes: &[u8; 64]) -> bool
```

**S-RUST-02**: `sign_submission` MUST use the `ed25519-dalek` crate `SigningKey::sign()` method
with `ed25519-dalek` version ≥ 2.0.0.

**S-RUST-03**: `verify_submission` MUST return `false` (not panic) when signature bytes
are malformed or the key bytes are invalid.

**S-RUST-04**: Both functions MUST be annotated with
`#[cfg_attr(feature = "wasm", wasm_bindgen)]` AND
`#[cfg_attr(feature = "napi", napi)]`.

**S-RUST-05**: `Cargo.toml` MUST add `ed25519-dalek = { version = "2", features = ["rand_core"] }`.
For the `wasm32` target, `getrandom = { version = "0.2", features = ["js"] }` MUST be added
under `[target.'cfg(target_arch = "wasm32")'.dependencies]`.

**S-RUST-06**: Tests MUST include:
- A known-good vector: sign a fixed payload with a fixed key, assert the 64-byte signature
  matches a pre-computed value.
- Round-trip: sign(privkey, payload) → verify(pubkey, payload, sig) == true.
- Tamper: modify one byte of payload after signing → verify returns false.
- Both `#[test]` (native) and `#[wasm_bindgen_test]` (WASM) variants MUST exist.

### 2.3 Key Generation (helper, not exported via WASM)

**S-RUST-07**: A `generate_keypair() -> ([u8; 32], [u8; 32])` helper (private_key, public_key)
SHOULD be exported for CLI tooling. It MUST use `ed25519_dalek::SigningKey::generate()` with
a platform CSPRNG.

---

## 3. Database Schema

### 3.1 `agent_pubkeys` table

**S-DB-01**: A migration MUST create the `agent_pubkeys` table with the following columns:

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY, base62 |
| `user_id` | TEXT | NOT NULL, FK → `users.id` ON DELETE CASCADE |
| `pubkey_hex` | TEXT | NOT NULL, 64-char lowercase hex (32 bytes) |
| `fingerprint` | TEXT | NOT NULL, 64-char lowercase hex SHA-256(pubkey_bytes) |
| `label` | TEXT | NULL allowed |
| `created_at` | INTEGER | NOT NULL, unix ms |
| `revoked_at` | INTEGER | NULL = active |

**S-DB-02**: The migration MUST create indexes:
- `UNIQUE(user_id, pubkey_hex)` — prevents duplicate key registration
- Index on `(fingerprint)` — for display/discovery queries
- Index on `(user_id)` — for listing agent keys

**S-DB-03**: The schema MUST be defined in `apps/backend/src/db/schema.ts` using Drizzle ORM,
following the existing table definition conventions.

---

## 4. Registration API

**S-API-REG-01**: `POST /api/v1/agents/keys` MUST accept:

```json
{
  "pubkey_hex": "<64 lowercase hex chars>",
  "label": "<optional string max 100 chars>"
}
```

**S-API-REG-02**: The endpoint MUST require authentication (Bearer API key or session).

**S-API-REG-03**: The endpoint MUST validate `pubkey_hex` is exactly 64 lowercase hex characters.
It SHOULD validate that the bytes form a valid Ed25519 public key (point-on-curve check via
`ed25519-dalek::VerifyingKey::from_bytes()`).

**S-API-REG-04**: The endpoint MUST return 409 if `(user_id, pubkey_hex)` already exists.

**S-API-REG-05**: The endpoint MUST return the created row including `id` and `fingerprint`.

**S-API-REG-06**: `DELETE /api/v1/agents/keys/:id` MUST soft-revoke by setting `revoked_at = now()`.
It MUST return 404 if the key does not belong to the authenticated user.

**S-API-REG-07**: `GET /api/v1/agents/keys` MUST return all active (non-revoked) keys for
the authenticated user.

---

## 5. Signature Middleware

**S-MW-01**: A middleware function `verifyAgentSignature` MUST be implemented in
`apps/backend/src/middleware/signature.ts`.

**S-MW-02**: The middleware MUST read the following HTTP request headers:
- `X-Agent-Pubkey-Id` — agent_pubkeys.id (the key to verify against)
- `X-Agent-Signature` — base64url-encoded 64-byte Ed25519 signature
- `X-Agent-Nonce` — base64url-encoded 16-byte random nonce
- `X-Agent-Timestamp` — unix milliseconds as a decimal integer string

**S-MW-03**: If `X-Agent-Pubkey-Id` is absent AND the authenticated user has no registered
active pubkeys, the middleware MUST pass through without error.

**S-MW-04**: If `X-Agent-Pubkey-Id` is absent AND the authenticated user has at least one
registered active pubkey, the middleware MUST return `401 { error: "SIGNATURE_REQUIRED" }`.

**S-MW-05**: If `X-Agent-Pubkey-Id` is present, all four headers (`X-Agent-Pubkey-Id`,
`X-Agent-Signature`, `X-Agent-Nonce`, `X-Agent-Timestamp`) MUST be present.
Missing any MUST return `401 { error: "SIGNATURE_REQUIRED" }`.

**S-MW-06**: The middleware MUST reject the request with `401 { error: "SIGNATURE_EXPIRED" }`
if `|server_now_ms - X-Agent-Timestamp| > 300_000` (5 minutes).

**S-MW-07**: The middleware MUST track seen nonces and reject with `401 { error: "SIGNATURE_REPLAYED" }`
if the nonce was seen within the last 5 minutes. Nonce tracking MAY use an in-memory LRU
cache with TTL. Nonce entries MUST expire after 5 minutes.

**S-MW-08**: The canonical payload MUST be constructed as:

```typescript
const canonical = JSON.stringify({
  agent_id: request.body?.agentId ?? request.user?.id,
  content_hash: sha256hex(request.rawBody),
  document_id: request.params?.documentId,  // resolved from slug lookup
  nonce: request.headers['x-agent-nonce'],
  section_id: request.body?.section_id ?? null,
  timestamp: parseInt(request.headers['x-agent-timestamp'], 10),
})
// Keys MUST be in alphabetical order (as written above)
```

**S-MW-09**: The middleware MUST verify the signature using the `verify_submission` function
from `crates/llmtxt-core` (via WASM bindings in `packages/llmtxt/src/wasm.ts` or native
NAPI bindings). It MUST NOT implement Ed25519 verification in pure JavaScript.

**S-MW-10**: A failed signature verification MUST return `401 { error: "SIGNATURE_MISMATCH" }`.

**S-MW-11**: A successful verification MUST set:
```typescript
request.signatureVerified = true
request.agentPubkeyId = lookupRow.id
request.agentFingerprint = lookupRow.fingerprint
```

**S-MW-12**: The middleware MUST be registered on ALL five write routes:
- `POST /api/v1/documents/:slug/versions`
- `PATCH /api/v1/documents/:slug/lifecycle`
- `POST /api/v1/documents/:slug/approvals`
- `PATCH /api/v1/documents/:slug/sections/:id`
- `PUT /api/v1/documents/:slug`

---

## 6. Cryptographic Receipt

**S-RECEIPT-01**: Every write response from the five routes listed in S-MW-12 MUST include
a `receipt` object at the top level of the JSON response body.

**S-RECEIPT-02**: The receipt MUST have the shape:

```typescript
interface CryptographicReceipt {
  agent_id: string | null
  pubkey_fingerprint: string | null   // null if unsigned
  payload_hash: string                // SHA-256 of canonical payload bytes, hex
  server_timestamp: number            // unix ms at time of write
  signature_verified: boolean
}
```

**S-RECEIPT-03**: For unsigned writes, `signature_verified` MUST be `false` and
`pubkey_fingerprint` MUST be `null`. Unsigned writes MUST NOT be rejected.

---

## 7. SDK: `AgentIdentity` class

**S-SDK-01**: `packages/llmtxt` MUST export an `AgentIdentity` class from
`packages/llmtxt/src/sdk/identity.ts`.

**S-SDK-02**: `AgentIdentity` MUST implement:

```typescript
class AgentIdentity {
  // Generates a new Ed25519 keypair. Saves privkey to `keyPath` (default: ~/.llmtxt/identity.key).
  static async generate(keyPath?: string): Promise<AgentIdentity>

  // Loads an existing keypair from disk.
  static async load(keyPath?: string): Promise<AgentIdentity>

  // Returns the public key as 64-char lowercase hex.
  get pubkeyHex(): string

  // Returns the SHA-256 fingerprint (64-char hex) of the public key.
  get fingerprint(): string

  // Signs arbitrary bytes. Returns base64url(64-byte Ed25519 signature).
  async sign(payloadBytes: Uint8Array): Promise<string>

  // Verifies a signature. Returns true if valid.
  async verify(payloadBytes: Uint8Array, signatureBase64url: string): Promise<string>

  // Returns the four HTTP headers needed for a signed submission.
  async buildSignatureHeaders(opts: {
    agentId: string
    documentId: string
    contentHash: string
    sectionId?: string | null
  }): Promise<Record<string, string>>
}
```

**S-SDK-03**: `AgentIdentity` MUST use `@noble/ed25519` v2.x for sign/verify operations.

**S-SDK-04**: The private key file MUST be stored as raw 32 bytes (binary), with file
permissions `0o600`. The SDK MUST warn (but MUST NOT throw) if the file permissions are
wider than `0o600` on Unix systems.

**S-SDK-05**: `buildSignatureHeaders` MUST produce a nonce using `crypto.getRandomValues`
(16 bytes) and encode it as base64url. It MUST include the current timestamp as unix ms.

---

## 8. Public Key Discovery

**S-DISCOVERY-01**: `GET /.well-known/agents/:pubkeyId` MUST return:

```json
{
  "pubkey_hex": "...",
  "fingerprint": "...",
  "created_at": 1713196800000,
  "revoked": false
}
```

**S-DISCOVERY-02**: The endpoint MUST return `404` if the key does not exist or has been
revoked. It MUST NOT expose `user_id` or `label`.

**S-DISCOVERY-03**: This endpoint is a stub in T147. The full discovery flow (agent metadata,
DID-style document) is deferred to MA-3.

---

## 9. Integration Test Requirements

**S-TEST-01**: An integration test MUST submit 10 versions from 3 different `AgentIdentity`
instances and assert:
- Each response contains a `receipt` with `signature_verified: true`
- Each receipt `pubkey_fingerprint` matches the submitting agent's `fingerprint`

**S-TEST-02**: A test MUST submit a request with a valid signature but a modified body
(tampered after signing) and assert `401 SIGNATURE_MISMATCH`.

**S-TEST-03**: A test MUST submit with a registered agent but no signature headers and
assert `401 SIGNATURE_REQUIRED`.

**S-TEST-04**: A test MUST submit with a replay (duplicate nonce within 5 minutes) and
assert `401 SIGNATURE_REPLAYED`.

**S-TEST-05**: Rust tests MUST pass for both `cargo test` (native) and `wasm-pack test`
(WASM headless) targets.

---

## 10. Acceptance Criteria (mirrored from T147)

1. `POST /api/v1/documents/:slug/versions` with a registered agentId but no signature
   header returns `401 SIGNATURE_REQUIRED`.
2. `POST /api/v1/documents/:slug/versions` with a valid Ed25519 signature returns `200`
   with a `receipt.signature_verified: true` body.
3. A tampered payload (signature valid, body modified) returns `401 SIGNATURE_MISMATCH`.
4. `crates/llmtxt-core` exports `sign_submission` and `verify_submission`; byte-identity
   tests pass in both WASM and native.
5. `packages/llmtxt` SDK `AgentIdentity` generates, persists, loads keypairs, and exposes
   `sign()` and `verify()` methods.
6. Integration test: 10 versions from 3 agents, each receipt verifiable against the
   respective public key.
