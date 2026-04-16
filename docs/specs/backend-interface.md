# Backend Interface Specification

**RFC 2119 Specification**
**Version**: 1.0.0
**Date**: 2026-04-16
**Status**: Active

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in RFC 2119.

---

## 1. Overview

The `Backend` interface (defined in `packages/llmtxt/src/core/backend.ts`) is the
canonical contract for all LLMtxt persistence and coordination operations. Every
consumer of LLMtxt MUST depend on this interface, not on a specific implementation.

Two implementations exist:

| Implementation | Location | Network | Persistence |
|----------------|----------|---------|-------------|
| `LocalBackend` | `packages/llmtxt/src/local/` | None | SQLite via better-sqlite3 |
| `RemoteBackend` | `packages/llmtxt/src/remote/` | HTTP/WS | api.llmtxt.my |

---

## 2. Lifecycle

### 2.1 open()

- Implementations MUST apply all pending migrations before returning from `open()`.
- Implementations MUST be idempotent — calling `open()` twice MUST NOT error.
- Consumers MUST call `open()` before any other method.

### 2.2 close()

- Implementations MUST stop all background timers, reapers, and interval functions.
- Implementations MUST close all database handles and network sockets.
- Implementations MUST be safe to call multiple times (idempotent).
- After `close()` is called, the behavior of any other method is undefined.

---

## 3. Document Operations (DocumentOps)

### 3.1 createDocument

- Implementations MUST generate a unique slug from the title using the slugify
  function from `crates/llmtxt-core` WASM if no explicit slug is provided.
- The generated slug MUST be unique within the backend instance.
- If a slug collision occurs, implementations MUST append a short suffix to
  disambiguate (e.g., `-2`, `-3`).
- Implementations MUST return the complete `Document` record.

### 3.2 getDocument / getDocumentBySlug

- Implementations MUST return `null` (not throw) when the document does not exist.

### 3.3 listDocuments

- Implementations MUST support cursor-based pagination.
- Results MUST be ordered by `createdAt` descending unless otherwise specified.
- The `nextCursor` in the result MUST be `null` when no further pages exist.

### 3.4 deleteDocument

- Implementations MUST cascade-delete all associated data: versions, events, CRDT
  states, leases, embeddings, approvals.
- Implementations MUST return `false` (not throw) when the document does not exist.

---

## 4. Version Operations (VersionOps)

### 4.1 publishVersion

- Implementations MUST compute the content hash using `hash_content` from
  `crates/llmtxt-core` WASM.
- Implementations MUST increment the document's `versionCount` atomically.
- For content exceeding 10 KB, LocalBackend MUST write content to the filesystem
  (at `config.storagePath/blobs/<hash>`) and store only the reference in the DB.

### 4.2 transitionVersion

- Implementations MUST validate the transition using `validateTransition` from
  `packages/llmtxt/src/sdk/lifecycle.ts`.
- Implementations MUST return `{ success: false, error: <reason> }` for invalid
  transitions. Implementations MUST NOT throw.
- Implementations MUST NOT allow transitions from ARCHIVED to any other state.

---

## 5. Approval Operations (ApprovalOps)

### 5.1 submitSignedApproval

- Implementations MUST verify the Ed25519 signature before persisting any data.
  Signature verification MUST use `crates/llmtxt-core` identity WASM.
- If signature verification fails, implementations MUST return
  `{ success: false, error: 'invalid signature' }`.
- If the same reviewer submits a second approval for the same version,
  implementations MUST return `{ success: false, error: 'duplicate approval' }`.
  This matches the backend's 409 behavior.
- After persisting, implementations MUST evaluate the quorum using
  `evaluateApprovals` from `packages/llmtxt/src/sdk/consensus.ts`.

---

## 6. Event Log Operations (EventOps)

### 6.1 appendEvent

- Implementations MUST persist the event before emitting it to subscribers.
  (Persist-first guarantees durability.)
- LocalBackend MUST emit the event on an in-process `EventEmitter` instance
  scoped to the backend. No Redis, no network.

### 6.2 subscribeStream

- LocalBackend MUST use `EventEmitter.on` to deliver events to the `AsyncIterable`.
- Implementations MUST remove the `EventEmitter` listener when the consumer
  calls `.return()` on the iterator (i.e., `for await` exits normally or via `break`).
- Implementations MUST remove the listener when an `AbortSignal` fires (if provided).
- Listener leaks are a correctness bug — implementations MUST NOT leak listeners.
- RemoteBackend SHOULD use Server-Sent Events (SSE) for the stream.

---

## 7. CRDT Operations (CrdtOps)

### 7.1 applyCrdtUpdate

- Implementations MUST merge the incoming update with the existing section snapshot
  using `merge_updates` from `crates/llmtxt-core` WASM.
- Implementations MUST persist both the raw update (for audit/replay) and the
  updated snapshot.
- Implementations MUST NOT import `yjs` directly. All CRDT ops MUST go through
  `crates/llmtxt-core` WASM or `packages/llmtxt/src/crdt-primitives.ts`.

### 7.2 subscribeSection

- Same listener cleanup requirements as `subscribeStream` (§6.2).

---

## 8. Lease Operations (LeaseOps)

### 8.1 acquireLease

- If a non-expired lease exists for a DIFFERENT holder, `acquireLease` MUST return
  `null`. It MUST NOT throw.
- If the same holder re-acquires the lease, `acquireLease` MUST succeed and extend
  the TTL.
- LocalBackend MUST use SQLite transactions to prevent race conditions between
  the existence check and the INSERT/UPDATE.

### 8.2 Expiry Reaper

- LocalBackend MUST run a background reaper that DELETEs expired leases on a
  configurable interval (default 10 s).
- The reaper MUST be stopped in `close()`.
- The reaper MUST handle errors gracefully (log and continue; do not crash).

---

## 9. Presence Operations (PresenceOps)

### 9.1 Storage

- Presence MUST be stored in-memory only (LocalBackend).
- Presence MUST NOT be persisted to SQLite — it is inherently ephemeral.
- This matches the backend's Redis-based presence semantics.

### 9.2 Expiry

- LocalBackend MUST run a background reaper that evicts presence entries older
  than `config.presenceTtlMs` (default 30 s).
- The reaper MUST be stopped in `close()`.

### 9.3 listPresence

- MUST return only entries where `lastSeen + presenceTtlMs > Date.now()`.

---

## 10. Scratchpad Operations (ScratchpadOps)

### 10.1 TTL

- The default TTL for scratchpad messages is 24 hours.
- If `ttlMs = 0`, the message MUST NEVER expire. Implementations MUST guard against
  this in all reaper and query filter code: `exp === 0 || exp > Date.now()`.
- This guard MUST appear in every code path that filters by expiry.

### 10.2 pollScratchpad

- MUST only return messages where `exp === 0 || exp > Date.now()`.

---

## 11. A2A Inbox Operations (A2AOps)

### 11.1 Signature Verification

- `sendA2AMessage` MUST verify the sender's Ed25519 signature embedded in the
  `envelopeJson` before persisting the message.
- Implementations MUST look up the sender's registered pubkey via `lookupAgentPubkey`.
- If verification fails, implementations MUST return `{ success: false, error: 'invalid signature' }`.

### 11.2 TTL

- Default TTL is 48 hours.
- Same `exp=0` guard applies as for scratchpad (§10.1).

---

## 12. Search Operations (SearchOps)

### 12.1 indexDocument

- Implementations SHOULD compute embeddings using `onnxruntime-node` with the
  same model as `apps/backend` (all-MiniLM-L6-v2 or equivalent).
- If `onnxruntime-node` is not installed, `indexDocument` MUST silently succeed
  without indexing. It MUST NOT throw.

### 12.2 search

- Implementations MUST return results sorted by cosine similarity descending.
- Cosine similarity MUST be computed using `crates/llmtxt-core` WASM `similarity.rs`.
- If `onnxruntime-node` is not installed, `search` MUST return an empty array.
  It MUST NOT throw.
- For LocalBackend with small corpora (< 10 000 documents), brute-force in-memory
  cosine similarity is acceptable.

---

## 13. Identity Operations (IdentityOps)

### 13.1 registerAgentPubkey

- MUST be idempotent — registering the same `(agentId, pubkeyHex)` pair a second
  time MUST NOT error and MUST NOT create a duplicate record.

### 13.2 recordSignatureNonce

- MUST return `false` (not throw) if the nonce has already been recorded.
- Nonce records MAY be pruned after `ttlMs` milliseconds (default: 5 minutes).

---

## 14. SSoT Enforcement

All portable primitive operations MUST use `crates/llmtxt-core` as the Single Source
of Truth:

| Operation | SSoT location |
|-----------|---------------|
| `hash_content` | `crates/llmtxt-core/src/crypto.rs` |
| `slugify` | `crates/llmtxt-core/src/slugify.rs` |
| CRDT merge | `crates/llmtxt-core/src/crdt.rs` |
| Ed25519 verify | `crates/llmtxt-core/src/identity.rs` |
| Cosine similarity | `crates/llmtxt-core/src/similarity.rs` |
| BFT quorum | `crates/llmtxt-core/src/bft.rs` |

Implementations MUST NOT import `yjs`, `automerge`, or `node:crypto`
`createHash`/`createHmac` directly. These are enforced by the CI ESLint ban rule
(see `apps/backend/.eslintrc.json`).

---

## 15. Migration Safety

- LocalBackend MUST use Drizzle ORM with `drizzle-kit generate` for all schema
  changes. Manual SQL migrations are PROHIBITED.
- LocalBackend MUST run pending migrations automatically in `open()` before
  accepting any operations.
- Migrations MUST be idempotent (Drizzle's `migrate()` guarantees this).
