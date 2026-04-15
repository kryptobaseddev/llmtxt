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
- **Rust SSoT**: All cryptographic and compression operations are implemented once in Rust, consumed via WASM (TypeScript) or direct Rust deps (Rust backends). Byte-identical output is CI-verified. (Native JS bindings deferred — WASM-only until benchmarks justify.)

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

## Phase 12+ — Layered Roadmap from 2026-04-15 Red-Team Analysis

> **Source**: `docs/RED-TEAM-ANALYSIS-2026-04-15.md` (supersedes `docs/RED-TEAM-ANALYSIS.md`)
>
> **Honest Assessment**: LLMtxt today scores **5.3/10** (up from 4.2/10 after T111 SDK-first refactor). SOTA peers (Notion, Liveblocks, Convex, PartyKit) score 7.5–8.5. The roadmap below is the credible engineering path to 8.0/10 if Layers 1–3 execute. This is not a marketing claim; it is a measured gap analysis.

### Score Progression

| Version | Composite | Drivers |
|---------|-----------|---------|
| 2026-04-14 | 4.2 | Phase 1–4 shipped; multi-agent core unbuilt; observability zero |
| 2026-04-15 (post-T111) | 5.3 | T111 SDK boundary restored; T093 schema-reset footgun removed; T108 P0 security remediated; CI hardening landed; multi-agent core still zero |
| Target (post-Layers-1–3) | 8.0 | CRDT merge, verified identity, event ordering, observability, backup/DR, Byzantine resistance |

### Refined Guiding Star (7 Properties)

Every future feature advances one of these:

| Property | Meaning | Layers |
|----------|---------|--------|
| Know what is true now | Current state, no stale reads | Layer 1 (MA-7, MA-2), Layer 2 (OPS-1) |
| Know who else is here | Presence, capabilities, activity | Layer 1 (MA-2, MA-4) |
| Know what changed | Differential updates since offset | Layer 1 (MA-6), Layer 5 (DIFF-1) |
| Contribute safely | Turn-taking, conflict-free merge, signed identity, scoped perms | Layer 1 (MA-1, MA-2, MA-5), Layer 3 (SEC-5, SEC-8) |
| Verify nothing was tampered with | Cryptographic chain, byte-identity across runtimes | Layer 1 (MA-2), Layer 3 (SEC-3) |
| Lose nothing on failure | Durable, replicated, restore-tested | Layer 2 (OPS-2, OPS-3) |
| Not impede others | Rate limits, fair scheduling, no blocking | Layer 1 (MA-7), Layer 4 (DX), Layer 2 (OPS-4) |

### Layer-by-Layer Feature Catalog

#### Layer 1 — Multi-Agent Foundations (10 epics)

Cannot claim "multi-agent" without these. Enables all downstream work.

| Epic | Title | What it delivers | Wave | Status |
|------|-------|------------------|------|--------|
| MA-1 | CRDT Collaboration Core | Section-level Yrs integration; real-time deltas; conflict-free concurrent edits | W1 | EXTENDS T083 |
| MA-2 | Verified Agent Identity | Ed25519 keypairs; signed submissions; cryptographic receipts | W1 | EXTENDS T076 |
| MA-3 | Agent Capability Manifest | `/.well-known/agents/{id}` discovery; supported ops; schema versions | W1 | NEW |
| MA-4 | Presence + Awareness | Who is editing now; cursor positions; selection ranges per section | W2 | EXTENDS T084 |
| MA-5 | Turn-Taking Leases | Claim section X for N seconds; auto-release; conflict on overlap | W2 | NEW |
| MA-6 | Differential Subscriptions | `?since=<event_seq>` returns deltas; agents stream from offset | W2 | EXTENDS T082 |
| MA-7 | Event Ordering Guarantees | Per-document monotonic event log; replay; idempotent event IDs | W1 | NEW |
| MA-8 | Byzantine Resistance | Multi-sig thresholds; signature on each state transition; tamper-evident chain | W7 | EXTENDS T108 |
| MA-9 | Shared Scratchpad / Comments | Ephemeral comments per section; agent-to-agent threads; resolved/open state | W3 | EXTENDS T088 |
| MA-10 | Agent-to-Agent Direct Messaging | Conduit channel between two agents about a doc (not just webhooks-to-URLs) | W3 | NEW |

#### Layer 2 — Operational Reliability (10 epics)

Cannot claim "production-ready" without these. Prerequisites for enterprise deployments.

| Epic | Title | What it delivers | Wave | Status |
|------|-------|------------------|------|--------|
| OPS-1 | Observability Stack | Pino → Loki/Datadog; OpenTelemetry traces; Sentry; metrics endpoint | W0 | EXTENDS T089 |
| OPS-2 | Backup + Point-in-Time Recovery | Litestream/pgbackrest; daily snapshots to S3; RTO ≤1hr, RPO ≤5min | W4 | EXTENDS T091 |
| OPS-3 | Replication / Read Replicas | Async replicas on PostgreSQL; SQLite single-region documented | W4 | NEW |
| OPS-4 | SLO/SLI Definition | p50/p95/p99 latency targets; error budget; alert routing | W0 | NEW |
| OPS-5 | Graceful Shutdown + Drain | SIGTERM handler; finish in-flight requests; close DB cleanly | W4 | EXTENDS T092 |
| OPS-6 | Migration Safety in CI | Run `drizzle-kit migrate` on fresh sqlite in every PR; reject duplicates | W0 | NEW |
| OPS-7 | Strict Release Runbook | Pre-publish checklist; provenance enforced; CHANGELOG-of-record validated | W0 | NEW |
| OPS-8 | Chaos / Fault Injection Tests | Kill DB mid-write; partition WS; clock skew; full disk; verify recovery | W4 | NEW |
| OPS-9 | Load Tests + Benchmarks | k6/wrk scripts on hot paths; published baseline; regression-tested in CI | W4 | NEW |
| OPS-10 | Secret Rotation Runbook | API_KEY_SECRET, SESSION_SECRET, tokens automated where possible | W1 | EXTENDS T090 |

#### Layer 3 — Security Hardening (8 epics)

Table-stakes for 2026. Prerequisite for regulated-industry use.

| Epic | Title | What it delivers | Wave | Status |
|------|-------|------------------|------|--------|
| SEC-1 | CSP + HSTS + COEP | Content-Security-Policy, Cross-Origin-Embedder-Policy, HSTS preload verification | W3 | NEW |
| SEC-2 | Markdown XSS Sanitization E2E | Validate every render path; fuzz with OWASP payloads | W3 | NEW |
| SEC-3 | Tamper-Evident Audit Log | Hash chain over events; merkle root committed daily to external timestamp | W7 | EXTENDS T108 |
| SEC-4 | Webhook Delivery Hardening | Exponential backoff; dead-letter queue; consumer-side replay protection | W3 | NEW |
| SEC-5 | Row-Level Security (PG) | RLS policies enforce org/role/visibility at DB layer, not just app | W3 | NEW |
| SEC-6 | Anonymous Mode Threat Model | Document what anon CAN and CANNOT do; aggressive rate-limit; session expiry contract | W3 | NEW |
| SEC-7 | PII Handling + GDPR Readiness | Identify PII; retention policy; right-to-erasure; export-my-data endpoint | W4 | EXTENDS T094 |
| SEC-8 | API Key Scopes Enforcement | scopes:* is placeholder today; implement scope-by-route enforcement | W2 | EXTENDS T085 |

#### Layer 4 — Developer Experience (7 epics)

Make the platform discoverable and usable by non-Rust, non-TS teams.

| Epic | Title | What it delivers | Wave | Status |
|------|-------|------------------|------|--------|
| DX-1 | OpenAPI 3.1 Auto-Generated | Forge-ts from routes; `/openapi.json` + Swagger UI at `/docs/api`; Postman | W5 | EXTENDS T095 |
| DX-2 | Multi-Language SDKs | Python (PyO3), Go (codegen), Rust (native), TS (existing) | W5 | EXTENDS T097 |
| DX-3 | CLI for Agents | `llmtxt` CLI: auth, submit version, fetch sections, watch; CI-reusable | W5 | EXTENDS T098 |
| DX-4 | Reference Agent Implementations | Worked examples: write-only, review, consensus, summarizer bots in `examples/` | W5 | NEW |
| DX-5 | Local Dev with Realistic Data | Seed script, fixtures, "spawn 5 fake agents" simulator | W5 | NEW |
| DX-6 | Error Message Catalog | Every error code has a docs page: "what happened, why, what to do" | W5 | NEW |
| DX-7 | Forge-ts Coverage Gate | TSDoc as CI gate; doctest as test runner; lock against drift | W5 | NEW |

#### Layer 5 — Differentiated Capabilities (8 epics)

These would matter competitively. Most depend on Layer 1 shipping first.

| Epic | Title | What it delivers | Wave | Status |
|------|-------|------------------|------|--------|
| DIFF-1 | Truly Differential Disclosure | `?since=<event_seq>` returns delta-only; subscribe to "section X only" | W2 | EXTENDS prior finding |
| DIFF-2 | Embedding-Based Semantic Search | Real embeddings (sentence-transformers); vector DB (qdrant/pgvector); cross-doc search | W6 | EXTENDS T102 |
| DIFF-3 | Cross-Document Graph Queries | "Show me docs linking to X"; backlinks; topic clusters | W6 | EXTENDS T122 |
| DIFF-4 | Block / Suggestion Mode | Inline suggestions with accept/reject; multi-agent threads | W6 | NEW |
| DIFF-5 | Snapshot Diff with Operational Semantics | "Agent X added clause Y at T+12s" not just "line A→B" | W6 | NEW |
| DIFF-6 | Federated Documents | Doc on instance A references/pulls from instance B; cross-instance auth | W6 | NEW |
| DIFF-7 | Time-Travel + Branch | Git-like branches per doc; merge between branches; per-branch rosters | W5 | EXTENDS versioning system |
| DIFF-8 | LLM-Aware Compression | Adaptive zstd dictionaries per doc-cluster; better than generic zlib | W6 | EXTENDS T100 |

#### Layer 6 — Compliance / Trust (5 epics)

Enterprise gate-keepers. Ship after core is proven.

| Epic | Title | What it delivers | Wave | Status |
|------|-------|------------------|------|--------|
| COMP-1 | SOC 2 Type 1 Readiness | Control inventory; gap analysis; remediation plan | W6 | NEW |
| COMP-2 | Data Residency Options | Multi-region deploy plan; document where tenant data lives | W6 | NEW |
| COMP-3 | Audit Log Retention + Export | 7-year retention with archive tier; legal-hold flag; JSON/CSV export | W6 | EXTENDS SEC-3 |
| COMP-4 | Right-to-Deletion Endpoint | DELETE /api/me cascades; 30-day grace; documented | W4 | EXTENDS T094 |
| COMP-5 | Sub-Processor List + DPA Template | Public list (Cloudflare, Railway, npm, etc.); DPA on request | W6 | NEW |

### Wave Schedule — Ship Order

The dependency analysis from `docs/RED-TEAM-ANALYSIS-2026-04-15.md` (Dependency Order section) drives this wave sequence.

| Wave | Label | Epics | Rationale | Parallel agents |
|------|-------|-------|-----------|-----------------|
| W0 | Clear Blockers | T093, T108, OPS-1 MVP, OPS-6, OPS-7 | Cannot ship anything safely without observability, migration safety, release discipline, and footgun removal | 2–3 in parallel |
| W1 | Multi-Agent Roots | MA-1 (CRDT), MA-2 (verified identity), MA-7 (event ordering), T076, T077, T090, OPS-10 | Three pillars everything else depends on; secret rotation prerequisite for identity in prod | 3 in parallel |
| W2 | Presence + Diff | MA-4, MA-6, DIFF-1, T082, T078, T110, SEC-8 | Now have CRDT + identity + events; wire presence + delta subscriptions | 6 in parallel |
| W3 | Security Hardening | SEC-1, SEC-2, SEC-4, SEC-5, SEC-6, MA-9 (scratchpad) | After core works, lock it down | 6 in parallel |
| W4 | Ops Maturity | OPS-2, OPS-3, OPS-5, OPS-8, OPS-9, SEC-7, COMP-4, MA-9, MA-10 | Backup, DR, graceful deployment, chaos testing | 8 in parallel |
| W5 | Ecosystem & DX | T095, DX-1, DX-2, DX-3, DX-4, DX-5, DX-6, DX-7, DIFF-7, T096, T098 | Publish the platform; then unlock downstream SDK consumers | 10 in parallel |
| W6 | Advanced Semantics | DIFF-2, DIFF-3, DIFF-4, DIFF-5, DIFF-6, DIFF-8, COMP-1, COMP-2, COMP-3, COMP-5 | Differentiation + compliance; depends on Layer 1 proven | 10 in parallel |

### Honest Prose Conclusion

LLMtxt today (post-T111) is **5.3/10**: well-architected SDK boundary, proven progressive-disclosure pattern, reliable versioning primitives, but missing the multi-agent collaboration core (CRDT, verified identity, event ordering), operational observability, and Byzantine-resistant consensus.

This roadmap is the credible engineering path to **8.0/10**. Layers 1–3 (multi-agent foundations, operational reliability, security hardening) are load-bearing. They define the gap to SOTA peers like Notion, Liveblocks, and Convex. Layers 4–6 are differentiation and ecosystem reach.

Execution discipline is proven: T111 was hard, careful work. The deploy-safety fixes today are lessons recorded. The 6–12 month timeline to Layers 1–3 complete is achievable if focus holds.

The honest claim is not "LLMtxt will be the best ever." It is "**If Layers 1–3 ship, LLMtxt will be a genuine SOTA multi-agent document substrate worthy of enterprise adoption.**" The roadmap is not speculation; the work is identified, sized, and sequenced. The only unknown is execution discipline.

## Non-Goals

- Live cursor sync (collaboration is version-based with sequential patches, not real-time cursors — but real-time version notifications and presence primitives are in scope)
- Binary file storage (text and JSON only)
- Replacing messaging systems (llmtxt is storage and collaboration, not transport)
- Building a full CMS (llmtxt is infrastructure that platforms build on)
- Becoming an agent runtime (agents run elsewhere; LLMtxt is their shared memory layer)
