# ADR-T148: Per-Document Monotonic Event Log with Hash Chain

**Status**: Proposed
**Date**: 2026-04-15
**Epic**: T148 — Multi-Agent: Per-document monotonic event log with replay from offset
**Deciders**: Team Lead (LOOM RCASD), pending HITL consensus on C1/C4
**Depends on**: T144, T145

---

## Context

Events from document mutations (version creation, state transitions, approvals) are today
emitted in-process via an `EventEmitter` bus and fan out to live SSE/WS connections. They
are not persisted. Agents that disconnect lose events; newly joining agents have no history.

Multi-agent collaboration (T146 CRDT, T145 presence, T149 locking) requires:
1. Durable, ordered event history per document
2. Client-side replay from any offset (Last-Event-ID resume)
3. Tamper evidence via hash chain (Guiding Star property 5: Verify nothing has been tampered)
4. Idempotent writes to prevent duplicate events on HTTP retry

This ADR specifies the `document_events` table, the append protocol, the SSE replay
mechanism, and the relationship to existing tables.

---

## Decision

### New Table: `document_events`

```sql
-- Drizzle ORM definition (SQLite schema)
export const documentEvents = sqliteTable(
  'document_events',
  {
    id:           text('id').primaryKey(),           -- base62 UUID
    documentId:   text('document_id').notNull()
                    .references(() => documents.id, { onDelete: 'cascade' }),
    seq:          integer('seq').notNull(),           -- per-document monotonic, starts at 1
    eventType:    text('event_type').notNull(),       -- DocumentEventType enum
    actorId:      text('actor_id'),                  -- agentId/userId; null = system
    payloadJson:  text('payload_json').notNull()
                    .default('{}'),
    idempotencyKey: text('idempotency_key'),          -- client-supplied UUIDv4; nullable
    createdAt:    integer('created_at').notNull(),    -- unix ms
    prevHash:     text('prev_hash').notNull(),        -- SHA-256 of prev canonical bytes;
                                                     -- literal 'genesis' for seq=1
  },
  (table) => ({
    seqIdx:     uniqueIndex('doc_events_seq_idx').on(table.documentId, table.seq),
    typeIdx:    index('doc_events_type_idx').on(table.documentId, table.eventType),
    actorIdx:   index('doc_events_actor_idx').on(table.actorId),
    idemIdx:    uniqueIndex('doc_events_idem_idx').on(table.documentId, table.idempotencyKey),
    // NOTE: uniqueIndex on idempotencyKey must be a partial index (WHERE idempotencyKey IS NOT NULL).
    // Drizzle does not yet support partial indexes natively; implement via raw migration SQL.
  })
);
```

### Sequence Assignment Protocol

```
BEGIN IMMEDIATE;  -- write lock, prevents concurrent MAX(seq) races
  next_seq = SELECT COALESCE(MAX(seq), 0) + 1 FROM document_events WHERE document_id = ?;
  prev_row  = SELECT id, seq, event_type, actor_id, payload_json, created_at
              FROM document_events WHERE document_id = ? ORDER BY seq DESC LIMIT 1;
  prev_hash = prev_row IS NULL ? 'genesis' : sha256(canonical_bytes(prev_row));
  INSERT INTO document_events (id, document_id, seq, event_type, actor_id,
              payload_json, idempotency_key, created_at, prev_hash)
  VALUES (?, ?, next_seq, ?, ?, ?, ?, ?, prev_hash);
COMMIT;
```

This is the only correct sequence assignment protocol. Any approach that assigns seq
outside the transaction will produce gaps under concurrent load.

### Canonical Bytes for Hash Chain

```
canonical_bytes(row) = utf8(JSON.stringify({
  "actor_id":    row.actorId,      // null → JSON null
  "created_at":  row.createdAt,
  "document_id": row.documentId,
  "event_type":  row.eventType,
  "payload_json": row.payloadJson, // raw string, not re-serialized
  "seq":         row.seq
}))
```

Keys are alphabetically sorted (matches `crates/llmtxt-core/src/normalize.rs` convention).
Computed using `node:crypto.createHash('sha256')` in the backend write path.

### Persist-then-Emit Ordering

Every route handler that previously called `eventBus.emitXxx()` MUST be modified to:

1. Insert the `document_events` row (inside the same write transaction as the primary mutation)
2. After `COMMIT`, call `eventBus.emit('document', {...})` as before

The bus emission MUST happen after commit to ensure SSE subscribers cannot receive an
event that refers to a row that has not yet committed. This is the standard "outbox"
pattern without a full outbox table — practical because SQLite is single-writer.

### Idempotency (Decision C4 — resolved)

A dedicated `idempotency_key TEXT` column with a partial unique index
`UNIQUE(document_id, idempotency_key) WHERE idempotency_key IS NOT NULL` prevents
duplicate event insertion on HTTP retry. The idempotency key is the value of the
`Idempotency-Key` request header (UUIDv4). If the INSERT fails with a unique constraint
violation on `(document_id, idempotency_key)`, the handler returns the original response
(200/201) without a new write.

### Hash Chain Validation (Decision C1 — resolved)

Chain validation is performed **asynchronously** by a background job, not on every write.

Rationale: On every write, validating the chain requires a `SELECT` for the previous row.
In SQLite under high concurrent write load (100 agents, T148 acceptance criterion), this
adds a read inside the write transaction and increases lock hold time. The marginal
tamper-detection benefit (catching tampering within <1 hour rather than immediately) is
outweighed by the throughput cost.

Background job behavior:
- Runs every 60 minutes
- Walks the last 1,000 events per document (configurable)
- On chain break: emits an alert log entry + inserts a `system.integrity.violation` event
- Does not repair: tampering is immutable; alerts operators

### SSE Replay Protocol

```
Client:  GET /api/v1/documents/:slug/events/stream?since=42
         (or reconnect with Last-Event-ID: 42 header)

Server:
  1. Query: SELECT * FROM document_events
            WHERE document_id = ? AND seq > 42
            ORDER BY seq ASC
            LIMIT 100
  2. Stream existing events as SSE (id: <seq>, event: <type>, data: <json>)
  3. Switch to live fan-out: subscribe to eventBus, emit new events as they arrive
  4. On new event from eventBus: INSERT (already done by route handler) then stream
```

No events are skipped between catch-up query and live subscription because both the DB
insert and bus emit happen in the same goroutine-equivalent (single-threaded Node.js event
loop with no async gap between commit and emit).

### Query Endpoint

```
GET /api/v1/documents/:slug/events?since=<seq>&limit=<n>
```

Response:
```json
{
  "events": [{ "seq": 43, "event_type": "...", "actor_id": "...", "payload": {}, "created_at": 0 }],
  "has_more": true,
  "next_since": 143
}
```

`since` defaults to 0 (return all events). `limit` defaults to 100, max 500.

### Compaction (day+30)

Background job at day+30:
- For events older than 30 days in `document_events`
- Replace `payload_json` with `{"compacted_at":<ms>,"original_type":"...","summary":"..."}`
- Preserve: `id`, `document_id`, `seq`, `event_type`, `actor_id`, `created_at`, `prev_hash`
- `event_type` for compacted rows = `'event.compacted'`
- Hash chain is preserved (rows are not deleted)

This approach satisfies the T148 spec requirement while controlling storage growth.

---

## State Machine: Event Append

```
                 ┌─────────────────────────────┐
                 │  Route handler: mutating op  │
                 └──────────────┬──────────────┘
                                │
                       BEGIN IMMEDIATE
                                │
               ┌────────────────▼─────────────────┐
               │  Idempotency check                │
               │  SELECT doc_events WHERE          │
               │  document_id=? AND idem_key=?     │
               └──────────┬──────────┬────────────┘
                   not found         found
                          │              │
               ┌──────────▼──┐    ┌──────▼──────┐
               │ Compute seq │    │ Return early │
               │ Compute hash│    │ (200/201)    │
               │ INSERT row  │    └─────────────┘
               └──────────┬──┘
                          │
                       COMMIT
                          │
               ┌──────────▼────────────┐
               │ eventBus.emit(...)    │
               └──────────┬────────────┘
                          │
               ┌──────────▼────────────┐
               │ SSE subscribers       │
               │ receive live event    │
               └───────────────────────┘
```

---

## Relationship to Other Epics

| Epic | How it uses document_events |
|------|----------------------------|
| T145 (presence + cursors) | Reads `seq` to track cursor position; subscribes to stream |
| T146 (CRDT) | Emits `section.edited` events on CRDT delta commit |
| T147 (identity) | `actor_id` in event row maps to verified `agent_pubkeys.id` when available |
| T149 (locking) | Reads stream to detect concurrent lock conflicts |
| T155 (conflict arbitration) | Replays event log to reconstruct causal history |

---

## Alternatives Considered

| Option | Rejected reason |
|--------|-----------------|
| Global sequence (across all documents) | Serialization bottleneck; documents are independent coordination units |
| Kafka/NATS event bus | External dependency; overkill for current scale; Railway doesn't run Kafka |
| Event sourcing as primary storage | Out of scope per T148 spec; versioned content is still primary |
| PostgreSQL SEQUENCE per document | Correct approach for Phase 2 PG migration; SQLite is current reality |

---

## Consequences

**Positive**:
- Agents can reconstruct full document history without server state
- SSE `Last-Event-ID` resume is a web standard — no custom protocol needed
- Hash chain provides tamper evidence aligned with Guiding Star property 5
- Idempotency prevents duplicate events on network retry

**Negative**:
- Every mutating route must be updated to append a `document_events` row (5 routes)
- Background hash chain validator is a new operational dependency
- SQLite `BEGIN IMMEDIATE` serializes writes to a document — acceptable now, revisit for PG

**Migration path**:
- Migration adds `document_events` table
- Existing rows in `audit_logs` and `state_transitions` are NOT back-filled
- Event log starts empty; seq=1 for the first post-migration write to each document
