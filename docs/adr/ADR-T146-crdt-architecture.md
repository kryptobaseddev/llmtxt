# ADR-T146: CRDT Architecture — Yrs Phase 2 Real-Time WebSocket Sync

| Field | Value |
|-------|-------|
| **ADR ID** | ADR-T146 |
| **Epic** | T146 — CRDT Yrs Phase 2 |
| **Status** | PROPOSED |
| **Date** | 2026-04-15 |
| **Deciders** | Team Lead (RCASD), owner |
| **Supersedes** | n/a |
| **Depends on** | T083 (Yrs Phase 1 Rust bindings), ADR principles in docs/ARCHITECTURE-PRINCIPLES.md |

---

## Context

T083 establishes the Yrs crate as the CRDT engine inside `crates/llmtxt-core` and proves wire-compatibility with Y.js clients. T146 builds the live-sync layer: WebSocket sessions, per-section Yrs Doc instances on the server, delta exchange, Postgres persistence, and Redis fan-out for horizontal scale.

The guiding constraint is the SSoT rule: **all CRDT state machine logic (encode, decode, apply, compact) lives in `crates/llmtxt-core` as Rust, exposed via WASM.** The WebSocket routing, Postgres I/O, and Redis pub/sub are `apps/backend`-only concerns.

---

## Decision

### Architecture overview (ASCII component diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CLIENT TIER                                        │
│                                                                             │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  Agent / Browser (Yjs client)  │  │  Agent (packages/llmtxt SDK)   │  │
│  │  y-websocket provider          │  │  subscribeSection(slug, sid)    │  │
│  │  Yjs Doc (in-memory)           │  │  SectionDelta callback          │  │
│  └──────────┬──────────────────────┘  └──────────┬──────────────────────┘  │
│             │ WS: yjs-sync-v1 binary              │ WS: yjs-sync-v1 binary  │
└─────────────┼─────────────────────────────────────┼───────────────────────┘
              │                                     │
              ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   apps/backend — WebSocket Handler                          │
│                                                                             │
│   route: WS /api/v1/documents/:slug/sections/:sid/collab                   │
│   file: apps/backend/src/routes/ws-crdt.ts                                 │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ 1. resolveWsUser() — bearer token / cookie auth → 4401 if missing   │  │
│   │ 2. RBAC check — editor/owner for write subprotocol → 4403 if denied │  │
│   │ 3. Load section state from Postgres (base + pending updates)         │  │
│   │ 4. Reconstruct live Yrs state via yrs_compact() WASM call           │  │
│   │ 5. Sync Step 1: receive client StateVector                          │  │
│   │ 6. Sync Step 2: send diff (encodeStateAsUpdate vs client SV)        │  │
│   │ 7. On incoming Update:                                               │  │
│   │    a. Persist to section_crdt_updates (Postgres)                   │  │
│   │    b. Apply to in-memory Yrs state via yrs_apply_update() WASM     │  │
│   │    c. PUBLISH to Redis channel crdt:doc:{docId}:section:{secId}    │  │
│   │    d. Echo to all local WS subscribers (excluding sender)           │  │
│   │ 8. On WS close: persist audit log entry (summary); run compaction   │  │
│   │    if clock >= CRDT_COMPACT_THRESHOLD (default 100)                 │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└──────┬─────────────────────────────────────────┬───────────────────────────┘
       │ Drizzle ORM                              │ ioredis / redis
       ▼                                         ▼
┌──────────────────────────┐        ┌──────────────────────────────────────┐
│   PostgreSQL             │        │   Redis                              │
│                          │        │                                      │
│  section_crdt_states     │        │  SUBSCRIBE crdt:doc:*:section:*      │
│  (latest compacted state)│        │  PUBLISH on each incoming update     │
│                          │        │                                      │
│  section_crdt_updates    │        │  Fallback: in-process EventEmitter   │
│  (incremental WAL)       │        │  when REDIS_URL not set              │
└──────────────────────────┘        └──────────────────────────────────────┘
       │
       │ (WASM calls via packages/llmtxt)
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│   crates/llmtxt-core (Rust, compiled to WASM)                           │
│                                                                          │
│   yrs_init_doc()           → Vec<u8>  — empty state vector              │
│   yrs_apply_update(s, u)   → Vec<u8>  — new merged state                │
│   yrs_encode_sv(state)     → Vec<u8>  — state vector for sync step 1    │
│   yrs_diff(state, sv)      → Vec<u8>  — update covering sv's gap        │
│   yrs_get_text(state)      → String   — materialize section content     │
│   yrs_compact(updates[])   → Vec<u8>  — merge N updates into one state  │
│                                                                          │
│   (uses: yrs crate ≥ 0.21, no y-sync, no tokio — WASM-safe)            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Client Connect → Edit → Reconnect

### Phase 1: Connection + Initial Sync

```
Client                          Server
  │                               │
  │── WS upgrade ?token=... ─────►│ resolveWsUser() + RBAC check
  │                               │ load state from Postgres
  │                               │ reconstruct live Yrs state
  │◄── { type: "connected" } ────│
  │                               │
  │── [sync step 1: SV bytes] ──►│ decode client StateVector
  │                               │ call yrs_diff(serverState, clientSV)
  │◄── [sync step 2: diff] ──────│ client applies diff → now in sync
  │                               │
```

### Phase 2: Live Editing

```
Client A (editor)               Server                  Client B (viewer)
  │                               │                          │
  │── [update: bytes] ──────────►│                          │
  │                               │ 1. persist → section_crdt_updates
  │                               │ 2. yrs_apply_update(state, update)
  │                               │ 3. PUBLISH to Redis channel
  │                               │ 4. echo to local subscribers (not A)
  │                               │─── [update: bytes] ─────►│
  │                               │                           │ applyUpdate locally
```

### Phase 3: Reconnect After Disconnect

```
Client                          Server
  │                               │
  │── WS upgrade ───────────────►│ auth + load state
  │── [sync step 1: clientSV] ──►│ yrs_diff(serverState, clientSV)
  │◄── [sync step 2: diff] ──────│ client applies only missed updates
  │── [buffered local updates] ─►│ server applies; echoes to peers
```

---

## Schema Additions

### `apps/backend/src/db/schema.ts` additions

```typescript
export const sectionCrdtStates = sqliteTable(
  'section_crdt_states',
  {
    documentId: text('document_id').notNull().references(() => documents.id),
    sectionId:  text('section_id').notNull(),
    yrsState:   blob('yrs_state', { mode: 'buffer' }).notNull(),
    clock:      integer('clock').notNull().default(0),
    updatedAt:  integer('updated_at').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.documentId, t.sectionId] }),
  }),
);

export const sectionCrdtUpdates = sqliteTable(
  'section_crdt_updates',
  {
    id:         integer('id').primaryKey({ autoIncrement: true }),
    documentId: text('document_id').notNull().references(() => documents.id),
    sectionId:  text('section_id').notNull(),
    updateBlob: blob('update_blob', { mode: 'buffer' }).notNull(),
    clientId:   text('client_id').notNull(),
    seq:        integer('seq').notNull(),
    createdAt:  integer('created_at').notNull(),
  },
  (t) => ({
    docSecSeqIdx: index('sec_upd_doc_sec_seq').on(t.documentId, t.sectionId, t.seq),
    docSecTsIdx:  index('sec_upd_doc_sec_ts').on(t.documentId, t.sectionId, t.createdAt),
  }),
);
```

Note: `apps/backend/src/db/schema-pg.ts` receives equivalent Postgres DDL using `pgTable`, `serial`, `bytea`, `timestamptz` types. The migration follows T144 idempotency contract (separate file per table, no raw DDL outside Drizzle).

---

## New WASM Exports for `crates/llmtxt-core`

Six functions in a new `src/crdt.rs` module:

```rust
/// Initialize a new empty Yrs Doc; returns its serialized state as bytes.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn yrs_init_doc() -> Vec<u8>

/// Encode the state vector of a serialized doc (for sync step 1).
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn yrs_encode_sv(state: &[u8]) -> Vec<u8>

/// Compute the diff between a state and a peer's state vector (for sync step 2).
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn yrs_diff(state: &[u8], peer_sv: &[u8]) -> Vec<u8>

/// Apply an incoming update to a serialized state; returns new serialized state.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn yrs_apply_update(state: &[u8], update: &[u8]) -> Vec<u8>

/// Materialize the Text content from a serialized Yrs doc (section body).
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn yrs_get_text(state: &[u8], key: &str) -> String

/// Compact multiple update blobs into a single consolidated state.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn yrs_compact(updates: Vec<Vec<u8>>) -> Vec<u8>
```

These six functions are the only CRDT primitives that cross the SSoT boundary. All Yjs wire framing, Redis I/O, and Postgres persistence remain in `apps/backend`.

---

## API Surface Additions

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `WS` | `/api/v1/documents/:slug/sections/:sid/collab` | Bearer / cookie; editor+ for write | Yjs sync protocol (yjs-sync-v1) — primary real-time path |
| `GET` | `/api/v1/documents/:slug/sections/:sid/crdt-state` | Bearer / cookie; viewer+ | Return serialized state + StateVector as base64 JSON (for HTTP-only agents) |
| `POST` | `/api/v1/documents/:slug/sections/:sid/crdt-update` | Bearer / cookie; editor+ | Apply a single update blob (HTTP fallback for WS-restricted networks) |

---

## Alternatives Considered

| Option | Rejected because |
|--------|-----------------|
| Y.js (npm) on server | Violates SSoT — no path for Rust/SignalDock consumers. Locked in SSOT.md. |
| Automerge | Different wire format; not byte-compatible with Y.js ecosystem; weaker ecosystem. |
| One Yrs Doc per document (all sections as Maps) | A crash or corrupt update on one section risks the whole document. Section isolation is safer for agents. |
| Hocuspocus NPM package as server | Ties us to a TypeScript-only server. Our goal: WASM-backed state machine. Hocuspocus is inspiration, not a dependency. |
| SQLite for update WAL | Chosen for dev/single-instance. The schema is identical for SQLite (`blob`) and Postgres (`bytea`) — Drizzle abstracts the difference. |

---

## Consequences

**Positive**
- Any standard Y.js/y-websocket/Hocuspocus client connects without modification — agents use the existing ecosystem.
- Crash safety: updates persist before broadcast. Reconnect is lossless.
- Horizontal scale via Redis pub/sub: stateless backend instances.
- `crates/llmtxt-core` gains a tested, WASM-safe CRDT module reusable by SignalDock and future integrators.

**Negative / Trade-offs**
- In-memory Yrs state per active section increases backend RAM proportionally to concurrent documents.
- Redis dependency adds operational complexity (mitigated by EventEmitter fallback for dev).
- Initial sync step adds 1 RTT latency before client is up-to-date (unavoidable with StateVector protocol).
