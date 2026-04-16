/**
 * OpenAPI route manifest for forge-ts.
 *
 * This file declares every HTTP route in the LLMtxt API as exported functions
 * so that forge-ts can extract `@route` tags and generate a complete OpenAPI
 * 3.2 specification. The functions themselves are stubs — the real handlers
 * live in `src/routes/`. This file exists solely for documentation and spec
 * generation.
 *
 * Authentication: Most mutating routes require a Bearer API key
 * (`Authorization: Bearer <key>`) or a session cookie. Read routes on public
 * documents are unauthenticated.
 *
 * @packageDocumentation
 * @public
 */

// ── Core Document Routes ──────────────────────────────────────────────────────

/**
 * Compress and store a document.
 *
 * Accepts plaintext, JSON, or Markdown. Auto-detects format when `format` is
 * omitted. Returns a slug that uniquely identifies the stored document.
 *
 * @route POST /api/compress
 * @body `{ content: string, format?: "json"|"text"|"markdown", schema?: string, agentId?: string }`
 * @response 201 `{ id, slug, url, format, tokenCount, compressionRatio, originalSize, compressedSize }`
 * @response 400 Validation failed — invalid body or unknown schema
 * @response 413 Content too large (exceeds limit)
 * @response 429 Write rate limit exceeded
 * @public
 */
export function postCompress(): void {}

/**
 * Decompress a document by slug.
 *
 * Returns the original uncompressed content. Increments access counter.
 *
 * @route GET /api/documents/{slug}
 * @param slug - URL-safe document identifier (≤ 20 chars)
 * @response 200 `{ id, slug, content, format, tokenCount, compressionRatio, originalSize, compressedSize }`
 * @response 404 Document not found
 * @response 403 Access denied (private document)
 * @public
 */
export function getDocument(): void {}

/**
 * Decompress a document body via POST.
 *
 * Alternative to GET when the slug must be sent as a body parameter.
 *
 * @route POST /api/decompress
 * @body `{ slug: string }`
 * @response 200 `{ content: string, format: string, tokenCount: number }`
 * @response 404 Document not found
 * @public
 */
export function postDecompress(): void {}

/**
 * Validate content against a predefined schema without storing it.
 *
 * @route POST /api/validate
 * @body `{ content: string, format?: string, schema?: string }`
 * @response 200 `{ valid: true }`
 * @response 400 Validation failed with detailed errors
 * @public
 */
export function postValidate(): void {}

/**
 * List all documents owned by the authenticated user.
 *
 * @route GET /api/documents/mine
 * @response 200 `{ documents: Array<{ id, slug, format, tokenCount, createdAt, state }>, total: number }`
 * @response 401 Authentication required
 * @public
 */
export function getDocumentsMine(): void {}

/**
 * List available predefined validation schemas.
 *
 * @route GET /api/schemas
 * @response 200 `{ schemas: string[] }`
 * @public
 */
export function getSchemas(): void {}

/**
 * Get a specific predefined schema by name.
 *
 * @route GET /api/schemas/{name}
 * @param name - Schema name (e.g., `prompt-v1`)
 * @response 200 The JSON schema object
 * @response 404 Schema not found
 * @public
 */
export function getSchema(): void {}

/**
 * Get cache statistics (hit/miss counts, size).
 *
 * @route GET /api/stats/cache
 * @response 200 `{ hits: number, misses: number, size: number }`
 * @public
 */
export function getStatsCache(): void {}

/**
 * Invalidate all cached documents.
 *
 * @route DELETE /api/cache
 * @response 200 `{ cleared: number }`
 * @response 401 Authentication required (admin only)
 * @public
 */
export function deleteCache(): void {}

/**
 * Serve the llms.txt autodiscovery file.
 *
 * @route GET /api/llms.txt
 * @response 200 Plain text llms.txt content
 * @public
 */
export function getLlmsTxt(): void {}

// ── Version Management Routes ─────────────────────────────────────────────────

/**
 * Update a document (creates a new version).
 *
 * Increments `currentVersion`, stores the new compressed content as a version
 * record, updates contributors, and invalidates cache.
 *
 * @route PUT /api/documents/{slug}
 * @param slug - Document identifier
 * @body `{ content: string, changelog?: string, agentId?: string }`
 * @response 200 `{ slug, versionNumber, tokenCount, compressionRatio }`
 * @response 404 Document not found
 * @response 403 Write access denied
 * @response 423 Document is locked (LOCKED state)
 * @response 429 Write rate limit exceeded
 * @public
 */
export function putDocument(): void {}

/**
 * List all versions of a document.
 *
 * @route GET /api/documents/{slug}/versions
 * @param slug - Document identifier
 * @response 200 `{ versions: Array<{ versionNumber, tokenCount, createdAt, createdBy, changelog }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentVersions(): void {}

/**
 * Get a specific version of a document.
 *
 * @route GET /api/documents/{slug}/versions/{num}
 * @param slug - Document identifier
 * @param num - Version number (1-based)
 * @response 200 `{ content, versionNumber, tokenCount, createdAt, createdBy }`
 * @response 404 Document or version not found
 * @public
 */
export function getDocumentVersion(): void {}

/**
 * Get a two-way diff between two versions of a document.
 *
 * @route GET /api/documents/{slug}/diff
 * @param slug - Document identifier
 * @query from - Source version number
 * @query to - Target version number
 * @response 200 `{ diff: DiffHunk[], fromVersion: number, toVersion: number }`
 * @response 400 Invalid version numbers
 * @response 404 Document or version not found
 * @public
 */
export function getDocumentDiff(): void {}

/**
 * Get a multi-way diff across N versions (N ≥ 2).
 *
 * Uses LCS-based alignment to produce a consensus view of divergent versions.
 *
 * @route GET /api/documents/{slug}/multi-diff
 * @param slug - Document identifier
 * @query versions - Comma-separated version numbers (e.g., `1,2,3`)
 * @response 200 `{ lines: MultiDiffLine[], versions: number[] }`
 * @response 400 Fewer than 2 versions specified
 * @response 404 Document or version not found
 * @public
 */
export function getDocumentMultiDiff(): void {}

/**
 * Create multiple versions in a single atomic batch.
 *
 * Each entry in the batch becomes a separate version record in order.
 *
 * @route POST /api/documents/{slug}/batch-versions
 * @param slug - Document identifier
 * @body `{ versions: Array<{ content: string, changelog?: string, createdBy?: string }> }`
 * @response 200 `{ created: number, latestVersion: number }`
 * @response 400 Invalid batch payload
 * @response 404 Document not found
 * @public
 */
export function postBatchVersions(): void {}

// ── Lifecycle / Approval Routes ───────────────────────────────────────────────

/**
 * Transition a document through its lifecycle state machine.
 *
 * Valid transitions: DRAFT→REVIEW, REVIEW→APPROVED, REVIEW→REJECTED,
 * APPROVED→LOCKED, LOCKED→DRAFT (unlock).
 *
 * @route POST /api/documents/{slug}/transition
 * @param slug - Document identifier
 * @body `{ state: "DRAFT"|"REVIEW"|"APPROVED"|"LOCKED"|"REJECTED" }`
 * @response 200 `{ slug, state, previousState }`
 * @response 400 Invalid transition
 * @response 404 Document not found
 * @response 403 Insufficient permissions
 * @public
 */
export function postDocumentTransition(): void {}

/**
 * Submit an approval vote for a document in REVIEW state.
 *
 * @route POST /api/documents/{slug}/approve
 * @param slug - Document identifier
 * @body `{ agentId?: string, comment?: string }`
 * @response 201 `{ approvalId, agentId, createdAt }`
 * @response 409 Already approved by this agent
 * @response 404 Document not found
 * @public
 */
export function postDocumentApprove(): void {}

/**
 * Submit a rejection for a document in REVIEW state.
 *
 * @route POST /api/documents/{slug}/reject
 * @param slug - Document identifier
 * @body `{ agentId?: string, reason: string }`
 * @response 200 `{ slug, state: "REJECTED" }`
 * @response 404 Document not found
 * @public
 */
export function postDocumentReject(): void {}

/**
 * Get approval records for a document.
 *
 * @route GET /api/documents/{slug}/approvals
 * @param slug - Document identifier
 * @response 200 `{ approvals: Array<{ agentId, createdAt, comment? }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentApprovals(): void {}

/**
 * Get contributor statistics for a document.
 *
 * @route GET /api/documents/{slug}/contributors
 * @param slug - Document identifier
 * @response 200 `{ contributors: Array<{ agentId, versionsAuthored, netTokens, firstContribution, lastContribution }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentContributors(): void {}

// ── Agent Key Routes ──────────────────────────────────────────────────────────

/**
 * Register an Ed25519 public key for an agent.
 *
 * The key is validated as a valid Ed25519 point before storage. A SHA-256
 * fingerprint (first 16 hex chars) is returned for identification.
 *
 * @route POST /api/agents/keys
 * @body `{ pubkey_hex: string, label?: string }`
 * @response 201 `{ id, fingerprint, pubkey_hex, label, createdAt }`
 * @response 400 Invalid Ed25519 public key
 * @response 401 Authentication required
 * @public
 */
export function postAgentKey(): void {}

/**
 * List all active (non-revoked) Ed25519 keys for the authenticated user.
 *
 * @route GET /api/agents/keys
 * @response 200 `{ keys: Array<{ id, fingerprint, pubkey_hex, label, createdAt }> }`
 * @response 401 Authentication required
 * @public
 */
export function getAgentKeys(): void {}

/**
 * Revoke (soft-delete) an agent key by ID.
 *
 * Sets `revoked_at` timestamp; the key is excluded from all future lookups.
 *
 * @route DELETE /api/agents/keys/{id}
 * @param id - Key record ID
 * @response 200 `{ id, revokedAt }`
 * @response 404 Key not found or belongs to another user
 * @response 401 Authentication required
 * @public
 */
export function deleteAgentKey(): void {}

// ── API Key Management ────────────────────────────────────────────────────────

/**
 * Create a new API key for programmatic access.
 *
 * @route POST /api/keys
 * @body `{ name: string, expiresAt?: number }`
 * @response 201 `{ id, key, name, createdAt, expiresAt }` — key is shown once
 * @response 401 Authentication required
 * @public
 */
export function postApiKey(): void {}

/**
 * List all active API keys for the authenticated user.
 *
 * @route GET /api/keys
 * @response 200 `{ keys: Array<{ id, name, createdAt, expiresAt, lastUsed }> }`
 * @response 401 Authentication required
 * @public
 */
export function getApiKeys(): void {}

/**
 * Delete (revoke) an API key by ID.
 *
 * @route DELETE /api/keys/{id}
 * @param id - API key ID
 * @response 200 `{ id }`
 * @response 404 Key not found
 * @response 401 Authentication required
 * @public
 */
export function deleteApiKey(): void {}

/**
 * Rotate an API key — atomically replaces the secret.
 *
 * @route POST /api/keys/{id}/rotate
 * @param id - API key ID
 * @response 200 `{ id, key }` — new key value shown once
 * @response 404 Key not found
 * @response 401 Authentication required
 * @public
 */
export function postApiKeyRotate(): void {}

// ── Health, Readiness, Metrics ────────────────────────────────────────────────

/**
 * Liveness probe — no I/O, always 200 when process is alive.
 *
 * @route GET /api/health
 * @response 200 `{ status: "ok", version: string, ts: string }`
 * @public
 */
export function getHealth(): void {}

/**
 * Readiness probe — pings the database before returning 200.
 *
 * @route GET /api/ready
 * @response 200 `{ status: "ok", version: string, ts: string }`
 * @response 503 Database unavailable
 * @public
 */
export function getReady(): void {}

/**
 * Prometheus metrics endpoint (prom-client).
 *
 * Protected by `METRICS_TOKEN` env var when set.
 *
 * @route GET /api/metrics
 * @header Authorization - `Bearer <METRICS_TOKEN>` when METRICS_TOKEN is set
 * @response 200 Prometheus text format
 * @response 401 Invalid or missing token
 * @public
 */
export function getMetrics(): void {}

// ── Progressive Disclosure (Document Structure) ───────────────────────────────

/**
 * Get a structural overview of a document (section list, stats).
 *
 * @route GET /api/documents/{slug}/overview
 * @param slug - Document identifier
 * @response 200 `{ slug, sectionCount, tokenCount, format, sections: string[] }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentOverview(): void {}

/**
 * Get all sections of a document.
 *
 * @route GET /api/documents/{slug}/sections
 * @param slug - Document identifier
 * @response 200 `{ sections: Array<{ name, content, tokenCount }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentSections(): void {}

/**
 * Get the table of contents for a document.
 *
 * @route GET /api/documents/{slug}/toc
 * @param slug - Document identifier
 * @response 200 `{ toc: Array<{ heading, level, anchor }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentToc(): void {}

/**
 * Get a named section from a document.
 *
 * @route GET /api/documents/{slug}/sections/{name}
 * @param slug - Document identifier
 * @param name - Section heading identifier
 * @response 200 `{ name, content, tokenCount }`
 * @response 404 Document or section not found
 * @public
 */
export function getDocumentSection(): void {}

/**
 * Full-text search within a document.
 *
 * @route GET /api/documents/{slug}/search
 * @param slug - Document identifier
 * @query q - Search query string
 * @response 200 `{ results: Array<{ section, excerpt, score }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentSearch(): void {}

/**
 * Fetch a document's raw (unformatted) content.
 *
 * @route GET /api/documents/{slug}/raw
 * @param slug - Document identifier
 * @response 200 Raw content as `text/plain`
 * @response 404 Document not found
 * @public
 */
export function getDocumentRaw(): void {}

/**
 * Batch-fetch multiple sections from a document.
 *
 * @route POST /api/documents/{slug}/batch
 * @param slug - Document identifier
 * @body `{ sections: string[] }`
 * @response 200 `{ sections: Array<{ name, content, tokenCount }> }`
 * @response 404 Document not found
 * @public
 */
export function postDocumentBatch(): void {}

// ── CRDT Collaboration (HTTP Fallback) ────────────────────────────────────────

/**
 * Get the current CRDT state for a document section (HTTP fallback).
 *
 * @route GET /api/documents/{slug}/sections/{sid}/crdt-state
 * @param slug - Document identifier
 * @param sid - Section identifier
 * @response 200 `{ state: string }` — base64-encoded Yjs state vector
 * @response 404 Document or section not found
 * @public
 */
export function getSectionCrdtState(): void {}

/**
 * Apply a CRDT update to a document section (HTTP fallback for WebSocket).
 *
 * @route POST /api/documents/{slug}/sections/{sid}/crdt-update
 * @param slug - Document identifier
 * @param sid - Section identifier
 * @body `{ update: string }` — base64-encoded Yjs update
 * @response 200 `{ applied: true }`
 * @response 400 Invalid update payload
 * @response 404 Document or section not found
 * @public
 */
export function postSectionCrdtUpdate(): void {}

/**
 * WebSocket endpoint for real-time CRDT collaboration on a document section.
 *
 * Subprotocol: `yjs-sync-v1`. Auth via `?token=<apiKey>` query param or
 * session cookie. Unauthenticated connections are closed with code 4401.
 *
 * @route GET /api/v1/documents/{slug}/sections/{sid}/collab
 * @param slug - Document identifier
 * @param sid - Section identifier
 * @query token - Bearer API key for WS auth
 * @response 101 WebSocket upgrade
 * @response 4401 Unauthenticated
 * @response 4403 Forbidden (insufficient role)
 * @public
 */
export function wsDocumentSectionCollab(): void {}

// ── Presence ──────────────────────────────────────────────────────────────────

/**
 * Get all agents currently active in a document (within the last 30 seconds).
 *
 * @route GET /api/v1/documents/{slug}/presence
 * @param slug - Document identifier
 * @response 200 `Array<{ agentId, section, cursorOffset?, lastSeen }>`
 * @response 404 Document not found
 * @public
 */
export function getDocumentPresence(): void {}

// ── Section Leases ────────────────────────────────────────────────────────────

/**
 * Acquire an exclusive write lease on a document section.
 *
 * @route POST /api/v1/documents/{slug}/sections/{sid}/lease
 * @param slug - Document identifier
 * @param sid - Section identifier
 * @body `{ agentId: string, ttlMs?: number }`
 * @response 201 `{ leaseId, agentId, expiresAt }`
 * @response 409 Section already leased by another agent
 * @response 404 Document not found
 * @public
 */
export function postSectionLease(): void {}

/**
 * Get the current lease holder for a document section.
 *
 * @route GET /api/v1/documents/{slug}/sections/{sid}/lease
 * @param slug - Document identifier
 * @param sid - Section identifier
 * @response 200 `{ leaseId, agentId, expiresAt }` or `{ leaseId: null }`
 * @response 404 Document not found
 * @public
 */
export function getSectionLease(): void {}

/**
 * Release a lease on a document section.
 *
 * @route DELETE /api/v1/documents/{slug}/sections/{sid}/lease
 * @param slug - Document identifier
 * @param sid - Section identifier
 * @response 200 `{ released: true }`
 * @response 404 Lease not found or not owned by caller
 * @public
 */
export function deleteSectionLease(): void {}

/**
 * Renew (heartbeat) a lease on a document section.
 *
 * @route PATCH /api/v1/documents/{slug}/sections/{sid}/lease
 * @param slug - Document identifier
 * @param sid - Section identifier
 * @body `{ agentId: string }`
 * @response 200 `{ leaseId, expiresAt }`
 * @response 404 Lease not found or expired
 * @public
 */
export function patchSectionLease(): void {}

// ── Agent Scratchpad ──────────────────────────────────────────────────────────

/**
 * Write to an agent's scratchpad within a document.
 *
 * @route POST /api/v1/documents/{slug}/scratchpad
 * @param slug - Document identifier
 * @body `{ agentId: string, content: string, section?: string }`
 * @response 201 `{ id, agentId, createdAt }`
 * @response 404 Document not found
 * @public
 */
export function postDocumentScratchpad(): void {}

/**
 * Read all scratchpad entries for a document (optionally filtered by agent).
 *
 * @route GET /api/v1/documents/{slug}/scratchpad
 * @param slug - Document identifier
 * @query agentId - Filter to entries by this agent
 * @response 200 `{ entries: Array<{ id, agentId, content, section?, createdAt }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentScratchpad(): void {}

/**
 * Server-sent events stream of new scratchpad entries.
 *
 * @route GET /api/v1/documents/{slug}/scratchpad/stream
 * @param slug - Document identifier
 * @response 200 `text/event-stream` — each event is a JSON scratchpad entry
 * @response 404 Document not found
 * @public
 */
export function getDocumentScratchpadStream(): void {}

// ── BFT Consensus ─────────────────────────────────────────────────────────────

/**
 * Submit a BFT consensus vote for a document section.
 *
 * @route POST /api/v1/documents/{slug}/bft/vote
 * @param slug - Document identifier
 * @body `{ agentId: string, sectionId: string, content: string, hash: string }`
 * @response 201 `{ voteId, status: "pending"|"consensus"|"byzantine" }`
 * @response 400 Invalid vote payload
 * @response 404 Document not found
 * @public
 */
export function postBftVote(): void {}

/**
 * Get BFT consensus status for a document.
 *
 * @route GET /api/documents/{slug}/bft/status
 * @param slug - Document identifier
 * @response 200 `{ status: "pending"|"consensus"|"byzantine", votes: number, quorum: number }`
 * @response 404 Document not found
 * @public
 */
export function getBftStatus(): void {}

/**
 * Get the BFT hash chain for audit verification.
 *
 * @route GET /api/documents/{slug}/chain
 * @param slug - Document identifier
 * @response 200 `{ chain: Array<{ blockIndex, hash, prevHash, agentId, timestamp }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentChain(): void {}

// ── Agent-to-Agent (A2A) Messaging ────────────────────────────────────────────

/**
 * Send a message to an agent's inbox.
 *
 * @route POST /api/v1/agents/{id}/inbox
 * @param id - Agent identifier
 * @body `{ from: string, content: string, replyTo?: string }`
 * @response 201 `{ messageId, queued: true }`
 * @response 404 Agent not found
 * @public
 */
export function postAgentInbox(): void {}

/**
 * Read messages from an agent's inbox (poll).
 *
 * @route GET /api/v1/agents/{id}/inbox
 * @param id - Agent identifier
 * @query since - ISO 8601 timestamp — only return messages after this time
 * @query limit - Maximum messages to return (default 50)
 * @response 200 `{ messages: Array<{ id, from, content, replyTo?, ts }>, count: number }`
 * @response 404 Agent not found
 * @public
 */
export function getAgentInbox(): void {}

// ── Document Events ───────────────────────────────────────────────────────────

/**
 * Get the event log for a document (paginated).
 *
 * @route GET /api/documents/{slug}/events
 * @param slug - Document identifier
 * @query since - ISO 8601 timestamp filter
 * @query limit - Max events (default 100)
 * @response 200 `{ events: Array<{ id, type, agentId, ts, payload? }>, total: number }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentEvents(): void {}

/**
 * Subscribe to document events as a server-sent event stream.
 *
 * @route GET /api/documents/{slug}/events/stream
 * @param slug - Document identifier
 * @query since - ISO 8601 timestamp — replay events after this time
 * @response 200 `text/event-stream` of JSON event objects
 * @response 404 Document not found
 * @public
 */
export function getDocumentEventsStream(): void {}

// ── Subscribe (Global Event Stream) ──────────────────────────────────────────

/**
 * Subscribe to global document events via SSE.
 *
 * @route GET /api/v1/subscribe
 * @query topics - Comma-separated list of event topics to subscribe to
 * @response 200 `text/event-stream`
 * @public
 */
export function getSubscribe(): void {}

// ── Signed URLs ───────────────────────────────────────────────────────────────

/**
 * Generate a time-limited signed URL for unauthenticated document access.
 *
 * @route POST /api/signed-urls
 * @body `{ slug: string, expiresInSeconds?: number }`
 * @response 201 `{ url: string, expiresAt: string }`
 * @response 404 Document not found
 * @public
 */
export function postSignedUrl(): void {}

// ── Merge ─────────────────────────────────────────────────────────────────────

/**
 * Three-way merge two document versions with a common ancestor.
 *
 * @route POST /api/documents/{slug}/merge
 * @param slug - Document identifier
 * @body `{ ourVersion: number, theirVersion: number, baseVersion?: number }`
 * @response 200 `{ merged: string, conflicts: number }`
 * @response 409 Unresolvable conflict detected
 * @response 404 Document not found
 * @public
 */
export function postDocumentMerge(): void {}

// ── Patches ───────────────────────────────────────────────────────────────────

/**
 * Apply a patch to a document.
 *
 * @route POST /api/documents/{slug}/patch
 * @param slug - Document identifier
 * @body `{ patch: string, baseVersion?: number }`
 * @response 200 `{ versionNumber: number, applied: true }`
 * @response 400 Patch failed to apply cleanly
 * @response 404 Document not found
 * @public
 */
export function postDocumentPatch(): void {}

// ── Cross-Document ────────────────────────────────────────────────────────────

/**
 * Cross-document semantic search.
 *
 * @route POST /api/search
 * @body `{ query: string, limit?: number }`
 * @response 200 `{ results: Array<{ slug, excerpt, score, format }> }`
 * @public
 */
export function postSearch(): void {}

/**
 * List outgoing links from a document.
 *
 * @route GET /api/documents/{slug}/links
 * @param slug - Source document identifier
 * @response 200 `{ links: Array<{ targetSlug, label?, createdAt }> }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentLinks(): void {}

/**
 * Create a link between two documents.
 *
 * @route POST /api/documents/{slug}/links
 * @param slug - Source document identifier
 * @body `{ targetSlug: string, label?: string }`
 * @response 201 `{ id, sourceSlug, targetSlug, label?, createdAt }`
 * @response 404 Source or target document not found
 * @public
 */
export function postDocumentLink(): void {}

/**
 * Delete a link between documents.
 *
 * @route DELETE /api/documents/{slug}/links/{linkId}
 * @param slug - Source document identifier
 * @param linkId - Link record ID
 * @response 200 `{ deleted: true }`
 * @response 404 Link not found
 * @public
 */
export function deleteDocumentLink(): void {}

/**
 * Get the cross-document relationship graph.
 *
 * @route GET /api/graph
 * @response 200 `{ nodes: Array<{ id, slug }>, edges: Array<{ source, target, label? }> }`
 * @public
 */
export function getGraph(): void {}

// ── Semantic Diff / Consensus ─────────────────────────────────────────────────

/**
 * Compute a semantic (embedding-based) diff between two versions.
 *
 * @route POST /api/documents/{slug}/semantic-diff
 * @param slug - Document identifier
 * @body `{ fromVersion: number, toVersion: number }`
 * @response 200 `{ sections: Array<{ name, similarity: number, changed: boolean }> }`
 * @response 404 Document not found
 * @public
 */
export function postDocumentSemanticDiff(): void {}

/**
 * Compute semantic similarity between two documents.
 *
 * @route GET /api/documents/{slug}/semantic-similarity
 * @param slug - Source document identifier
 * @query compareTo - Target document slug
 * @response 200 `{ similarity: number }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentSemanticSimilarity(): void {}

/**
 * Run a semantic consensus check across multiple agent versions.
 *
 * @route POST /api/documents/{slug}/semantic-consensus
 * @param slug - Document identifier
 * @body `{ agentIds: string[], threshold?: number }`
 * @response 200 `{ consensus: boolean, score: number, divergentAgents: string[] }`
 * @response 404 Document not found
 * @public
 */
export function postDocumentSemanticConsensus(): void {}

// ── Well-Known Agents ─────────────────────────────────────────────────────────

/**
 * Get the well-known agent descriptor for a registered agent.
 *
 * @route GET /api/.well-known/agents/{id}
 * @param id - Agent identifier
 * @response 200 `AgentDescriptor` — capabilities, supported protocols, public key
 * @response 404 Agent not found
 * @public
 */
export function getWellKnownAgent(): void {}

// ── Webhooks ──────────────────────────────────────────────────────────────────

/**
 * Register a new webhook endpoint.
 *
 * @route POST /api/webhooks
 * @body `{ url: string, events: string[], secret?: string }`
 * @response 201 `{ id, url, events, createdAt }`
 * @response 400 Invalid URL or event types
 * @response 401 Authentication required
 * @public
 */
export function postWebhook(): void {}

/**
 * List all webhooks for the authenticated user.
 *
 * @route GET /api/webhooks
 * @response 200 `{ webhooks: Array<{ id, url, events, createdAt, lastDelivery? }> }`
 * @response 401 Authentication required
 * @public
 */
export function getWebhooks(): void {}

/**
 * Delete a webhook by ID.
 *
 * @route DELETE /api/webhooks/{id}
 * @param id - Webhook ID
 * @response 200 `{ deleted: true }`
 * @response 404 Webhook not found
 * @response 401 Authentication required
 * @public
 */
export function deleteWebhook(): void {}

// ── Access Control ────────────────────────────────────────────────────────────

/**
 * Get the access control list (ACL) for a document.
 *
 * @route GET /api/documents/{slug}/access
 * @param slug - Document identifier
 * @response 200 `{ roles: Array<{ userId, role }>, visibility: "public"|"private" }`
 * @response 404 Document not found
 * @public
 */
export function getDocumentAccess(): void {}

/**
 * Grant a role to a user on a document.
 *
 * @route POST /api/documents/{slug}/access
 * @param slug - Document identifier
 * @body `{ userId: string, role: "viewer"|"editor"|"admin" }`
 * @response 201 `{ userId, role, grantedAt }`
 * @response 403 Only document owners can grant roles
 * @response 404 Document not found
 * @public
 */
export function postDocumentAccess(): void {}

/**
 * Revoke a user's role on a document.
 *
 * @route DELETE /api/documents/{slug}/access/{userId}
 * @param slug - Document identifier
 * @param userId - User ID to revoke
 * @response 200 `{ revoked: true }`
 * @response 404 Role not found
 * @public
 */
export function deleteDocumentAccess(): void {}

// ── Organizations ─────────────────────────────────────────────────────────────

/**
 * Create a new organization.
 *
 * @route POST /api/organizations
 * @body `{ name: string, slug?: string }`
 * @response 201 `{ id, slug, name, createdAt }`
 * @response 401 Authentication required
 * @public
 */
export function postOrganization(): void {}

/**
 * List organizations the authenticated user belongs to.
 *
 * @route GET /api/organizations
 * @response 200 `{ organizations: Array<{ id, slug, name, role }> }`
 * @response 401 Authentication required
 * @public
 */
export function getOrganizations(): void {}

/**
 * Get an organization by slug.
 *
 * @route GET /api/organizations/{slug}
 * @param slug - Organization slug
 * @response 200 `{ id, slug, name, members: Array<{ userId, role }> }`
 * @response 404 Organization not found
 * @public
 */
export function getOrganization(): void {}

/**
 * Add a member to an organization.
 *
 * @route POST /api/organizations/{slug}/members
 * @param slug - Organization slug
 * @body `{ userId: string, role: "member"|"admin" }`
 * @response 201 `{ userId, role }`
 * @response 403 Only org admins can add members
 * @public
 */
export function postOrganizationMember(): void {}

/**
 * Remove a member from an organization.
 *
 * @route DELETE /api/organizations/{slug}/members/{userId}
 * @param slug - Organization slug
 * @param userId - User ID to remove
 * @response 200 `{ removed: true }`
 * @response 403 Only org admins can remove members
 * @public
 */
export function deleteOrganizationMember(): void {}

// ── WebSocket (legacy document stream) ───────────────────────────────────────

/**
 * WebSocket endpoint for legacy real-time document event streaming.
 *
 * @route GET /api/documents/{slug}
 * @param slug - Document identifier (WebSocket upgrade)
 * @response 101 WebSocket upgrade
 * @response 4401 Unauthenticated
 * @public
 */
export function wsDocumentStream(): void {}
