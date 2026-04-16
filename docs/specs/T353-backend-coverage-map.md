# T353 Backend Coverage Map

**Epic**: T353 — SDK-first refactor: route all apps/backend handlers through BackendCore  
**Generated**: 2026-04-16  
**Status**: RCASD (Phase 1 complete)

---

## Summary

| Metric | Count |
|--------|-------|
| Route files inventoried | 36 (35 in routes/ + 1 in routes/v1/) |
| Route handler count (approximate) | ~120 handlers |
| Files with direct Drizzle `db` import | 35 |
| Files without direct Drizzle import | 1 (auth.ts, health.ts proxy only) |
| Backend interface methods already defined | 28 methods across 11 sub-interfaces |
| Backend methods that need to be ADDED | ~25 new methods for missing domains |

---

## Domain Groupings

### Domain A — Documents + Versions (Core) [Wave A]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `api.ts` | GET /documents/:slug | GET | `getDocumentBySlug` ✓ |
| `api.ts` | GET /documents/mine | GET | `listDocuments` ✓ |
| `api.ts` | POST /compress | POST | `createDocument` ✓ + `publishVersion` ✓ |
| `api.ts` | POST /decompress | POST | `getDocumentBySlug` ✓ + `listVersions` ✓ |
| `api.ts` | POST /validate | POST | stateless (SDK util only) — no Backend needed |
| `api.ts` | GET /schemas | GET | stateless — no Backend needed |
| `api.ts` | GET /schemas/:name | GET | stateless — no Backend needed |
| `api.ts` | GET /llms.txt | GET | `listDocuments` ✓ |
| `api.ts` | GET /stats/cache | GET | stateless — no Backend needed |
| `api.ts` | DELETE /cache | DELETE | stateless — no Backend needed |
| `versions.ts` | PUT /documents/:slug | PUT | `publishVersion` ✓ + `getDocumentBySlug` ✓ |
| `versions.ts` | GET /documents/:slug/versions | GET | `listVersions` ✓ |
| `versions.ts` | GET /documents/:slug/versions/:num | GET | `getVersion` ✓ |
| `versions.ts` | GET /documents/:slug/diff | GET | `getVersion` ✓ (diff computed in SDK) |
| `versions.ts` | GET /documents/:slug/multi-diff | GET | `listVersions` ✓ (multi-diff via WASM) |
| `versions.ts` | POST /documents/:slug/batch-versions | POST | `listVersions` ✓ |
| `patches.ts` | POST /documents/:slug/patch | POST | `getDocumentBySlug` ✓ + `publishVersion` ✓ |
| `merge.ts` | POST /documents/:slug/merge | POST | `getVersion` ✓ + `publishVersion` ✓ (cherry-pick via WASM) |
| `conflicts.ts` | POST /documents/:slug/merge-conflict | POST | `getDocumentBySlug` ✓ + `publishVersion` ✓ |
| `conflicts.ts` | POST /documents/:slug/auto-merge | POST | `getDocumentBySlug` ✓ + `publishVersion` ✓ |

### Domain B — Lifecycle + Approvals [Wave A]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `lifecycle.ts` | POST /documents/:slug/transition | POST | `transitionVersion` ✓ |
| `lifecycle.ts` | POST /documents/:slug/approve | POST | `submitSignedApproval` ✓ + `getApprovalPolicy` ✓ |
| `lifecycle.ts` | POST /documents/:slug/reject | POST | `submitSignedApproval` ✓ |
| `lifecycle.ts` | GET /documents/:slug/approvals | GET | `getApprovalProgress` ✓ |
| `lifecycle.ts` | GET /documents/:slug/contributors | GET | **MISSING** → need `listContributors(docId)` |
| `bft.ts` | POST /documents/:slug/bft/approve | POST | `submitSignedApproval` ✓ + BFT chain logic |
| `bft.ts` | GET /documents/:slug/bft/status | GET | `getApprovalProgress` ✓ + BFT quorum logic |
| `bft.ts` | GET /documents/:slug/chain | GET | **MISSING** → need `getApprovalChain(docId)` |

### Domain C — Progressive Disclosure [Wave A]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `disclosure.ts` | GET /documents/:slug/overview | GET | `getDocumentBySlug` ✓ + `listVersions` ✓ |
| `disclosure.ts` | GET /documents/:slug/sections | GET | `getDocumentBySlug` ✓ (sections parsed from content) |
| `disclosure.ts` | GET /documents/:slug/toc | GET | `getDocumentBySlug` ✓ |
| `disclosure.ts` | GET /documents/:slug/sections/:sid | GET | **MISSING** → need `getSection(docId, sectionId)` |
| `disclosure.ts` | GET /documents/:slug/sections/:sid/raw | GET | **MISSING** → need `getSectionRaw(docId, sectionId)` |
| `disclosure.ts` | POST /documents/:slug/sections/select | POST | stateless (content processing) |
| `disclosure.ts` | GET /documents/:slug/token-budget | GET | stateless (content processing) |
| `retrieval.ts` | POST /retrieval/plan | POST | `getDocumentBySlug` ✓ + `listVersions` ✓ (stateless planning) |

### Domain D — Document Events + SSE Streaming [Wave B]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `document-events.ts` | GET /documents/:slug/events | GET | `queryEvents` ✓ |
| `document-events.ts` | GET /documents/:slug/events/stream | SSE | `subscribeStream` ✓ |
| `subscribe.ts` | GET /documents/:slug/subscribe | SSE | `queryEvents` ✓ + `subscribeStream` ✓ |

### Domain E — CRDT [Wave B]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `crdt.ts` | GET /documents/:slug/sections/:sid/crdt-state | GET | `getCrdtState` ✓ |
| `crdt.ts` | POST /documents/:slug/sections/:sid/crdt-update | POST | `applyCrdtUpdate` ✓ |
| `ws-crdt.ts` | GET /ws/crdt/:slug | WS | `getCrdtState` ✓ + `applyCrdtUpdate` ✓ + `subscribeSection` ✓ |
| `ws.ts` | GET /ws/:slug | WS | `subscribeStream` ✓ (general document WS) |
| `ws.ts` | GET /ws/presence | WS | `joinPresence` ✓ + `heartbeatPresence` ✓ |

### Domain F — Leases [Wave C]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `leases.ts` | POST /documents/:slug/sections/:sid/lease | POST | `acquireLease` ✓ |
| `leases.ts` | GET /documents/:slug/sections/:sid/lease | GET | `getLease` ✓ |
| `leases.ts` | DELETE /documents/:slug/sections/:sid/lease | DELETE | `releaseLease` ✓ |
| `leases.ts` | PATCH /documents/:slug/sections/:sid/lease | PATCH | `renewLease` ✓ |

Note: current `leases.ts` uses `lease-service.ts` functions with a different signature. The Backend interface uses `resource: string` (format `"slug:sectionId"`) while the service uses `(db, docId, sectionId, agentId)` separately. These must be reconciled — Backend LeaseOps methods match what is needed.

### Domain G — Presence [Wave C]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `presence.ts` | GET /documents/:slug/presence | GET | `listPresence` ✓ |

Note: presence write operations (join/heartbeat/leave) happen via WS (ws.ts). The REST endpoint is read-only.

### Domain H — Scratchpad [Wave C]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `scratchpad.ts` | POST /documents/:slug/scratchpad | POST | **PARTIAL** — current uses Redis/in-memory, not `sendScratchpad` |
| `scratchpad.ts` | GET /documents/:slug/scratchpad | GET | **PARTIAL** — current uses `readScratchpad` lib, not `pollScratchpad` |
| `scratchpad.ts` | GET /documents/:slug/scratchpad/stream | SSE | **PARTIAL** — current uses `subscribeScratchpad` lib |

Note: The Backend ScratchpadOps interface uses `toAgentId/fromAgentId` paradigm, but scratchpad.ts uses a document-scoped channel (messages go to the document's channel, not to a specific agent). The Backend interface needs `publishDocScratchpad(docId, ...)` and `readDocScratchpad(docId, ...)` methods, or the existing `sendScratchpad/pollScratchpad` semantics need to change to match the current route behavior.

### Domain I — A2A (Agent-to-Agent) Inbox [Wave C]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `a2a.ts` | POST /agents/:id/inbox | POST | `sendA2AMessage` ✓ |
| `a2a.ts` | GET /agents/:id/inbox | GET | `pollA2AInbox` ✓ |

Note: current a2a.ts does signature verification inline using `node:crypto`. This must move to Backend (which already calls `recordSignatureNonce` / `hasNonceBeenUsed`). A2AOps.`sendA2AMessage` already specifies MUST-verify-signature.

### Domain J — Agent Identity + Agent Keys [Wave D]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `agent-keys.ts` | POST /agents/keys | POST | `registerAgentPubkey` ✓ |
| `agent-keys.ts` | GET /agents/keys | GET | **MISSING** → need `listAgentPubkeys(userId?)` |
| `agent-keys.ts` | DELETE /agents/keys/:id | DELETE | `revokeAgentPubkey` ✓ |
| `well-known-agents.ts` | GET /.well-known/agent-keys/:id | GET | `lookupAgentPubkey` ✓ |

### Domain K — Search + Semantic + Similarity [Wave D]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `search.ts` | GET /search?q=... | GET | `search` ✓ (semantic) + TF-IDF fallback |
| `search.ts` | GET /documents/:slug/similar | GET | **MISSING** → need `findSimilarDocuments(docId, opts)` |
| `semantic.ts` | POST /documents/:slug/semantic-diff | POST | **MISSING** → need `semanticDiff(docId, v1, v2)` |
| `semantic.ts` | GET /documents/:slug/semantic-status | GET | **MISSING** → need `getSemanticStatus(docId)` |
| `semantic.ts` | POST /documents/:slug/consensus | POST | `getApprovalProgress` ✓ + semantic consensus logic |
| `similarity.ts` | GET /documents/:slug/similar-sections | GET | **MISSING** → need `findSimilarSections(docId, opts)` |
| `retrieval.ts` | POST /retrieval/plan | POST | `getDocumentBySlug` ✓ + `listVersions` ✓ |
| `graph.ts` | GET /documents/:slug/graph | GET | **MISSING** → need `getDocumentGraph(docId)` |

### Domain L — Collections + Cross-doc [Wave D]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `collections.ts` | POST /collections | POST | **MISSING** → need `createCollection(params)` |
| `collections.ts` | GET /collections | GET | **MISSING** → need `listCollections(opts)` |
| `collections.ts` | GET /collections/:slug | GET | **MISSING** → need `getCollection(slug)` |
| `collections.ts` | POST /collections/:slug/documents | POST | **MISSING** → need `addDocToCollection(slug, docSlug)` |
| `collections.ts` | DELETE /collections/:slug/documents/:documentSlug | DELETE | **MISSING** → need `removeDocFromCollection(slug, docSlug)` |
| `collections.ts` | PUT /collections/:slug/order | PUT | **MISSING** → need `reorderCollection(slug, order)` |
| `collections.ts` | GET /collections/:slug/export | GET | **MISSING** → need `exportCollection(slug)` |
| `cross-doc.ts` | POST /search | POST | `search` ✓ (extended multi-doc search) |
| `cross-doc.ts` | GET /documents/:slug/links | GET | **MISSING** → need `getDocumentLinks(docId)` |
| `cross-doc.ts` | POST /documents/:slug/links | POST | **MISSING** → need `createDocumentLink(params)` |
| `cross-doc.ts` | DELETE /documents/:slug/links/:linkId | DELETE | **MISSING** → need `deleteDocumentLink(docId, linkId)` |
| `cross-doc.ts` | GET /graph | GET | **MISSING** → need `getGlobalGraph(opts)` |

### Domain M — Webhooks + Signed URLs [Wave D]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `webhooks.ts` | POST /webhooks | POST | **MISSING** → need `createWebhook(params)` |
| `webhooks.ts` | GET /webhooks | GET | **MISSING** → need `listWebhooks(userId)` |
| `webhooks.ts` | DELETE /webhooks/:id | DELETE | **MISSING** → need `deleteWebhook(id, userId)` |
| `webhooks.ts` | POST /webhooks/:id/test | POST | **MISSING** → need `testWebhook(id)` |
| `signed-urls.ts` | POST /signed-urls | POST | **MISSING** → need `createSignedUrl(params)` |

### Domain N — Access Control + Organizations [Wave D]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `access-control.ts` | GET /documents/:slug/access | GET | **MISSING** → need `getDocumentAccess(docId)` |
| `access-control.ts` | POST /documents/:slug/access | POST | **MISSING** → need `grantDocumentAccess(docId, params)` |
| `access-control.ts` | DELETE /documents/:slug/access/:userId | DELETE | **MISSING** → need `revokeDocumentAccess(docId, userId)` |
| `access-control.ts` | PUT /documents/:slug/visibility | PUT | **MISSING** → need `setDocumentVisibility(docId, visibility)` |
| `access-control.ts` | POST /documents/:slug/invite | POST | **MISSING** → need `inviteToDocument(docId, params)` |
| `organizations.ts` | POST /organizations | POST | **MISSING** → need `createOrganization(params)` |
| `organizations.ts` | GET /organizations | GET | **MISSING** → need `listOrganizations(userId)` |
| `organizations.ts` | GET /organizations/:slug | GET | **MISSING** → need `getOrganization(slug)` |
| `organizations.ts` | POST /organizations/:slug/members | POST | **MISSING** → need `addOrgMember(slug, userId)` |
| `organizations.ts` | DELETE /organizations/:slug/members/:userId | DELETE | **MISSING** → need `removeOrgMember(slug, userId)` |
| `organizations.ts` | POST /organizations/:slug/documents | POST | **MISSING** → need `associateOrgDocument(slug, docSlug)` |

### Domain O — API Keys [Wave D]

| Route File | Handler | HTTP | Backend Method (existing / needed) |
|------------|---------|------|-------------------------------------|
| `api-keys.ts` | POST /api-keys | POST | **MISSING** → need `createApiKey(params)` |
| `api-keys.ts` | GET /api-keys | GET | **MISSING** → need `listApiKeys(userId)` |
| `api-keys.ts` | DELETE /api-keys/:id | DELETE | **MISSING** → need `deleteApiKey(id, userId)` |
| `api-keys.ts` | POST /api-keys/:id/rotate | POST | **MISSING** → need `rotateApiKey(id, userId)` |

### Domain P — Infrastructure / Stateless (no Backend needed) [Skip]

| Route File | Handler | HTTP | Notes |
|------------|---------|------|-------|
| `auth.ts` | /auth/* | all | Proxied to better-auth — no Backend needed |
| `health.ts` | GET /api/health | GET | Liveness probe — no Backend needed |
| `health.ts` | GET /api/ready | GET | Readiness probe — uses `db` directly for SELECT 1 |
| `health.ts` | GET /api/metrics | GET | Prometheus metrics scrape — no Backend needed |
| `docs.ts` | GET /api/docs | GET | Swagger UI — no Backend needed |
| `web.ts` | GET /* | GET | SPA fallback — no Backend needed |
| `viewTemplate.ts` | GET /view/:slug | GET | Server-side render — uses `getDocumentBySlug` ✓ |
| `v1/index.ts` | (router only) | — | Route registration only |

---

## Backend Interface Gap Analysis

### Methods Already in Interface (28 methods)

**DocumentOps**: `createDocument`, `getDocument`, `getDocumentBySlug`, `listDocuments`, `deleteDocument`  
**VersionOps**: `publishVersion`, `getVersion`, `listVersions`, `transitionVersion`  
**ApprovalOps**: `submitSignedApproval`, `getApprovalProgress`, `getApprovalPolicy`, `setApprovalPolicy`  
**EventOps**: `appendEvent`, `queryEvents`, `subscribeStream`  
**CrdtOps**: `applyCrdtUpdate`, `getCrdtState`, `subscribeSection`  
**LeaseOps**: `acquireLease`, `renewLease`, `releaseLease`, `getLease`  
**PresenceOps**: `joinPresence`, `leavePresence`, `listPresence`, `heartbeatPresence`  
**ScratchpadOps**: `sendScratchpad`, `pollScratchpad`, `deleteScratchpadMessage`  
**A2AOps**: `sendA2AMessage`, `pollA2AInbox`, `deleteA2AMessage`  
**SearchOps**: `indexDocument`, `search`  
**IdentityOps**: `registerAgentPubkey`, `lookupAgentPubkey`, `revokeAgentPubkey`, `recordSignatureNonce`, `hasNonceBeenUsed`

### Methods Needed But Missing (~25 new methods)

These must be added to `packages/llmtxt/src/core/backend.ts` as new sub-interfaces:

#### ApprovalOps extensions
- `listContributors(documentId: string): Promise<ContributorRecord[]>`
- `getApprovalChain(documentId: string): Promise<ApprovalChainResult>`

#### CollectionOps (new sub-interface)
- `createCollection(params: CreateCollectionParams): Promise<Collection>`
- `getCollection(slug: string): Promise<Collection | null>`
- `listCollections(params?: ListCollectionsParams): Promise<ListResult<Collection>>`
- `addDocToCollection(collectionSlug: string, documentSlug: string, position?: number): Promise<void>`
- `removeDocFromCollection(collectionSlug: string, documentSlug: string): Promise<boolean>`
- `reorderCollection(collectionSlug: string, orderedSlugs: string[]): Promise<void>`
- `exportCollection(collectionSlug: string): Promise<CollectionExport>`

#### CrossDocOps (new sub-interface)
- `createDocumentLink(params: CreateDocLinkParams): Promise<DocumentLink>`
- `getDocumentLinks(documentId: string): Promise<DocumentLink[]>`
- `deleteDocumentLink(documentId: string, linkId: string): Promise<boolean>`
- `getGlobalGraph(params?: GraphParams): Promise<GraphResult>`

#### WebhookOps (new sub-interface)
- `createWebhook(params: CreateWebhookParams): Promise<Webhook>`
- `listWebhooks(userId: string): Promise<Webhook[]>`
- `deleteWebhook(id: string, userId: string): Promise<boolean>`
- `testWebhook(id: string): Promise<WebhookTestResult>`

#### AccessControlOps (new sub-interface)
- `getDocumentAccess(documentId: string): Promise<AccessControlList>`
- `grantDocumentAccess(documentId: string, params: GrantAccessParams): Promise<void>`
- `revokeDocumentAccess(documentId: string, userId: string): Promise<boolean>`
- `setDocumentVisibility(documentId: string, visibility: DocumentVisibility): Promise<void>`

#### OrganizationOps (new sub-interface)
- `createOrganization(params: CreateOrgParams): Promise<Organization>`
- `getOrganization(slug: string): Promise<Organization | null>`
- `listOrganizations(userId: string): Promise<Organization[]>`
- `addOrgMember(orgSlug: string, userId: string, role?: string): Promise<void>`
- `removeOrgMember(orgSlug: string, userId: string): Promise<boolean>`

#### ApiKeyOps (new sub-interface)
- `createApiKey(params: CreateApiKeyParams): Promise<ApiKey>`
- `listApiKeys(userId: string): Promise<ApiKey[]>`
- `deleteApiKey(id: string, userId: string): Promise<boolean>`
- `rotateApiKey(id: string, userId: string): Promise<ApiKey>`

#### IdentityOps extensions
- `listAgentPubkeys(userId?: string): Promise<AgentPubkeyRecord[]>`

#### SearchOps extensions
- `findSimilarDocuments(documentId: string, opts?: SimilarityOpts): Promise<SearchResult[]>`
- `findSimilarSections(documentId: string, opts?: SectionSimilarityOpts): Promise<SectionSimilarityResult[]>`
- `semanticDiff(documentId: string, v1: number, v2: number): Promise<SemanticDiffResult>`

#### ContentOps (new sub-interface for disclosure helpers)
- `getSection(documentId: string, sectionId: string): Promise<SectionContent | null>`
- `createSignedUrl(params: CreateSignedUrlParams): Promise<SignedUrl>`

#### DiscourseMisc (on DocumentOps or new sub-interface)
- `getDocumentGraph(documentId: string): Promise<DocumentGraphResult>`

---

## Scope Assessment for Each Wave

### Wave A (commits 2-4): Documents + Versions + Lifecycle + Disclosure
**Files**: api.ts, versions.ts, lifecycle.ts, disclosure.ts, patches.ts, merge.ts, conflicts.ts  
**Handler count**: ~40 handlers  
**Blocker**: `listContributors` and `getApprovalChain` need to be added to Backend interface first (T355)

### Wave B (commits 5-6): Events + CRDT
**Files**: document-events.ts, crdt.ts, ws-crdt.ts, subscribe.ts, ws.ts  
**Handler count**: ~8 handlers  
**Blocker**: None — all needed Backend methods exist

### Wave C (commits 7-8): Leases + Presence + Scratchpad + A2A + BFT
**Files**: leases.ts, presence.ts, scratchpad.ts, a2a.ts, bft.ts  
**Handler count**: ~12 handlers  
**Blocker**: Scratchpad paradigm mismatch (doc-scoped vs agent-scoped). Need to reconcile or add `publishDocScratchpad` / `readDocScratchpad` to Backend.

### Wave D (commits 9-12): Search + Semantic + Collections + Cross-doc + Auth + Identity
**Files**: search.ts, semantic.ts, similarity.ts, graph.ts, collections.ts, cross-doc.ts, agent-keys.ts, well-known-agents.ts, webhooks.ts, signed-urls.ts, access-control.ts, organizations.ts, api-keys.ts, retrieval.ts  
**Handler count**: ~50 handlers  
**Blocker**: Many new Backend sub-interfaces needed (T355 prerequisite)

---

## Notes on In-Scope vs. Out-of-Scope

### In-Scope (must move to BackendCore)
All orchestration logic — document lookup, version creation, approval tracking, event appending, CRDT merging, lease acquisition, presence tracking, A2A delivery.

### Out-of-Scope (stays in apps/backend)
- better-auth session management (auth.ts proxies to better-auth)
- Prometheus metrics scraping (no persistence)
- Swagger UI docs route
- Rate limiting middleware (HTTP-layer concern)
- Cache invalidation (can stay in BackendCore.invalidateCache or HTTP layer)
- SSE/WS connection management (transport concerns, calling Backend methods inside)
- Fastify middleware (RBAC checks, content size, etc.) — these validate then delegate to Backend

---

## PostgresBackend Strategy (T356)

**Decision**: Option B — new `PostgresBackend` class (does not extend LocalBackend).

**Location**: `packages/llmtxt/src/pg/pg-backend.ts`

**Schema**: Import from `apps/backend/src/db/schema-pg.ts` initially. After Wave A is stable, consider moving `schema-pg.ts` to `packages/llmtxt/src/pg/schema-pg.ts` as the canonical SSoT.

**Database access**: Uses `drizzle-orm/postgres-js` with `postgres` driver (matching apps/backend/src/db/index.ts).

**Lifecycle**:
- `open()` — creates Drizzle instance from `connectionString` config, runs migrations
- `close()` — closes the postgres connection pool

**Transactions**: All methods use `async/await` (postgres-js is fully async, unlike better-sqlite3 which is sync).

---

## Fastify Plugin Strategy (T356)

After PostgresBackend is scaffolded, register it as `fastify.backendCore` via a new plugin:

```
apps/backend/src/plugins/postgres-backend-plugin.ts
```

This plugin:
1. Reads `DATABASE_URL` from env (already set by Railway)
2. Creates `new PostgresBackend({ connectionString: process.env.DATABASE_URL })`
3. Calls `await backend.open()` on startup
4. Decorates `fastify.backendCore: Backend`
5. Calls `await backend.close()` on `fastify.onClose`

Route handlers then call `request.server.backendCore.method(...)` instead of `db.select(...).from(...)`.

---

## Handoff Notes

This coverage map is complete for PHASE 1 (RCASD). Next steps in order:

1. **T355** — Add missing Backend interface methods to `packages/llmtxt/src/core/backend.ts`
2. **T356** — Create PostgresBackend skeleton + plugin
3. **T354-T361** Wave execution order: A → B → C → D → Final
