# T146 — Research Note: CRDT Yrs Phase 2 (Real-Time Deltas + WS Sync)

> **Status**: RCASD Research Phase output  
> **Date**: 2026-04-15  
> **Author**: Team Lead (RCASD subagent)  
> **Epic**: T146 — Multi-Agent: CRDT Yrs integration Phase 2  
> **Depends on**: T083 (Phase 1 Yrs Rust bindings), T144 (migration safety), T145 (observability)

---

## 1. Yrs API Shape

Yrs is the authoritative Rust port of Y.js, maintained by the same author (Bartosz Sypytkowski). The wire format is byte-identical to Y.js v13 — any Y.js/Hocuspocus/y-websocket client connects without modification.

### Core types

| Yrs type | Purpose | Y.js equivalent |
|----------|---------|-----------------|
| `Doc` | Root CRDT document; holds shared types | `Y.Doc` |
| `Text` | Mutable text (insert/delete by index) | `Y.Text` |
| `Map<K,V>` | Key-value shared type | `Y.Map` |
| `Array<T>` | Ordered list shared type | `Y.Array` |
| `Transaction` | Atomic operation group; produces an Update on commit | `doc.transact()` |
| `StateVector` | Compact representation of a doc's known clock | `Y.encodeStateVector` |
| `Update` | Binary diff message; commutative+idempotent | `Y.encodeStateAsUpdate` |
| `Doc::encode_state_as_update(sv)` | Returns bytes covering everything the peer with `sv` hasn't seen | `Y.encodeStateAsUpdate(doc, sv)` |
| `Doc::apply_update(update)` | Merges an incoming diff into the doc | `Y.applyUpdate` |
| `Doc::encode_state_vector()` | Returns compact state vector for sync step 1 | `Y.encodeStateVector` |

### Key Yrs crate references
- Crate: `yrs` on crates.io (latest stable ≥ 0.21)
- Sync helpers: `yrs::updates::encoder`, `yrs::updates::decoder`
- `y-sync` sub-crate: implements Hocuspocus/y-websocket message framing
- Protocol buffer format: VARINT-length-prefixed, same as Y.js v13

### WASM compatibility note
Yrs compiles to `wasm32-unknown-unknown` **without the `y-sync` sub-crate** (which uses `tokio`). The four WASM exports needed by T146 are pure-data functions (no async, no I/O) and will compile cleanly with `wasm-bindgen`.

---

## 2. Hocuspocus / y-websocket Protocol

The Yjs sync protocol over WebSocket is an open, documented binary protocol (`y-protocols/sync`). Three message types:

| Msg type | Direction | Payload | Purpose |
|----------|-----------|---------|---------|
| `sync step 1` (type 0) | client → server | client's `StateVector` bytes | "Here is what I know; send me what I'm missing" |
| `sync step 2` (type 1) | server → client | `encodeStateAsUpdate(doc, clientSV)` | Full diff to bring client up-to-date |
| `update` (type 2) | bidirectional | incremental update bytes from a transaction | Live delta; applied to both sides |

Wire framing (y-websocket / Hocuspocus binary):
```
[1 byte msg_type] [varint doc_name_len] [doc_name bytes] [payload bytes]
```

Hocuspocus is an open-source TypeScript server implementing exactly this framing with:
- Per-document `Y.Doc` kept in memory
- Hook system for `onConnect`, `onChange`, `onAuthenticate`, `onLoadDocument`, `onStoreDocument`
- PostgreSQL extension (`@hocuspocus/extension-database`) for state persistence

**Our server will re-implement this framing in TypeScript** (Fastify + `@fastify/websocket`) using the `y-protocols` npm package, backed by Yrs state stored in Postgres. We do NOT depend on the Hocuspocus NPM package — we implement the same open protocol so any y-websocket client connects.

### y-protocols npm package (used in apps/backend, NOT in crates/llmtxt-core)
```typescript
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
```
These are backend-only I/O helpers — they do NOT cross the SSoT boundary. The CRDT state machine (apply_update, encode_state_as_update) lives in `crates/llmtxt-core` per SSoT rule.

---

## 3. PostgreSQL Storage Pattern

The standard pattern (used by Hocuspocus PostgreSQL extension and similar servers):

### Tables needed

**`section_crdt_states`** — latest consolidated state per section (the "checkpoint"):
```sql
CREATE TABLE section_crdt_states (
  document_id TEXT NOT NULL REFERENCES documents(id),
  section_id  TEXT NOT NULL,             -- section slug/heading key
  yrs_state   BYTEA NOT NULL,            -- full serialized Yrs doc state
  clock       INTEGER NOT NULL DEFAULT 0, -- update count since last compaction
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (document_id, section_id)
);
```

**`section_crdt_updates`** — incremental update log (the "WAL"):
```sql
CREATE TABLE section_crdt_updates (
  id          BIGSERIAL PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  section_id  TEXT NOT NULL,
  update_blob BYTEA NOT NULL,            -- raw Yrs update bytes
  client_id   TEXT NOT NULL,            -- agent UUID from verified identity
  seq         INTEGER NOT NULL,          -- monotonic per (document_id, section_id)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON section_crdt_updates (document_id, section_id, seq);
CREATE INDEX ON section_crdt_updates (document_id, section_id, created_at DESC);
```

### Sync-on-read reconstruction
On WS connect, server:
1. Reads `section_crdt_states` for base state
2. Reads all `section_crdt_updates` where `seq > state.clock` (pending updates since last compaction)
3. Calls `yrs_compact([base_state, ...pending_updates])` to produce a live state in memory
4. Holds that in memory for the session lifetime

### Crash safety
Every incoming update is persisted to `section_crdt_updates` BEFORE it is echoed to other subscribers via Redis. If the server crashes after writing but before broadcasting, updates survive. On reconnect, clients send StateVector → server computes diff → missing updates delivered.

---

## 4. Redis Pub/Sub for Multi-Instance Coordination

Single-instance: in-memory `EventEmitter` (already used in `apps/backend/src/events/bus.ts`) is sufficient.  
Multi-instance (Railway horizontal scale, staging vs. prod): a Redis channel per document bridges instances.

### Channel naming
```
crdt:doc:{document_id}:section:{section_id}
```
One channel per (document, section) pair. Message payload is the raw Yrs update bytes (binary, passed through Redis as a Buffer).

### Flow
```
Client A --update--> Instance 1
  Instance 1:
    1. persist update to Postgres
    2. apply to in-memory Yrs state
    3. PUBLISH crdt:doc:{docId}:section:{secId} <update_bytes>
    4. echo to all local WS subscribers (excluding sender)

  Instance 2 (SUBSCRIBE listener):
    5. receive update from Redis
    6. apply to in-memory Yrs state
    7. echo to all local WS subscribers (excluding sender — check client_id)
```

### Backpressure
Redis channel-per-(document,section) keeps fan-out targeted. A document with 50 sections creates at most 50 channels only when those sections have active subscribers. Idle sections have zero Redis traffic.

### Fallback for dev/single-instance
If no `REDIS_URL` env var is set, the pub/sub adapter falls back to the existing `eventBus` (in-process EventEmitter). No behavior change; single binary just works.

---

## 5. Authorization Hook for WS Connection

Existing `apps/backend/src/middleware/auth.ts` implements:
- Bearer API key auth (resolved from `?token=` query param or `Authorization: Bearer` header)
- Cookie session auth (better-auth)
- RBAC: `document_roles` table + `role_has_permission(role, permission)` from `crates/llmtxt-core`

For the CRDT WS endpoint (`/api/v1/documents/:slug/sections/:sid/collab`):
1. Extract token from `?token=` query param (WS upgrade requests cannot carry `Authorization` header)
2. Resolve user via `resolveWsUser()` (already in `ws.ts`) → 401/close(4401) if missing
3. Look up document by `:slug` → 404 if not found
4. Check `documentRoles` for the resolved user → 403/close(4403) if role is `viewer` attempting write subprotocol
5. Write subprotocol (`yjs-sync-v1`) requires `editor` or `owner` role
6. Read-only subprotocol (`yjs-readonly-v1`) allows any authenticated role

The existing `resolveWsUser` function in `ws.ts` is reused directly. RBAC check is an additional step that calls `role_has_permission` (already exported from `packages/llmtxt`).

---

## 6. Existing Code to Reuse or Preserve

| File | Status | Role in T146 |
|------|--------|-------------|
| `crates/llmtxt-core/src/three_way_merge.rs` | PRESERVE unchanged | Remains as batch/offline merge fallback. Non-CRDT. Used when an agent submits a complete section via REST without WS session. |
| `apps/backend/src/routes/ws.ts` | EXTEND | Current file handles broadcast-only events. New file `ws-crdt.ts` added alongside it for Yjs protocol routes. Existing `wsRoutes` not modified. |
| `apps/backend/src/middleware/auth.ts` | REUSE | `requireAuth` + bearer resolution reused. `resolveWsUser` helper extracted/reused. |
| `apps/backend/src/events/bus.ts` | REUSE + WRAP | Local in-process bus kept. Redis adapter wraps it for multi-instance. |
| `packages/llmtxt/src/index.ts` | EXTEND | Add `subscribeSection()` SDK method and `SectionDelta` type export. |

---

## 7. External References

- **Yrs crate docs**: https://docs.rs/yrs/latest/yrs/
- **y-sync crate** (Hocuspocus message framing in Rust): https://docs.rs/y-sync/latest/y_sync/
- **Yjs sync protocol spec**: https://github.com/yjs/y-protocols (sync.js, awareness.js)
- **y-websocket server reference**: https://github.com/yjs/y-websocket/blob/master/bin/server.mjs
- **Hocuspocus source**: https://github.com/ueberdosis/hocuspocus (open source, MIT)
- **Hocuspocus PostgreSQL extension**: https://github.com/ueberdosis/hocuspocus/tree/develop/packages/extension-database

---

## Consensus

Five open decisions to be resolved by HITL or defaulted per the less-invasive option:

| # | Question | Options | Proposed default | Rationale | HITL required? |
|---|----------|---------|-----------------|-----------|---------------|
| C1 | **Section granularity**: one Yrs `Doc` per section, OR one Yrs `Map` field per section inside a single per-document `Doc`? | A: Doc-per-section (isolation, parallel writes to different sections don't contend); B: Map-per-section inside a Doc (lower connection init cost, single state vector) | **A — Doc-per-section** | Sections evolve independently. Concurrent writers editing different sections see no contention. Simpler crash recovery (one section failure doesn't corrupt others). Init cost (one extra sync step per additional section tab) is acceptable. | No — proposing A |
| C2 | **Redis channel granularity**: one channel per (document, section) OR one channel per document (broadcast all sections)? | A: per (doc, section) — targeted, low noise; B: per document — simpler, more traffic | **A — per (document, section)** | Agents subscribing to section X should not receive updates for section Y. Per-section channels keep bandwidth proportional to actual subscriptions. | No — proposing A |
| C3 | **Compaction policy**: compact when N updates accumulated OR compact on idle timeout OR both? | A: N=100 threshold only; B: idle timeout only (30s); C: either (N=100 OR 30s idle) | **C — either (N=100 OR 30s idle)** | N=100 prevents unbounded update log growth under load. Idle timeout ensures quiet sections are compacted between sessions. Threshold and timeout SHOULD be configurable via env vars `CRDT_COMPACT_THRESHOLD` (default 100) and `CRDT_COMPACT_IDLE_MS` (default 30000). | No — proposing C, config exposed |
| C4 | **Audit log entries for CRDT operations**: log every update, or only at semantic boundaries (section finalized, WS disconnect, explicit flush)?| A: every update (verbose, high write amplification); B: semantic boundaries only (WS disconnect + explicit flush) | **B — semantic boundaries only** | CRDT updates can arrive at 10-100 Hz during active editing. Logging every byte would bloat `auditLogs` 100x. Audit entries at: WS disconnect (summary: N updates, final content hash), explicit REST flush, and compaction events. Raw update bytes already in `section_crdt_updates` for forensics. | **YES — flag for HITL** (audit compliance requirement may override this) |
| C5 | **Offline-edit fallback**: if WS is severed, does client keep editing locally and sync on reconnect (Yrs supports this natively)? | A: yes, full offline capability (client buffers updates, reconnects, exchanges StateVectors); B: no, WS required for any CRDT edit — REST-only fallback on disconnect | **A — full offline capability** | Yrs's StateVector/diff mechanism was designed for exactly this. Agents in restricted networks benefit. The HTTP fallback endpoint (`POST /crdt-update`) provides the same mechanism for polling-only consumers. Offline buffer expiry: updates older than `CRDT_OFFLINE_EXPIRY_MS` (default 3600000 = 1h) are rejected on reconnect with a 409 to prevent stale convergence. | **YES — flag for HITL** (1h expiry is a judgment call; security vs. usability tradeoff) |

**HITL items C4 and C5 are flagged for owner review before T146.4 (WS server) and T146.8 (persistence) tasks ship.**
