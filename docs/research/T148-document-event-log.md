# Research: T148 — Per-Document Monotonic Event Log

**Date**: 2026-04-15
**Epic**: T148 — Multi-Agent: Per-document monotonic event log with replay from offset
**Status**: research

---

## 1. Problem Statement

Events today are emitted in-process via `apps/backend/src/events/bus.ts`, a plain
`EventEmitter`. Events are ephemeral — they fan out to SSE/WS listeners currently alive
and are not persisted anywhere. A client that disconnects misses events. A new agent that
joins a document has no way to reconstruct history. Multi-agent collaboration requires
causal ordering guarantees, and those are impossible without a durable, monotonically
ordered event log.

T148 adds durability: every mutating write appends a row to `document_events` with a
per-document monotonic sequence number and a SHA-256 hash chain linking consecutive
events. Clients subscribe via SSE using `Last-Event-ID` to resume from any offset.

Guiding Star properties addressed:
- **Property 1 (Know what is true now)**: clients can replay from their last known seq
- **Property 3 (Know what changed)**: every mutation is a typed event with full payload

This table is load-bearing for T145 (presence + cursors), T149 (MA-4 optimistic locks),
and T155 (MA-9 conflict arbitration).

---

## 2. Relationship to Existing Tables

| Table | Purpose | Canonical? |
|-------|---------|------------|
| `audit_logs` | Cross-cutting compliance record of all API calls | Yes, for compliance/forensics |
| `state_transitions` | Document lifecycle transitions only | Yes, lifecycle audit trail |
| `document_events` (NEW) | Per-document ordered event stream for agent consumption | Yes, for agent coordination |

These are **peers, not duplicates**. `audit_logs` records HTTP-level actions for
compliance (who called what endpoint). `document_events` records semantic domain events
for agent coordination (what changed in the document's content/state). The `state_transitions`
table is a fine-grained sub-log of lifecycle changes; `document_events` captures all
mutation types including version creates and approvals.

The existing in-process `eventBus` (bus.ts) continues to operate for sub-millisecond
fan-out to live SSE/WS connections. After the DB write, the bus still fires. T148 does
not replace the bus — it adds persistence under it.

---

## 3. Schema Design

### 3.1 `document_events` table

```sql
CREATE TABLE document_events (
  id           TEXT PRIMARY KEY,           -- base62 UUID
  document_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,           -- per-document monotonic, starts at 1
  event_type   TEXT NOT NULL,              -- see event taxonomy below
  actor_id     TEXT,                       -- agentId / userId of the initiator (null = system)
  payload_json TEXT NOT NULL DEFAULT '{}', -- JSON blob, event-type-specific
  created_at   INTEGER NOT NULL,           -- unix ms
  prev_hash    TEXT NOT NULL,              -- SHA-256(prev event canonical bytes); 'genesis' for seq=1
  UNIQUE (document_id, seq)
);

CREATE INDEX document_events_document_id_idx ON document_events(document_id);
CREATE INDEX document_events_seq_idx ON document_events(document_id, seq);
CREATE INDEX document_events_event_type_idx ON document_events(document_id, event_type);
CREATE INDEX document_events_actor_idx ON document_events(actor_id);
```

### 3.2 Sequence generation

SQLite has no sequence objects. Per-document monotonic seq is maintained by:

```sql
-- Atomic increment within the same write transaction
SELECT COALESCE(MAX(seq), 0) + 1 FROM document_events WHERE document_id = ?
```

Run inside a `BEGIN IMMEDIATE` transaction (same pattern as existing concurrent version
writes in `apps/backend/src/routes/versions.ts`). This is safe for SQLite's
single-writer model and consistent with the existing `versions` table pattern.

For the PostgreSQL migration path (tracked separately), use a `SEQUENCE` per document or
the `nextval` advisory lock pattern.

### 3.3 Hash chain

Each row's `prev_hash` = SHA-256 of the _canonical bytes_ of the previous row:

```
canonical_bytes(event) = utf8(JSON.stringify({
  "document_id": "...",
  "seq": N,
  "event_type": "...",
  "actor_id": "...",
  "payload_json": "...",   // raw JSON string, not re-parsed
  "created_at": 1713196800000
}))
```

Keys sorted alphabetically. This matches the existing `canonicalize` convention in
`crates/llmtxt-core/src/normalize.rs`. The hash chain is computed in the backend write
path (Node.js using `node:crypto`'s `createHash('sha256')`). No WASM needed here since
this is a server-only operation.

The genesis event (seq=1) uses `prev_hash = 'genesis'`.

**Chain validation** is performed on-write (sync, same transaction) only for events that
arrive out of the expected sequence. The primary integrity check is a background job
(runs hourly) that walks the chain for the last N events per document. Immediate
on-every-write validation would add a `SELECT` for the previous row to every write path;
acceptable overhead but flagged as C1 for consensus.

---

## 4. Event Type Taxonomy

Fixed enum (type-safety beats extensibility for an internal protocol):

```typescript
type DocumentEventType =
  // Existing types in bus.ts DocumentEventType — preserved exactly
  | 'document.created'
  | 'version.created'
  | 'state.changed'
  | 'document.locked'
  | 'document.archived'
  | 'approval.submitted'
  | 'approval.rejected'
  // New types added by T148
  | 'section.edited'      // CRDT section patch committed (T146 integration)
  | 'event.compacted'     // Signals a compaction window; payload has replaced_seq_range
```

The existing `DocumentEventType` in `packages/llmtxt/src/types.ts` must be extended with
`section.edited` and `event.compacted`. This is additive and backward-compatible.

---

## 5. SSE Stream and Replay

### 5.1 Query endpoint

```
GET /api/v1/documents/:slug/events?since=42&limit=100
```

Returns JSON array of events with `seq > since`, ordered by seq ASC, capped at `limit`
(default 100, max 500). Response:

```json
{
  "events": [
    { "seq": 43, "event_type": "version.created", "actor_id": "agt_x", "payload": {}, "created_at": 1713196800123 },
    ...
  ],
  "has_more": false,
  "next_seq": 43
}
```

### 5.2 SSE stream

```
GET /api/v1/documents/:slug/events/stream?since=42
```

Content-Type: `text/event-stream`. Each event:

```
id: 43
event: version.created
data: {"seq":43,"actor_id":"agt_x","payload":{...},"created_at":1713196800123}

```

The SSE `id:` field carries the `seq` value. On reconnect, the browser (or SDK client)
sends `Last-Event-ID: 43`; the server resumes from seq > 43. This is the HTML5
EventSource standard reconnect mechanism.

**Implementation**: The existing `sse.ts` route module registers document-level streams.
T148 wires the new persistence layer so that:
1. Live events emitted via `eventBus` are both persisted AND fanned out in the same
   DB transaction (persist first, then emit to bus).
2. On new SSE connection with `?since=N`, a catch-up query replays `N+1..latest` from
   `document_events` before switching to live fan-out.

### 5.3 Idempotency

Every mutating write that produces a document event MUST carry an `Idempotency-Key`
request header (UUIDv4). The key is stored in `payload_json.idempotency_key`. On retry:

```sql
SELECT id FROM document_events 
WHERE document_id = ? AND payload_json->>'idempotency_key' = ?
LIMIT 1
```

If found, return the original response without inserting a duplicate row. This satisfies
the T148 acceptance criterion for idempotent writes.

---

## 6. Compaction

At day+30, a background job consolidates the `payload_json` for old events into a summary
object and sets `event_type = 'event.compacted'` for the compaction-range entries. The
`seq`, `prev_hash`, `created_at`, and `actor_id` are preserved — the chain is never
broken.

Compaction does not delete rows; it replaces `payload_json` with:
```json
{"compacted_at": 1713196800000, "original_type": "version.created", "summary": "..."}
```

This keeps the hash chain intact while reducing storage.

---

## 7. Concurrent Write Safety

The acceptance criterion requires 100 concurrent writes with no gaps in seq. The
implementation must:
1. Wrap the `MAX(seq)+1` read and the `INSERT` in the same `BEGIN IMMEDIATE` transaction.
2. In SQLite, `BEGIN IMMEDIATE` acquires a write lock immediately, serializing concurrent
   writers at the DB level. This is identical to the pattern in `versions.ts` for
   concurrent version creation.
3. The `UNIQUE(document_id, seq)` constraint provides a final safety net; a duplicate seq
   INSERT will fail with a constraint error, which the application MUST retry.

---

## 8. SDK Integration

`packages/llmtxt` exports:

```typescript
interface DocumentEvent {
  seq: number
  event_type: DocumentEventType
  actor_id: string | null
  payload: Record<string, unknown>
  created_at: number
}

// AsyncIterable of typed events; reconnects on disconnect using Last-Event-ID
function watchDocument(slug: string, fromSeq?: number): AsyncIterable<DocumentEvent>
```

The `watchDocument` function wraps the `EventSource` (or `fetch` SSE) API in an
async generator that:
1. Opens `GET /api/v1/documents/:slug/events/stream?since=${fromSeq ?? 0}`
2. Yields events as they arrive
3. On disconnect, re-opens from the last received `seq`
4. Throws on non-retryable errors (404 document not found, 403 unauthorized)

---

## 9. Open Decisions for Consensus (flagged for HITL)

| ID | Decision | Proposed Answer | Risk |
|----|----------|-----------------|------|
| C1 | Validate hash chain on every write or async? | Async background job (hourly) — not on every write. On-write would add a `SELECT prev` to every mutation path; at high throughput (100 concurrent writers) this creates lock contention in SQLite. | Medium — tampering window is up to 1 hour |
| C2 | `audit_logs` vs `document_events` — which wins for compliance queries? | `audit_logs` is canonical for compliance (HTTP-level, cross-resource). `document_events` is canonical for agent coordination (document-scoped, semantic). They are peers. | Low |
| C3 | Event type taxonomy: fixed enum vs free string? | Fixed enum (type-safety). New event types require a code change, which is intentional — prevents arbitrary event proliferation. | Low |
| C4 | Idempotency key storage — inside `payload_json` or a dedicated column? | Dedicated column `idempotency_key TEXT` with a `UNIQUE(document_id, idempotency_key)` partial index (only for non-null keys). More efficient than JSON path queries in SQLite. | Low |

---

## 10. Sources

- HTML5 EventSource / SSE spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
- Existing event bus: `apps/backend/src/events/bus.ts`
- Existing SSE routes: `apps/backend/src/sse.ts`
- Existing schema patterns: `apps/backend/src/db/schema.ts`
- Existing concurrent version writes (BEGIN IMMEDIATE): `apps/backend/src/routes/versions.ts`
- T145 (presence + cursors): depends on document_events.seq for cursor position
- T146 (CRDT): emits `section.edited` event type
