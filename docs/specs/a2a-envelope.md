# A2A Message Envelope Specification

**Status**: ACTIVE  
**Epic**: T154 — A2A Message Envelope  
**Version**: W3/2026-04-16  
**RFC 2119 compliance**: MUST/SHOULD/MAY language used throughout

---

## 1. Purpose

The A2A (Agent-to-Agent) message envelope is a canonical, signed message format that enables LLMtxt agents to communicate directly — regardless of transport layer (scratchpad Redis Streams, HTTP inbox, future channels).

Goals:
- **Authenticity**: receiver can verify the sender's identity via Ed25519
- **Integrity**: payload tampering is detectable via signature
- **Replay protection**: nonce + timestamp prevent replay attacks
- **Transport-agnostic**: same envelope works over scratchpad or HTTP inbox

---

## 2. Canonical Format

### 2.1 Envelope Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | MUST | Sender agent identifier |
| `to` | string | MUST | Recipient agent identifier, or `"*"` for broadcast |
| `nonce` | string | MUST | Random hex string, ≥ 32 chars (16 bytes of randomness) |
| `timestamp_ms` | integer | MUST | Unix milliseconds |
| `signature` | string | MUST | Ed25519 signature, 128-char lowercase hex |
| `content_type` | string | MUST | MIME-like type, e.g. `"application/json"` |
| `payload` | string | MUST | Base64-encoded payload bytes |

### 2.2 Canonical Bytes (for signing)

The signature covers the following newline-separated string:

```
{from}\n{to}\n{nonce}\n{timestamp_ms}\n{content_type}\n{sha256(payload_bytes)_hex}
```

Where `sha256(payload_bytes)` is the SHA-256 of the base64-**decoded** payload bytes, encoded as lowercase hex.

**Example**:

Envelope:
```json
{
  "from": "agent-alice",
  "to": "agent-bob",
  "nonce": "aabbccdd00112233aabbccdd00112233",
  "timestamp_ms": 1700000000000,
  "content_type": "application/json",
  "payload": "eyJhY3Rpb24iOiJwaW5nIn0="
}
```

Canonical bytes (the string that is signed):
```
agent-alice
agent-bob
aabbccdd00112233aabbccdd00112233
1700000000000
application/json
635d9a0053cd03dd01331cac31546217af248565d843de56e7e9a702d66dc6d1
```

(SHA-256 of `{"action":"ping"}` = `635d9a00...`)

---

## 3. Transport Options

### 3.1 Scratchpad (T153)

A2A messages MAY be wrapped in a scratchpad message:

```http
POST /api/v1/documents/:slug/scratchpad
Content-Type: application/json

{
  "content": "{...a2a envelope json...}",
  "content_type": "application/vnd.llmtxt.a2a+json",
  "thread_id": "conv-12345"
}
```

Receivers parse the `content` field as an A2AMessage JSON and verify the signature.

### 3.2 HTTP Inbox (T154)

A2A messages MUST be delivered via the agent inbox:

```http
POST /api/v1/agents/:id/inbox
Authorization: Bearer <token>
Content-Type: application/json

{
  "envelope": {
    "from": "agent-alice",
    "to": "agent-bob",
    "nonce": "...",
    "timestamp_ms": 1700000000000,
    "signature": "...",
    "content_type": "application/json",
    "payload": "..."
  }
}
```

**Response (201 Created)**:
```json
{
  "delivered": true,
  "to": "agent-bob",
  "from": "agent-alice",
  "nonce": "...",
  "sig_verified": true,
  "expires_at": 1700172800000
}
```

#### Inbox Poll

```http
GET /api/v1/agents/:id/inbox?unread_only=true
Authorization: Bearer <token>
```

---

## 4. Security Requirements

### 4.1 Sender MUST register their public key

Before messages can be verified, the sender MUST register their Ed25519 public key:

```http
POST /api/v1/agents/keys
Content-Type: application/json

{
  "agent_id": "agent-alice",
  "pubkey_hex": "<64-char hex>",
  "label": "prod-2026"
}
```

### 4.2 Timestamp window

Receivers SHOULD reject messages with `timestamp_ms` outside `[now - 5 min, now + 1 min]`.

### 4.3 Nonce uniqueness

Each nonce MUST be used at most once per sender. The server MUST reject duplicate nonces (`409 Conflict`).

### 4.4 Signature MUST be verified

Receivers MUST verify the Ed25519 signature before acting on the message payload.

### 4.5 Inbox TTL

HTTP inbox messages MUST expire after 48 hours. The server MUST purge expired messages via a background job.

---

## 5. Rust Core (T291)

The A2A struct lives in `crates/llmtxt-core/src/a2a.rs`:

```rust
pub struct A2AMessage {
    pub from: String,
    pub to: String,
    pub nonce: String,
    pub timestamp_ms: u64,
    pub signature: String,
    pub content_type: String,
    pub payload: Vec<u8>,   // serialized as base64 in JSON
}

impl A2AMessage {
    pub fn canonical_bytes(&self) -> Vec<u8>;
    pub fn sign(&mut self, sk: &[u8; 32]) -> Result<(), String>;
    pub fn verify(&self, pk: &[u8; 32]) -> bool;
    pub fn build(from, to, nonce, timestamp_ms, content_type, payload) -> Self;
}
```

WASM exports: `a2a_build_and_sign()`, `a2a_verify()`.

---

## 6. SDK (T292, T303)

```ts
import {
  A2AMessage,
  buildA2AMessage,
  sendToInbox,
  pollInbox,
  onDirectMessage,
} from 'llmtxt/sdk';

// Build and sign
const msg = await buildA2AMessage({
  from: 'agent-alice',
  to: 'agent-bob',
  payload: { action: 'ping' },
  identity,
});

// Send via HTTP inbox
const result = await sendToInbox(baseUrl, 'agent-bob', msg, authHeaders);

// Poll inbox
const inbox = await pollInbox(baseUrl, 'agent-bob', { unreadOnly: true }, authHeaders);

// Subscribe (polling loop)
const stop = onDirectMessage(baseUrl, 'agent-bob', (msg) => {
  console.log('Got:', msg.envelope.from);
}, authHeaders);
```

---

## 7. Test Vectors

See `tests/fixtures/a2a-vectors.json` and `apps/backend/src/__tests__/a2a-vectors.test.ts`.

Vector format preserves the canonical byte structure for cross-implementation verification.

---

## 8. Acceptance Criteria

- [x] `A2AMessage.canonical_bytes()` produces deterministic 6-field newline-separated output
- [x] `A2AMessage.sign(sk)` produces a valid 64-byte Ed25519 signature
- [x] `A2AMessage.verify(pk)` returns `true` for matching key/payload, `false` for any mismatch
- [x] Tampered payload → `verify()` returns `false`
- [x] Wrong public key → `verify()` returns `false`
- [x] Serde round-trip: serialize to JSON, deserialize, re-verify → passes
- [x] POST /agents/:id/inbox rejects duplicate nonce → 409
- [x] POST /agents/:id/inbox with timestamp >5min old → 400
- [x] GET /agents/:id/inbox returns messages ordered by received_at
- [x] Messages expire after 48h (background purge job)
- [x] SDK `buildA2AMessage()` produces verifiable envelope
- [x] SDK `sendToInbox()` → `pollInbox()` round-trip works
