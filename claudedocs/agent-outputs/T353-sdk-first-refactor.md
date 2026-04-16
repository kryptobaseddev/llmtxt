# T353 SDK-First Refactor — Agent Output

**Task**: T353 — Epic: Finish SDK-first refactor — route all apps/backend handlers through BackendCore  
**Agent**: CLEO Team Lead (claude-sonnet-4-6)  
**Date**: 2026-04-16  
**Status**: PARTIAL — Phase 1 (RCASD) complete; Phases 2-5 (Waves A-D + Final) queued

---

## Phase 2 Complete (Wave A) — Commits ee983fe + c438341

### Wave A: Documents + Versions + Lifecycle domain

**Commits**:
- `ee983fe` — `feat(T357/Wave-A-C1): refactor api.ts + versions.ts + lifecycle.ts + disclosure.ts through backendCore`
- `c438341` — `feat(T357/Wave-A-C2): refactor patches.ts + merge.ts + conflicts.ts doc lookup through backendCore`

**CI**: Pushed to main (2 commits)  
**Tests**: 156/156 backend, 25/25 SDK  
**Typecheck**: 0 errors  
**Lint**: 0 warnings

**PostgresBackend methods implemented**:
- `getDocument(id)` — select by id
- `getDocumentBySlug(slug)` — select by slug
- `listDocuments(params?)` — with optional ownerId filter; returns `{items, nextCursor}`
- `getVersion(documentId, versionNumber)` — fetches version row with compressedData
- `listVersions(documentId)` — ordered by versionNumber desc, returns metadata columns
- `getApprovalProgress(documentId, _versionNumber?)` — returns `{doc, reviews}` raw shape
- `getApprovalPolicy(documentId)` — returns approval policy fields from documents row
- `listContributors(documentId)` — ordered by netTokens desc
- `setSchema(schema)` — injects schema table refs (called by postgres-backend-plugin.ts)

**PostgresBackend methods still stubbed** (throw NotImplemented for Wave A):
- `createDocument` — compress route owns its transaction
- `publishVersion` — PUT /documents/:slug owns its transaction
- `transitionVersion` — lifecycle route owns its transaction
- `submitSignedApproval` — approve/reject routes own their transactions

**Route files refactored (Wave A)**:
| File | Handlers → backendCore | Remaining db calls |
|------|------------------------|-------------------|
| `api.ts` | GET /mine, GET /:slug, POST /decompress | POST /compress (create doc/version/contributor) |
| `versions.ts` | GET /versions, GET /versions/:num, GET /diff, GET /multi-diff, POST /batch-versions | PUT /:slug (version creation tx) |
| `lifecycle.ts` | GET /approvals, GET /contributors | POST /transition, POST /approve, POST /reject (complex txs) |
| `disclosure.ts` | All resolveDocument calls (slug→content) | db.update access count (infrastructure) |
| `patches.ts` | Initial doc lookup | version insert (complex patchText fields) |
| `merge.ts` | Initial doc lookup | version creation tx |
| `conflicts.ts` | Initial doc lookups (both handlers) | persistNewVersion helper |

**Architecture decisions made**:
1. Schema injection pattern: `setSchema()` called from `postgres-backend-plugin.ts` after `open()` — avoids cross-package static imports
2. `getVersion(documentId, num)` accepts document.id (not slug) to match existing call patterns
3. `getApprovalProgress` returns raw `{doc, reviews}` shape (not Backend interface ApprovalResult) — route reconstructs consensus with SDK evaluateApprovals
4. Complex write transactions (compress, PUT, approve/reject) intentionally stay in routes for Wave A — these become Wave D scope

---

## Phase 1 Complete (RCASD) — Commit bbe7acf

### Wave 0: Inventory + Interface + Scaffold

**Commit**: `bbe7acf` — `docs(T353): RCASD — backend coverage map + Backend interface gap fill + PostgresBackend scaffold`  
**CI**: SUCCESS  
**Tests**: 156/156 backend, 25/25 SDK

**Files created/modified**:
- `docs/specs/T353-backend-coverage-map.md` — full route→method coverage map (120 handlers, 35 route files, domains A-P)
- `packages/llmtxt/src/core/backend.ts` — added 8 new sub-interfaces, ~25 new method signatures, 15+ new types
- `packages/llmtxt/src/local/local-backend.ts` — stub implementations for all new methods (throw NotImplemented)
- `packages/llmtxt/src/remote/remote-backend.ts` — stub implementations for all new methods (throw NotImplemented)
- `packages/llmtxt/src/pg/pg-backend.ts` — PostgresBackend scaffold implementing Backend interface, open()/close() functional, all methods stub
- `packages/llmtxt/src/pg/index.ts` — `llmtxt/pg` subpath exports
- `packages/llmtxt/package.json` — added `./pg` subpath export
- `apps/backend/src/plugins/postgres-backend-plugin.ts` — Fastify plugin registering `fastify.backendCore: Backend`

**Subtasks created**:
- T354: T353.1 Inventory + Coverage Map (RCASD) — DONE in this phase
- T355: T353.2 Define missing Backend interface methods — DONE in this phase  
- T356: T353.3 PostgresBackend scaffold — DONE in this phase
- T357: T353.4 Wave A — Documents + Versions + Lifecycle
- T358: T353.5 Wave B — Events + CRDT
- T359: T353.6 Wave C — Leases + Presence + Scratchpad + A2A + BFT
- T360: T353.7 Wave D — Search + Semantic + Collections + Cross-doc + Auth + Identity
- T361: T353.Final — Contract tests for both LocalBackend and PostgresBackend

---

## Remaining Waves (Successor Agent Handoff)

### Wave A (T357): COMPLETE — see Phase 2 section above

### Wave B (T358): Events + CRDT domain

**Files to refactor** (5 files, ~8 handlers):
- `document-events.ts` — GET events, GET events/stream (SSE)
- `crdt.ts` — GET crdt-state, POST crdt-update  
- `ws-crdt.ts` — GET /ws/crdt/:slug (WebSocket)
- `subscribe.ts` — GET subscribe (differential SSE)
- `ws.ts` — GET /ws/:slug, GET /ws/presence

**Backend methods to implement in PostgresBackend**:
```
appendEvent, queryEvents, subscribeStream
applyCrdtUpdate, getCrdtState, subscribeSection
```

**Key constraints**:
- SSE/WS routes are transport handlers — they still need to listen to `eventBus` for live events
- `queryEvents` uses `documentEvents` table from schema-pg.ts (bigint seq field)
- `subscribeStream` returns AsyncIterable — can wrap eventBus EventEmitter

### Wave C (T359): Leases + Presence + Scratchpad + A2A + BFT

**Files to refactor** (5 files, ~12 handlers):
- `leases.ts` — POST/GET/DELETE/PATCH lease
- `presence.ts` — GET presence (read-only; write via WS)
- `scratchpad.ts` — POST publish, GET read, GET stream  
- `a2a.ts` — POST inbox, GET inbox
- `bft.ts` — POST bft/approve, GET bft/status, GET chain

**Notes**:
- Leases currently use `lease-service.ts` (resource=`"slug:sectionId"` format vs Backend's `resource: string`)
- Presence currently uses in-memory `presenceRegistry` — PostgresBackend.listPresence should delegate to presenceRegistry
- Scratchpad uses Redis/in-memory `lib/scratchpad.ts` — paradigm mismatch with Backend.sendScratchpad (doc-scoped vs agent-scoped)

### Wave D (T360): Search + Semantic + Collections + Cross-doc + Auth + Identity

**Files to refactor** (14 files, ~50 handlers) — biggest wave, least critical for correctness  
Most of these are either stateless (semantic diff, similarity) or wrap existing backends (search uses pgvector).

### Wave Final (T361): Contract tests

After all waves, extend `packages/llmtxt/src/__tests__/backend-contract.test.ts` to parametrize over both LocalBackend AND PostgresBackend. Requires a test Postgres service (Docker/Railway test env).

---

## Architecture Decisions Made

1. **PostgresBackend imports schema from apps/backend** — during migration, schema-pg.ts stays in apps/backend. After Wave D is complete, move to packages/llmtxt/src/pg/schema-pg.ts as SSoT.

2. **Plugin: fastify.backendCore** — `apps/backend/src/plugins/postgres-backend-plugin.ts` registers the decorator. Routes call `request.server.backendCore.methodName()`.

3. **No behavior change** — all HTTP response shapes remain identical. BackendCore methods return the same types as the old direct Drizzle queries, just routed through the interface.

4. **Scratchpad paradigm** — the Backend interface `sendScratchpad/pollScratchpad` uses agent-scoped mailbox semantics. The existing route uses document-scoped channels (Redis Streams). Resolution: either add doc-scoped scratchpad methods to Backend interface, or migrate the route to agent-scoped semantics (breaking change). Wave C agent must decide.

---

## Validation State at Handoff

| Check | Status |
|-------|--------|
| SDK typecheck (`pnpm --filter llmtxt run typecheck`) | PASS |
| SDK tests 25/25 | PASS |
| Backend typecheck (`tsc --noEmit` in apps/backend) | PASS |
| Backend tests 156/156 | PASS |
| CI (push to main, run 24497072654) | SUCCESS |
| Routes still use direct Drizzle | YES (unchanged — all routes use `db.*` as before) |
| `fastify.backendCore` registered | YES (plugin exists but not imported in server.ts yet) |

---

## Next Agent Instructions

1. Read `docs/specs/T353-backend-coverage-map.md` — it has the full route→method mapping
2. Start with `cleo show T357` (Wave A task)  
3. Register the `postgres-backend-plugin.ts` in `apps/backend/src/index.ts` (or `server.ts`) alongside existing plugins
4. Implement Wave A PostgresBackend methods in `packages/llmtxt/src/pg/pg-backend.ts`
5. Refactor `lifecycle.ts` first (simplest complete domain) as a proof of concept
6. Run validation gates, commit, push, verify CI green
7. Proceed to `api.ts`, `versions.ts`, etc.

**Critical**: Do NOT change route HTTP response shapes. The API contract must stay identical.
