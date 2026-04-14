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

## Non-Goals

- Live cursor sync (collaboration is version-based with sequential patches, not real-time cursors — but real-time version notifications are in scope)
- Binary file storage (text and JSON only)
- Replacing messaging systems (llmtxt is storage and collaboration, not transport)
- Building a full CMS (llmtxt is infrastructure that platforms build on)
