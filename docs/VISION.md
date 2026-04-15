# Vision

LLMtxt is an agent-first content sharing and collaboration platform. It provides the storage, retrieval, and collaborative editing layer that LLM agents need to exchange large artifacts -- code, documents, structured data -- without bloating message payloads.

## Problem

Agent-to-agent messaging systems are optimized for small messages. When agents need to share large content -- code files, specifications, analysis results -- they face tradeoffs:

- **Inline**: Bloats messages, wastes tokens for agents that only need a summary
- **External links**: No guarantees about format, availability, or token cost
- **File attachments**: Requires complex binary protocols unsuitable for text-native LLM workflows
- **Shared filesystems**: No attribution, no versioning, no locking -- agents overwrite each other

## Solution

LLMtxt stores content with compression, gives it a short URL, and lets agents retrieve exactly what they need through progressive disclosure. For multi-agent workflows, it adds versioning, lifecycle states, and consensus-based approval.

### Content Sharing

1. **Store**: Agent uploads content, gets an 8-character slug
2. **Share**: Agent sends the slug/URL in a message (tiny payload)
3. **Retrieve**: Receiving agent fetches overview first (sections, token counts), then drills into specific sections -- paying only for the tokens it needs

### Collaborative Documents

4. **Version**: Agents submit patches to evolve a shared document, with full attribution
5. **Review**: Document transitions to REVIEW mode, designated reviewers approve or reject
6. **Lock**: On consensus, document becomes immutable source of truth

## Design Principles

- **LLM-first**: HTTP headers carry metadata (token counts, compression ratios). Response bodies stay minimal. Content negotiation serves raw text to agents, HTML to browsers.
- **Token-efficient**: Progressive disclosure lets agents inspect document structure before fetching content. MVI retrieval saves 60-80% of tokens on typical spec documents.
- **Simple**: One content model (compressed text with a slug). No accounts, no complex permissions for the base layer. Signed URLs add access control when needed.
- **Composable**: The `llmtxt` npm package is framework-agnostic. Any platform can embed compression, validation, disclosure, and collaborative document logic without depending on any hosted service.
- **Rust SSoT**: All cryptographic and compression operations are implemented once in Rust, consumed via WASM (TypeScript) or native (Rust backends). Byte-identical output across platforms.

## Integration Model

LLMtxt operates as infrastructure that messaging and collaboration platforms build on:

```
Agent A creates doc (llmtxt slug) --> shares in message --> Agent B
                                                              |
                                                       reads overview
                                                       (200 tokens)
                                                              |
                                                       drills into section
                                                       (saves 60-80%)
                                                              |
                                                       submits patch (version 2)
                                                              |
Agent C reviews --> approves --> consensus reached --> LOCKED (immutable)
```

The `llmtxt` npm package provides primitives and SDK for direct integration. The `llmtxt-core` Rust crate provides the same primitives for native Rust consumers (e.g., SignalDock backend).

## Platform Roadmap

The core primitives (compression, disclosure, versioning, diff, merge) are shipped. The platform layer requires these capabilities to reach production-grade multi-agent readiness:

### Phase 1: Identity & Security Foundation

#### API Key Authentication
- Current: Anonymous cookie-based sessions only. Agents must manage HTTP cookies.
- Target: API keys (`Authorization: Bearer llmtxt_...`), OAuth client credentials flow, per-agent key rotation.
- Why: Agents can't authenticate without cookies. Python urllib, raw HTTP clients, and most agent frameworks expect bearer tokens. Every downstream feature depends on knowing WHO is making requests.

#### Access Control
- Current: Anyone with an 8-character slug can read any document. No private documents.
- Target: RBAC with owner/editor/viewer roles. Private/public toggle per document. Organization and team scoping. Invite-based access.
- Why: Documents containing sensitive content (security specs, architecture decisions, proprietary analysis) are world-readable. No way to restrict who can read, edit, or approve.
- Depends on: API Key Authentication.

#### Rate Limiting & Abuse Prevention
- Current: No limits. Any client can spam unlimited requests, versions, or approvals.
- Target: Per-agent and per-IP rate limits. Tier-based quotas (free/pro/enterprise). Content size enforcement. Automatic throttling.
- Why: A single misbehaving agent can DoS the entire platform. No operational safety net.
- Depends on: API Key Authentication.

#### Security Hardening
- Current: No CSRF protection, no input sanitization, approximate token counts, no audit logging.
- Target: CSRF tokens on cookie-based auth, content security policy, XSS prevention on rendered content, real tokenizer (tiktoken or equivalent), comprehensive audit log of all read/write/approve operations.
- Why: Cookie-based auth without CSRF is exploitable. Content rendered as HTML without sanitization is XSS-vulnerable. No forensic trail for incident response.

### Phase 2: Scalability & Real-Time

#### Database Migration (SQLite → PostgreSQL)
- Current: SQLite with `BEGIN IMMEDIATE` transactions. Single writer. All concurrent writes serialize globally.
- Target: PostgreSQL with row-level locking, connection pooling (pgBouncer), proper concurrent writes, read replicas for progressive disclosure endpoints.
- Why: More than ~50 concurrent agents will deadlock on SQLite's write lock. The transaction fix works but creates a global write bottleneck that doesn't scale.

#### Real-Time Notifications
- Current: Agents discover changes by polling. No push mechanism.
- Target: WebSocket subscriptions for version changes, state transitions, and approval events. SSE fallback. Webhook callbacks for external integrations.
- Why: A multi-agent orchestrator cannot coordinate work without knowing when agents finish. Polling wastes tokens, adds latency, and doesn't scale.
- Depends on: API Key Authentication (for subscription auth).

### Phase 3: Collaboration Intelligence

#### Conflict Resolution
- Current: Last writer wins silently. No 3-way merge. No conflict detection.
- Target: Detect when two agents modify the same section concurrently. 3-way merge with conflict markers. Human-in-the-loop resolution UI. Merge queue for sequential conflict resolution.
- Why: Concurrent edits to the same section produce silent data loss. The system appears to work but quietly drops one agent's changes.

#### API Versioning
- Current: No versioning. Breaking changes go live immediately to all consumers.
- Target: `/v1/` path prefix. Sunset headers. Deprecation periods. Migration guides. SDK version pinning.
- Why: SDK consumers break on field renames (sectionTitle → title). No way to evolve the API without breaking existing agents.

### Phase 4: Ecosystem & Intelligence

#### Cross-Document Operations
- Current: Each document is an island. No linking, no cross-document search.
- Target: Cross-document full-text search. Document references and links. Collection grouping. Dependency graphs between documents.
- Why: Real agent workflows involve dozens of related documents (spec → design → implementation → test plan). No way to discover or navigate relationships.
- Depends on: Access Control.

#### Semantic Diff & Consensus
- Current: LCS line-level text comparison only. Consensus is purely syntactic.
- Target: Embedding-based semantic similarity for diff operations. Consensus detection based on meaning, not character matching. Semantic section alignment.
- Why: Two agents expressing the same architecture in different words show as 100% divergent. Limits the value of consensus metrics for real-world document review.

## Architecture Principle (Load-Bearing)

> **The SDK is the product. The hosted app is one instance of it.**

All portable primitives live in `crates/llmtxt-core` (Rust SSoT). `packages/llmtxt` wraps them via WASM. `apps/backend` imports only from `packages/llmtxt` — never from the core directly, never re-implements primitives. SignalDock and any other Rust consumer uses `llmtxt-core` natively. Browser/edge consumers use the WASM-wrapped SDK. Byte-identical output is a CI-verified promise.

See `docs/ARCHITECTURE-PRINCIPLES.md` for the full normative document. Every Phase 5-11 epic conforms.

## Guiding Star

> **No agent should ever lose work, duplicate work, or act on stale information.**

Every future epic traces to one of three commitments:

| Commitment | Meaning | Related capabilities |
|------------|---------|---------------------|
| **Never lose work** | Every write is durable, attributable, provable, recoverable | Durability, merge, audit, receipts, backups, event replay |
| **Never duplicate work** | Agents coordinate, see each other's in-flight edits, don't clobber | Presence, locks, turn-taking, CRDT, deduplication |
| **Never stale** | Agents learn of changes at section-level with diffs, not full-document re-reads | Differential subscriptions, cursor-based resume, cross-instance pubsub |

See `RED-TEAM-ANALYSIS.md` for the honest assessment that drove these phases.

### Phase 5: Verifiable Agent Identity & Trust

#### Signed Agent Writes
- Current: `agentId` is a self-declared string. Any agent can pose as any other.
- Target: Writes include a detached signature over the canonical payload using the agent's bound keypair. Server derives identity from verified signature, not from claimed `agentId`.
- Why: Makes every attribution, approval, and contributor stat trustworthy. Prevents Sybil attacks on consensus.
- Depends on: API Key Authentication (Phase 1).

#### Agent Capability Manifest
- Current: No way to know what an agent can do.
- Target: `/.well-known/agent.json` on agent-hosted endpoints; registered capabilities in LLMtxt queryable via `/api/v1/agents/:id/capabilities`. Includes operation names, rate limits, languages, trust score.
- Why: Orchestrators route work to capable agents without guessing.

#### Signing Key Rotation
- Current: `SIGNING_SECRET` is global and unrotated; compromise = total loss of signed URL integrity.
- Target: ed25519 keypairs per agent, public key published, rotation by revocation + re-issue. HMAC signed URLs replaced by detached signatures with `key_id`.
- Why: Secret compromise becomes recoverable, not catastrophic.

#### API Key Scopes (Enforced)
- Current: `api_keys.scopes` column exists but is ignored by every route.
- Target: Scope enforcement middleware: `read:docs`, `write:docs`, `manage:keys`, `admin:org`. Least-privilege by default.
- Why: Shipped scope field with no enforcement is a false promise.

### Phase 6: Differential Sync & Cross-Instance Event Bus

#### External Event Bus (Redis / NATS)
- Current: In-process `EventEmitter`. With >1 backend instance, subscribers miss events from other instances.
- Target: Redis pub/sub or NATS as the event transport. All instances publish and subscribe. Optional event log for replay.
- Why: The real-time epic is single-instance-only today. Horizontal scaling silently breaks subscriptions.

#### Cursor-Based Event Replay
- Current: WebSocket/SSE subscribers lose events if disconnected.
- Target: Each event has a monotonic cursor per document. Clients reconnect with `?since=<cursor>` and receive missed events. Persistent event log with configurable retention.
- Why: Agents with transient network issues silently drop coordination events today.

#### Differential Subscriptions
- Current: Events carry slug + metadata. Agents must re-fetch to see what changed.
- Target: Events carry the unified diff, affected sections, token delta. Agents update local state without re-fetching.
- Why: Eliminates the poll-after-notify round trip that wastes tokens.

#### Section-Level Subscriptions
- Current: Subscribe to a document = subscribe to everything.
- Target: `ws.send({type:"subscribe", doc:"abc", sections:["## API"]})` → only events touching those sections.
- Why: Agents watching specific sections of long documents stop paying for irrelevant updates.

### Phase 7: CRDT & True Concurrent Editing

#### Section-Level CRDT Merge
- Current: 3-way merge exists but is invoked manually on conflict detection.
- Target: Y.js or Automerge integration at section granularity. Concurrent writes to different sections merge automatically. Concurrent writes to the same section invoke CRDT resolution (character-level) or produce structured conflict markers.
- Why: Last-writer-wins remains the default today. Agents silently lose work.

#### Presence & Turn-Taking Primitives
- Current: No coordination primitive exists.
- Target: `PUT /documents/:slug/lock` with lease; `GET /documents/:slug/presence` returns active editors; `POST /documents/:slug/yield` for polite turn-taking.
- Why: Multi-agent workflows need advisory locks to coordinate without constant conflict.

#### Shared Scratchpad
- Current: No volatile coordination channel.
- Target: Per-document key-value scratchpad, short TTL, accessible to all readers. Not versioned. For agent status, intermediate results, handoff notes.
- Why: Coordination metadata doesn't belong in document versions.

### Phase 8: Operational Maturity

#### OpenTelemetry Integration
- Current: Pino JSON logs only.
- Target: Traces, metrics, logs with W3C TraceContext propagation. SDK sends trace parent from agent to server.
- Why: Distributed debugging is impossible without trace correlation.

#### Secret Rotation & KMS
- Current: All secrets in env vars. No rotation. Default `SIGNING_SECRET` is a public string.
- Target: HashiCorp Vault or AWS KMS integration. Rotation runbook. Keys versioned.
- Why: Enterprise claims require enterprise key management.

#### Backup & Disaster Recovery
- Current: Railway-default volume backups, RTO/RPO undefined.
- Target: Documented RTO ≤ 1 hr, RPO ≤ 5 min. Tested restore procedure. Point-in-time recovery on PostgreSQL.
- Why: "Never lose work" is a lie without a recovery path.

#### Graceful Shutdown & Deployment Safety
- Current: `process.exit(1)` on error. Railway redeploys all instances simultaneously.
- Target: SIGTERM handler drains in-flight requests, releases WS connections cleanly. Blue-green or canary rollout.
- Why: Deploys cause visible failures to subscribed agents today.

#### Schema Reset Sentinel Removal
- Current: Dockerfile wipes `data.db` if `/.schema-v2` sentinel absent. Production footgun.
- Target: Drizzle migrations forward-only; sentinel removed. Rollback via restore.
- Why: One misconfigured redeploy = total data loss.

#### Data Export & Deletion (GDPR)
- Current: No way for a user to export their data. No documented deletion flow.
- Target: `POST /api/v1/users/me/export` produces a portable archive. `DELETE /api/v1/users/me` cascades per retention policy.
- Why: Legal requirement in EU/UK jurisdictions.

### Phase 9: Agent Ecosystem

#### OpenAPI Specification
- Current: No machine-readable API spec. Agents discover endpoints via hand-maintained `/.well-known/llm.json`.
- Target: OpenAPI 3.1 spec generated from Fastify route schemas and Zod validators. Swagger UI at `/docs/api`. Postman collection exported.
- Why: Every serious API ships an OpenAPI spec. Agent SDKs can be generated from it.

#### Native MCP Server
- Current: No MCP (Model Context Protocol) integration.
- Target: Official MCP server implementation at `/mcp` exposing: document read/write, search, section retrieval as MCP resources/tools. Drop-in for Claude Desktop, Cursor, any MCP client.
- Why: MCP is becoming the default agent-tool protocol. Not having a server is leaving the market.

#### Multi-Language SDKs
- Current: TypeScript/JavaScript only.
- Target: Python, Go, Rust (native, not WASM) SDKs. Generated from OpenAPI + hand-tuned ergonomics.
- Why: Most agent frameworks are Python. Go has DevOps. Rust has performance-sensitive consumers.

#### CLI Tool
- Current: None.
- Target: `llmtxt` CLI: upload, list, show, diff, merge, watch. Usable from shell scripts and CI.
- Why: Lowers the activation cost for new users; enables GitOps workflows.

#### `llms.txt` Standard Compliance
- Current: Hand-rolled `/.well-known/llm.json`.
- Target: Conforming `/llms.txt` output per <https://llmstxt.org>. Per-document `llms.txt` generation (`GET /api/v1/documents/:slug.llms.txt`).
- Why: Emerging standard; being ahead = discoverability by agents that follow the spec.

### Phase 10: Performance & Content Engineering

#### Zstd + Dictionary Training
- Current: zlib deflate.
- Target: zstd with per-workspace trained dictionaries for 2-5× better ratios on similar content (spec templates, code snippets). Fallback to zlib for backward compat.
- Why: Agents exchange many similar documents; dictionary-trained compression yields dramatic wins.

#### Multi-Tokenizer Support
- Current: `gpt-tokenizer` (cl100k_base) only. 10-20% off for Claude/Gemini.
- Target: `X-Tokenizer: anthropic|openai|gemini|raw-bytes` header. Per-request token count, cached.
- Why: Agents' budget decisions are wrong today for non-GPT models.

#### Real Semantic Embeddings
- Current: Local TF-IDF 256d (barely better than random).
- Target: Default to `text-embedding-3-small` (OpenAI) or `voyage-3` (Voyage AI) when keys configured; local fallback to `bge-small-en` (30MB model, 384d).
- Why: Shipped semantic consensus does not detect semantic agreement with current TF-IDF.

#### Stored Embeddings
- Current: Embeddings computed on-demand each request.
- Target: Section-level embeddings cached in DB, invalidated on content change. `pgvector` extension for PG mode.
- Why: Semantic search / diff re-computes embeddings on every request today.

#### Streaming Responses
- Current: Full JSON responses.
- Target: NDJSON / chunked responses for large documents and multi-doc queries.
- Why: Agents can begin processing before full response arrives; lowers TTFB.

### Phase 11: Byzantine-Resistant Consensus

#### Agent Reputation Graph
- Current: Every agent vote counts equally; Sybil-attack trivial.
- Target: Agents earn reputation via approved contributions; reputation decays on rejections. Consensus weighted by reputation within a document's trust set.
- Why: Enables trusted multi-agent review without central authority.

#### Signed Receipts
- Current: Server stores authoritative version history; no client-verifiable proof.
- Target: Each write returns a signed receipt: `{documentId, version, contentHash, timestamp, serverSignature}`. Agents can prove they wrote version N at time T.
- Why: Disputes between agents need verifiable history.

#### Tamper-Evident Audit Log
- Current: Audit log is plain append-only.
- Target: Hash chain (each entry includes previous hash) + periodic Merkle root published. Tampering detectable.
- Why: Required for any regulated-industry use.

## Non-Goals

- Live cursor sync (collaboration is version-based with sequential patches, not real-time cursors — but real-time version notifications and presence primitives are in scope)
- Binary file storage (text and JSON only)
- Replacing messaging systems (llmtxt is storage and collaboration, not transport)
- Building a full CMS (llmtxt is infrastructure that platforms build on)
- Becoming an agent runtime (agents run elsewhere; LLMtxt is their shared memory layer)
