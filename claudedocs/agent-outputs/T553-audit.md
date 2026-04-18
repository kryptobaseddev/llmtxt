# T642: Identity Code Audit — llmtxt codebase

**Date**: 2026-04-18
**Task**: T642 — Audit current identity code locations

---

## 1. Rust SSoT — `crates/llmtxt-core/src/identity.rs`

The canonical Ed25519 implementation lives here. All cryptographic operations
are implemented in Rust and exposed as WASM exports.

| Symbol | Line | Role |
|--------|------|------|
| `keygen()` | 36 | Generate `([u8;32], [u8;32])` secret+public keypair |
| `body_hash(body)` | 48 | SHA-256 of request body bytes → `[u8;32]` |
| `canonical_payload(method, path, ts, agent_id, nonce_hex, body_hash_hex)` | 63 | Build newline-delimited canonical payload bytes |
| `sign_submission(sk, payload)` | 86 | Ed25519 sign → `[u8;64]` |
| `verify_submission(pk, payload, sig)` | 103 | Ed25519 verify → `bool` |
| `identity_keygen()` | 118 | WASM export: keygen → JSON `{"sk":"<hex>","pk":"<hex>"}` |
| `identity_sign(sk_hex, payload)` | 135 | WASM export: sign → 128-char hex |
| `identity_verify(pk_hex, payload, sig_hex)` | 157 | WASM export: verify → bool |
| `identity_canonical_payload(…)` | 178 | WASM export: canonical payload bytes |
| `identity_body_hash_hex(body)` | 199 | WASM export: body hash → lowercase hex |

Unit tests at lines 206–298 cover: round-trip, tamper detection, wrong-key,
empty-body, canonical format ordering.

---

## 2. SDK — `packages/llmtxt/src/identity.ts`

TypeScript implementation (using `@noble/ed25519` v3, not WASM). This is the
**duplication hotspot**: it re-implements keygen, signing, and hashing in JS
rather than wrapping the WASM exports from `identity.rs`.

| Symbol | Line | Role |
|--------|------|------|
| `SignatureHeaders` interface | 36 | HTTP header shape for outgoing requests |
| `CanonicalPayloadOptions` interface | 48 | Input type for canonical payload builder |
| `bodyHashHex(body)` | 60 | SHA-256 body hash via WebCrypto — duplicates `identity_body_hash_hex` |
| `buildCanonicalPayload(opts)` | 72 | Newline-delimited payload — duplicates `canonical_payload` Rust fn |
| `randomNonceHex()` | 84 | 16 random bytes as hex |
| `toHex(bytes)` | 94 | Internal hex encoder |
| `fromHex(hex)` | 101 | Internal hex decoder |
| `saveKeyNode(sk, pk)` / `loadKeyNode()` | 117/135 | Node.js file persistence (`~/.llmtxt/identity.key`, 0o600) |
| `saveKeyBrowser(sk, pk)` / `loadKeyBrowser()` | 148/153 | Browser localStorage persistence |
| `persistKey(sk, pk)` | 167 | Dispatch to Node/browser |
| `loadPersistedKey()` | 175 | Dispatch load |
| `AgentIdentity` class | 189 | Main exported class |
| `AgentIdentity.generate()` | 211 | Keygen + persist — uses `@noble/ed25519`, not WASM |
| `AgentIdentity.load()` | 224 | Load from persistence |
| `AgentIdentity.fromSeed(seed)` | 236 | Construct from raw seed — used by tests |
| `AgentIdentity.sign(message)` | 246 | Sign via `@noble/ed25519` — duplicates Rust `identity_sign` |
| `AgentIdentity.verify(message, signature)` | 253 | Verify — duplicates Rust `identity_verify` |
| `AgentIdentity.buildSignatureHeaders(…)` | 271 | Build `X-Agent-*` headers — high-value public API |

**Exports** (from `src/index.ts` line 329):
```ts
export { AgentIdentity, bodyHashHex, buildCanonicalPayload, randomNonceHex } from './identity.js';
export type { SignatureHeaders, CanonicalPayloadOptions } from './identity.js';
```

---

## 3. Backend middleware — `apps/backend/src/middleware/verify-agent-signature.ts`

Fastify `preHandler` that verifies incoming X-Agent-Signature headers.
Contains **duplicate** canonical payload builder and body hash function.

| Symbol | Line | Role |
|--------|------|------|
| `computeFingerprint(pubkeyHex)` | 52 | SHA-256 of pubkey hex, first 16 chars |
| `computeBodyHash(body)` | 65 | Body hash via `hashContent` — duplicate of SDK |
| `buildCanonicalPayload(…)` | 71 | Canonical payload builder — **DUPLICATE** of SDK and Rust |
| `computeReceipt(canonicalPayload, responseBodyHex)` | 96 | HMAC-SHA256 server receipt |
| `buildReceipt(opts)` | 115 | Receipt object constructor |
| `startNonceCleanup()` | 139 | Background interval purging old nonces |
| `verifyAgentSignature(request, reply)` | 170 | Main middleware: validates timestamps, db lookup, sig verify |

The middleware imports `@noble/ed25519` directly (line 18) rather than using
SDK identity functions — **third copy of the Ed25519 dependency**.

---

## 4. Backend plugin — `apps/backend/src/middleware/agent-signature-plugin.ts`

Wires `verifyAgentSignature` into Fastify lifecycle hooks. No identity logic
itself; just plumbing. No duplication to eliminate here.

---

## 5. SDK consumers (import `AgentIdentity` from `'../identity.js'`)

| File | Import pattern | Usage |
|------|----------------|-------|
| `src/mesh/a2a.ts:13` | `import type { AgentIdentity }` | A2A envelope signing |
| `src/mesh/sync-engine.ts:15` | `import type { AgentIdentity }` | Sync message signing |
| `src/sdk/a2a.ts:30` | `import type { AgentIdentity }` | A2A SDK types |
| `src/sdk/bft.ts:15` | `import type { AgentIdentity }` | BFT approval signing |
| `src/sdk/scratchpad.ts:23` | `import type { AgentIdentity }` | Optional identity on scratchpad |
| `src/export/backend-export.ts:146` | dynamic import | Load identity for export signing |
| `src/cli/llmtxt.ts:1238` | dynamic import | CLI signing |
| Tests: a2a, mesh-5-peer, sync-engine | direct import | Test helpers |

After extraction, all these must import from `'../identity/index.js'` instead.

---

## 6. `AgentSession` — `packages/llmtxt/src/sdk/session.ts`

AgentSession does **not** currently hold an `AgentIdentity` instance or call
any signing primitives directly. The `ContributionReceipt.signature` field is
a stub (`// signature: undefined — T461 will add Ed25519 signing`).

T650 must wire AgentSession to accept an optional `AgentIdentity` from
`'../identity/index.js'` and sign the receipt when provided.

---

## 7. Duplication Hotspots Summary

| Operation | Rust core | SDK identity.ts | Backend middleware |
|-----------|-----------|-----------------|-------------------|
| Ed25519 keygen | `keygen()` | `AgentIdentity.generate()` via @noble | — |
| Sign | `sign_submission()` / WASM | `AgentIdentity.sign()` via @noble | `ed.verifyAsync()` direct |
| Verify | `verify_submission()` / WASM | `AgentIdentity.verify()` via @noble | `ed.verifyAsync()` direct |
| Canonical payload | `canonical_payload()` / WASM | `buildCanonicalPayload()` | `buildCanonicalPayload()` |
| Body hash | `identity_body_hash_hex()` / WASM | `bodyHashHex()` WebCrypto | `computeBodyHash()` via `hashContent` |

**Consolidation strategy**:
1. Create `packages/llmtxt/src/identity/` as a subpath module.
2. Move `identity.ts` → `identity/index.ts`. Keep existing public API.
3. Where WASM exports are available, delegate internally (the WASM `identity_*`
   exports already exist in `src/wasm.ts`). For signing ops in the SDK, keep
   `@noble/ed25519` as the runtime — it is the established JS implementation and
   WASM for key ops is not yet benchmarked as necessary (D004).
4. The backend middleware `buildCanonicalPayload` and body hash must be removed
   and replaced with an import from `llmtxt/identity`.
5. `AgentSession` gains an optional `AgentIdentity` field for receipt signing.
6. Export the subpath from `package.json` at `"./identity"`.
