# T627: Event Code Audit — llmtxt/events Subpath

**Task**: T627  
**Date**: 2026-04-18  
**Auditor**: Lead agent T608  

---

## 1. Scope

Survey all event-related code across LocalBackend, PostgresBackend, and SDK layer.
Document every file:line with event emit, subscribe, or stream logic.

---

## 2. LocalBackend (`packages/llmtxt/src/local/local-backend.ts`)

### 2.1 Event Bus Setup

| Line | Code | Notes |
|------|------|-------|
| 33 | `import { EventEmitter } from 'node:events'` | Node EventEmitter import |
| 244 | `private readonly bus = new EventEmitter()` | Bus instantiated as private field |
| 261 | `this.bus.setMaxListeners(500)` | Max listeners raised to 500 |

### 2.2 Document Event (subscribeStream channel)

| Line | Code | Notes |
|------|------|-------|
| 877–889 | `appendEvent()` — builds `DocumentEvent` object | Event construction |
| 887 | `this.bus.emit('events:${params.documentId}', event)` | Emit on channel `events:<docId>` |
| 923–964 | `subscribeStream(documentId)` — full AsyncIterator impl | Returns `AsyncIterable<DocumentEvent>` |
| 942 | `bus.on('events:${documentId}', handler)` | Subscribe on channel `events:<docId>` |
| 958 | `bus.off('events:${documentId}', handler)` | Unsubscribe on return() |

**Pattern**: queue + resolve pattern for backpressure.

### 2.3 CRDT Section Event (subscribeSection channel)

| Line | Code | Notes |
|------|------|-------|
| 1055 | `this.bus.emit('crdt:${params.documentId}:${params.sectionKey}', crdtUpdate)` | Emit on `crdt:<docId>:<sectionKey>` |
| 1118–1158 | `subscribeSection(documentId, sectionKey)` — full AsyncIterator impl | Returns `AsyncIterable<CrdtUpdate>` |
| 1138 | `bus.on(channel, handler)` | Subscribe on `crdt:<docId>:<sectionKey>` |
| 1152 | `bus.off(channel, handler)` | Unsubscribe on return() |

**Pattern**: Identical queue + resolve pattern as subscribeStream.

---

## 3. PostgresBackend (`packages/llmtxt/src/pg/pg-backend.ts`)

### 3.1 Event Bus Interface

| Line | Code | Notes |
|------|------|-------|
| 187–191 | `interface DocumentEventBusLike` | Defines `on` + `off` for `'document'` channel |
| 194–201 | `interface BusDocumentEvent` | Shape: `{ type, slug, documentId, timestamp, actor, data }` |

### 3.2 subscribeStream

| Line | Code | Notes |
|------|------|-------|
| 1434–1488 | `async *subscribeStream(documentId)` | Generator-based, not AsyncIterable-factory |
| 1467 | `bus.on('document', listener)` | Subscribes on `'document'` channel |
| 1449 | `if (event.slug !== documentId) return` | Client-side filter (no per-doc channel) |
| 1483 | `bus.off('document', listener)` | Unsubscribes in finally |

**Key difference from LocalBackend**: PG uses a single `'document'` channel + slug filter; Local uses per-doc `events:<docId>` channel.

### 3.3 subscribeSection (CRDT)

| Line | Code | Notes |
|------|------|-------|
| 1536–1588 | `async *subscribeSection(documentId, sectionKey)` | Generator-based |
| 1541 | `if (!this._subscribeCrdtUpdates)` | Delegates to injected `SubscribeCrdtUpdatesFn` |
| 1567 | `const unsubscribe = subscribeFn(...)` | External fn manages subscription |
| 1583 | `unsubscribe()` | Unsubscribe in finally |

**Key difference**: PG delegates CRDT subscription to an injected function (Redis pub/sub or similar); Local uses internal bus.

---

## 4. Shared Types (`packages/llmtxt/src/core/backend.ts`)

| Line | Type | Notes |
|------|------|-------|
| 197–204 | `DocumentEvent` | `{ id, documentId, type, agentId, payload, createdAt }` |
| 207–212 | `AppendEventParams` | `{ documentId, type, agentId, payload? }` |
| 215–223 | `QueryEventsParams` | `{ documentId, type?, since?, limit? }` |
| 228–235 | `CrdtUpdate` | `{ documentId, sectionKey, updateBase64, agentId, createdAt }` |
| 571 | `appendEvent(params)` | Backend interface method |
| 576 | `queryEvents(params)` | Backend interface method |
| 584 | `subscribeStream(documentId)` | Backend interface method |
| 594–614 | `applyCrdtUpdate / subscribeSection` | Backend interface methods |

---

## 5. Duplicate Logic — Hotspots

| Logic | LocalBackend | PostgresBackend | Duplication Severity |
|-------|-------------|----------------|---------------------|
| Queue + resolve pattern (AsyncIterator) | local-backend.ts:923-964 | pg-backend.ts:1434-1488 | HIGH — identical pattern, different bus |
| Queue + resolve pattern (CRDT) | local-backend.ts:1118-1158 | pg-backend.ts:1536-1588 | HIGH — identical pattern |
| Max-listener guard | local-backend.ts:261 | N/A | LOW |
| Event bus ownership | Inline `new EventEmitter()` | Injected `DocumentEventBusLike` | MEDIUM — design inconsistency |

---

## 6. Proposed Consolidation Strategy

### Extract to `packages/llmtxt/src/events/`

The queue-and-resolve async iterator factory is the prime duplication. Extract:

1. **`makeEventStream<T>(bus, channel)`** — creates `AsyncIterable<T>` backed by EventEmitter.
2. **`EventBus`** — thin class wrapping `EventEmitter` with typed channels.
3. **`EventPublisher<T>`** — interface for `emit(channel, event)`.
4. **`EventSubscriber<T>`** — interface for `subscribe(channel): AsyncIterable<T>`.

Both backends import from `llmtxt/events`. LocalBackend creates `new EventBus()`.
PostgresBackend adapts its injected `DocumentEventBusLike` via an adapter.

### Files to create

```
packages/llmtxt/src/events/
  index.ts          — public surface: types + EventBus + makeEventStream
  stream.ts         — makeEventStream<T>() implementation
  bus.ts            — EventBus class
  types.ts          — EventPublisher, EventSubscriber interfaces
```

### Subpath export

`package.json` → `"./events": { "types": "./dist/events/index.d.ts", "import": "./dist/events/index.js" }`

---

## 7. Acceptance Criteria Verification

- [x] audit identifies all event-related code in LocalBackend, PostgresBackend, and packages/llmtxt
- [x] file:line references documented for every event emit, subscribe, and stream operation
- [x] duplication hotspots listed with proposed consolidation strategy
