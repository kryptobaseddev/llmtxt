# @llmtxt/backend — API Reference

## Table of Contents

- [Functions](#functions)
- [Types](#types)
- [Classes](#classes)
- [Constants](#constants)

## Functions

### `countTokens`

Count tokens using the cl100k_base BPE tokenizer (GPT-3.5/GPT-4 compatible).  Returns the exact number of tokens the given text would consume in a GPT-4 / Claude-compatible API call. This is significantly more accurate than the `ceil(len / 4)` heuristic for content with non-ASCII characters, code, or structured markup.

```typescript
(text: string) => number
```

**Parameters:**

- `text` — The text to tokenize.

**Returns:** Number of tokens.

### `getDocumentCacheKey`

Generate cache key for a document

```typescript
(slug: string, type?: "content" | "metadata") => string
```

### `shouldSkipCache`

Check if cache should be skipped based on query params

```typescript
(request: FastifyRequest) => boolean
```

### `cacheDocumentContent`

Middleware to cache document content Usage: app.get('/documents/:slug', cacheDocumentContent, async (request, reply) =  ... )

```typescript
(request: FastifyRequest<{ Params: { slug: string; }; Querystring: Record<string, string>; }>, reply: FastifyReply) => Promise<void>
```

### `cacheDocumentMetadata`

Middleware to cache document metadata

```typescript
(request: FastifyRequest<{ Params: { slug: string; }; Querystring: Record<string, string>; }>, reply: FastifyReply) => Promise<void>
```

### `setCachedContent`

Store document content in cache

```typescript
(slug: string, content: string, ttl?: number) => void
```

### `setCachedMetadata`

Store document metadata in cache

```typescript
(slug: string, metadata: Record<string, unknown>, ttl?: number) => void
```

### `invalidateDocumentCache`

Invalidate cache for a document

```typescript
(slug: string) => void
```

### `invalidateAllCache`

Invalidate all cache

```typescript
() => void
```

### `getCacheStats`

Get cache stats for both caches

```typescript
() => { content: ReturnType<typeof contentCache.getStats>; metadata: ReturnType<typeof metadataCache.getStats>; }
```

### `keyGenerator`

Generate a stable rate-limit key for the request.  Uses the most specific identifier available:   1. Hashed API key (from Bearer token) — identifies the key, not the user   2. User ID (from session cookie)   3. Client IP address

```typescript
(request: FastifyRequest) => string
```

### `getTierMax`

Return the rate limit max for the given category based on the request's auth tier.

```typescript
(request: FastifyRequest, category: "global" | "write" | "auth") => number
```

### `registerRateLimiting`

Register the global rate limiter on the Fastify instance.  Must be called AFTER CORS and compression plugins but BEFORE route registration. The global limit applies to all routes; individual routes may override with stricter config via writeRateLimit or authRateLimit.  The /api/health endpoint is explicitly skipped via the skip function.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `adaptiveThrottle`

Adaptive throttle hook: adds artificial delay when a client approaches their rate limit ceiling ( 20% remaining). This smooths out burst traffic by slowing requests progressively rather than hard-cutting at the limit. Maximum induced delay is 500ms.  Attach as a preHandler hook on routes where burst smoothing is desired.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<void>
```

### `enforceContentSize`

Enforce the maximum document content size.  Reads `content` from the request body and rejects with 413 if the UTF-8 byte length exceeds CONTENT_LIMITS.maxDocumentSize. Safe to call on any route that accepts a `content` body field.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `enforcePatchSize`

Enforce the maximum patch content size.  Reads `patchText` from the request body and rejects with 413 if its byte length exceeds CONTENT_LIMITS.maxPatchSize.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `enforceDocumentLimit`

Enforce the maximum number of documents per authenticated user.  Counts documents owned by request.user.id and rejects with 429 if at or above CONTENT_LIMITS.maxDocumentsPerUser. Skips the check for unauthenticated requests (anonymous creation still allowed up to the rate limit; ownership won't accumulate).

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `getDocumentPermissions`

Resolve the set of permissions a user holds for a document identified by slug.  Returns an empty array when the user has no access at all. Callers should treat an empty result as a 403 for private/org documents, or allow through for public documents (already handled inside this function).

```typescript
(userId: string | null | undefined, slug: string) => Promise<Permission[]>
```

### `hasPermission`

Check whether a user holds a specific permission on a document. Returns false for non-existent documents (caller should 404 separately).

```typescript
(userId: string | null | undefined, slug: string, permission: Permission) => Promise<boolean>
```

### `requirePermission`

Create a Fastify preHandler that enforces a minimum permission level.  Usage:   fastify.get('/documents/:slug',  preHandler: [requirePermission('read')] , handler)  The handler is responsible for checking document existence (404) separately when the slug is not found — this middleware returns 403 for permission denied and 401 for unauthenticated requests on private documents.

```typescript
(permission: Permission) => (request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `ensureDefaultMetrics`

```typescript
() => void
```

### `registerMetrics`

Register per-request HTTP metrics hooks on the Fastify instance.  Attaches an onRequest hook to start a timer and an onResponse hook to record the duration and increment the request counter. The /api/metrics route itself is excluded from metrics to avoid self-referential noise.  Call this once during application setup, after plugin registration and before route registration.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `appendDocumentEvent`

Append a document event inside an open Drizzle transaction.

```typescript
(tx: any, input: AppendDocumentEventInput) => Promise<AppendDocumentEventResult>
```

**Parameters:**

- `tx` — Open Drizzle transaction (postgres-js provider).
- `input` — Event parameters.

**Returns:** The appended event row + whether it was a duplicate.

### `validateHashChain`

Validate the hash chain for the last `limit` rows of a document's event log.  Walks the rows in ascending seq order and recomputes each prev_hash, comparing against the stored value. Returns the first broken seq if any.

```typescript
(db: any, slug: string, limit?: number) => Promise<ChainValidationResult>
```

**Parameters:**

- `db` — Drizzle client (outside any transaction).
- `slug` — Document slug (= document_id FK).
- `limit` — Number of recent rows to validate (default 100).

### `apiRoutes`

Register core document API routes: compress, decompress, validate, search, schemas, and cache management.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `getEventsSince`

Fetch document events with seq  fromSeq, ordered ascending.

```typescript
(db: any, docId: string, fromSeq: number) => Promise<DocumentEventRow[]>
```

### `computeSectionDelta`

Compute a SectionDelta for a specific section between fromSeq and now.  Returns null when fromSeq === currentSeq (no changes).  The delta is derived by examining SECTION_UPDATED / SECTION_CREATED / SECTION_DELETED events in the payload. Events of type 'section.edited' are used as the primary signal (payload.sectionId and payload.event).  For backward compatibility, also checks event payloads for sectionName and content fields.

```typescript
(db: any, docId: string, sectionName: string, fromSeq: number) => Promise<SectionDelta | null>
```

### `disclosureRoutes`

Register progressive disclosure routes: overview, sections, toc, search, lines, raw, query, and batch endpoints for token-efficient content retrieval.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `versionRoutes`

Register version management routes: document update, version listing, version retrieval, and pairwise diff computation.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `authRoutes`

Register authentication routes by proxying all /auth/* requests to the better-auth handler.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `generateApiKey`

Generate a new API key.

```typescript
() => { rawKey: string; keyHash: string; keyPrefix: string; }
```

**Returns:** An object containing:   - `rawKey`: the full key string (return to user ONCE, never store)   - `keyHash`: SHA-256 hex digest to persist in the database   - `keyPrefix`: display prefix for the database (first 8 random chars)

### `hashApiKey`

Hash a raw API key using SHA-256.  Delegates to crates/llmtxt-core::hash_content via the llmtxt WASM binding. Used both at creation time (to derive the stored hash) and at authentication time (to look up the key by hash).

```typescript
(rawKey: string) => string
```

**Parameters:**

- `rawKey` — The full key string including the "llmtxt_" prefix

**Returns:** Hex-encoded SHA-256 digest

### `isApiKeyFormat`

Check whether a raw key string looks like an LLMtxt API key. Used to quickly reject obviously wrong Bearer tokens before hashing.

```typescript
(token: string) => boolean
```

### `requireAuth`

Authenticate the request via Bearer API key first, then session cookie. Populates request.user and request.session, or returns 401.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `requireRegistered`

Require an authenticated, non-anonymous user. Calls requireAuth first, then rejects anonymous sessions with 403.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `requireOwner`

Require the authenticated user to be the document owner. Checks slug from route params against document ownerId. Returns 403 if not owner, 404 if document not found.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `requireOwnerAllowAnon`

Require the authenticated user (anonymous OK) to be the document owner. Reads slug from request body (for routes like POST /signed-urls where slug is a body field). Does NOT call requireRegistered — anonymous owners are permitted. Returns 403 if not owner, 404 if document not found.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `requireOwnerAllowAnonParams`

Require the authenticated user (anonymous OK) to be the document owner. Reads slug from route params (for routes like POST /documents/:slug/transition). Does NOT call requireRegistered — anonymous owners are permitted. Returns 403 if not owner, 404 if document not found.

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `lifecycleRoutes`

Register lifecycle and consensus routes: state transitions, approve/reject voting, approval listing, and contributor attribution.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `patchRoutes`

Register patch route: POST /documents/:slug/patch to apply a unified diff and create a new version. Requires authentication and editable document state.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `similarityRoutes`

Register similarity route: GET /documents/:slug/similar?q=query&method=ngram&threshold=0 to rank document sections by similarity to a query.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `graphRoutes`

Register knowledge graph route: GET /documents/:slug/graph to extract mentions, #tags, /directives from document content, and cross-document links.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `retrievalRoutes`

Register retrieval planning route: POST /documents/:slug/plan-retrieval for token-budget-aware section selection. Ranks sections by relevance and greedily packs within a token budget.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `signedUrlRoutes`

Register signed URL route: POST /signed-urls to generate time-limited HMAC-signed access tokens for document retrieval. Requires owner authentication.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `mergeRoutes`

Register the cherry-pick merge route.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `apiKeyRoutes`

Register API key management routes.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `conflictRoutes`

Register conflict resolution routes.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `createEmbeddingProvider`

Select the best available embedding provider.  - If `OPENAI_API_KEY` is set → `OpenAIEmbeddingProvider` (`text-embedding-3-small`). - Otherwise → `LocalEmbeddingProvider` (TF-IDF, 256-dimensional, no external API).

```typescript
() => EmbeddingProvider
```

### `semanticRoutes`

Register semantic diff and consensus routes.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `accessControlRoutes`

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `organizationRoutes`

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `wsRoutes`

Register WebSocket subscription routes. The fastify instance must have fastify/websocket registered.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `persistCrdtUpdate`

Persist a CRDT update to section_crdt_updates and update section_crdt_states.  Steps (all within one transaction):  1. Acquire pg_advisory_xact_lock on the (docId, secId) pair.  2. SELECT MAX(seq)+1 as next seq; default to 1 if no rows.  3. Load current state from section_crdt_states (or empty for new section).  4. Apply the update to derive new state.  5. INSERT into section_crdt_updates (seq, updateBlob, clientId).  6. UPSERT section_crdt_states with the new state.

```typescript
(documentId: string, sectionId: string, updateBlob: Buffer, clientId: string) => Promise<PersistResult>
```

**Parameters:**

- `documentId` — document slug (FK references documents.slug)
- `sectionId` — section identifier
- `updateBlob` — raw lib0 v1 Yrs update bytes from the client
- `clientId` — agent/user ID that produced this update

**Returns:** seq, newState  on success; throws on failure

### `loadSectionState`

Load the consolidated CRDT state for a (documentId, sectionId) pair. Returns null if no state exists yet (section not yet initialized).

```typescript
(documentId: string, sectionId: string) => Promise<{ yrsState: Buffer; clock: number; updatedAt: Date | null; } | null>
```

### `loadPendingUpdates`

Load all pending CRDT update blobs for a (documentId, sectionId) pair, ordered by seq ascending.

```typescript
(documentId: string, sectionId: string) => Promise<Buffer[]>
```

### `initCrdtPubSub`

Initialize the CRDT pub/sub adapter.  Must be called once at server startup (before routes are registered). Idempotent — subsequent calls are no-ops.

```typescript
() => Promise<void>
```

### `publishCrdtUpdate`

Publish a CRDT update to all subscribers (both local and cross-instance).

```typescript
(documentId: string, sectionId: string, update: Buffer) => Promise<void>
```

### `subscribeCrdtUpdates`

Subscribe to CRDT updates for a (documentId, sectionId) pair.  Returns an unsubscribe function — call it when the WebSocket closes.

```typescript
(documentId: string, sectionId: string, listener: UpdateListener) => () => void
```

### `compactSection`

Compact a single (documentId, sectionId) pair.  Steps:  1. BEGIN TRANSACTION  2. SELECT all pending updates ordered by seq  3. Merge updates into consolidated state via crdt_merge_updates  4. UPSERT section_crdt_states with merged state, clock = 0  5. DELETE all compacted rows from section_crdt_updates  6. COMMIT  If the transaction fails, no update rows are deleted (rollback guarantee).

```typescript
(documentId: string, sectionId: string) => Promise<number>
```

**Returns:** number of update rows deleted

### `broadcastAwareness`

Broadcast awareness update bytes to all other connections in the same room. Does NOT decode the awareness state — raw relay only (T256 AC).

```typescript
(documentId: string, sectionId: string, updateBytes: Buffer, excludeClientId: string) => void
```

### `handleAwarenessMessage`

Handle an awareness message from a client. Relay raw bytes to peers and upsert the presence registry entry.  The awareness payload is NOT decoded server-side — we relay the raw bytes to all other peers in the same (docId, sectionId) room.

```typescript
(clientId: string, documentId: string, sectionId: string, updateBytes: Buffer) => void
```

### `hasSectionSessions`

Check whether any WS session is active for a given section. Used by the compaction job to avoid compacting while clients are connected.

```typescript
(documentId: string, sectionId: string) => boolean
```

### `wsCrdtRoutes`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `startCrdtCompactionJob`

Start the CRDT compaction background job.  Runs immediately on startup (to handle backlog) then every 6 hours. Safe to call multiple times — subsequent calls are no-ops.

```typescript
() => void
```

### `sseRoutes`

Register SSE streaming routes under the provided prefix (e.g. /api).

```typescript
(app: FastifyInstance) => Promise<void>
```

### `webhookRoutes`

Register webhook CRUD routes. All routes require authentication.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `startWebhookWorker`

Start the webhook delivery worker.  Call once at server startup. The worker attaches a single listener to the event bus and fans out to all matching webhooks for each event.

```typescript
() => void
```

### `startEventLogJobs`

Start both background jobs. Call once at server startup (after DB is ready). Safe to call multiple times — subsequent calls are no-ops.

```typescript
() => void
```

### `stopEventLogJobs`

Stop both background jobs. Useful in tests or graceful shutdown.

```typescript
() => void
```

### `crossDocRoutes`

Register cross-document routes: enhanced search, document links, and multi-document graph.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `collectionRoutes`

Register collection management routes.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `getDocumentWithContent`

Fetch a document by slug, resolving content from cache or database with decompression.

```typescript
(slug: string, request: FastifyRequest) => Promise<any>
```

### `handleContentNegotiation`

Handle content negotiation for slug requests. Returns true if the request was handled (response sent), false otherwise.

```typescript
(request: FastifyRequest, reply: FastifyReply, slug: string) => Promise<boolean>
```

### `extractSlugWithExtension`

Check if a URL path looks like a document slug with an explicit extension. Supported extensions: .txt, .json, .md

```typescript
(urlPath: string) => { slug: string; ext: string; } | null
```

### `extractSlug`

Check if a URL path looks like a document slug. Slugs are short alphanumeric strings at the root level. Returns the slug if valid, null otherwise.

```typescript
(urlPath: string) => string | null
```

### `registerAuditLogging`

Register an onResponse hook that writes audit log entries for all successful state-changing requests.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `auditLogRoutes`

Register the GET /api/audit-logs route. Requires authentication. Returns paginated audit logs with optional filtering.  Query parameters:   - action: filter by exact action name (e.g. 'document.create')   - resourceType: filter by resource type   - userId: filter by user ID   - from: start timestamp (unix ms)   - to: end timestamp (unix ms)   - limit: max results (default 50, max 500)   - offset: pagination offset (default 0)

```typescript
(app: FastifyInstance) => Promise<void>
```

### `documentEventRoutes`

Register document event log routes under the given Fastify scope.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `agentKeyRoutes`

Register agent key management routes under /agents/keys.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `crdtRoutes`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `presenceRoutes`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `acquireLease`

Acquire an advisory lease on a section.  Returns the inserted Lease row, or null if the section is already leased by another agent (conflict). The caller may pass ttlMs to override the default.

```typescript
(db: any, docId: string, sectionId: string, agentId: string, ttlMs: number, reason?: string | null) => Promise<Lease | null>
```

**Parameters:**

- `db` — Drizzle client or transaction.
- `docId` — Document slug.
- `sectionId` — Section identifier.
- `agentId` — Requesting agent.
- `ttlMs` — Lease duration in milliseconds.
- `reason` — Optional human-readable reason.

### `renewLease`

Renew a lease by extending its expiresAt.  Returns the updated Lease, or null if the lease was not found or the requesting agent is not the holder.

```typescript
(db: any, leaseId: string, agentId: string, ttlMs: number) => Promise<Lease | null>
```

### `releaseLease`

Release a lease. No-op if the lease is already expired or does not exist. Returns true if a row was deleted.

```typescript
(db: any, leaseId: string, agentId: string) => Promise<boolean>
```

### `getActiveLease`

Get the active (non-expired) lease for a (docId, sectionId) pair. Returns null if no active lease exists.

```typescript
(db: any, docId: string, sectionId: string) => Promise<Lease | null>
```

### `leaseRoutes`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `matchPath`

Test whether a path matches a pattern.

```typescript
(pattern: string, path: string) => boolean
```

**Parameters:**

- `pattern` — URL pattern with optional :param and * placeholders.
- `path` — The actual URL path to test.

**Returns:** true if the path matches the pattern.

### `extractParams`

Extract named parameters from a path according to a pattern.

```typescript
(pattern: string, path: string) => Record<string, string>
```

**Parameters:**

- `pattern` — URL pattern with :param placeholders.
- `path` — The actual URL path.

**Returns:** Object mapping parameter names to captured values.                 Empty object if no parameters or no match.

### `subscribeRoutes`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `bftRoutes`

Register BFT consensus routes.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `publishScratchpad`

Publish a message to the document scratchpad.  Returns the assigned message ID.

```typescript
(slug: string, opts: PublishOptions) => Promise<ScratchpadMessage>
```

### `readScratchpad`

Read messages from the document scratchpad.  Returns up to `limit` messages after `lastId`.

```typescript
(slug: string, opts?: ReadOptions) => Promise<ScratchpadMessage[]>
```

### `subscribeScratchpad`

Subscribe to new scratchpad messages for SSE fan-out (in-memory fallback).  Returns an unsubscribe function.

```typescript
(slug: string, threadId: string | undefined, onMessage: (msg: ScratchpadMessage) => void) => () => void
```

### `purgeScratchpad`

Purge expired scratchpad messages (24h TTL cleanup).  For Redis: XTRIM handles this automatically (TTL set on XADD). For in-memory: scans all streams and removes old entries.

```typescript
() => Promise<void>
```

### `scratchpadRoutes`

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `a2aRoutes`

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `purgeExpiredInboxMessages`

Purge expired agent inbox messages older than 48h. Called by the background jobs scheduler.

```typescript
() => Promise<number>
```

### `resolveRequestVersion`

Resolve the version from the request. URL path prefix takes precedence and is handled by route registration; this function handles Accept and X-API-Version headers.

```typescript
(request: FastifyRequest) => ApiVersionInfo
```

### `addVersionResponseHeaders`

Attach standard API version response headers to every reply.    X-API-Version:        served version   X-API-Latest-Version: latest available version

```typescript
(reply: FastifyReply, versionInfo: ApiVersionInfo) => void
```

### `addDeprecationHeaders`

Attach RFC 8594 deprecation headers when serving a deprecated (or unversioned-legacy) endpoint.    Deprecation: true   Sunset:      ISO date   Link:        /api/v; rel="successor-version"

```typescript
(reply: FastifyReply, requestUrl: string, versionInfo: ApiVersionInfo) => void
```

### `apiVersionPlugin`

Register this plugin globally so that `request.apiVersion` is always populated, even for requests that are served from legacy /api/* routes.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `v1Routes`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `healthRoutes`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `securityHeaders`

Register an onSend hook that sets comprehensive security headers on every response.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `registerCsrf`

Register fastify/cookie and fastify/csrf-protection, and add a preHandler hook that enforces CSRF for cookie-authenticated, state-changing requests.

```typescript
(app: FastifyInstance) => Promise<void>
```

### `wellKnownAgentsRoutes`

Register the /.well-known/agents/:id discovery route.

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `computeReceipt`

Compute a stateless server receipt HMAC.  receipt = HMAC-SHA256(SERVER_RECEIPT_SECRET, canonical_payload + 'n' + response_hash) Uses signWebhookPayload (WASM Rust HMAC-SHA256, SSOT per docs/SSOT.md). Returns the hex portion only (strips the 'sha256=' prefix for compact storage).

```typescript
(canonicalPayload: string, responseBodyHex: string) => string
```

### `buildReceipt`

Build the signature receipt object included in every mutating write response.  When `signatureVerified` is true, `agent_id` and `pubkey_fingerprint` are set.

```typescript
(opts: { agentId: string | null; pubkeyFingerprint: string | null; payloadHash: string; serverTimestamp: number; signatureVerified: boolean; }) => { agent_id: string | null; pubkey_fingerprint: string | null; payload_hash: string; server_timestamp: number; signature_verified: boolean; }
```

### `startNonceCleanup`

Start a background interval that purges nonces older than 24 hours. Safe to call multiple times — only one interval is registered.

```typescript
() => void
```

### `verifyAgentSignature`

Fastify `preHandler` hook that verifies Ed25519 agent signatures.  When no signature headers are present and the requesting user has no registered pubkeys, the request passes through (unsigned writes are allowed when `SIGNATURE_REQUIRED` is not set to `"true"`).

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<void>
```

### `agentSignaturePlugin`

Register the agent signature plugin as a Fastify plugin.  Adds: - onRequest hook: calls verifyAgentSignature for write routes - onSend hook: injects receipt into JSON responses for write routes

```typescript
(fastify: FastifyInstance) => Promise<void>
```

### `runLeaseExpiryPass`

Run one expiry pass: delete expired rows and emit events.

```typescript
() => Promise<void>
```

### `startLeaseExpiryJob`

Start the lease expiry job.

```typescript
() => ReturnType<typeof setInterval>
```

**Returns:** NodeJS.Timeout reference for use with clearInterval in tests/shutdown.

### `stopLeaseExpiryJob`

Stop a previously started lease expiry job.

```typescript
(timer: ReturnType<typeof setInterval>) => void
```

### `registerObservabilityHooks`

```typescript
(app: FastifyInstance) => Promise<void>
```

### `sanitizeHtml`

Sanitize an HTML string for safe embedding in a server-rendered page.  This function must only be called on content that will be rendered as HTML (e.g., the output of renderMarkdown in viewTemplate.ts). Do not call it on raw content stored in the database or returned via JSON/plain-text APIs.

```typescript
(html: string) => string
```

**Parameters:**

- `html` — The HTML string to sanitize.

**Returns:** A safe HTML string with all dangerous elements and attributes removed.

### `renderViewHtml`

Render the server-side HTML view template for a document page, including meta tags and structured content display.

```typescript
(slug: string, data: any) => string
```

### `setupTestDb`

Set up a test database.  When `DATABASE_URL_PG` is set, a Postgres connection is opened against a fresh, randomly-named schema.  Otherwise an in-memory SQLite database is created and bootstrapped with the full DDL.  Always call `teardownTestDb(ctx)` in `after()` to release connections and clean up schema.

```typescript
() => Promise<TestDbContext>
```

### `teardownTestDb`

Tear down a test database context returned by `setupTestDb()`.  - SQLite: closes the database file handle. - PostgreSQL: drops the isolated test schema and ends all connections.

```typescript
(ctx: TestDbContext) => Promise<void>
```

### `computeAndStoreEmbeddings`

Compute and store embeddings for all sections of a document.  Skips sections whose content_hash matches the stored value (no recompute). Safe to call on every version write — idempotent and fast for unchanged sections.

```typescript
(documentId: string, content: string) => Promise<void>
```

**Parameters:**

- `documentId` — The document ID.
- `content` — Decompressed document text.

### `invalidateDocumentEmbeddings`

Delete all stored embeddings for a document.  Called before regenerating embeddings (e.g. on content change). In practice the ON CONFLICT upsert handles staleness, but explicit invalidation is useful when sections are removed.

```typescript
(documentId: string) => Promise<void>
```

### `backfillEmbeddings`

Backfill embeddings for documents that have none.  Fetches the latest version for each document lacking embeddings and computes section embeddings.  Safe to run concurrently — each document is processed independently.

```typescript
(limit?: number) => Promise<number>
```

**Parameters:**

- `limit` — Maximum number of documents to backfill per run (default 50).

## Types

### `User`

```typescript
{ id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: Date; updatedAt: Date; isAnonymous: boolean | null; agentId: string | null; expiresAt: number | null; }
```

### `NewUser`

```typescript
{ id: string; email: string; createdAt: Date; updatedAt: Date; name?: string | undefined; emailVerified?: boolean | undefined; image?: string | null | undefined; isAnonymous?: boolean | null | undefined; agentId?: string | null | undefined; expiresAt?: number | null | undefined; }
```

### `Session`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress: string | null; userAgent: string | null; }
```

### `NewSession`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; }
```

### `Document`

```typescript
{ id: string; createdAt: number; isAnonymous: boolean; expiresAt: number | null; slug: string; format: string; contentHash: string; compressedData: unknown; originalSize: number; compressedSize: number; tokenCount: number | null; accessCount: number; lastAccessedAt: number | null; state: string; ownerId: string | null; storageType: string; storageKey: string | null; currentVersion: number; versionCount: number; sharingMode: string; approvalRequiredCount: number; approvalRequireUnanimous: boolean; approvalAllowedReviewers: string; approvalTimeoutMs: number; visibility: string; }
```

### `NewDocument`

```typescript
{ id: string; createdAt: number; slug: string; format: string; contentHash: string; originalSize: number; compressedSize: number; isAnonymous?: boolean | undefined; expiresAt?: number | null | undefined; compressedData?: unknown; tokenCount?: number | null | undefined; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; state?: string | undefined; ownerId?: string | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; currentVersion?: number | undefined; versionCount?: number | undefined; sharingMode?: string | undefined; approvalRequiredCount?: number | undefined; approvalRequireUnanimous?: boolean | undefined; approvalAllowedReviewers?: string | undefined; approvalTimeoutMs?: number | undefined; visibility?: string | undefined; }
```

### `Version`

```typescript
{ id: string; createdAt: number; contentHash: string; compressedData: unknown; tokenCount: number | null; storageType: string; storageKey: string | null; documentId: string; versionNumber: number; createdBy: string | null; changelog: string | null; patchText: string | null; baseVersion: number | null; }
```

### `NewVersion`

```typescript
{ id: string; createdAt: number; contentHash: string; documentId: string; versionNumber: number; compressedData?: unknown; tokenCount?: number | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; createdBy?: string | null | undefined; changelog?: string | null | undefined; patchText?: string | null | undefined; baseVersion?: number | null | undefined; }
```

### `StateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; reason: string | null; atVersion: number; }
```

### `NewStateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; atVersion: number; reason?: string | null | undefined; }
```

### `Approval`

```typescript
{ timestamp: number; id: string; documentId: string; reason: string | null; atVersion: number; reviewerId: string; status: string; }
```

### `NewApproval`

```typescript
{ timestamp: number; id: string; documentId: string; atVersion: number; reviewerId: string; status: string; reason?: string | null | undefined; }
```

### `Contributor`

```typescript
{ id: string; agentId: string; documentId: string; versionsAuthored: number; totalTokensAdded: number; totalTokensRemoved: number; netTokens: number; firstContribution: number; lastContribution: number; sectionsModified: string; displayName: string | null; }
```

### `NewContributor`

```typescript
{ id: string; agentId: string; documentId: string; firstContribution: number; lastContribution: number; versionsAuthored?: number | undefined; totalTokensAdded?: number | undefined; totalTokensRemoved?: number | undefined; netTokens?: number | undefined; sectionsModified?: string | undefined; displayName?: string | null | undefined; }
```

### `SignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; accessCount: number; lastAccessedAt: number | null; documentId: string; conversationId: string; orgId: string | null; signature: string; signatureLength: number; revoked: boolean; }
```

### `NewSignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; documentId: string; conversationId: string; signature: string; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; orgId?: string | null | undefined; signatureLength?: number | undefined; revoked?: boolean | undefined; }
```

### `VersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; changelog: string; sectionsModified: string; authorId: string; addedLines: number; removedLines: number; addedTokens: number; removedTokens: number; }
```

### `NewVersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; authorId: string; changelog?: string | undefined; sectionsModified?: string | undefined; addedLines?: number | undefined; removedLines?: number | undefined; addedTokens?: number | undefined; removedTokens?: number | undefined; }
```

### `ApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; expiresAt: number | null; userId: string; revoked: boolean; keyHash: string; keyPrefix: string; scopes: string; lastUsedAt: number | null; }
```

### `NewApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; userId: string; keyHash: string; keyPrefix: string; expiresAt?: number | null | undefined; revoked?: boolean | undefined; scopes?: string | undefined; lastUsedAt?: number | null | undefined; }
```

### `AuditLog`

```typescript
{ timestamp: number; id: string; agentId: string | null; userId: string | null; ipAddress: string | null; userAgent: string | null; action: string; resourceType: string; resourceId: string | null; details: string | null; requestId: string | null; method: string | null; path: string | null; statusCode: number | null; }
```

### `NewAuditLog`

```typescript
{ timestamp: number; id: string; action: string; resourceType: string; agentId?: string | null | undefined; userId?: string | null | undefined; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; resourceId?: string | null | undefined; details?: string | null | undefined; requestId?: string | null | undefined; method?: string | null | undefined; path?: string | null | undefined; statusCode?: number | null | undefined; }
```

### `DocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `NewDocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `Organization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `NewOrganization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `OrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `NewOrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `DocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `NewDocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `PendingInvite`

```typescript
{ id: string; email: string; createdAt: number; expiresAt: number | null; documentId: string; role: string; invitedBy: string; }
```

### `NewPendingInvite`

```typescript
{ id: string; email: string; createdAt: number; documentId: string; role: string; invitedBy: string; expiresAt?: number | null | undefined; }
```

### `Webhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events: string; documentSlug: string | null; active: boolean; failureCount: number; lastDeliveryAt: number | null; lastSuccessAt: number | null; }
```

### `NewWebhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events?: string | undefined; documentSlug?: string | null | undefined; active?: boolean | undefined; failureCount?: number | undefined; lastDeliveryAt?: number | null | undefined; lastSuccessAt?: number | null | undefined; }
```

### `DocumentLink`

```typescript
{ id: string; createdAt: number; createdBy: string | null; sourceDocId: string; targetDocId: string; linkType: string; label: string | null; }
```

### `NewDocumentLink`

```typescript
{ id: string; createdAt: number; sourceDocId: string; targetDocId: string; linkType: string; createdBy?: string | null | undefined; label?: string | null | undefined; }
```

### `Collection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility: string; description: string | null; }
```

### `NewCollection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility?: string | undefined; description?: string | null | undefined; }
```

### `CollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position: number; addedBy: string | null; }
```

### `NewCollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position?: number | undefined; addedBy?: string | null | undefined; }
```

### `SectionCrdtState`

```typescript
{ updatedAt: number; documentId: string; sectionId: string; clock: number; yrsState: Buffer<ArrayBufferLike>; }
```

### `NewSectionCrdtState`

```typescript
{ documentId: string; sectionId: string; yrsState: Buffer<ArrayBufferLike>; updatedAt?: number | undefined; clock?: number | undefined; }
```

### `SectionCrdtUpdate`

```typescript
{ id: string; createdAt: number; documentId: string; sectionId: string; updateBlob: Buffer<ArrayBufferLike>; clientId: string; seq: number; }
```

### `NewSectionCrdtUpdate`

```typescript
{ id: string; documentId: string; sectionId: string; updateBlob: Buffer<ArrayBufferLike>; clientId: string; seq: number; createdAt?: number | undefined; }
```

### `DocumentEvent`

```typescript
{ id: string; createdAt: number; documentId: string; seq: number; eventType: string; actorId: string; payloadJson: unknown; idempotencyKey: string | null; prevHash: Buffer<ArrayBufferLike> | null; }
```

### `NewDocumentEvent`

```typescript
{ id: string; documentId: string; seq: number; eventType: string; actorId: string; payloadJson: unknown; createdAt?: number | undefined; idempotencyKey?: string | null | undefined; prevHash?: Buffer<ArrayBufferLike> | null | undefined; }
```

### `AgentPubkey`

```typescript
{ id: string; createdAt: number; agentId: string; pubkey: Buffer<ArrayBufferLike>; revokedAt: number | null; }
```

### `NewAgentPubkey`

```typescript
{ id: string; agentId: string; pubkey: Buffer<ArrayBufferLike>; createdAt?: number | undefined; revokedAt?: number | null | undefined; }
```

### `AgentSignatureNonce`

```typescript
{ agentId: string; nonce: string; firstSeen: number; }
```

### `NewAgentSignatureNonce`

```typescript
{ agentId: string; nonce: string; firstSeen?: number | undefined; }
```

### `InsertUser`

```typescript
{ id: string; email: string; createdAt: Date; updatedAt: Date; name?: string | undefined; emailVerified?: boolean | undefined; image?: string | null | undefined; isAnonymous?: boolean | null | undefined; agentId?: string | null | undefined; expiresAt?: number | null | undefined; }
```

### `SelectUser`

```typescript
{ id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: Date; updatedAt: Date; isAnonymous: boolean | null; agentId: string | null; expiresAt: number | null; }
```

### `InsertSession`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; }
```

### `SelectSession`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress: string | null; userAgent: string | null; }
```

### `InsertDocument`

```typescript
{ id: string; createdAt: number; slug: string; format: string; contentHash: string; originalSize: number; compressedSize: number; isAnonymous?: boolean | undefined; expiresAt?: number | null | undefined; compressedData?: any; tokenCount?: number | null | undefined; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; state?: string | undefined; ownerId?: string | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; currentVersion?: number | undefined; versionCount?: number | undefined; sharingMode?: string | undefined; approvalRequiredCount?: number | undefined; approvalRequireUnanimous?: boolean | undefined; approvalAllowedReviewers?: string | undefined; approvalTimeoutMs?: number | undefined; visibility?: string | undefined; }
```

### `SelectDocument`

```typescript
{ id: string; createdAt: number; isAnonymous: boolean; expiresAt: number | null; slug: string; format: string; contentHash: string; originalSize: number; compressedSize: number; tokenCount: number | null; accessCount: number; lastAccessedAt: number | null; state: string; ownerId: string | null; storageType: string; storageKey: string | null; currentVersion: number; versionCount: number; sharingMode: string; approvalRequiredCount: number; approvalRequireUnanimous: boolean; approvalAllowedReviewers: string; approvalTimeoutMs: number; visibility: string; compressedData?: any; }
```

### `InsertVersion`

```typescript
{ id: string; createdAt: number; contentHash: string; documentId: string; versionNumber: number; compressedData?: any; tokenCount?: number | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; createdBy?: string | null | undefined; changelog?: string | null | undefined; patchText?: string | null | undefined; baseVersion?: number | null | undefined; }
```

### `SelectVersion`

```typescript
{ id: string; createdAt: number; contentHash: string; tokenCount: number | null; storageType: string; storageKey: string | null; documentId: string; versionNumber: number; createdBy: string | null; changelog: string | null; patchText: string | null; baseVersion: number | null; compressedData?: any; }
```

### `InsertStateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; atVersion: number; reason?: string | null | undefined; }
```

### `SelectStateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; reason: string | null; atVersion: number; }
```

### `InsertApproval`

```typescript
{ timestamp: number; id: string; documentId: string; atVersion: number; reviewerId: string; status: string; reason?: string | null | undefined; }
```

### `SelectApproval`

```typescript
{ timestamp: number; id: string; documentId: string; reason: string | null; atVersion: number; reviewerId: string; status: string; }
```

### `InsertContributor`

```typescript
{ id: string; agentId: string; documentId: string; firstContribution: number; lastContribution: number; versionsAuthored?: number | undefined; totalTokensAdded?: number | undefined; totalTokensRemoved?: number | undefined; netTokens?: number | undefined; sectionsModified?: string | undefined; displayName?: string | null | undefined; }
```

### `SelectContributor`

```typescript
{ id: string; agentId: string; documentId: string; versionsAuthored: number; totalTokensAdded: number; totalTokensRemoved: number; netTokens: number; firstContribution: number; lastContribution: number; sectionsModified: string; displayName: string | null; }
```

### `InsertSignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; documentId: string; conversationId: string; signature: string; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; orgId?: string | null | undefined; signatureLength?: number | undefined; revoked?: boolean | undefined; }
```

### `SelectSignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; accessCount: number; lastAccessedAt: number | null; documentId: string; conversationId: string; orgId: string | null; signature: string; signatureLength: number; revoked: boolean; }
```

### `InsertVersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; authorId: string; changelog?: string | undefined; sectionsModified?: string | undefined; addedLines?: number | undefined; removedLines?: number | undefined; addedTokens?: number | undefined; removedTokens?: number | undefined; }
```

### `SelectVersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; changelog: string; sectionsModified: string; authorId: string; addedLines: number; removedLines: number; addedTokens: number; removedTokens: number; }
```

### `InsertApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; userId: string; keyHash: string; keyPrefix: string; expiresAt?: number | null | undefined; revoked?: boolean | undefined; scopes?: string | undefined; lastUsedAt?: number | null | undefined; }
```

### `SelectApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; expiresAt: number | null; userId: string; revoked: boolean; keyHash: string; keyPrefix: string; scopes: string; lastUsedAt: number | null; }
```

### `InsertAuditLog`

```typescript
{ timestamp: number; id: string; action: string; resourceType: string; agentId?: string | null | undefined; userId?: string | null | undefined; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; resourceId?: string | null | undefined; details?: string | null | undefined; requestId?: string | null | undefined; method?: string | null | undefined; path?: string | null | undefined; statusCode?: number | null | undefined; }
```

### `SelectAuditLog`

```typescript
{ timestamp: number; id: string; agentId: string | null; userId: string | null; ipAddress: string | null; userAgent: string | null; action: string; resourceType: string; resourceId: string | null; details: string | null; requestId: string | null; method: string | null; path: string | null; statusCode: number | null; }
```

### `InsertDocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `SelectDocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `InsertOrganization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `SelectOrganization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `InsertOrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `SelectOrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `InsertDocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `SelectDocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `InsertPendingInvite`

```typescript
{ id: string; email: string; createdAt: number; documentId: string; role: string; invitedBy: string; expiresAt?: number | null | undefined; }
```

### `SelectPendingInvite`

```typescript
{ id: string; email: string; createdAt: number; expiresAt: number | null; documentId: string; role: string; invitedBy: string; }
```

### `InsertWebhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events?: string | undefined; documentSlug?: string | null | undefined; active?: boolean | undefined; failureCount?: number | undefined; lastDeliveryAt?: number | null | undefined; lastSuccessAt?: number | null | undefined; }
```

### `SelectWebhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events: string; documentSlug: string | null; active: boolean; failureCount: number; lastDeliveryAt: number | null; lastSuccessAt: number | null; }
```

### `InsertDocumentLink`

```typescript
{ id: string; createdAt: number; sourceDocId: string; targetDocId: string; linkType: string; createdBy?: string | null | undefined; label?: string | null | undefined; }
```

### `SelectDocumentLink`

```typescript
{ id: string; createdAt: number; createdBy: string | null; sourceDocId: string; targetDocId: string; linkType: string; label: string | null; }
```

### `InsertCollection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility?: string | undefined; description?: string | null | undefined; }
```

### `SelectCollection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility: string; description: string | null; }
```

### `InsertCollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position?: number | undefined; addedBy?: string | null | undefined; }
```

### `SelectCollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position: number; addedBy: string | null; }
```

### `User`

```typescript
{ id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: Date; updatedAt: Date; isAnonymous: boolean | null; agentId: string | null; expiresAt: number | null; }
```

### `NewUser`

```typescript
{ id: string; email: string; createdAt: Date; updatedAt: Date; name?: string | undefined; emailVerified?: boolean | undefined; image?: string | null | undefined; isAnonymous?: boolean | null | undefined; agentId?: string | null | undefined; expiresAt?: number | null | undefined; }
```

### `Session`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress: string | null; userAgent: string | null; }
```

### `NewSession`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; }
```

### `Document`

```typescript
{ id: string; createdAt: number; isAnonymous: boolean; expiresAt: number | null; slug: string; format: string; contentHash: string; compressedData: Buffer<ArrayBufferLike> | null; originalSize: number; compressedSize: number; tokenCount: number | null; accessCount: number; lastAccessedAt: number | null; state: string; ownerId: string | null; storageType: string; storageKey: string | null; currentVersion: number; versionCount: number; sharingMode: string; approvalRequiredCount: number; approvalRequireUnanimous: boolean; approvalAllowedReviewers: string; approvalTimeoutMs: number; visibility: string; eventSeqCounter: bigint; bftF: number; }
```

### `NewDocument`

```typescript
{ id: string; createdAt: number; slug: string; format: string; contentHash: string; originalSize: number; compressedSize: number; isAnonymous?: boolean | undefined; expiresAt?: number | null | undefined; compressedData?: Buffer<ArrayBufferLike> | null | undefined; tokenCount?: number | null | undefined; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; state?: string | undefined; ownerId?: string | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; currentVersion?: number | undefined; versionCount?: number | undefined; sharingMode?: string | undefined; approvalRequiredCount?: number | undefined; approvalRequireUnanimous?: boolean | undefined; approvalAllowedReviewers?: string | undefined; approvalTimeoutMs?: number | undefined; visibility?: string | undefined; eventSeqCounter?: bigint | undefined; bftF?: number | undefined; }
```

### `Version`

```typescript
{ id: string; createdAt: number; contentHash: string; compressedData: Buffer<ArrayBufferLike> | null; tokenCount: number | null; storageType: string; storageKey: string | null; documentId: string; versionNumber: number; createdBy: string | null; changelog: string | null; patchText: string | null; baseVersion: number | null; }
```

### `NewVersion`

```typescript
{ id: string; createdAt: number; contentHash: string; documentId: string; versionNumber: number; compressedData?: Buffer<ArrayBufferLike> | null | undefined; tokenCount?: number | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; createdBy?: string | null | undefined; changelog?: string | null | undefined; patchText?: string | null | undefined; baseVersion?: number | null | undefined; }
```

### `StateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; reason: string | null; atVersion: number; }
```

### `NewStateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; atVersion: number; reason?: string | null | undefined; }
```

### `Approval`

```typescript
{ timestamp: number; id: string; documentId: string; reason: string | null; atVersion: number; reviewerId: string; status: string; bftF: number; sigHex: string | null; canonicalPayload: string | null; chainHash: string | null; prevChainHash: string | null; }
```

### `NewApproval`

```typescript
{ timestamp: number; id: string; documentId: string; atVersion: number; reviewerId: string; status: string; reason?: string | null | undefined; bftF?: number | undefined; sigHex?: string | null | undefined; canonicalPayload?: string | null | undefined; chainHash?: string | null | undefined; prevChainHash?: string | null | undefined; }
```

### `Contributor`

```typescript
{ id: string; agentId: string; documentId: string; versionsAuthored: number; totalTokensAdded: number; totalTokensRemoved: number; netTokens: number; firstContribution: number; lastContribution: number; sectionsModified: string; displayName: string | null; }
```

### `NewContributor`

```typescript
{ id: string; agentId: string; documentId: string; firstContribution: number; lastContribution: number; versionsAuthored?: number | undefined; totalTokensAdded?: number | undefined; totalTokensRemoved?: number | undefined; netTokens?: number | undefined; sectionsModified?: string | undefined; displayName?: string | null | undefined; }
```

### `SignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; accessCount: number; lastAccessedAt: number | null; documentId: string; conversationId: string; orgId: string | null; signature: string; signatureLength: number; revoked: boolean; }
```

### `NewSignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; documentId: string; conversationId: string; signature: string; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; orgId?: string | null | undefined; signatureLength?: number | undefined; revoked?: boolean | undefined; }
```

### `VersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; changelog: string; sectionsModified: string; authorId: string; addedLines: number; removedLines: number; addedTokens: number; removedTokens: number; }
```

### `NewVersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; authorId: string; changelog?: string | undefined; sectionsModified?: string | undefined; addedLines?: number | undefined; removedLines?: number | undefined; addedTokens?: number | undefined; removedTokens?: number | undefined; }
```

### `ApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; expiresAt: number | null; userId: string; revoked: boolean; keyHash: string; keyPrefix: string; scopes: string; lastUsedAt: number | null; }
```

### `NewApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; userId: string; keyHash: string; keyPrefix: string; expiresAt?: number | null | undefined; revoked?: boolean | undefined; scopes?: string | undefined; lastUsedAt?: number | null | undefined; }
```

### `AuditLog`

```typescript
{ timestamp: number; id: string; agentId: string | null; userId: string | null; ipAddress: string | null; userAgent: string | null; action: string; resourceType: string; resourceId: string | null; details: string | null; requestId: string | null; method: string | null; path: string | null; statusCode: number | null; }
```

### `NewAuditLog`

```typescript
{ timestamp: number; id: string; action: string; resourceType: string; agentId?: string | null | undefined; userId?: string | null | undefined; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; resourceId?: string | null | undefined; details?: string | null | undefined; requestId?: string | null | undefined; method?: string | null | undefined; path?: string | null | undefined; statusCode?: number | null | undefined; }
```

### `DocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `NewDocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `Organization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `NewOrganization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `OrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `NewOrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `DocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `NewDocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `PendingInvite`

```typescript
{ id: string; email: string; createdAt: number; expiresAt: number | null; documentId: string; role: string; invitedBy: string; }
```

### `NewPendingInvite`

```typescript
{ id: string; email: string; createdAt: number; documentId: string; role: string; invitedBy: string; expiresAt?: number | null | undefined; }
```

### `Webhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events: string; documentSlug: string | null; active: boolean; failureCount: number; lastDeliveryAt: number | null; lastSuccessAt: number | null; }
```

### `NewWebhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events?: string | undefined; documentSlug?: string | null | undefined; active?: boolean | undefined; failureCount?: number | undefined; lastDeliveryAt?: number | null | undefined; lastSuccessAt?: number | null | undefined; }
```

### `DocumentLink`

```typescript
{ id: string; createdAt: number; createdBy: string | null; sourceDocId: string; targetDocId: string; linkType: string; label: string | null; }
```

### `NewDocumentLink`

```typescript
{ id: string; createdAt: number; sourceDocId: string; targetDocId: string; linkType: string; createdBy?: string | null | undefined; label?: string | null | undefined; }
```

### `Collection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility: string; description: string | null; }
```

### `NewCollection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility?: string | undefined; description?: string | null | undefined; }
```

### `CollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position: number; addedBy: string | null; }
```

### `NewCollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position?: number | undefined; addedBy?: string | null | undefined; }
```

### `SectionCrdtState`

```typescript
{ updatedAt: Date; documentId: string; sectionId: string; clock: number; yrsState: Buffer<ArrayBufferLike>; }
```

### `NewSectionCrdtState`

```typescript
{ documentId: string; sectionId: string; yrsState: Buffer<ArrayBufferLike>; updatedAt?: Date | undefined; clock?: number | undefined; }
```

### `SectionCrdtUpdate`

```typescript
{ id: string; createdAt: Date; documentId: string; sectionId: string; updateBlob: Buffer<ArrayBufferLike>; clientId: string; seq: bigint; }
```

### `NewSectionCrdtUpdate`

```typescript
{ documentId: string; sectionId: string; updateBlob: Buffer<ArrayBufferLike>; clientId: string; seq: bigint; id?: string | undefined; createdAt?: Date | undefined; }
```

### `DocumentEvent`

```typescript
{ id: string; createdAt: Date; documentId: string; seq: bigint; eventType: string; actorId: string; payloadJson: unknown; idempotencyKey: string | null; prevHash: Buffer<ArrayBufferLike> | null; }
```

### `NewDocumentEvent`

```typescript
{ documentId: string; seq: bigint; eventType: string; actorId: string; id?: string | undefined; createdAt?: Date | undefined; payloadJson?: unknown; idempotencyKey?: string | null | undefined; prevHash?: Buffer<ArrayBufferLike> | null | undefined; }
```

### `AgentPubkey`

```typescript
{ id: string; createdAt: Date; agentId: string; pubkey: Buffer<ArrayBufferLike>; revokedAt: Date | null; }
```

### `NewAgentPubkey`

```typescript
{ agentId: string; pubkey: Buffer<ArrayBufferLike>; id?: string | undefined; createdAt?: Date | undefined; revokedAt?: Date | null | undefined; }
```

### `AgentSignatureNonce`

```typescript
{ agentId: string; nonce: string; firstSeen: Date; }
```

### `NewAgentSignatureNonce`

```typescript
{ agentId: string; nonce: string; firstSeen?: Date | undefined; }
```

### `SectionLease`

```typescript
{ id: string; expiresAt: Date; reason: string | null; sectionId: string; docId: string; holderAgentId: string; acquiredAt: Date; }
```

### `NewSectionLease`

```typescript
{ expiresAt: Date; sectionId: string; docId: string; holderAgentId: string; id?: string | undefined; reason?: string | null | undefined; acquiredAt?: Date | undefined; }
```

### `AgentInboxMessage`

```typescript
{ id: string; expiresAt: number; nonce: string; toAgentId: string; fromAgentId: string; envelopeJson: unknown; receivedAt: number; read: boolean; }
```

### `NewAgentInboxMessage`

```typescript
{ expiresAt: number; nonce: string; toAgentId: string; fromAgentId: string; receivedAt: number; id?: string | undefined; envelopeJson?: unknown; read?: boolean | undefined; }
```

### `SectionEmbedding`

```typescript
{ id: string; contentHash: string; documentId: string; sectionSlug: string; sectionTitle: string; provider: string; model: string; embedding: string | null; computedAt: number; }
```

### `NewSectionEmbedding`

```typescript
{ contentHash: string; documentId: string; computedAt: number; id?: string | undefined; sectionSlug?: string | undefined; sectionTitle?: string | undefined; provider?: string | undefined; model?: string | undefined; embedding?: string | null | undefined; }
```

### `InsertUser`

```typescript
{ id: string; email: string; createdAt: Date; updatedAt: Date; name?: string | undefined; emailVerified?: boolean | undefined; image?: string | null | undefined; isAnonymous?: boolean | null | undefined; agentId?: string | null | undefined; expiresAt?: number | null | undefined; }
```

### `SelectUser`

```typescript
{ id: string; name: string; email: string; emailVerified: boolean; image: string | null; createdAt: Date; updatedAt: Date; isAnonymous: boolean | null; agentId: string | null; expiresAt: number | null; }
```

### `InsertSession`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; }
```

### `SelectSession`

```typescript
{ id: string; createdAt: Date; updatedAt: Date; expiresAt: Date; userId: string; token: string; ipAddress: string | null; userAgent: string | null; }
```

### `InsertDocument`

```typescript
{ id: string; createdAt: number; slug: string; format: string; contentHash: string; originalSize: number; compressedSize: number; isAnonymous?: boolean | undefined; expiresAt?: number | null | undefined; compressedData?: Buffer<ArrayBufferLike> | null | undefined; tokenCount?: number | null | undefined; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; state?: string | undefined; ownerId?: string | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; currentVersion?: number | undefined; versionCount?: number | undefined; sharingMode?: string | undefined; approvalRequiredCount?: number | undefined; approvalRequireUnanimous?: boolean | undefined; approvalAllowedReviewers?: string | undefined; approvalTimeoutMs?: number | undefined; visibility?: string | undefined; eventSeqCounter?: bigint | undefined; bftF?: number | undefined; }
```

### `SelectDocument`

```typescript
{ id: string; createdAt: number; isAnonymous: boolean; expiresAt: number | null; slug: string; format: string; contentHash: string; compressedData: Buffer<ArrayBufferLike> | null; originalSize: number; compressedSize: number; tokenCount: number | null; accessCount: number; lastAccessedAt: number | null; state: string; ownerId: string | null; storageType: string; storageKey: string | null; currentVersion: number; versionCount: number; sharingMode: string; approvalRequiredCount: number; approvalRequireUnanimous: boolean; approvalAllowedReviewers: string; approvalTimeoutMs: number; visibility: string; eventSeqCounter: bigint; bftF: number; }
```

### `InsertVersion`

```typescript
{ id: string; createdAt: number; contentHash: string; documentId: string; versionNumber: number; compressedData?: Buffer<ArrayBufferLike> | null | undefined; tokenCount?: number | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; createdBy?: string | null | undefined; changelog?: string | null | undefined; patchText?: string | null | undefined; baseVersion?: number | null | undefined; }
```

### `SelectVersion`

```typescript
{ id: string; createdAt: number; contentHash: string; compressedData: Buffer<ArrayBufferLike> | null; tokenCount: number | null; storageType: string; storageKey: string | null; documentId: string; versionNumber: number; createdBy: string | null; changelog: string | null; patchText: string | null; baseVersion: number | null; }
```

### `InsertStateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; atVersion: number; reason?: string | null | undefined; }
```

### `SelectStateTransition`

```typescript
{ id: string; documentId: string; fromState: string; toState: string; changedBy: string; changedAt: number; reason: string | null; atVersion: number; }
```

### `InsertApproval`

```typescript
{ timestamp: number; id: string; documentId: string; atVersion: number; reviewerId: string; status: string; reason?: string | null | undefined; bftF?: number | undefined; sigHex?: string | null | undefined; canonicalPayload?: string | null | undefined; chainHash?: string | null | undefined; prevChainHash?: string | null | undefined; }
```

### `SelectApproval`

```typescript
{ timestamp: number; id: string; documentId: string; reason: string | null; atVersion: number; reviewerId: string; status: string; bftF: number; sigHex: string | null; canonicalPayload: string | null; chainHash: string | null; prevChainHash: string | null; }
```

### `InsertContributor`

```typescript
{ id: string; agentId: string; documentId: string; firstContribution: number; lastContribution: number; versionsAuthored?: number | undefined; totalTokensAdded?: number | undefined; totalTokensRemoved?: number | undefined; netTokens?: number | undefined; sectionsModified?: string | undefined; displayName?: string | null | undefined; }
```

### `SelectContributor`

```typescript
{ id: string; agentId: string; documentId: string; versionsAuthored: number; totalTokensAdded: number; totalTokensRemoved: number; netTokens: number; firstContribution: number; lastContribution: number; sectionsModified: string; displayName: string | null; }
```

### `InsertSignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; documentId: string; conversationId: string; signature: string; accessCount?: number | undefined; lastAccessedAt?: number | null | undefined; orgId?: string | null | undefined; signatureLength?: number | undefined; revoked?: boolean | undefined; }
```

### `SelectSignedUrlToken`

```typescript
{ id: string; createdAt: number; agentId: string; expiresAt: number; slug: string; accessCount: number; lastAccessedAt: number | null; documentId: string; conversationId: string; orgId: string | null; signature: string; signatureLength: number; revoked: boolean; }
```

### `InsertVersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; authorId: string; changelog?: string | undefined; sectionsModified?: string | undefined; addedLines?: number | undefined; removedLines?: number | undefined; addedTokens?: number | undefined; removedTokens?: number | undefined; }
```

### `SelectVersionAttribution`

```typescript
{ id: string; createdAt: number; documentId: string; versionNumber: number; changelog: string; sectionsModified: string; authorId: string; addedLines: number; removedLines: number; addedTokens: number; removedTokens: number; }
```

### `InsertApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; userId: string; keyHash: string; keyPrefix: string; expiresAt?: number | null | undefined; revoked?: boolean | undefined; scopes?: string | undefined; lastUsedAt?: number | null | undefined; }
```

### `SelectApiKey`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; expiresAt: number | null; userId: string; revoked: boolean; keyHash: string; keyPrefix: string; scopes: string; lastUsedAt: number | null; }
```

### `InsertAuditLog`

```typescript
{ timestamp: number; id: string; action: string; resourceType: string; agentId?: string | null | undefined; userId?: string | null | undefined; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; resourceId?: string | null | undefined; details?: string | null | undefined; requestId?: string | null | undefined; method?: string | null | undefined; path?: string | null | undefined; statusCode?: number | null | undefined; }
```

### `SelectAuditLog`

```typescript
{ timestamp: number; id: string; agentId: string | null; userId: string | null; ipAddress: string | null; userAgent: string | null; action: string; resourceType: string; resourceId: string | null; details: string | null; requestId: string | null; method: string | null; path: string | null; statusCode: number | null; }
```

### `InsertDocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `SelectDocumentRole`

```typescript
{ id: string; userId: string; documentId: string; role: string; grantedBy: string; grantedAt: number; }
```

### `InsertOrganization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `SelectOrganization`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; createdBy: string; }
```

### `InsertOrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `SelectOrgMember`

```typescript
{ id: string; userId: string; orgId: string; role: string; joinedAt: number; }
```

### `InsertDocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `SelectDocumentOrg`

```typescript
{ id: string; documentId: string; orgId: string; addedAt: number; }
```

### `InsertPendingInvite`

```typescript
{ id: string; email: string; createdAt: number; documentId: string; role: string; invitedBy: string; expiresAt?: number | null | undefined; }
```

### `SelectPendingInvite`

```typescript
{ id: string; email: string; createdAt: number; expiresAt: number | null; documentId: string; role: string; invitedBy: string; }
```

### `InsertWebhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events?: string | undefined; documentSlug?: string | null | undefined; active?: boolean | undefined; failureCount?: number | undefined; lastDeliveryAt?: number | null | undefined; lastSuccessAt?: number | null | undefined; }
```

### `SelectWebhook`

```typescript
{ id: string; createdAt: number; userId: string; url: string; secret: string; events: string; documentSlug: string | null; active: boolean; failureCount: number; lastDeliveryAt: number | null; lastSuccessAt: number | null; }
```

### `InsertDocumentLink`

```typescript
{ id: string; createdAt: number; sourceDocId: string; targetDocId: string; linkType: string; createdBy?: string | null | undefined; label?: string | null | undefined; }
```

### `SelectDocumentLink`

```typescript
{ id: string; createdAt: number; createdBy: string | null; sourceDocId: string; targetDocId: string; linkType: string; label: string | null; }
```

### `InsertCollection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility?: string | undefined; description?: string | null | undefined; }
```

### `SelectCollection`

```typescript
{ id: string; name: string; createdAt: number; updatedAt: number; slug: string; ownerId: string; visibility: string; description: string | null; }
```

### `InsertCollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position?: number | undefined; addedBy?: string | null | undefined; }
```

### `SelectCollectionDocument`

```typescript
{ id: string; documentId: string; addedAt: number; collectionId: string; position: number; addedBy: string | null; }
```

### `InsertSectionCrdtState`

```typescript
{ documentId: string; sectionId: string; yrsState: Buffer<ArrayBufferLike>; updatedAt?: Date | undefined; clock?: number | undefined; }
```

### `SelectSectionCrdtState`

```typescript
{ updatedAt: Date; documentId: string; sectionId: string; clock: number; yrsState: Buffer<ArrayBufferLike>; }
```

### `InsertSectionCrdtUpdate`

```typescript
{ documentId: string; sectionId: string; updateBlob: Buffer<ArrayBufferLike>; clientId: string; seq: bigint; id?: string | undefined; createdAt?: Date | undefined; }
```

### `SelectSectionCrdtUpdate`

```typescript
{ id: string; createdAt: Date; documentId: string; sectionId: string; updateBlob: Buffer<ArrayBufferLike>; clientId: string; seq: bigint; }
```

### `InsertDocumentEvent`

```typescript
{ documentId: string; seq: bigint; eventType: string; actorId: string; id?: string | undefined; createdAt?: Date | undefined; payloadJson?: any; idempotencyKey?: string | null | undefined; prevHash?: Buffer<ArrayBufferLike> | null | undefined; }
```

### `SelectDocumentEvent`

```typescript
{ id: string; createdAt: Date; documentId: string; seq: bigint; eventType: string; actorId: string; idempotencyKey: string | null; prevHash: Buffer<ArrayBufferLike> | null; payloadJson?: any; }
```

### `InsertAgentPubkey`

```typescript
{ agentId: string; pubkey: Buffer<ArrayBufferLike>; id?: string | undefined; createdAt?: Date | undefined; revokedAt?: Date | null | undefined; }
```

### `SelectAgentPubkey`

```typescript
{ id: string; createdAt: Date; agentId: string; pubkey: Buffer<ArrayBufferLike>; revokedAt: Date | null; }
```

### `InsertAgentSignatureNonce`

```typescript
{ agentId: string; nonce: string; firstSeen?: Date | undefined; }
```

### `SelectAgentSignatureNonce`

```typescript
{ agentId: string; nonce: string; firstSeen: Date; }
```

### `DocumentEventLogType`

```typescript
"document.created" | "version.published" | "lifecycle.transitioned" | "approval.submitted" | "approval.rejected" | "section.edited" | "event.compacted" | "bft.approval_submitted" | "bft.byzantine_slash" | "bft.quorum_reached"
```

### `AppendDocumentEventInput`

```typescript
AppendDocumentEventInput
```

**Members:**

- `documentId` — FK → documents.slug (the public-facing identifier).
- `eventType`
- `actorId` — Actor/user/agent that triggered this event.
- `payloadJson` — Event-specific payload. Must be JSON-serialisable.
- `idempotencyKey` — Optional idempotency key from the Idempotency-Key request header.

### `AppendDocumentEventRow`

```typescript
AppendDocumentEventRow
```

**Members:**

- `id`
- `documentId`
- `seq`
- `eventType`
- `actorId`
- `payloadJson`
- `idempotencyKey`
- `createdAt`
- `prevHash`

### `AppendDocumentEventResult`

```typescript
AppendDocumentEventResult
```

**Members:**

- `event` — The inserted (or pre-existing) event row.
- `duplicated` — true when the idempotency key matched an existing row; no insert occurred.

### `ChainValidationResult`

```typescript
ChainValidationResult
```

**Members:**

- `valid`
- `checkedRows`
- `firstBrokenSeq`
- `error`

### `DocumentEventRow`

```typescript
DocumentEventRow
```

**Members:**

- `id`
- `documentId`
- `seq`
- `eventType`
- `actorId`
- `payloadJson`
- `idempotencyKey`
- `createdAt`

### `SectionDelta`

```typescript
SectionDelta
```

**Members:**

- `added`
- `modified`
- `deleted`
- `fromSeq`
- `toSeq`

### `EmbeddingProvider`

```typescript
EmbeddingProvider
```

**Members:**

- `embed` — Batch-embed an array of texts. Returns one vector per input text.
- `dimensions` — Dimensionality of produced vectors.
- `model` — Model name for logging/observability.

### `PresenceEntry`

```typescript
PresenceEntry
```

**Members:**

- `section`
- `cursorOffset`
- `lastSeen`

### `PresenceRecord`

```typescript
PresenceRecord
```

**Members:**

- `agentId`
- `section`
- `cursorOffset`
- `lastSeen`

### `PersistResult`

```typescript
PersistResult
```

**Members:**

- `seq`
- `newState`

### `Lease`

```typescript
Lease
```

**Members:**

- `id`
- `docId`
- `sectionId`
- `holderAgentId`
- `acquiredAt`
- `expiresAt`
- `reason`

### `ScratchpadMessage`

```typescript
ScratchpadMessage
```

**Members:**

- `id` — Server-assigned stream message ID (e.g. "1700000000000-0").
- `agentId` — Agent identifier of the sender.
- `content` — Message content body.
- `contentType` — MIME content type (default: "text/plain").
- `threadId` — Optional thread identifier for reply chains.
- `sigHex` — Optional Ed25519 signature over canonical message bytes.
- `timestampMs` — Unix ms timestamp of the message.

### `PublishOptions`

```typescript
PublishOptions
```

**Members:**

- `agentId`
- `content`
- `contentType`
- `threadId`
- `sigHex`

### `ReadOptions`

```typescript
ReadOptions
```

**Members:**

- `threadId` — Only return messages in this thread.
- `lastId` — Return messages after this stream ID (exclusive).
- `limit` — Maximum number of messages to return. Default 100.

### `TestDbContext`

```typescript
TestDbContext
```

**Members:**

- `db`
- `sqlite`
- `provider` — Provider in use for this context.
- `cleanup` — Cleanup — drops the test schema (PG) or closes the connection (SQLite).

## Classes

### `OpenAIEmbeddingProvider`

OpenAI `text-embedding-3-small` provider.  Handles: - Batching (≤ 2 048 inputs per request) - Exponential back-off on 429 / 5xx responses - Result reordering by the index returned in the API response

```typescript
typeof OpenAIEmbeddingProvider
```

**Members:**

- `dimensions`
- `model`
- `embed`
- `embedBatch`

### `LocalEmbeddingProvider`

Lightweight TF-IDF vectorizer for offline / dev use.  Delegates to `crates/llmtxt-core::tfidf::tfidf_embed_batch_wasm` via the `llmtxt` WASM binding (audit item #15 fix). The algorithm is identical to the previous TypeScript implementation: 1. Tokenise into lowercase word unigrams + bigrams. 2. Build global vocabulary, compute TF, IDF (smooth), project via FNV-1a. 3. L2-normalise.  This is intentionally approximate — sufficient for testing and development, NOT a replacement for neural embeddings in production.

```typescript
typeof LocalEmbeddingProvider
```

**Members:**

- `dimensions`
- `model`
- `embed`

### `PresenceRegistry`

```typescript
typeof PresenceRegistry
```

**Members:**

- `registry` — MapdocId, MapagentId, PresenceEntry
- `upsert` — Upsert (insert or update) a presence entry. Sets lastSeen = Date.now().
- `expire` — Remove entries older than TTL_MS from the registry. Accepts an optional `now` timestamp for testing with fake timers.
- `getByDoc` — Get all active presence records for a document, sorted by lastSeen descending.

## Constants

### `users`

Users table - supports both anonymous (24hr TTL) and registered accounts.  Anonymous users get a generated ID and no credentials. They are auto-purged after `expiresAt`. Registered users provide email/password and persist indefinitely until explicitly deleted.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "users"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; email: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; emailVerified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; image: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; isAnonymous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: number; notNull: false; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `sessions`

Sessions table - server-side session tokens for both user types.  Anonymous users get a session on first document creation. Registered users get a session on login. Sessions are invalidated on logout or expiration.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "sessions"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; token: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ipAddress: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userAgent: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `accounts`

Accounts table — better-auth manages OAuth and credential providers.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "accounts"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accountId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; providerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessToken: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; refreshToken: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessTokenExpiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; refreshTokenExpiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; scope: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; idToken: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; password: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `verifications`

Verifications table — better-auth email verification and password reset tokens.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "verifications"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "verifications"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; identifier: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "verifications"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; value: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "verifications"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "verifications"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "verifications"; dataType: "object date"; data: Date; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "verifications"; dataType: "object date"; data: Date; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `documents`

Documents table - stores compressed text documents.  Extended with lifecycle state, ownership, anonymous flag, storage mode, version tracking, and approval policy to support the full SDK feature set (lifecycle, consensus, versioning, signed URLs).

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "documents"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; format: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; originalSize: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedSize: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastAccessedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; state: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ownerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; isAnonymous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; currentVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sharingMode: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalRequiredCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalRequireUnanimous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalAllowedReviewers: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalTimeoutMs: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `versions`

Versions table - tracks document version history with patch support.  Extended with patchText for incremental storage (SDK VersionEntry), storage mode, and base version reference for patch chains.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "versions"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; patchText: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; baseVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `stateTransitions`

State transitions table - audit trail for document lifecycle changes.  Maps directly to the SDK StateTransition interface. Every call to `LlmtxtDocument.transition()` inserts a row here.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "state_transitions"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; fromState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `approvals`

Approvals table - stores individual review/approval records.  Maps directly to the SDK Review interface from consensus.ts. Each row is one review action; the latest per reviewer wins.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "approvals"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reviewerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; status: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `contributors`

Contributors table - materialized aggregation of per-agent attribution.  Maps directly to the SDK ContributorSummary interface. Denormalized from version + attribution data for fast reads. Refreshed on each version creation via application logic.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "contributors"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionsAuthored: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; totalTokensAdded: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; totalTokensRemoved: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; netTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; firstContribution: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastContribution: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionsModified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; displayName: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `signedUrlTokens`

Signed URL tokens table - persists generated signed URL grants.  Maps to the SDK SignedUrlParams interface. Each row represents an active access grant. Expired tokens are cleaned up by the purge job. Supports both conversation-scoped and org-scoped signatures.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "signed_url_tokens"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; conversationId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; signature: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; signatureLength: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revoked: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastAccessedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `apiKeys`

API keys table - programmatic access tokens for registered users.  Keys are generated once and the raw value is never stored. Only the SHA-256 hash is persisted. The `keyPrefix` stores "llmtxt_" + first 8 chars of the random part for display purposes.  Revocation is soft (revoked=true); rows are never hard-deleted so audit trails are preserved.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "api_keys"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; keyHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; keyPrefix: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; scopes: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastUsedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revoked: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `versionAttributions`

Version attributions table - per-version diff metadata for attribution.  Maps directly to the SDK VersionAttribution interface. Stores the computed diff stats (lines/tokens added/removed, sections modified) for each version, enabling fast attribution queries without recomputing diffs.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "version_attributions"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; authorId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedLines: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; removedLines: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; removedTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionsModified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `auditLogs`

Audit logs table - records all state-changing operations for compliance and forensic investigation. Every successful mutating request (POST/PUT/DELETE) should produce an audit log row.  Growth management: - Four targeted indexes support the most common query patterns (by user, by   action type, by resource, and by timestamp range) without excessive index   overhead for an append-only table. - Old rows should be periodically archived or purged via a background job   (not yet implemented; tracked as a future operational task).

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "audit_logs"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ipAddress: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userAgent: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; action: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resourceType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resourceId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; details: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; requestId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; method: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; path: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; statusCode: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `documentRoles`

Document-level role assignments.  One row per (document, user) pair. The ownerId on the documents table is the source of truth for the 'owner' role; explicit role rows are for 'editor' and 'viewer' grants (and can optionally mirror owner).  Roles: 'owner' | 'editor' | 'viewer'

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "document_roles"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; grantedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; grantedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `documentLinks`

Document links table - directional relationships between documents. Supports typed relationships: references, depends_on, derived_from, supersedes, related. Links are used to build cross-document knowledge graphs and dependency chains.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "document_links"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sourceDocId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; targetDocId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; linkType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; label: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `organizations`

Organizations table — optional grouping of users for shared document access.  Documents can be associated with one or more organizations via documentOrgs. Members of the organization inherit access based on their org role.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "organizations"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `collections`

Collections table - named, ordered groupings of documents. Allows users to curate sets of related documents (e.g., a spec + design + implementation + test plan) and export them as a single concatenated context for agent consumption.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "collections"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; description: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ownerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `orgMembers`

Org members table — maps users to organizations with a role.  Roles: 'admin' | 'member' | 'viewer' Admin: can manage org membership and associate documents. Member: can read/write org-associated documents (per doc visibility). Viewer: read-only access to org documents.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "org_members"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; joinedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `documentOrgs`

Document-org association table — links a document to an organization.  When a document has visibility='org', all members of associated organizations gain access according to their org role.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "document_orgs"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `pendingInvites`

Pending invites table — holds invite-by-email records for users who do not yet have an account. On sign-up the invite is resolved and converted to a documentRoles row.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "pending_invites"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; email: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; invitedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `webhooks`

Webhooks table - stores external HTTP callback registrations. When a matching document event fires, the delivery worker POSTs the event payload to `url` with an HMAC-SHA256 signature in the X-LLMtxt-Signature header. Webhooks are automatically disabled after 10 consecutive delivery failures.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "webhooks"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; url: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; secret: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; events: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentSlug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; active: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; failureCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastDeliveryAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastSuccessAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `collectionDocuments`

Collection documents table - ordered membership list. Each row maps a document into a collection with a position for ordering. The position is used for export order and display order.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "collection_documents"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; collectionId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; position: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `sectionCrdtStates`

SQLite mirror of section_crdt_states. bytea → blob('bytes'), timestamptz → integer (unix ms), composite PK via primaryKey.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "section_crdt_states"; schema: undefined; columns: { documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; clock: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: true; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; yrsState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "object buffer"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `sectionCrdtUpdates`

SQLite mirror of section_crdt_updates.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "section_crdt_updates"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updateBlob: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "object buffer"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; clientId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; seq: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: true; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `documentEvents`

SQLite mirror of document_events. jsonb → text with  mode: 'json' , bytea → blob('bytes').

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "document_events"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; seq: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; eventType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; actorId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; payloadJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "object json"; data: unknown; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; idempotencyKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: true; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; prevHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "object buffer"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `agentPubkeys`

SQLite mirror of agent_pubkeys.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "agent_pubkeys"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; pubkey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "object buffer"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: true; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revokedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `agentSignatureNonces`

SQLite mirror of agent_signature_nonces.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "agent_signature_nonces"; schema: undefined; columns: { nonce: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; firstSeen: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_signature_nonces"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: true; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `insertUserSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; email: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; emailVerified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; image: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; isAnonymous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: number; notNull: false; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectUserSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; email: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; emailVerified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; image: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; isAnonymous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: number; notNull: false; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "users"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertSessionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; token: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ipAddress: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userAgent: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectSessionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; token: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ipAddress: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userAgent: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; format: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; originalSize: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedSize: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastAccessedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; state: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ownerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; isAnonymous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; currentVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sharingMode: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalRequiredCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalRequireUnanimous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalAllowedReviewers: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalTimeoutMs: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; format: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; originalSize: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedSize: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastAccessedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; state: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ownerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; isAnonymous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; currentVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sharingMode: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalRequiredCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalRequireUnanimous: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalAllowedReviewers: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalTimeoutMs: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertVersionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; patchText: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; baseVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectVersionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; patchText: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; baseVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertStateTransitionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; fromState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectStateTransitionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; fromState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertApprovalSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reviewerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; status: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectApprovalSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reviewerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; status: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertContributorSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionsAuthored: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; totalTokensAdded: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; totalTokensRemoved: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; netTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; firstContribution: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastContribution: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionsModified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; displayName: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectContributorSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionsAuthored: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; totalTokensAdded: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; totalTokensRemoved: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; netTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; firstContribution: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastContribution: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionsModified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; displayName: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertSignedUrlTokenSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; conversationId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; signature: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; signatureLength: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revoked: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastAccessedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectSignedUrlTokenSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; conversationId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; signature: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; signatureLength: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revoked: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; accessCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastAccessedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertVersionAttributionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; authorId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedLines: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; removedLines: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; removedTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionsModified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectVersionAttributionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; authorId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedLines: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; removedLines: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; removedTokens: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionsModified: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertApiKeySchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; keyHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; keyPrefix: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; scopes: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastUsedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revoked: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectApiKeySchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; keyHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; keyPrefix: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; scopes: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastUsedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revoked: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertAuditLogSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ipAddress: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userAgent: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; action: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resourceType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resourceId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; details: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; requestId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; method: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; path: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; statusCode: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectAuditLogSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ipAddress: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userAgent: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; action: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resourceType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resourceId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; details: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; requestId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; method: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; path: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; statusCode: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertDocumentRoleSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; grantedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; grantedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectDocumentRoleSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; grantedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; grantedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_roles"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertOrganizationSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectOrganizationSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertOrgMemberSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; joinedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectOrgMemberSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; joinedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "org_members"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertDocumentOrgSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectDocumentOrgSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; orgId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_orgs"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertPendingInviteSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; email: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; invitedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectPendingInviteSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; email: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; role: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; invitedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertWebhookSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; url: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; secret: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; events: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentSlug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; active: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; failureCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastDeliveryAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastSuccessAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectWebhookSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; userId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; url: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; secret: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; events: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentSlug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; active: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "boolean"; data: boolean; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; failureCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastDeliveryAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; lastSuccessAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertDocumentLinkSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sourceDocId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; targetDocId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; linkType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; label: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectDocumentLinkSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sourceDocId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; targetDocId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; linkType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; label: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_links"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertCollectionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; description: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ownerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectCollectionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; name: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; description: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; ownerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `insertCollectionDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; collectionId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; position: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `selectCollectionDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; collectionId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; position: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; addedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined>
```

### `users`

Users table - supports both anonymous (24hr TTL) and registered accounts.  Anonymous users get a generated ID and no credentials. They are auto-purged after `expiresAt`. Registered users provide email/password and persist indefinitely until explicitly deleted.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "users"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; email: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; emailVerified: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; image: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; isAnonymous: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").PgBooleanBuilder>, { name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: false; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | null | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "users"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }; dialect: "pg"; }>
```

### `sessions`

Sessions table - server-side session tokens for both user types.  Anonymous users get a session on first document creation. Registered users get a session on login. Sessions are invalidated on logout or expiration.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "sessions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; token: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; ipAddress: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; userAgent: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; }; dialect: "pg"; }>
```

### `accounts`

Accounts table — better-auth manages OAuth and credential providers.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "accounts"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; accountId: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; providerId: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; accessToken: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; refreshToken: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; accessTokenExpiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").PgTimestampBuilder, { name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | null | undefined; }>; refreshTokenExpiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").PgTimestampBuilder, { name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | null | undefined; }>; scope: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; idToken: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; password: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "accounts"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"accounts", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "accounts"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; }; dialect: "pg"; }>
```

### `verifications`

Verifications table — better-auth email verification and password reset tokens.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "verifications"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"verifications", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "verifications"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; identifier: import("drizzle-orm/pg-core").PgBuildColumn<"verifications", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "verifications"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; value: import("drizzle-orm/pg-core").PgBuildColumn<"verifications", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "verifications"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"verifications", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "verifications"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"verifications", import("drizzle-orm/pg-core").PgTimestampBuilder, { name: string; tableName: "verifications"; dataType: "object date"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | null | undefined; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"verifications", import("drizzle-orm/pg-core").PgTimestampBuilder, { name: string; tableName: "verifications"; dataType: "object date"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | null | undefined; }>; }; dialect: "pg"; }>
```

### `documents`

Documents table - stores compressed text documents.  Extended with lifecycle state, ownership, anonymous flag, storage mode, version tracking, and approval policy to support the full SDK feature set (lifecycle, consensus, versioning, signed URLs).

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "documents"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; format: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; contentHash: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; compressedData: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "documents"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; originalSize: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; compressedSize: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; tokenCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; accessCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastAccessedAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; state: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; ownerId: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; isAnonymous: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; storageType: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; storageKey: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; currentVersion: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; versionCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; sharingMode: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; approvalRequiredCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; approvalRequireUnanimous: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; approvalAllowedReviewers: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; approvalTimeoutMs: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>>, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; visibility: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; eventSeqCounter: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>>, { name: string; tableName: "documents"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint | undefined; }>; bftF: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; }; dialect: "pg"; }>
```

### `versions`

Versions table - tracks document version history with patch support.  Extended with patchText for incremental storage (SDK VersionEntry), storage mode, and base version reference for patch chains.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "versions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionNumber: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; compressedData: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "versions"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; contentHash: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; tokenCount: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; changelog: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; patchText: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; baseVersion: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; storageType: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; storageKey: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; }; dialect: "pg"; }>
```

### `stateTransitions`

State transitions table - audit trail for document lifecycle changes.  Maps directly to the SDK StateTransition interface. Every call to `LlmtxtDocument.transition()` inserts a row here.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "state_transitions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; fromState: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; toState: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; changedBy: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; changedAt: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; reason: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; atVersion: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "state_transitions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `approvals`

Approvals table - stores individual review/approval records.  Maps directly to the SDK Review interface from consensus.ts. Each row is one review action; the latest per reviewer wins.  W3/T251 extensions:   - sig_hex: Ed25519 signature over canonical_payload (128-char hex)   - canonical_payload: the exact bytes that were signed (for audit/replay)   - chain_hash: SHA-256 hash chaining this approval to the previous one   - prev_chain_hash: hash of the previous approval in the chain   - bft_f: per-document BFT fault tolerance f at time of approval

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "approvals"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; reviewerId: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; status: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; timestamp: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; reason: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; atVersion: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "approvals"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; sigHex: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; canonicalPayload: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; chainHash: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; prevChainHash: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; bftF: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "approvals"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; }; dialect: "pg"; }>
```

### `contributors`

Contributors table - materialized aggregation of per-agent attribution.  Maps directly to the SDK ContributorSummary interface. Denormalized from version + attribution data for fast reads. Refreshed on each version creation via application logic.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "contributors"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionsAuthored: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; totalTokensAdded: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; totalTokensRemoved: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; netTokens: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; firstContribution: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; lastContribution: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; sectionsModified: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; displayName: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; }; dialect: "pg"; }>
```

### `signedUrlTokens`

Signed URL tokens table - persists generated signed URL grants.  Maps to the SDK SignedUrlParams interface. Each row represents an active access grant. Expired tokens are cleaned up by the purge job. Supports both conversation-scoped and org-scoped signatures.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "signed_url_tokens"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; conversationId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; signature: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; signatureLength: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; revoked: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; accessCount: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastAccessedAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }; dialect: "pg"; }>
```

### `versionAttributions`

Version attributions table - per-version diff metadata for attribution.  Maps directly to the SDK VersionAttribution interface. Stores the computed diff stats (lines/tokens added/removed, sections modified) for each version, enabling fast attribution queries without recomputing diffs.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "version_attributions"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionNumber: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; authorId: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; addedLines: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; removedLines: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; addedTokens: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; removedTokens: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; sectionsModified: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; changelog: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `apiKeys`

API keys table - programmatic access tokens for registered users.  Keys are generated once and the raw value is never stored. Only the SHA-256 hash is persisted. The `keyPrefix` stores "llmtxt_" + first 8 chars of the random part for display purposes.  Revocation is soft (revoked=true); rows are never hard-deleted so audit trails are preserved.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "api_keys"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; keyHash: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; keyPrefix: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; scopes: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; lastUsedAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; revoked: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "api_keys"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `auditLogs`

Audit logs table - records all state-changing operations for compliance and forensic investigation. Every successful mutating request (POST/PUT/DELETE) should produce an audit log row.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "audit_logs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; ipAddress: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; userAgent: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; action: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; resourceType: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; resourceId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; details: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; timestamp: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; requestId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; method: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; path: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; statusCode: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "audit_logs"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }; dialect: "pg"; }>
```

### `documentRoles`

Document-level role assignments.  One row per (document, user) pair. The ownerId on the documents table is the source of truth for the 'owner' role; explicit role rows are for 'editor' and 'viewer' grants (and can optionally mirror owner).  Roles: 'owner' | 'editor' | 'viewer'

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "document_roles"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; grantedBy: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; grantedAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_roles"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `organizations`

Organizations table — optional grouping of users for shared document access.  Documents can be associated with one or more organizations via documentOrgs. Members of the organization inherit access based on their org role.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "organizations"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `orgMembers`

Org members table — maps users to organizations with a role.  Roles: 'admin' | 'member' | 'viewer' Admin: can manage org membership and associate documents. Member: can read/write org-associated documents (per doc visibility). Viewer: read-only access to org documents.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "org_members"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; joinedAt: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "org_members"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `documentOrgs`

Document-org association table — links a document to an organization.  When a document has visibility='org', all members of associated organizations gain access according to their org role.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "document_orgs"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; addedAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_orgs"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `pendingInvites`

Pending invites table — holds invite-by-email records for users who do not yet have an account. On sign-up the invite is resolved and converted to a documentRoles row.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "pending_invites"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; email: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; invitedBy: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }; dialect: "pg"; }>
```

### `webhooks`

Webhooks table - stores external HTTP callback registrations. When a matching document event fires, the delivery worker POSTs the event payload to `url` with an HMAC-SHA256 signature in the X-LLMtxt-Signature header. Webhooks are automatically disabled after 10 consecutive delivery failures.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "webhooks"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; url: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; secret: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; events: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentSlug: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; active: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "webhooks"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; failureCount: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "webhooks"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastDeliveryAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; lastSuccessAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `documentLinks`

Document links table - directional relationships between documents. Supports typed relationships: references, depends_on, derived_from, supersedes, related. Links are used to build cross-document knowledge graphs and dependency chains.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "document_links"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sourceDocId: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; targetDocId: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; linkType: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; label: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_links"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `collections`

Collections table - named, ordered groupings of documents. Allows users to curate sets of related documents (e.g., a spec + design + implementation + test plan) and export them as a single concatenated context for agent consumption.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "collections"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; description: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; ownerId: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; visibility: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `collectionDocuments`

Collection documents table - ordered membership list. Each row maps a document into a collection with a position for ordering. The position is used for export order and display order.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "collection_documents"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; collectionId: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; position: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "collection_documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; addedBy: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; addedAt: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `sectionCrdtStates`

Section CRDT states — consolidated Yjs state vector per (document, section).  Stores the full Yjs document state after applying all updates. Updated atomically when updates are compacted. FK references documents.slug (the public-facing identifier used in CRDT operations).

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "section_crdt_states"; schema: undefined; columns: { documentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; clock: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "section_crdt_states"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "section_crdt_states"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; yrsState: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "section_crdt_states"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; }; dialect: "pg"; }>
```

### `sectionCrdtUpdates`

Section CRDT updates — raw Yjs update messages pending compaction.  Each row is one Yjs update message from a client. Updates are compacted into section_crdt_states by a background job. FK on document_id alone (cascade alignment mirrors states table via document_id).

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "section_crdt_updates"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "section_crdt_updates"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; updateBlob: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "section_crdt_updates"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; clientId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; seq: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>, { name: string; tableName: "section_crdt_updates"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "section_crdt_updates"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; }; dialect: "pg"; }>
```

### `documentEvents`

Document events — append-only event log with hash chain for integrity.  Every significant operation on a document emits an event here. The prev_hash column links each event to its predecessor, forming a tamper-evident chain. The first event per document has prev_hash = NULL.  Partial unique index on (document_id, idempotency_key) WHERE idempotency_key IS NOT NULL is added via raw-SQL follow-up migration.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "document_events"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "document_events"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; seq: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>, { name: string; tableName: "document_events"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint; }>; eventType: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; actorId: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; payloadJson: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgJsonbBuilder>, { name: string; tableName: "document_events"; dataType: "object json"; data: unknown; driverParam: unknown; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: unknown; }>; idempotencyKey: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "document_events"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; prevHash: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "document_events"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; }; dialect: "pg"; }>
```

### `agentPubkeys`

Agent public keys — Ed25519 (or equivalent) pubkeys for agent signature verification. Each agent_id maps to exactly one active pubkey at a time. Revocation is soft: set revoked_at to the revocation timestamp.  CHECK constraint (octet_length(pubkey) = 32) is added via raw-SQL follow-up migration because Drizzle cannot express this in schema alone.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "agent_pubkeys"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "agent_pubkeys"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; pubkey: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "agent_pubkeys"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "agent_pubkeys"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; revokedAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").PgTimestampBuilder, { name: string; tableName: "agent_pubkeys"; dataType: "object date"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | null | undefined; }>; }; dialect: "pg"; }>
```

### `sectionLeases`

Section leases — advisory locks for section turn-taking.  Leases are cooperative signals only. The CRDT layer still accepts writes from non-holders; a 409 from POST /lease is a social signal, not a hard block. TTL is enforced server-side by the expiry background job.

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "section_leases"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"section_leases", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "section_leases"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; docId: import("drizzle-orm/pg-core").PgBuildColumn<"section_leases", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionId: import("drizzle-orm/pg-core").PgBuildColumn<"section_leases", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; holderAgentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_leases", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; acquiredAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_leases", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "section_leases"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_leases", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "section_leases"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; reason: import("drizzle-orm/pg-core").PgBuildColumn<"section_leases", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; }; dialect: "pg"; }>
```

### `agentSignatureNonces`

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "agent_signature_nonces"; schema: undefined; columns: { nonce: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; firstSeen: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "agent_signature_nonces"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; }; dialect: "pg"; }>
```

### `agentInboxMessages`

Agent inbox messages — ephemeral A2A message store.  Messages are stored for up to 48 hours. The recipient polls GET /api/v1/agents/:id/inbox or subscribes to SSE. Each message is a signed A2AMessage envelope (JSON).  Background job purges rows where expires_at  now().

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "agent_inbox_messages"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; toAgentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; fromAgentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; envelopeJson: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgJsonbBuilder>, { name: string; tableName: "agent_inbox_messages"; dataType: "object json"; data: unknown; driverParam: unknown; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: unknown; }>; nonce: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; receivedAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; read: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "agent_inbox_messages"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; }; dialect: "pg"; }>
```

### `sectionEmbeddings`

Cached per-section embeddings for nearest-neighbour search.  Schema exception: the `embedding` column uses a raw SQL type `vector(384)` because drizzle-orm does not (yet) ship a first-class pgvector column helper. We store the vector as a text column in Drizzle but rely on the raw SQL migration to create it as `vector(384)` so pgvector operators work.  For INSERT/SELECT we convert between `number[]` - JSON string in the embedding service layer (see src/jobs/embeddings.ts).

```typescript
import("drizzle-orm/pg-core").PgTableWithColumns<{ name: "section_embeddings"; schema: undefined; columns: { id: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "section_embeddings"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionSlug: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; sectionTitle: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; contentHash: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; provider: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; model: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; embedding: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; computedAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_embeddings", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "section_embeddings"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }; dialect: "pg"; }>
```

### `insertUserSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; email: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; emailVerified: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; image: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; isAnonymous: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").PgBooleanBuilder>, { name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: false; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | null | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "users"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `selectUserSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; email: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; emailVerified: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; image: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "users"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; isAnonymous: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").PgBooleanBuilder>, { name: string; tableName: "users"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: false; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | null | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "users"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"users", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "users"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `insertSessionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; token: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; ipAddress: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; userAgent: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; }, undefined>
```

### `selectSessionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; token: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; ipAddress: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; userAgent: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "sessions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"sessions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>, { name: string; tableName: "sessions"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date; }>; }, undefined>
```

### `insertDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; format: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; contentHash: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; compressedData: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "documents"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; originalSize: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; compressedSize: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; tokenCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; accessCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastAccessedAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; state: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; ownerId: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; isAnonymous: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; storageType: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; storageKey: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; currentVersion: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; versionCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; sharingMode: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; approvalRequiredCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; approvalRequireUnanimous: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; approvalAllowedReviewers: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; approvalTimeoutMs: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>>, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; visibility: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; eventSeqCounter: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>>, { name: string; tableName: "documents"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint | undefined; }>; bftF: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; }, undefined>
```

### `selectDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; format: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; contentHash: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; compressedData: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "documents"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; originalSize: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; compressedSize: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; tokenCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; accessCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastAccessedAt: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; state: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; ownerId: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; isAnonymous: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; storageType: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; storageKey: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; currentVersion: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; versionCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; sharingMode: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; approvalRequiredCount: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; approvalRequireUnanimous: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "documents"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; approvalAllowedReviewers: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; approvalTimeoutMs: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>>, { name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; visibility: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; eventSeqCounter: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>>, { name: string; tableName: "documents"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint | undefined; }>; bftF: import("drizzle-orm/pg-core").PgBuildColumn<"documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; }, undefined>
```

### `insertVersionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionNumber: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; compressedData: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "versions"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; contentHash: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; tokenCount: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; changelog: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; patchText: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; baseVersion: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; storageType: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; storageKey: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; }, undefined>
```

### `selectVersionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionNumber: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; compressedData: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "versions"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; contentHash: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; tokenCount: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; changelog: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; patchText: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; baseVersion: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "versions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; storageType: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; storageKey: import("drizzle-orm/pg-core").PgBuildColumn<"versions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; }, undefined>
```

### `insertStateTransitionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; fromState: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; toState: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; changedBy: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; changedAt: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; reason: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; atVersion: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "state_transitions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectStateTransitionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; fromState: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; toState: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; changedBy: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; changedAt: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; reason: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; atVersion: import("drizzle-orm/pg-core").PgBuildColumn<"state_transitions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "state_transitions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertApprovalSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; reviewerId: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; status: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; timestamp: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; reason: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; atVersion: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "approvals"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; sigHex: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; canonicalPayload: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; chainHash: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; prevChainHash: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; bftF: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "approvals"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; }, undefined>
```

### `selectApprovalSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; reviewerId: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; status: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; timestamp: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; reason: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; atVersion: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "approvals"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; sigHex: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; canonicalPayload: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; chainHash: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; prevChainHash: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; bftF: import("drizzle-orm/pg-core").PgBuildColumn<"approvals", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "approvals"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; }, undefined>
```

### `insertContributorSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionsAuthored: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; totalTokensAdded: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; totalTokensRemoved: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; netTokens: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; firstContribution: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; lastContribution: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; sectionsModified: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; displayName: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; }, undefined>
```

### `selectContributorSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionsAuthored: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; totalTokensAdded: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; totalTokensRemoved: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; netTokens: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "contributors"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; firstContribution: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; lastContribution: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "contributors"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; sectionsModified: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; displayName: import("drizzle-orm/pg-core").PgBuildColumn<"contributors", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "contributors"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; }, undefined>
```

### `insertSignedUrlTokenSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; conversationId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; signature: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; signatureLength: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; revoked: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; accessCount: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastAccessedAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `selectSignedUrlTokenSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; conversationId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; signature: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "signed_url_tokens"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; signatureLength: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; revoked: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; accessCount: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "signed_url_tokens"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastAccessedAt: import("drizzle-orm/pg-core").PgBuildColumn<"signed_url_tokens", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "signed_url_tokens"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `insertVersionAttributionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionNumber: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; authorId: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; addedLines: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; removedLines: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; addedTokens: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; removedTokens: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; sectionsModified: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; changelog: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectVersionAttributionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; versionNumber: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; authorId: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; addedLines: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; removedLines: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; addedTokens: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; removedTokens: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "version_attributions"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; sectionsModified: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; changelog: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "version_attributions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"version_attributions", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "version_attributions"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertApiKeySchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; keyHash: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; keyPrefix: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; scopes: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; lastUsedAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; revoked: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "api_keys"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectApiKeySchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; keyHash: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; keyPrefix: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; scopes: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "api_keys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; lastUsedAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; revoked: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "api_keys"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"api_keys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "api_keys"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertAuditLogSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; ipAddress: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; userAgent: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; action: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; resourceType: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; resourceId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; details: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; timestamp: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; requestId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; method: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; path: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; statusCode: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "audit_logs"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `selectAuditLogSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; ipAddress: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; userAgent: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; action: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; resourceType: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; resourceId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; details: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; timestamp: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "audit_logs"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; requestId: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; method: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; path: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "audit_logs"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; statusCode: import("drizzle-orm/pg-core").PgBuildColumn<"audit_logs", import("drizzle-orm/pg-core").PgIntegerBuilder, { name: string; tableName: "audit_logs"; dataType: "number int32"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `insertDocumentRoleSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; grantedBy: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; grantedAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_roles"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectDocumentRoleSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; grantedBy: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_roles"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; grantedAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_roles", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_roles"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertOrganizationSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectOrganizationSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "organizations"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"organizations", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "organizations"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertOrgMemberSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; joinedAt: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "org_members"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectOrgMemberSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "org_members"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; joinedAt: import("drizzle-orm/pg-core").PgBuildColumn<"org_members", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "org_members"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertDocumentOrgSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; addedAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_orgs"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectDocumentOrgSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; orgId: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_orgs"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; addedAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_orgs", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_orgs"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertPendingInviteSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; email: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; invitedBy: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `selectPendingInviteSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; email: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; role: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; invitedBy: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "pending_invites"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"pending_invites", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "pending_invites"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; }, undefined>
```

### `insertWebhookSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; url: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; secret: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; events: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentSlug: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; active: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "webhooks"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; failureCount: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "webhooks"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastDeliveryAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; lastSuccessAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectWebhookSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; userId: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; url: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; secret: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; events: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentSlug: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "webhooks"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; active: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "webhooks"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; failureCount: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "webhooks"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; lastDeliveryAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; lastSuccessAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").PgBigInt53Builder, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"webhooks", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "webhooks"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertDocumentLinkSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sourceDocId: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; targetDocId: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; linkType: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; label: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_links"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectDocumentLinkSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sourceDocId: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; targetDocId: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; linkType: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; label: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdBy: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_links"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_links", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "document_links"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertCollectionSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; description: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; ownerId: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; visibility: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectCollectionSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; name: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; slug: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; description: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; ownerId: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; visibility: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>>, { name: string; tableName: "collections"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"collections", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collections"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertCollectionDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; collectionId: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; position: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "collection_documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; addedBy: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; addedAt: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `selectCollectionDocumentSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; collectionId: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; position: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "collection_documents"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; addedBy: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "collection_documents"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; addedAt: import("drizzle-orm/pg-core").PgBuildColumn<"collection_documents", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "collection_documents"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; }, undefined>
```

### `insertSectionCrdtStateSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { documentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; clock: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "section_crdt_states"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "section_crdt_states"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; yrsState: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "section_crdt_states"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; }, undefined>
```

### `selectSectionCrdtStateSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { documentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; clock: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgIntegerBuilder>>, { name: string; tableName: "section_crdt_states"; dataType: "number int32"; data: number; driverParam: string | number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number | undefined; }>; updatedAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "section_crdt_states"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; yrsState: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_states", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "section_crdt_states"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; }, undefined>
```

### `insertSectionCrdtUpdateSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "section_crdt_updates"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; updateBlob: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "section_crdt_updates"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; clientId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; seq: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>, { name: string; tableName: "section_crdt_updates"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "section_crdt_updates"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; }, undefined>
```

### `selectSectionCrdtUpdateSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "section_crdt_updates"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; sectionId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; updateBlob: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "section_crdt_updates"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; clientId: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; seq: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>, { name: string; tableName: "section_crdt_updates"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"section_crdt_updates", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "section_crdt_updates"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; }, undefined>
```

### `insertDocumentEventSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "document_events"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; seq: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>, { name: string; tableName: "document_events"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint; }>; eventType: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; actorId: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; payloadJson: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgJsonbBuilder>, { name: string; tableName: "document_events"; dataType: "object json"; data: unknown; driverParam: unknown; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: unknown; }>; idempotencyKey: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "document_events"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; prevHash: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "document_events"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; }, undefined>
```

### `selectDocumentEventSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "document_events"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; documentId: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; seq: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt64Builder>, { name: string; tableName: "document_events"; dataType: "bigint int64"; data: bigint; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: bigint; }>; eventType: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; actorId: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; payloadJson: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgJsonbBuilder>, { name: string; tableName: "document_events"; dataType: "object json"; data: unknown; driverParam: unknown; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: unknown; }>; idempotencyKey: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").PgTextBuilder<undefined>, { name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | null | undefined; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "document_events"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; prevHash: import("drizzle-orm/pg-core").PgBuildColumn<"document_events", import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>, { name: string; tableName: "document_events"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike> | null | undefined; }>; }, undefined>
```

### `insertAgentPubkeySchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "agent_pubkeys"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; pubkey: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "agent_pubkeys"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "agent_pubkeys"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; revokedAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").PgTimestampBuilder, { name: string; tableName: "agent_pubkeys"; dataType: "object date"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | null | undefined; }>; }, undefined>
```

### `selectAgentPubkeySchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "agent_pubkeys"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; pubkey: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgCustomColumnBuilder<{ dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; }>>, { name: string; tableName: "agent_pubkeys"; dataType: "custom"; data: Buffer<ArrayBufferLike>; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Buffer<ArrayBufferLike>; }>; createdAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "agent_pubkeys"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; revokedAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_pubkeys", import("drizzle-orm/pg-core").PgTimestampBuilder, { name: string; tableName: "agent_pubkeys"; dataType: "object date"; data: Date; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | null | undefined; }>; }, undefined>
```

### `insertAgentSignatureNonceSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { nonce: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; firstSeen: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "agent_signature_nonces"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; }, undefined>
```

### `selectAgentSignatureNonceSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { nonce: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; agentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; firstSeen: import("drizzle-orm/pg-core").PgBuildColumn<"agent_signature_nonces", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTimestampBuilder>>, { name: string; tableName: "agent_signature_nonces"; dataType: "object date"; data: Date; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: Date | undefined; }>; }, undefined>
```

### `insertAgentInboxMessageSchema`

```typescript
import("drizzle-zod").BuildSchema<"insert", { id: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; toAgentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; fromAgentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; envelopeJson: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgJsonbBuilder>, { name: string; tableName: "agent_inbox_messages"; dataType: "object json"; data: unknown; driverParam: unknown; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: unknown; }>; nonce: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; receivedAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; read: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "agent_inbox_messages"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; }, undefined>
```

### `selectAgentInboxMessageSchema`

```typescript
import("drizzle-zod").BuildSchema<"select", { id: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetIsPrimaryKey<import("drizzle-orm/pg-core").PgUUIDBuilder>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string uuid"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string | undefined; }>; toAgentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; fromAgentId: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; envelopeJson: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgJsonbBuilder>, { name: string; tableName: "agent_inbox_messages"; dataType: "object json"; data: unknown; driverParam: unknown; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: unknown; }>; nonce: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgTextBuilder<undefined>>, { name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: string; }>; receivedAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; expiresAt: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBigInt53Builder>, { name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: string | number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: number; }>; read: import("drizzle-orm/pg-core").PgBuildColumn<"agent_inbox_messages", import("drizzle-orm/pg-core").SetHasDefault<import("drizzle-orm/pg-core").SetNotNull<import("drizzle-orm/pg-core").PgBooleanBuilder>>, { name: string; tableName: "agent_inbox_messages"; dataType: "boolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; identity: undefined; generated: undefined; insertType: boolean | undefined; }>; }, undefined>
```

### `DATABASE_PROVIDER`

Active database provider. Exported so auth.ts can configure drizzleAdapter.

```typescript
"sqlite" | "postgresql"
```

### `db`

```typescript
any
```

### `schema`

```typescript
any
```

### `sqlite`

```typescript
any
```

### `dbDriver`

Which driver is active — useful for code paths where transaction syntax differs between SQLite (synchronous .run()/.all()) and PG (async-only).

```typescript
"sqlite" | "postgres"
```

### `auth`

Better-auth instance with email/password + anonymous authentication, cookie-based sessions, and 24hr anonymous user TTL.

```typescript
import("better-auth").Auth<{ database: (options: import("better-auth").BetterAuthOptions) => import("better-auth").DBAdapter<import("better-auth").BetterAuthOptions>; emailAndPassword: { enabled: true; minPasswordLength: number; maxPasswordLength: number; autoSignIn: true; }; session: { expiresIn: number; updateAge: number; cookieCache: { enabled: true; maxAge: number; }; }; plugins: [{ id: "anonymous"; endpoints: { signInAnonymous: import("better-auth").StrictEndpoint<"/sign-in/anonymous", { method: "POST"; metadata: { openapi: { description: string; responses: { 200: { description: string; content: { "application/json": { schema: { type: "object"; properties: { user: { $ref: string; }; session: { $ref: string; }; }; }; }; }; }; }; }; }; }, { token: string; user: Record<string, any> & { id: string; createdAt: Date; updatedAt: Date; email: string; emailVerified: boolean; name: string; image?: string | null | undefined; }; }>; deleteAnonymousUser: import("better-auth").StrictEndpoint<"/delete-anonymous-user", { method: "POST"; use: ((inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<{ session: { session: Record<string, any> & { id: string; createdAt: Date; updatedAt: Date; userId: string; expiresAt: Date; token: string; ipAddress?: string | null | undefined; userAgent?: string | null | undefined; }; user: Record<string, any> & { id: string; createdAt: Date; updatedAt: Date; email: string; emailVerified: boolean; name: string; image?: string | null | undefined; }; }; }>)[]; metadata: { openapi: { description: string; responses: { 200: { description: string; content: { "application/json": { schema: { type: "object"; properties: { success: { type: string; }; }; }; }; }; }; "400": { description: string; content: { "application/json": { schema: { type: "object"; properties: { message: { type: string; }; }; }; required: string[]; }; }; }; "500": { description: string; content: { "application/json": { schema: { type: "object"; properties: { message: { type: string; }; }; required: string[]; }; }; }; }; }; }; }; }, { success: boolean; }>; }; hooks: { after: { matcher(ctx: import("better-auth").HookEndpointContext): boolean; handler: (inputContext: import("better-auth").MiddlewareInputContext<import("better-auth").MiddlewareOptions>) => Promise<void>; }[]; }; options: import("better-auth/plugins").AnonymousOptions | undefined; schema: { user: { fields: { isAnonymous: { type: "boolean"; required: false; input: false; defaultValue: false; }; }; }; }; $ERROR_CODES: { FAILED_TO_CREATE_USER: import("better-auth").RawError<"FAILED_TO_CREATE_USER">; INVALID_EMAIL_FORMAT: import("better-auth").RawError<"INVALID_EMAIL_FORMAT">; COULD_NOT_CREATE_SESSION: import("better-auth").RawError<"COULD_NOT_CREATE_SESSION">; ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY: import("better-auth").RawError<"ANONYMOUS_USERS_CANNOT_SIGN_IN_AGAIN_ANONYMOUSLY">; FAILED_TO_DELETE_ANONYMOUS_USER: import("better-auth").RawError<"FAILED_TO_DELETE_ANONYMOUS_USER">; USER_IS_NOT_ANONYMOUS: import("better-auth").RawError<"USER_IS_NOT_ANONYMOUS">; DELETE_ANONYMOUS_USER_DISABLED: import("better-auth").RawError<"DELETE_ANONYMOUS_USER_DISABLED">; }; }]; trustedOrigins: string[]; }>
```

### `contentCache`

LRU cache for decompressed document content strings, keyed by slug.

```typescript
LRUCache<string>
```

### `metadataCache`

LRU cache for document metadata objects, keyed by slug.

```typescript
LRUCache<Record<string, unknown>>
```

### `RATE_LIMITS`

Tier-based rate limit configuration. All windows are 1 minute.

```typescript
{ readonly ip: { readonly global: { readonly max: 100; readonly timeWindow: "1 minute"; }; readonly write: { readonly max: 20; readonly timeWindow: "1 minute"; }; readonly auth: { readonly max: 10; readonly timeWindow: "1 minute"; }; }; readonly user: { readonly global: { readonly max: 300; readonly timeWindow: "1 minute"; }; readonly write: { readonly max: 60; readonly timeWindow: "1 minute"; }; readonly auth: { readonly max: 30; readonly timeWindow: "1 minute"; }; }; readonly apiKey: { readonly global: { readonly max: 600; readonly timeWindow: "1 minute"; }; readonly write: { readonly max: 120; readonly timeWindow: "1 minute"; }; readonly auth: { readonly max: 60; readonly timeWindow: "1 minute"; }; }; }
```

### `writeRateLimit`

Route-level config object for write-operation rate limits. Apply to POST/PUT/DELETE route handlers that mutate state.  Usage:   fastify.post('/route',  config: writeRateLimit , handler)

```typescript
{ rateLimit: { max: (request: FastifyRequest) => number; timeWindow: string; keyGenerator: (request: FastifyRequest) => string; }; }
```

### `authRateLimit`

Route-level config object for authentication endpoint rate limits. Apply to sign-up, sign-in, and key-creation routes.  Usage:   fastify.post('/auth/sign-up/email',  config: authRateLimit , handler)

```typescript
{ rateLimit: { max: (request: FastifyRequest) => number; timeWindow: string; keyGenerator: (request: FastifyRequest) => string; }; }
```

### `eventBus`

```typescript
DocumentEventBus
```

### `canRead`

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `canWrite`

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `canDelete`

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `canManage`

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `canApprove`

```typescript
(request: FastifyRequest, reply: FastifyReply) => Promise<undefined>
```

### `httpRequestDurationSeconds`

HTTP request duration histogram (seconds). Labels: method, route, status_code. SPEC-T145 §7.2

```typescript
Histogram<"method" | "status_code" | "route">
```

### `httpRequestsTotal`

HTTP requests total counter. Labels: method, route, status_code. SPEC-T145 §7.2

```typescript
Counter<"method" | "status_code" | "route">
```

### `documentCreatedTotal`

Incremented when a document is created successfully.

```typescript
Counter<"visibility">
```

### `documentApprovalSubmittedTotal`

Incremented when an approval vote is submitted.

```typescript
Counter<"status">
```

### `documentStateTransitionTotal`

Incremented on every document lifecycle state transition.

```typescript
Counter<"from_state" | "to_state">
```

### `versionCreatedTotal`

Incremented when a new document version is created.

```typescript
Counter<"source">
```

### `webhookDeliveryTotal`

Incremented on every webhook delivery attempt.

```typescript
Counter<"event_type" | "result">
```

### `DOCUMENT_EVENT_TYPES`

Canonical event type strings for the document event log.  Matches the design spec exactly. Consumers should import from here rather than using raw strings to benefit from exhaustiveness checks.

```typescript
readonly ["document.created", "version.published", "lifecycle.transitioned", "approval.submitted", "approval.rejected", "section.edited", "event.compacted", "bft.approval_submitted", "bft.byzantine_slash", "bft.quorum_reached"]
```

### `presenceRegistry`

```typescript
PresenceRegistry
```

### `CRDT_COMPACT_THRESHOLD`

```typescript
number
```

### `CRDT_COMPACT_IDLE_MS`

```typescript
number
```

### `publicDir`

Absolute path to the public assets directory for static file serving.

```typescript
string
```

### `logger`

```typescript
FastifyBaseLogger
```
