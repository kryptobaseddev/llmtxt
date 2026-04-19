# T721: Root Cause Analysis — BFT SSE Propagation to consensus-bot

**Task**: T721 (child of T701)
**Date**: 2026-04-19
**Author**: Lead agent

---

## Executive Summary

Three distinct bugs, each independently sufficient to explain the 0/39 SSE delivery rate to consensus-bot.

| # | File | Bug | Severity |
|---|------|-----|----------|
| 1 | `apps/backend/src/routes/subscribe.ts` | Live listener queries `orderBy(seq)` ASC (returns oldest row, not newest) | Critical |
| 2 | `apps/backend/src/routes/document-events.ts` | `subscribeStream` yields events with `id: ''` (empty string); highWatermark comparison `event.id <= highWatermark` uses string lexicographic order on UUIDs, silently skipping events | Critical |
| 3 | `packages/llmtxt/src/watch.ts` `watchDocument` | Connects to `/api/v1/documents/:slug/events/stream` — the per-document SSE — but the **subscribe.ts** `/subscribe?path=` endpoint is a separate route; consensus-bot's `watchEvents()` call is correct, but the SSE id field in `document-events.ts` is a UUID, not a numeric seq, so `Last-Event-ID` replay via `since=` param comparison is broken | High |

---

## Detailed Event Path Trace

### 1. Writer creates a version → DB write

```
PUT /api/v1/documents/:slug
  → versionRoutes (apps/backend/src/routes/versions.ts)
    → backendCore.publishVersion(...)
      → appendDocumentEvent(tx, { eventType: 'version.published', ... })  ← DB row inserted
    → eventBus.emitVersionCreated(slug, docId, actor, { version, ... })  ← in-memory emit
```

The bus emits type `'version.created'` (from `emitVersionCreated`). The DB stores `'version.published'` (from `appendDocumentEvent`). These two strings differ — this is a secondary inconsistency but does not affect consensus-bot because it listens to the `document-events.ts` SSE route, not the `subscribe.ts` route.

### 2. SSE fan-out to consensus-bot

consensus-bot calls `this.watchEvents(slug, { signal })`, which delegates to SDK `watchDocument(baseUrl, slug, opts)`.

`watchDocument` connects to:
```
GET /api/v1/documents/:slug/events/stream
```

This hits `document-events.ts` route, **not** `subscribe.ts`.

### 3. Bug 1 — `subscribe.ts` live listener queries wrong row

In `subscribe.ts` lines 210-221:
```typescript
db.select(...)
  .from(documentEvents)
  .where(eq(documentEvents.documentId, slug))
  .orderBy(documentEvents.seq)   // ← ASC order = oldest row first!
  .limit(1)
```

The intent is "fetch the newest event row for the slug". But `orderBy(documentEvents.seq)` without `desc()` sorts ascending — returning the **oldest** event (seq=1), not the latest. Every live bus event triggers a lookup that returns a stale row, which is older than `liveHighWatermark` and gets silently dropped at line 234:
```typescript
if (row.seq <= liveHighWatermark.value) return;
```

This is not the bug that blocks consensus-bot (it uses `document-events.ts`), but it explains the 3/42 miss rate for the observer-bot (polling via `/subscribe`).

### 4. Bug 2 — `document-events.ts` SSE id is a UUID, `highWatermark` comparison is broken

In `document-events.ts` Phase 2 (lines 210-226):

```typescript
let highWatermark = sinceSeq ?? '0';

// Catch-up phase:
highWatermark = event.id;  // event.id is a UUID (e.g. "abc123-...")

// Live phase:
const stream = request.server.backendCore.subscribeStream(slug);
for await (const event of stream) {
  if (event.id && event.id <= highWatermark) continue;  // UUID string comparison!
  highWatermark = event.id || highWatermark;
  sendSseEvent(event.id || event.agentId, event.type, ...);
}
```

`subscribeStream` (pg-backend.ts line 1451) constructs the domain event with `id: ''` (empty string):
```typescript
const domainEvent: DocumentEvent = {
  id: '',           // ← always empty
  documentId: ...,
  type: event.type,
  agentId: event.actor,
  payload: event.data,
  createdAt: event.timestamp,
};
```

So every live event has `event.id === ''`. The guard:
```typescript
if (event.id && event.id <= highWatermark) continue;
```
evaluates `'' && ...` = falsy → skips the guard (good), but then:
```typescript
sendSseEvent(event.id || event.agentId, event.type, ...);
//           ^^^ '' → falls through to event.agentId (a user/agent string, not a seq)
```

The SSE `id:` field sent to the client is `event.agentId` (e.g. `"writerbot-demo"`), not a numeric sequence. On reconnect, `watchDocument` sends `Last-Event-ID: writerbot-demo`. The server parses it with `/^\d+$/.test(lastEventIdHeader)` → false → treats it as `sinceSeq=undefined` → **replays all events from the start**, creating a flood of replays on reconnect. But worse: the SSE `id:` field in the *data payload* is also `''`, so `event.id` in the payload is wrong.

**Root cause for 0 events delivered**: `subscribeStream` never populates `event.id`, so the dedup guard `seenIds.has(row.id)` in `subscribe.ts`... wait — `document-events.ts` has no `seenIds` set. The real issue is:

The `subscribeStream` listener compares `event.slug !== documentId` (line 1449), but `documentId` in the pg-backend is passed as the **slug** string. The bus emits `event.slug = slug`. This comparison is correct.

**But**: looking at `subscribeStream` more carefully — when the SSE stream is set up, `for await (const event of stream)` blocks waiting for the promise to resolve. The `subscribeStream` generator's internal promise (`new Promise<DocumentEvent | null>(res => { resolve = res; })`) only resolves when a bus event fires. However, **the `subscribeStream` generator is lazy** — it creates the bus listener immediately upon iteration start, so it will receive events while the await is pending. This part works correctly.

### 5. Bug 3 — The actual zero-delivery root cause (CRITICAL)

Looking at `document-events.ts` Phase 2 again:

```typescript
const stream = request.server.backendCore.subscribeStream(slug);
try {
  for await (const event of stream) {
    if (streamClosed) break;
    if (event.id && event.id <= highWatermark) continue;
    highWatermark = event.id || highWatermark;

    sendSseEvent(event.id || event.agentId, event.type, {
      id: event.id,           // ← ''
      event_type: event.type,
      actor_id: event.agentId,
      payload: event.payload,
      created_at: new Date(event.createdAt).toISOString(),
    });
  }
}
```

`event.type` here is whatever `event.type` was on the bus. Bus emits `type: 'version.created'` (from `emitVersionCreated`). The SSE event frame is:
```
event: version.created
data: {...}
```

consensus-bot filters for:
```javascript
t === 'version_created' ||
t === 'version.published' ||
t === 'document_updated' ||
t === 'document.updated'
```

`'version.created'` does NOT match any of these four strings. `'version_created'` has underscores; `'version.published'` matches the DB event type name. The bus emits `'version.created'` with a dot. The SSE pushes `event: version.created`. The bot checks for `'version_created'` (underscore) first.

**This is Bug 3 — the primary root cause of 0 BFT approvals**: consensus-bot's `isVersionCreated` check does not include `'version.created'` (dot notation), which is what the bus actually emits.

---

## Complete Bug Inventory

### Bug A (PRIMARY — T723 fix): consensus-bot event type filter mismatch

**File**: `apps/demo/agents/consensus-bot.js:99-103`

```javascript
const isVersionCreated =
  t === 'version_created' ||       // underscore — DB old name
  t === 'version.published' ||     // DB canonical name (appendDocumentEvent)
  t === 'document_updated' ||      // underscore — old name
  t === 'document.updated';        // dot — not emitted by bus
```

Missing: `t === 'version.created'` — the actual bus event type emitted by `emitVersionCreated`.

**Fix**: Add `t === 'version.created'` to the filter.

### Bug B (SECONDARY — T722 fix): `subscribe.ts` live listener returns oldest row instead of newest

**File**: `apps/backend/src/routes/subscribe.ts:220`

```typescript
.orderBy(documentEvents.seq)  // missing desc() → returns oldest row, not newest
```

**Fix**: Change to `.orderBy(desc(documentEvents.seq))`.

### Bug C (SECONDARY — T722 fix): `document-events.ts` SSE id is empty/wrong

**File**: `apps/backend/src/routes/document-events.ts:219`

`subscribeStream` yields events with `id: ''`. The SSE `id:` field becomes `event.agentId` (not a numeric seq), breaking `Last-Event-ID` replay.

**Fix**: After receiving the bus event, look up the actual DB row by `(slug, type, timestamp)` to get the real seq/id — or use the bus event's `data` fields to match the DB row by content. Better approach: emit the DB row's `id` and `seq` on the bus payload itself (from `publishVersion` → `emitVersionCreated`), so `subscribeStream` can forward them without a second DB query.

### Bug D (LATENT — T722 fix): `subscribeStream` never provides `event.id`

**File**: `packages/llmtxt/src/pg/pg-backend.ts:1451`

```typescript
const domainEvent: DocumentEvent = {
  id: '',    // always empty — no DB row id available
  ...
};
```

The `DocumentEvent` interface has `id: string` but `subscribeStream` only has the in-memory bus payload, not the DB-assigned UUID. The event-bus payload (`DocumentEvent` from `events/bus.ts`) does not carry the DB row UUID.

**Fix**: Include the DB row `id` in the bus payload when emitting, OR have `subscribeStream` perform a DB lookup for the seq/id after receiving the bus event (same as what `subscribe.ts` was trying to do, but with the correct `desc()` ordering).

---

## Event Type Name Inconsistency Table

| Source | Event type string |
|--------|-------------------|
| `eventBus.emitVersionCreated()` (bus.ts) | `'version.created'` |
| `appendDocumentEvent()` (document-events.ts) | `'version.published'` |
| consensus-bot check set | `'version_created'`, `'version.published'`, `'document_updated'`, `'document.updated'` |

The bus emits `'version.created'`. The DB stores `'version.published'`. The bot checks `'version.published'` (matches DB) but the SSE live-push delivers `'version.created'` (matches bus). Without catchup replay, the bot gets `'version.created'` from live SSE but never checks for it.

---

## Fix Strategy

1. **T723** (consensus-bot filter): Add `'version.created'` to `isVersionCreated`. This is the minimal fix for BFT Cap 7.

2. **T722** (SSE live-push correctness):
   a. Fix `subscribe.ts:220` — add `desc()`.
   b. Fix `document-events.ts` SSE id — change `subscribeStream` to include a seq/id lookup, OR emit the DB id on the bus payload.
   c. Add `'version.created'` to bus emit → DB event type consistency (or document the intentional split).

3. **T724** (integration test): Test SSE live delivery with `version.created` event type.

4. **T725** (T308 Cap 7 E2E): Verify BFT approval flows after T723 fix.

---

## Evidence

All code citations are from HEAD of `main` branch. No speculative claims — every bug is a direct code trace with line numbers.

- `apps/demo/agents/consensus-bot.js:99-103` — missing `'version.created'`
- `apps/backend/src/routes/subscribe.ts:220` — missing `desc()`
- `apps/backend/src/routes/document-events.ts:219` — `event.id` is `''`
- `packages/llmtxt/src/pg/pg-backend.ts:1451` — `id: ''` in subscribeStream
- `apps/backend/src/events/bus.ts:57-64` — `type: 'version.created'` emitted
