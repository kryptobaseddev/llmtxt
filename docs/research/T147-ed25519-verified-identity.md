# Research: T147 — Ed25519 Verified Agent Identity

**Date**: 2026-04-15
**Epic**: T147 — Multi-Agent: Verified agent identity Phase 2
**Status**: research

---

## 1. Problem Statement

Every document contribution (version creation, state transition, approval) today carries a
self-declared `agentId` string. Any caller can claim any identity. Red-team findings S-07
and A-04 both flag this: consensus votes and attribution are trivially spoofed.

T076 established the foundational schema (public-key storage, fingerprint). T147 wires the
cryptographic verification into every write path so that registered agents cannot submit
without a valid Ed25519 signature, and unsigned submissions get a receipt that proves
_absence_ of signature (useful for distinguishing anonymous vs. agent writes).

---

## 2. Algorithm Selection: Ed25519

| Property | Ed25519 | RSA-2048 | ECDSA P-256 |
|----------|---------|----------|-------------|
| Key size (private) | 32 bytes | 256 bytes | 32 bytes |
| Signature size | 64 bytes | 256 bytes | 64 bytes |
| Sign speed (relative) | ~1x | ~140x slower | ~3x slower |
| Verify speed | ~1x | ~5x faster | ~1.5x slower |
| Library maturity | High | High | High |
| Deterministic | Yes | No (PKCS#1 v1.5) | No (requires CSPRNG) |
| Batch verify | Supported | No | No |

Ed25519 is the correct choice: small keys, deterministic signing, no per-sign entropy
requirement (eliminates a failure mode), and fast verification. NIST curves add oracle
attack surface; RSA is heavyweight for this use case.

---

## 3. Library Survey

### 3.1 Rust — `ed25519-dalek` (crates/llmtxt-core)

- Crate: `ed25519-dalek 2.x` (actively maintained, used by Solana, Signal, etc.)
- API: `SigningKey::from_bytes(&[u8; 32])`, `VerifyingKey`, `Signature`
- WASM compat: Works with `wasm-bindgen` via standard Rust primitives (no OS entropy
  needed for verify; sign needs CSPRNG — use `getrandom` with `js` feature flag for WASM)
- Feature flag approach: `ed25519-dalek` + `getrandom = { features = ["js"] }` for WASM target

Current `crypto.rs` module in `crates/llmtxt-core` provides HMAC-SHA256 webhook signing.
The new `identity.rs` module will sit alongside it and provide:

```rust
// crates/llmtxt-core/src/identity.rs (planned)
pub fn sign_submission(private_key_bytes: &[u8; 32], payload_bytes: &[u8]) -> [u8; 64]
pub fn verify_submission(public_key_bytes: &[u8; 32], payload_bytes: &[u8], sig_bytes: &[u8; 64]) -> bool
```

Both functions exposed via `#[cfg_attr(feature = "wasm", wasm_bindgen)]` and
`#[cfg_attr(feature = "napi", napi)]` per the D002 dual-binding decision.

### 3.2 Node.js (packages/llmtxt SDK)

Two candidates:

| Library | Bundle size | Pure JS | Dependencies | Notes |
|---------|-------------|---------|--------------|-------|
| `@noble/ed25519` | ~7 KB | Yes | 0 | Paul Miller, audited by Cure53, widely used |
| `tweetnacl` | ~30 KB | Yes | 0 | NaCl port, well-audited, older API |

**Recommendation: `@noble/ed25519`** — smaller, modern async API, actively maintained,
used by @noble/curves family which the project may adopt broadly. The sync version
`@noble/ed25519` v2 changed to async-only for sign; verify remains sync. The SDK
`AgentIdentity` class wraps this.

### 3.3 Canonical JSON

The signed payload MUST be deterministic across languages. The project already uses
`crates/llmtxt-core::normalize` (which provides a canonicalize function). The signed
payload for a submission is a JSON object with keys sorted alphabetically:

```json
{
  "agent_id": "agt_abc123",
  "content_hash": "sha256hex...",
  "document_id": "docid...",
  "nonce": "base64url-16bytes",
  "section_id": null,
  "timestamp": 1713196800000
}
```

The canonicalized UTF-8 bytes of this JSON object are what gets signed. `section_id` is
included (null for whole-document writes) so the same mechanism extends to section-level
writes for T146 CRDT.

---

## 4. Existing Schema Analysis

### 4.1 `api_keys` table (current)

```
api_keys { id, userId, name, keyHash, keyPrefix, scopes, lastUsedAt, expiresAt, revoked, createdAt, updatedAt }
```

T076 added (or plans to add) public key columns. The T147 schema migration must add to
the `users` or a new `agent_pubkeys` table:

```
agent_pubkeys {
  id          text PK
  userId      text FK → users.id CASCADE DELETE
  pubkeyHex   text NOT NULL  -- 32-byte Ed25519 verifying key, hex-encoded
  fingerprint text NOT NULL  -- SHA-256(pubkeyBytes), hex, first 16 chars (display)
  label       text           -- "My laptop key", user-assigned
  createdAt   integer NOT NULL
  revokedAt   integer        -- null = active
}
```

One user may register multiple keys (key rotation, multiple devices). Verification uses
the `pubkey_id` header to look up the correct key row, then verifies the signature.

### 4.2 `better-auth` integration

The server uses `better-auth` for session management (cookie) and the `api-keys` plugin
for Bearer tokens. The signature verification is orthogonal — it is a second factor that
applies only to agents who have registered a public key. The auth flow remains:

1. Auth middleware resolves `request.user` (Bearer API key OR session cookie)
2. NEW: Signature middleware checks `X-Agent-Pubkey-Id` header; if present + agent has
   key registered, verifies signature; if absent + agent has key registered, rejects 401

---

## 5. Request/Response Format

### Signed request headers

```
X-Agent-Pubkey-Id: <agent_pubkeys.id>   (required when signing)
X-Agent-Signature: <base64url(64-byte Ed25519 signature)>
X-Agent-Nonce: <base64url(16 random bytes)>   (prevents replay)
X-Agent-Timestamp: <unix ms>   (server rejects if |now - ts| > 300_000ms)
```

### Signed payload (bytes fed to Ed25519)

Canonical UTF-8 JSON, keys alphabetically sorted, no trailing whitespace:

```json
{"agent_id":"...","content_hash":"sha256hex","document_id":"...","nonce":"...","section_id":null,"timestamp":1713196800000}
```

The `content_hash` is SHA-256 of the request body bytes (before compression). This binds
the signature to the exact content, making body tampering detectable.

### Cryptographic receipt (response body addition)

On successful signed write, the response body gains a `receipt` object:

```json
{
  "receipt": {
    "agent_id": "agt_abc123",
    "pubkey_fingerprint": "a1b2c3d4...",
    "payload_hash": "sha256hex-of-canonical-payload",
    "server_timestamp": 1713196800123,
    "signature_verified": true
  }
}
```

Unsigned writes return `"receipt": null` — explicitly marking the write as unverified.

---

## 6. T146 CRDT Interface Contract

T146 (CRDT Yrs Phase 2) carries Yjs update messages over WebSocket. Each update message
originator MUST include the agent identity claim. The interface:

```typescript
// Yjs awareness state field (set by SDK client before syncing)
awareness.setLocalStateField('identity', {
  pubkeyId: agentIdentity.pubkeyId,       // agent_pubkeys.id
  agentId: agentIdentity.agentId,          // users.agent_id
  fingerprint: agentIdentity.fingerprint,  // first 16 chars of pubkey SHA-256
  // NOTE: The WS message itself is NOT signed at the Yjs protocol level.
  // Signing happens at the HTTP write endpoint when a Yjs delta is
  // committed to a version. The awareness field is informational only.
})
```

For committed writes (when a CRDT delta is flushed to a server version), the SDK sends a
normal HTTP POST `/api/v1/documents/:slug/versions` with the signed headers. The `section_id`
field in the canonical payload identifies which section the CRDT delta belongs to.

**T146 workers MUST** read this document before implementing the WS sync protocol to
ensure `awareness.identity.pubkeyId` is populated correctly.

---

## 7. Open Decisions for Consensus (flagged for HITL)

| ID | Decision | Proposed Answer | Risk |
|----|----------|-----------------|------|
| C1 | Signature verification in middleware or inline in each route? | Middleware — keeps routes clean; opt-in via presence of `X-Agent-Pubkey-Id` header | Low; middleware hook is established pattern (see `rbac.ts`) |
| C2 | Bad signature response code — 401 or 403? | 401 (SIGNATURE_REQUIRED / SIGNATURE_MISMATCH) — both are authentication failures, not authorization | Medium — 401 implies "retry with valid creds"; 403 is "you're denied". 401 is more actionable |
| C3 | Rate-limit signature verification separately? | No separate limit needed; verification is ~0.1ms CPU and already covered by write rate limits | Low |
| C4 | Nonce storage — how long to retain nonces for replay prevention? | Store nonces in a Redis TTL key (or ephemeral in-memory LRU if no Redis) for 5 minutes. Match timestamp window. | Medium — requires decision on whether Redis is available; if not, in-memory LRU with TTL |

---

## 8. Sources

- Ed25519 spec: RFC 8032 (https://datatracker.ietf.org/doc/rfc8032/)
- `ed25519-dalek` crate: https://crates.io/crates/ed25519-dalek
- `@noble/ed25519` npm: https://www.npmjs.com/package/@noble/ed25519
- Cure53 audit of @noble/ed25519: https://cure53.de/pentest-report_noble-lib.pdf
- Existing crypto.rs: `crates/llmtxt-core/src/crypto.rs`
- Existing RBAC middleware pattern: `apps/backend/src/middleware/rbac.ts`
- D001 SSoT decision: CLEO brain
- D002 dual-binding decision: CLEO brain
