# SPEC-T148: Per-Document Monotonic Event Log

**Version**: 1.0.0
**Date**: 2026-04-15
**Epic**: T148 — Multi-Agent: Per-document monotonic event log with replay from offset
**RFC 2119 keywords**: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in RFC 2119.

---

## 1. Scope

This specification covers:
- The `document_events` Drizzle schema
- The sequence assignment and hash chain protocol
- The five mutating route updates (persist-then-emit)
- The query endpoint `GET /api/v1/documents/:slug/events`
- The SSE stream endpoint `GET /api/v1/documents/:slug/events/stream`
- The idempotency key mechanism
- The background hash chain validator
- The compaction job (day+30)
- The SDK `watchDocument` function

Out of scope: cross-document event ordering, event sourcing as primary storage,
global sequence numbers, PostgreSQL migration (separate epic).

---

## 2. Database Schema

### 2.1 `document_events` table

**S-DB-01**: A migration MUST create the `document_events` table with the following
columns using Drizzle ORM conventions matching the existing `schema.ts` style:

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | TEXT | PRIMARY KEY, base62 |
| `document_id` | TEXT | NOT NULL, FK → `documents.id` ON DELETE CASCADE |
| `seq` | INTEGER | NOT NULL |
| `event_type` | TEXT | NOT NULL, see S-TYPES-01 |
| `actor_id` | TEXT | NULL allowed (null = system-generated event) |
| `payload_json` | TEXT | NOT NULL, default `'{}'` |
| `idempotency_key` | TEXT | NULL allowed |
| `created_at` | INTEGER | NOT NULL, unix ms |
| `prev_hash` | TEXT | NOT NULL, 64-char hex or literal `'genesis'` |

**S-DB-02**: The migration MUST create the following indexes:

```sql
CREATE UNIQUE INDEX doc_events_seq_idx     ON document_events(document_id, seq);
CREATE        INDEX doc_events_type_idx    ON document_events(document_id, event_type);
CREATE        INDEX doc_events_actor_idx   ON document_events(actor_id);
CREATE UNIQUE INDEX doc_events_idem_idx    ON document_events(document_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

The partial unique index `WHERE idempotency_key IS NOT NULL` MUST be implemented via raw
SQL in the migration file because Drizzle ORM does not natively support partial indexes.

**S-DB-03**: The Drizzle type definitions MUST be exported from `schema.ts` as
`DocumentEvent`, `InsertDocumentEvent`, `SelectDocumentEvent` following the existing
naming conventions.

---

## 3. Event Types

**S-TYPES-01**: The `DocumentEventType` type in `packages/llmtxt/src/types.ts` MUST be
extended to include ALL of the following values. No additional values are permitted without
a code review:

```typescript
type DocumentEventType =
  // Existing (unchanged)
  | 'document.created'
  | 'version.created'
  | 'state.changed'
  | 'document.locked'
  | 'document.archived'
  | 'approval.submitted'
  | 'approval.rejected'
  // New in T148
  | 'section.edited'      // CRDT delta committed to a version (T146)
  | 'event.compacted'     // Compaction boundary event
```

**S-TYPES-02**: The event type MUST be validated against the enum at write time. An
unknown `event_type` value MUST NOT be inserted and MUST cause an application error.

---

## 4. Sequence and Hash Chain Protocol

**S-SEQ-01**: The sequence number (`seq`) MUST be a per-document monotonically increasing
integer starting at 1.

**S-SEQ-02**: Sequence assignment MUST be performed inside a `BEGIN IMMEDIATE` transaction
in SQLite using:

```sql
SELECT COALESCE(MAX(seq), 0) + 1 FROM document_events WHERE document_id = ?
```

This SELECT and the subsequent INSERT MUST be in the same transaction. A gap in seq
values is a protocol violation.

**S-SEQ-03**: If the INSERT fails with a `UNIQUE` constraint violation on
`(document_id, seq)`, the application MUST retry the transaction up to 3 times with
no delay. If all retries fail, the write MUST be rolled back and the caller MUST receive
`500 Internal Server Error`.

**S-SEQ-04**: The `prev_hash` of the first event for a document (seq=1) MUST be the
literal string `'genesis'`.

**S-SEQ-05**: For seq > 1, `prev_hash` MUST be computed as:

```
SHA-256( utf8(canonical_json(previous_event_row)) )
```

Where `canonical_json` produces a JSON object with keys in alphabetical order:
```json
{"actor_id":...,"created_at":...,"document_id":"...","event_type":"...","payload_json":"...","seq":...}
```

Note: `payload_json` is included as a raw string (not re-parsed). `created_at` and `seq`
are included as JSON numbers.

**S-SEQ-06**: The `prev_hash` computation MUST use `node:crypto.createHash('sha256')`.
It MUST NOT use the WASM bindings for this server-side operation.

---

## 5. Persist-Then-Emit Protocol

**S-EMIT-01**: The following five route handlers MUST be modified to insert a
`document_events` row BEFORE emitting to the in-process `eventBus`:

1. `apps/backend/src/routes/versions.ts` — on successful `PUT /documents/:slug`
2. `apps/backend/src/routes/lifecycle.ts` — on successful `PATCH /documents/:slug/lifecycle`
3. `apps/backend/src/routes/api.ts` — on `POST /documents` (document.created)
4. `apps/backend/src/routes/patches.ts` — on successful section patch (section.edited, T146)
5. Approval route — on successful approval submission

**S-EMIT-02**: The `document_events` INSERT MUST occur within the same database
transaction as the primary mutation (e.g., the `versions` INSERT). They MUST commit
atomically — if either INSERT fails, both MUST be rolled back.

**S-EMIT-03**: The `eventBus.emit()` call MUST occur AFTER the database transaction
commits successfully. It MUST NOT be called inside the transaction.

**S-EMIT-04**: The `actor_id` in the event row MUST be set to the authenticated user's
`agentId` field (from `users.agent_id`), falling back to `users.id` if `agent_id` is null.

---

## 6. Idempotency

**S-IDEM-01**: All five mutating routes MUST accept an `Idempotency-Key` request header.
The value MUST be a UUIDv4 string (validated by the server).

**S-IDEM-02**: When an `Idempotency-Key` header is present, the server MUST check:

```sql
SELECT id FROM document_events
WHERE document_id = ? AND idempotency_key = ?
LIMIT 1
```

**S-IDEM-03**: If a matching row is found, the server MUST return the original response
status and body from the first successful request. It MUST NOT insert a duplicate row.

**S-IDEM-04**: If no matching row is found, the server MUST proceed normally and store
`idempotency_key` in the `document_events` row.

**S-IDEM-05**: An invalid `Idempotency-Key` format (not UUIDv4) MUST return `422`.

---

## 7. Query Endpoint

**S-QUERY-01**: `GET /api/v1/documents/:slug/events` MUST be implemented.

**S-QUERY-02**: Query parameters:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `since` | integer ≥ 0 | 0 | — | Return events with seq > since |
| `limit` | integer 1–500 | 100 | 500 | Max events per page |

**S-QUERY-03**: The response MUST be:

```typescript
{
  events: Array<{
    seq: number
    event_type: DocumentEventType
    actor_id: string | null
    payload: Record<string, unknown>
    created_at: number
  }>,
  has_more: boolean,
  next_since: number   // = last event seq in this page, or `since` if no events
}
```

**S-QUERY-04**: Events MUST be ordered by `seq ASC`.

**S-QUERY-05**: The endpoint MUST require at minimum read access on the document (public
documents may be queried unauthenticated, consistent with existing visibility rules).

---

## 8. SSE Stream Endpoint

**S-SSE-01**: `GET /api/v1/documents/:slug/events/stream` MUST be implemented with
`Content-Type: text/event-stream`.

**S-SSE-02**: The endpoint MUST accept `?since=<seq>` query parameter (default 0) AND the
`Last-Event-ID` header for resume. If both are present, `Last-Event-ID` takes precedence.

**S-SSE-03**: On connection, the server MUST:
1. Query all events with seq > since from `document_events` and stream them immediately
   (catch-up phase), each formatted as an SSE message.
2. Subscribe to `eventBus` for live events on this document.
3. For each new event received from the bus, stream it to the client.

**S-SSE-04**: Each SSE message MUST have the format:

```
id: <seq>\n
event: <event_type>\n
data: <json-object-without-newlines>\n
\n
```

Where `data` is:
```json
{"seq":42,"actor_id":"...","payload":{},"created_at":1713196800000}
```

**S-SSE-05**: The SSE `id:` field MUST be set to the `seq` value (as a decimal integer
string). This enables the standard `Last-Event-ID` resume mechanism.

**S-SSE-06**: The server MUST send a `:\n\n` (comment/keep-alive) ping every 30 seconds
to prevent proxy timeout disconnections.

**S-SSE-07**: On client disconnect, the server MUST remove the event listener from the
bus and release all resources associated with the stream.

**S-SSE-08**: The endpoint MUST require at minimum read access (same as S-QUERY-05).

---

## 9. Hash Chain Validation (Background Job)

**S-CHAIN-01**: A background job `validateEventChain` MUST be implemented. It MUST run
on a schedule of at most every 60 minutes. The schedule MAY be triggered by an admin API.

**S-CHAIN-02**: The job MUST, for each document with events in the last 24 hours, validate
the hash chain for the most recent 1,000 events (configurable via environment variable
`EVENT_CHAIN_VALIDATION_WINDOW`, default 1000).

**S-CHAIN-03**: Validation algorithm:
```
For seq = 2..N:
  computed_hash = sha256(canonical_json(event[seq-1]))
  if event[seq].prev_hash != computed_hash:
    ALERT: chain break at document_id=X, seq=N
    break
```

**S-CHAIN-04**: On chain break detection, the job MUST emit a log entry at `error` level
and MUST insert a `document_events` row with `event_type = 'system.integrity.violation'`,
`actor_id = null`, `seq = MAX(seq)+1`, and `payload_json` containing
`{"broken_at_seq": N, "expected_hash": "...", "found_hash": "..."}`.

**S-CHAIN-05**: The job MUST NOT delete or modify any existing event rows.

---

## 10. Compaction (Day+30)

**S-COMPACT-01**: A background job `compactEventLog` MUST be implemented. It MUST run
once per day.

**S-COMPACT-02**: For each event row older than 30 days (configurable via
`EVENT_COMPACTION_DAYS`, default 30), the job MUST:
- Set `event_type = 'event.compacted'`
- Replace `payload_json` with:
  ```json
  {"compacted_at":<unix-ms>,"original_type":"<original event_type>","summary":"<changelog-or-empty>"}
  ```
- Leave `id`, `document_id`, `seq`, `actor_id`, `created_at`, and `prev_hash` unchanged.

**S-COMPACT-03**: The job MUST NOT delete any rows.

---

## 11. SDK: `watchDocument`

**S-SDK-01**: `packages/llmtxt` MUST export from `packages/llmtxt/src/sdk/events.ts`:

```typescript
export function watchDocument(
  slug: string,
  fromSeq?: number,
  options?: { baseUrl?: string; headers?: Record<string, string> }
): AsyncIterable<DocumentEvent>
```

**S-SDK-02**: `watchDocument` MUST connect to
`GET /api/v1/documents/:slug/events/stream?since=<fromSeq ?? 0>`.

**S-SDK-03**: On disconnect, `watchDocument` MUST automatically reconnect using the last
received `seq` as the new `since` value, with exponential backoff starting at 1 second,
capped at 30 seconds.

**S-SDK-04**: `watchDocument` MUST yield typed `DocumentEvent` objects on each SSE message.

**S-SDK-05**: `watchDocument` MUST throw (and stop iterating) on:
- HTTP 404 (document not found)
- HTTP 401/403 (unauthorized)

It MUST reconnect (not throw) on:
- HTTP 5xx
- Network errors
- HTTP 429 (after the `Retry-After` header delay if present)

---

## 12. Acceptance Criteria (mirrored from T148)

1. Every mutating API call (POST version, PATCH state, POST approval, PATCH section)
   inserts a `document_events` row with a monotonically increasing `seq` scoped to the
   document.
2. `GET /api/v1/documents/:slug/events?since=42` returns all events with seq > 42 in
   ascending seq order; a test verifies 100 concurrent writes produce 100 distinct seq
   values with no gaps.
3. SSE stream includes `id:` field matching seq; reconnecting with `Last-Event-ID` resumes
   from that offset without replaying earlier events.
4. Idempotency: replaying the same HTTP request results in exactly one event row.
5. CI integration test: 5 agents writing concurrently for 10 seconds; final event log has
   no duplicate seq values and seq is monotonically increasing.
6. `packages/llmtxt` exports `watchDocument(slug, fromSeq)` returning `AsyncIterable<DocumentEvent>`.
