# T353 SDK-First Refactor — Agent Output

**Task**: T353 — Epic: Finish SDK-first refactor — route all apps/backend handlers through BackendCore  
**Agent**: CLEO Team Lead (claude-sonnet-4-6)  
**Date**: 2026-04-16  
**Status**: PARTIAL — Phase 1 (RCASD) complete; Phases 2-5 (Waves A-D + Final) queued

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

### Wave A (T357): Documents + Versions + Lifecycle domain

**Files to refactor** (7 files, ~40 handlers):
- `apps/backend/src/routes/api.ts` — POST /compress, GET /documents/:slug, POST /decompress, GET /documents/mine
- `apps/backend/src/routes/versions.ts` — PUT /documents/:slug, GET versions, GET version, GET diff, GET multi-diff
- `apps/backend/src/routes/lifecycle.ts` — POST transition, POST approve, POST reject, GET approvals, GET contributors
- `apps/backend/src/routes/disclosure.ts` — GET overview, sections, toc, section/:sid, token-budget
- `apps/backend/src/routes/patches.ts` — POST /documents/:slug/patch
- `apps/backend/src/routes/merge.ts` — POST /documents/:slug/merge
- `apps/backend/src/routes/conflicts.ts` — POST merge-conflict, POST auto-merge

**Backend methods to implement in PostgresBackend** (Wave A):
```
createDocument, getDocument, getDocumentBySlug, listDocuments, deleteDocument
publishVersion, getVersion, listVersions, transitionVersion
submitSignedApproval, getApprovalProgress, getApprovalPolicy, setApprovalPolicy
listContributors
```

**Route refactor pattern** (for each route file):
```typescript
// BEFORE (in route file):
const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);

// AFTER (in route file):
const doc = await request.server.backendCore.getDocumentBySlug(slug);
```

**Key constraints**:
- `lifecycle.ts` has complex transactions with approval auto-lock logic — implement `transitionVersion` and `submitSignedApproval` in PostgresBackend with equivalent Postgres tx semantics
- `versions.ts` PUT handler compresses content + runs contributor upsert — these must move to `publishVersion`  
- `api.ts` POST /compress creates both document and version 1 — route can use `createDocument` + `publishVersion`
- Schema: `apps/backend/src/db/schema-pg.ts` is the canonical table schema; PostgresBackend imports tables from there

**PostgresBackend implementation guide**:
The `_db` field after `open()` is a Drizzle instance with the postgres-js driver. Import schema tables:
```typescript
// In pg-backend.ts (at top after imports):
// These are dynamic imports due to the monorepo boundary.
// The schema lives at apps/backend/src/db/schema-pg.ts.
// Move to packages/llmtxt/src/pg/schema-pg.ts after Wave A.
```

**Wave A validation gates** (must pass before push):
```bash
pnpm --filter llmtxt run typecheck     # 0 errors
pnpm --filter llmtxt run test          # 25/25
cd apps/backend && pnpm exec tsc --noEmit  # 0 errors  
pnpm --filter @llmtxt/backend test     # 156+
```

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
