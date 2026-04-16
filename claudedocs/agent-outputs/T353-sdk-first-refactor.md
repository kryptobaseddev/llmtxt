# T353 SDK-First Refactor — Agent Output

**Task**: T353 — Epic: Finish SDK-first refactor — route all apps/backend handlers through BackendCore  
**Agent**: CLEO Team Lead (claude-sonnet-4-6)  
**Date**: 2026-04-16  
**Status**: PARTIAL — Phase 1 (RCASD) complete; Wave A read-ops complete; Wave A-2 write-ops complete; Wave B complete; Wave C complete; Wave D queued

---

## Phase 5 Complete (Wave C) — Commits 6f7645d + 7619ca8 + e9a6001

### Wave C: Leases + Presence + Scratchpad + A2A + BFT domain

**Commits**:
- `6f7645d` — `feat(T353/Wave-C1): PostgresBackend.leases.* + leases.ts route refactor`
- `7619ca8` — `feat(T353/Wave-C2): a2a.ts + bft.ts route refactors via backendCore`
- `e9a6001` — `feat(T353/Wave-C3): presence.ts + scratchpad.ts route refactors via backendCore`

**CI**: Pushed to main (3 commits)
**Tests**: 156/156 backend (all passes maintained)
**Build**: tsc clean (SDK + backend)
**Lint**: 0 warnings

**PostgresBackend methods implemented (Wave C)**:

*Lease ops (PG-backed)*:
- `acquireLease(params)` — INSERT into `section_leases`, conflict-aware: returns null if another holder holds an active lease; upserts (extends) if same holder; resource format `"docSlug:sectionId"` parsed by `_parseLeaseResource`
- `renewLease(resource, holder, ttlMs)` — SELECT + UPDATE `expiresAt` if active + holder matches
- `releaseLease(resource, holder)` — SELECT + DELETE by (docId, sectionId, holderAgentId)
- `getLease(resource)` — SELECT non-expired lease row, returns `Lease | null`

*Presence ops (in-memory, no PG)*:
- `joinPresence(docId, agentId, meta)` — delegates to injected `presenceRegistry.upsert`; maps `meta.section` → section field
- `leavePresence(docId, agentId)` — deletes from registry's internal Map directly (registry has no `remove()` API; internal access via cast)
- `listPresence(docId)` — calls `registry.expire()` then `registry.getByDoc(docId)`; maps section/cursorOffset → meta fields
- `heartbeatPresence(docId, agentId)` — re-upserts with existing section to refresh lastSeen

*Scratchpad ops (Redis/in-memory via injected fns)*:
- `sendScratchpad(params)` — delegates to `scratchpadPublish` using agent-scoped channel `"agent:<toAgentId>"`; maps Backend payload to lib msg format
- `pollScratchpad(agentId, limit)` — delegates to `scratchpadRead` with agent channel slug
- `deleteScratchpadMessage(id, agentId)` — returns `true` optimistically (Redis XDEL not supported; TTL handles expiry)

*A2A ops (PG-backed via `agentInboxMessages`)*:
- `sendA2AMessage(params)` — INSERT with nonce unique constraint; graceful error on duplicate nonce returns `{success: false, error: 'Duplicate nonce'}`; envelope stored as JSONB
- `pollA2AInbox(agentId, limit)` — SELECT non-expired messages for recipient, ordered by receivedAt
- `deleteA2AMessage(id, agentId)` — DELETE by (id, toAgentId) ownership check

*BFT ops*:
- `getApprovalChain(documentId)` — resolves doc by slug, fetches all approvals ordered by timestamp, re-computes and verifies the hash chain using `hashContent` SDK helper; returns `{valid, length, firstInvalidAt, entries}`

**Injection mechanism (Wave C)**:
- `setWaveCDeps(deps)` — called by `postgres-backend-plugin.ts` after Wave B injection, injecting:
  - `presenceRegistry` from `apps/backend/src/presence/registry.ts`
  - `scratchpadPublish` (`publishScratchpad`) from `apps/backend/src/lib/scratchpad.ts`
  - `scratchpadRead` (`readScratchpad`) from same
  - `scratchpadSubscribe` (`subscribeScratchpad`) from same

**Route files refactored (Wave C)**:
| File | Change |
|------|--------|
| `leases.ts` | All 4 handlers use `backendCore.acquireLease/getLease/releaseLease/renewLease`; zero Drizzle; removed `lease-service.ts` import, schema imports, `db` import |
| `presence.ts` | GET presence uses `backendCore.getDocumentBySlug` (doc existence) + `backendCore.listPresence`; removed `db`, `eq`, schema imports |
| `a2a.ts` | POST inbox uses `backendCore.sendA2AMessage`; GET inbox uses `backendCore.pollA2AInbox`; signature verification stays in-route (Identity ops are Wave D); `db` import retained for pubkey lookup only |
| `bft.ts` | GET /bft/status uses `backendCore.getApprovalProgress`; GET /chain uses `backendCore.getApprovalChain` (zero Drizzle); POST /bft/approve retains Drizzle (byzantine-detection tx — Tech Debt, see below) |
| `scratchpad.ts` | Doc existence uses `backendCore.getDocumentBySlug`; fixed schema import bug (was `../db/schema.js` SQLite instead of `schema-pg.js`); lib functions kept as direct imports (non-Drizzle, doc-channel semantics differ from Backend.ScratchpadOps) |

**_orm extension**: Added `gt, lt, gte, lte, asc, or, not, isNull` operators to the cached `_orm` record in `open()` (Wave C methods require them for expiry checks).

**Architecture decisions (Wave C)**:

1. **Lease resource format**: Backend interface uses `resource: string`; DB schema uses separate `docId + sectionId` columns. Decision: parse `"slug:sectionId"` (first colon split) in `_parseLeaseResource`. Route uses same format: `${slug}:${sid}`. No schema change needed.

2. **Presence is in-memory only**: Consistent with LocalBackend spec. PostgresBackend delegates to the same `presenceRegistry` singleton as ws.ts/ws-crdt.ts. `leavePresence` accesses the registry's internal `Map` via cast (registry lacks a `remove()` public API). This is noted as a minor tech debt — the registry should expose `remove(agentId, docId)`.

3. **Scratchpad paradigm mismatch**: Backend `ScratchpadOps` uses agent-inbox semantics (`toAgentId/fromAgentId`); the scratchpad route uses document-scoped broadcast channels (Redis Streams keyed by slug). Decision: implement Backend interface methods using agent-scoped channel slug `"agent:<toAgentId>"` to keep the two semantics separate. The route file keeps `publishScratchpad/readScratchpad` direct imports (not Drizzle — acceptable). A future Wave would add `publishDocScratchpad/readDocScratchpad` doc-scoped methods to the Backend interface.

4. **BFT POST approve retains Drizzle**: The byzantine-detection transaction (double-vote detection → key revocation → chain hash → event append) is a complex multi-step write that cannot be cleanly expressed via the existing `submitSignedApproval` method without refactoring its signature. Noted as Tech Debt for Wave D (`bft.ts` POST approve remains the only handler with direct Drizzle writes in Wave C scope).

5. **`deleteScratchpadMessage` is a no-op**: Redis Streams do not support single-message deletion without XDEL (which our ioredis wrapper doesn't expose). Messages expire via stream TTL (24h). Returns `true` optimistically. Documented as known limitation.

---

## Phase 4 Complete (Wave A-2) — Commits 2da416c + 23bb647 + 0d91a77

### Wave A-2: Write operations — createDocument, publishVersion, transitionVersion, submitSignedApproval

**Commits**:
- `2da416c` — `feat(T353/Wave-A2-C1): implement PostgresBackend.createDocument + refactor POST /compress`
- `23bb647` — `feat(T353/Wave-A2-C2): implement PostgresBackend.publishVersion + refactor PUT /documents/:slug`
- `0d91a77` — `feat(T353/Wave-A2-C3): implement transitionVersion + submitSignedApproval + refactor lifecycle.ts`

**CI**: Pushed to main (3 commits)  
**Tests**: 156/156 backend, 25/25 SDK  
**Typecheck**: 0 errors  
**Lint**: 0 warnings  
**0 direct Drizzle write calls** in api.ts, versions.ts, lifecycle.ts (verified)

**PostgresBackend methods implemented (Wave A-2)**:
- `createDocument(params)` — transactional insert: documents + versions (v1) + contributors + document_roles; params pre-computed by route; returns inserted doc row
- `publishVersion(params)` — transactional: first-update v1 snapshot, new version insert, document head update, contributor upsert (SQL arithmetic), version.published event log append; UNIQUE constraint retry handled by route caller
- `transitionVersion(params)` — validates via SDK `validateTransition`, updates documents.state, inserts state_transitions row, clears rejection records on REVIEW→DRAFT, appends lifecycle.transitioned event
- `submitSignedApproval(params)` — inserts approval row, evaluates consensus via SDK `evaluateApprovals`, auto-locks (REVIEW→LOCKED) on consensus.approved, inserts state_transitions row, appends approval.submitted / approval.rejected event

**Route files refactored (Wave A-2)**:
| File | Change |
|------|--------|
| `api.ts` | POST /compress delegates to `backendCore.createDocument`; removed direct db.insert for documents/versions/contributors/documentRoles |
| `versions.ts` | PUT /:slug delegates to `backendCore.publishVersion`; removed entire Drizzle transaction block; removed contributors/versions schema imports, appendDocumentEvent import |
| `lifecycle.ts` | POST /transition → `backendCore.transitionVersion`; POST /approve → `backendCore.submitSignedApproval`; POST /reject → `backendCore.submitSignedApproval`; db import dropped entirely; all direct schema imports removed |

**Key design decisions (Wave A-2)**:
1. Route pre-computes CPU-bound ops (compress, hash, structuredDiff) outside transaction; passes results to backend.
2. `transitionVersion` route does a pre-flight `getDocumentBySlug` to capture `previousState` for metrics/events (backend returns updated doc with new state).
3. `submitSignedApproval` accepts `signatureBase64: ''` from route (route auth layer validates caller is allowed, not the signature; BFT approval flow uses bft.ts separately).
4. `appendDocumentEvent` in `createDocument` remains in the route as fire-and-forget (Wave B dep injection not guaranteed at all call sites).

---

## Phase 3 Complete (Wave B) — Commits 44b9c89 + d8191b3 + 7a4be78

### Wave B: Events + CRDT domain

**Commits**:
- `44b9c89` — `feat(T353.5): Wave B C1 — PostgresBackend events.* + document-events.ts refactor`
- `d8191b3` — `feat(T353.5): Wave B C2 — PostgresBackend crdt.* + crdt.ts + ws-crdt.ts refactor`
- `7a4be78` — `feat(T353.5): Wave B C3 — subscribe.ts refactor to use eventBus + backendCore`

**CI**: Pushed to main (3 commits)  
**Tests**: 156/156 backend, 25/25 SDK  
**Typecheck**: 0 errors

**PostgresBackend methods implemented (Wave B)**:
- `appendEvent(params)` — wraps `appendDocumentEvent` lib in an implicit transaction; returns `DocumentEvent`
- `queryEvents(params)` — paginated select from `document_events` table with optional type filter and bigint cursor
- `subscribeStream(documentId)` — async generator that wraps the in-process `eventBus`, yielding bus events filtered by slug
- `applyCrdtUpdate(params)` — delegates to injected `persistCrdtUpdate` (advisory lock, upsert state); returns `CrdtState`
- `getCrdtState(documentId, sectionKey)` — delegates to injected `loadSectionState`; returns `CrdtState | null`
- `subscribeSection(documentId, sectionKey)` — async generator wrapping injected `subscribeCrdtUpdates` pub/sub

**Injection mechanism** (Wave B):
- `setWaveBDeps(deps)` — called by `postgres-backend-plugin.ts` after `open()`, injecting:
  - `appendDocumentEvent` from `apps/backend/src/lib/document-events.ts`
  - `persistCrdtUpdate` and `loadSectionState` from `apps/backend/src/crdt/persistence.ts`
  - `subscribeCrdtUpdates` from `apps/backend/src/realtime/redis-pubsub.ts`
  - `eventBus` from `apps/backend/src/events/bus.ts`
  - `crdtStateVector` from `apps/backend/src/crdt/primitives.ts`

**Route files refactored (Wave B)**:
| File | Change |
|------|--------|
| `document-events.ts` | GET /events uses `backendCore.queryEvents`; SSE stream uses `backendCore.subscribeStream` + async generator |
| `crdt.ts` | GET crdt-state uses `backendCore.getCrdtState`; POST crdt-update uses `backendCore.applyCrdtUpdate` |
| `ws-crdt.ts` | RBAC doc lookup uses `backendCore.getDocumentBySlug`; initial state uses `backendCore.getCrdtState`; update persist uses `backendCore.applyCrdtUpdate` |
| `subscribe.ts` | Live SSE phase uses `eventBus` directly (cross-document filter via path matcher); catch-up uses raw Drizzle (cross-doc, awaits future ContentOps.queryAllEvents) |

**Architecture decisions (Wave B)**:
1. `subscribe.ts` catch-up phase retains raw Drizzle query for cross-document range scan — `backendCore.queryEvents` is per-document and would require N queries. Per coverage map note, a future `ContentOps.queryAllEvents` will replace this.
2. WS compaction trigger still uses `loadSectionState` directly to get `clock` field — `getCrdtState` returns `CrdtState` which doesn't include `clock`. This is intentional (transport-layer concern stays in route).
3. `publishCrdtUpdate` (Redis pub/sub broadcast) stays in route files — it's a transport concern, same as WS connection management.
4. `subscribe.ts` live phase uses `eventBus` directly rather than `subscribeStream` — needed for cross-document path-pattern matching across all slugs simultaneously.

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

### Wave B (T358): Events + CRDT domain — **COMPLETE** (see Phase 3 above)

`ws.ts` (general document WS) was NOT refactored as part of Wave B — it is not in scope per the original dispatch (ws.ts uses presence, not CRDT). It belongs to Wave C.

### Wave C (T359): Leases + Presence + Scratchpad + A2A + BFT — **COMPLETE** (see Phase 5 above)

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
| SDK typecheck (`pnpm --filter llmtxt run typecheck`) | PASS (Wave B) |
| SDK tests 25/25 | PASS (Wave B) |
| Backend typecheck (`tsc --noEmit` in apps/backend) | PASS (Wave B) |
| Backend tests 156/156 | PASS (Wave B) |
| Wave B T358 | DONE (all gates passed) |
| Wave C T359 | DONE (all gates passed) |
| `fastify.backendCore` registered | YES |
| Wave B routes `db` imports removed | YES — document-events.ts, crdt.ts, ws-crdt.ts removed; subscribe.ts retains one raw Drizzle call for cross-doc catch-up |
| Wave C routes `db` imports removed | YES — leases.ts, presence.ts, scratchpad.ts: zero Drizzle; a2a.ts: db retained for pubkey lookup only (Wave D Identity); bft.ts: POST /bft/approve retains Drizzle (byzantine tx tech debt) |

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
