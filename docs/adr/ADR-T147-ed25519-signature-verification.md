# ADR-T147: Ed25519 Signature Verification for Agent Submissions

**Status**: Proposed
**Date**: 2026-04-15
**Epic**: T147 — Multi-Agent: Verified agent identity Phase 2
**Deciders**: Team Lead (LOOM RCASD), pending HITL consensus on C1/C2/C4
**Depends on**: T076 (foundational key registration schema)

---

## Context

LLMtxt agents today self-declare their `agentId` in request bodies. There is no
cryptographic proof that the caller is who they claim to be. Red-team findings S-07
(Sybil attacks on consensus) and A-04 (attribution fraud) both stem from this gap.

T076 established key registration intent. T147 implements the verification layer: every
write from a registered agent MUST carry an Ed25519 signature over the canonical request
payload, verified server-side before the write proceeds.

Backward compatibility is non-negotiable: existing anonymous and cookie-session writes
continue to work unchanged. Signing is opt-in for registered API-key agents; mandatory
only when a public key is registered for the agent.

---

## Decision

### Algorithm: Ed25519

Ed25519 (RFC 8032) is chosen. Key attributes:
- 32-byte private key, 32-byte public key, 64-byte signature
- Deterministic signing — no per-sign entropy requirement
- ~0.1ms verify on commodity hardware
- Batch verification support for future multi-sig scenarios
- Implemented in `ed25519-dalek` (Rust, crates/llmtxt-core) and `@noble/ed25519` (TS, SDK)

### Signed Payload (Canonical JSON)

The bytes fed to Ed25519 sign/verify are the UTF-8 encoding of a canonical JSON object
with keys sorted alphabetically:

```
{"agent_id":"<string>","content_hash":"<sha256hex>","document_id":"<string>","nonce":"<base64url-16bytes>","section_id":<string|null>,"timestamp":<unix-ms>}
```

`content_hash` = SHA-256 of the raw request body bytes. This binds the signature to the
exact payload, making any in-transit modification detectable.

`section_id` is included for forward compatibility with section-level writes (T146 CRDT).
For whole-document writes it is `null`.

### New Schema: `agent_pubkeys` table

```
agent_pubkeys {
  id           TEXT PK (base62)
  user_id      TEXT NOT NULL FK → users.id CASCADE DELETE
  pubkey_hex   TEXT NOT NULL     -- 32-byte Ed25519 verifying key, lowercase hex
  fingerprint  TEXT NOT NULL     -- SHA-256(pubkeyBytes) hex, full 64 chars
  label        TEXT              -- user-assigned display name
  created_at   INTEGER NOT NULL  -- unix ms
  revoked_at   INTEGER           -- null = active; set on revocation
  UNIQUE(user_id, pubkey_hex)
}
```

Index: `(user_id)`, `(pubkey_hex)`, `(fingerprint)`.

### Request Headers for Signed Submissions

```
X-Agent-Pubkey-Id:  <agent_pubkeys.id>
X-Agent-Signature:  <base64url(64-byte Ed25519 signature)>
X-Agent-Nonce:      <base64url(16 random bytes)>
X-Agent-Timestamp:  <unix ms>
```

All four headers MUST be present for signature verification to activate.

### Server Verification Flow

```
POST /api/v1/documents/:slug/versions
     ↓
[auth middleware] → resolves request.user (Bearer API key or session)
     ↓
[signature middleware] (verifyAgentSignature)
  ├── No X-Agent-Pubkey-Id header?
  │   ├── agent has registered pubkey? → 401 SIGNATURE_REQUIRED
  │   └── no registered pubkey? → pass through (unsigned write)
  ├── X-Agent-Pubkey-Id present?
  │   ├── Look up agent_pubkeys row (active, not revoked)
  │   ├── Validate X-Agent-Timestamp within ±5 minutes of server time
  │   ├── Check X-Agent-Nonce not seen in last 5 minutes (replay prevention)
  │   ├── Reconstruct canonical payload bytes
  │   ├── Ed25519 verify(pubkey, payload, signature)
  │   ├── Fail? → 401 SIGNATURE_MISMATCH
  │   └── Pass → set request.signatureVerified = true, request.agentPubkeyId
     ↓
[route handler]
  ├── Performs normal write
  └── Appends receipt to response:
      { receipt: { agent_id, pubkey_fingerprint, payload_hash, server_timestamp, signature_verified } }
```

### Middleware vs Inline (Decision C1 — resolved)

Verification MUST be in a dedicated middleware (`verifyAgentSignature`) rather than
inline in each route handler. Rationale:

1. Five write routes (POST version, PATCH state, POST approval, PATCH section, PUT
   document) would all duplicate the same verification logic inline.
2. The middleware pattern is established in this codebase (see `rbac.ts`, `auth.ts`).
3. Opt-in activation via header presence keeps the middleware lightweight on unsigned
   requests (one header check = early return).

### Error Codes (Decision C2 — resolved)

| Condition | HTTP | Body error code |
|-----------|------|-----------------|
| Registered agent submits without headers | 401 | `SIGNATURE_REQUIRED` |
| Signature headers present but verification fails | 401 | `SIGNATURE_MISMATCH` |
| Timestamp out of ±5 min window | 401 | `SIGNATURE_EXPIRED` |
| Nonce already seen | 401 | `SIGNATURE_REPLAYED` |

All are 401 because they are authentication failures — the caller must fix credentials
and retry. 403 is reserved for authorization failures (RBAC, ownership).

### Nonce Storage (Decision C4 — HITL flagged)

Nonces must be tracked for 5 minutes to prevent replay attacks. Two options:

**Option A (recommended)**: In-memory LRU cache (`lru-cache` npm package) with TTL
entries. Zero infrastructure dependency; works for single-process deployments. Capacity:
10,000 nonces × 5-min TTL = handles ~33 RPS of signed writes continuously.

**Option B**: Redis (if available in production). Scalable to multi-process. Requires
Redis deployment.

**HITL flag**: Owner must decide whether Railway deployment has Redis available (T090
secret rotation epic may add it). For now, Option A (in-memory LRU) is the implementation
default, with Option B as a drop-in swap behind an interface.

### Cryptographic Receipt

Every successful write response (signed or not) gains a `receipt` field:

```json
{
  "receipt": {
    "agent_id": "agt_abc123",
    "pubkey_fingerprint": "a1b2c3d4e5f6...",
    "payload_hash": "sha256hex-of-canonical-payload",
    "server_timestamp": 1713196800123,
    "signature_verified": true
  }
}
```

`signature_verified: false` for unsigned writes. `pubkey_fingerprint: null` for unsigned.
Unsigned writes do NOT fail — they produce a receipt marking them as unverified.

---

## T146 CRDT Interface Contract

T146 (CRDT Yrs Phase 2) workers MUST read this section before implementing WS sync.

**Yjs awareness state (client-side)**:

```typescript
// Set before any sync message is sent
yDoc.awareness.setLocalStateField('identity', {
  pubkeyId:    agentIdentity.pubkeyId,      // agent_pubkeys.id (null if unsigned)
  agentId:     agentIdentity.agentId,        // users.agent_id
  fingerprint: agentIdentity.fingerprint,    // first 16 chars of pubkey SHA-256
})
```

**Committed write (CRDT delta → version)**:

When the SDK flushes a CRDT delta to a server version, it sends:
```
POST /api/v1/documents/:slug/versions
  X-Agent-Pubkey-Id: <agent_pubkeys.id>
  X-Agent-Signature: <base64url(sig)>
  X-Agent-Nonce:     <base64url(nonce)>
  X-Agent-Timestamp: <unix ms>
  Body: { content, changelog, agentId, section_id: "heading-key" }
```

The canonical payload's `section_id` field carries the Yjs section key. This is how
signed identity propagates into CRDT-originated version writes.

**WS messages are NOT signed at the Yjs protocol level.** Signing happens only at the
HTTP commit endpoint. The awareness `identity` field is informational — it lets the UI
display "Agent X is editing section Y" but does not constitute a cryptographic claim.

---

## Alternatives Considered

| Option | Rejected reason |
|--------|-----------------|
| ECDSA P-256 | Non-deterministic signing (requires CSPRNG per signature); slightly larger surface |
| HMAC-SHA256 | Symmetric key — server must know private key, impossible with client-side keys |
| mTLS | Requires CA infrastructure; too heavyweight for developer experience |
| JWT (RS256) | RSA overhead; JWTs are designed for sessions not individual writes |

---

## Consequences

**Positive**:
- Every agent write is either cryptographically proven or explicitly marked unverified
- Receipt enables independent audit: third parties can verify a signature without
  contacting the server (pubkey is public)
- Sybil attack cost increases enormously — attacker needs to register a valid keypair

**Negative**:
- SDK `AgentIdentity` class adds setup friction for new integrators
- Nonce tracking adds memory overhead (bounded at ~10K entries with LRU)
- Signature verification adds ~0.1ms per signed write (acceptable)

**Risks**:
- Key loss: agent loses private key → all future writes unsigned. Mitigation: SDK prompts
  to back up keypair on creation.
- Key compromise: attacker obtains private key → can forge writes. Mitigation: pubkey
  revocation (set `revoked_at`) + key rotation (T086).
