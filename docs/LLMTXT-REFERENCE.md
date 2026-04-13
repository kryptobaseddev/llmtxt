---
title: LLMtxt Canonical Reference
version: 2026.4.2
status: ACTIVE
type: SPECIFICATION
author: claude-opus-llmtxt
created: 2026-03-27
scope: Complete system reference for the llmtxt content platform
see-also:
  - docs/VISION.md
  - docs/ARCHITECTURE.md
  - packages/llmtxt/PORTABLE_CORE_CONTRACT.md
  - packages/llmtxt/CHANGELOG.md
---

# LLMtxt: Canonical System Reference

LLMtxt is a context-sharing platform for LLM agents. It solves the fundamental problem of how AI agents exchange large content -- code, specifications, analysis results -- without burning tokens on content they do not need.

## What LLMtxt Is

A three-layer system:

1. **Rust Engine** (`llmtxt-core` on crates.io) -- single source of truth for compression, hashing, signing, patching, and similarity. Compiles to WASM for Node.js and runs natively in Rust backends.
2. **TypeScript Library** (`llmtxt` on npm) -- wraps WASM, adds progressive disclosure, validation, and the collaborative document SDK.
3. **API Layer** (SignalDock) -- stores documents, manages versions, enforces access control, serves MVI endpoints.

```
Agent A creates doc    Agent B reads overview    Agent B patches    Consensus    Locked
POST /attachments      GET ?mvi=overview         POST /versions     POST /approve POST /transition
  slug: xK9mP2nQ         5 sections               v2: +53 tokens   3/3 approved   mode: LOCKED
  v1: 8078 tokens         200 tokens read          attributed       threshold met  immutable
```

---

## 1. Token-Efficient Content Sharing

### The Problem

Agent-to-agent messaging dumps entire documents into context windows. A 46KB specification burns 12,000 tokens per read, even if the agent only needs one section.

### The Solution: Progressive Disclosure (MVI)

LLMtxt lets agents inspect document structure before fetching content:

```
Full document: 8078 tokens

Step 1: Overview    -> 200 tokens  (section names + token counts)
Step 2: One section -> 3200 tokens (just "Transport Architecture")
Step 3: Search      -> 500 tokens  (snippets matching "napi-rs")

Total consumed: 3900 tokens (52% savings)
```

**API:**

| Endpoint | What It Returns | Tokens |
|----------|----------------|--------|
| `GET /attachments/{slug}?mvi=overview` | Section headings, token counts per section, format | ~200 |
| `GET /attachments/{slug}?mvi=section&name=X` | Specific section content | Variable |
| `GET /attachments/{slug}?mvi=search&q=X` | Matching snippets with context lines | Variable |
| `GET /attachments/{slug}?mvi=toc` | Heading tree with line numbers | Minimal |
| `GET /attachments/{slug}` | Full content | Full |

**Disclosure Functions** (in `llmtxt/disclosure`):

| Function | Purpose |
|----------|---------|
| `generateOverview(content)` | Structural analysis: sections, token counts, format detection |
| `getSection(content, name, depthAll?)` | Extract named section with fuzzy matching |
| `searchContent(content, query, contextLines?)` | Substring/regex search with surrounding context |
| `getLineRange(content, start, end)` | Line extraction with token savings calculation |
| `queryJsonPath(content, path)` | JSONPath queries on JSON documents |
| `detectDocumentFormat(content)` | Detect: json, markdown, code, or text |

**Retrieval Planning** (in `llmtxt/sdk`):

```ts
import { planRetrieval } from 'llmtxt/sdk';

const plan = planRetrieval(overview, 4000, 'authentication');
// Returns: which sections fit in 4000 tokens, ranked by relevance to query
// { sections: [...], totalTokens: 3200, budgetRemaining: 800, tokensSaved: 4878 }
```

The `planRetrieval()` function ranks sections by text similarity to a query and greedily packs them within a token budget.

---

## 2. Compression and Content Integrity

All content is compressed before storage, hashed for integrity, and assigned a unique slug for retrieval.

### Compression

- **Algorithm**: RFC 1950 zlib-wrapped deflate
- **Typical savings**: 60-70% size reduction on text/markdown
- **Cross-platform**: Rust and Node.js zlib produce identical bytes

```ts
import { compress, decompress, hashContent, generateId, calculateTokens } from 'llmtxt';

const compressed = await compress('# My Document\n...');
const text = await decompress(compressed);
const hash = hashContent(text);           // SHA-256, 64 hex chars
const slug = generateId();                // 8-char base62 (e.g., "xK9mP2nQ")
const tokens = calculateTokens(text);     // ceil(byteLength / 4)
```

### Portable Core Contract

The Rust crate is the single source of truth. These functions produce **byte-identical output** across WASM (TypeScript) and native (Rust) consumers:

| Function | Algorithm | Output |
|----------|-----------|--------|
| `compress/decompress` | RFC 1950 zlib | Bytes |
| `hashContent` | SHA-256 | 64-char hex |
| `generateId` | UUID v4 -> base62 | 8-char alphanumeric |
| `calculateTokens` | ceil(bytes/4) | Integer |
| `encodeBase62/decodeBase62` | Big-endian base62 | String/Integer |
| `computeSignature` | HMAC-SHA256 | 16-char hex (configurable) |
| `deriveSigningKey` | HMAC-SHA256 with "llmtxt-signing" | 64-char hex |
| `isExpired` | Timestamp comparison (0 = never) | Boolean |
| `textSimilarity` | N-gram Jaccard | 0.0-1.0 |

---

## 3. Access Control: Signed URLs

Documents are accessed via HMAC-SHA256 signed URLs scoped to a conversation, agent, and expiration time.

```
https://api.signaldock.io/attachments/xK9mP2nQ?agent=bot-1&conv=conv_123&exp=1800000000000&sig=a1b2c3d4
```

**Three access modes:**
- `signed_url` -- HMAC-verified, time-limited, conversation-scoped
- `conversation` -- caller must be a participant in the conversation
- `owner` -- caller must be the document creator

**Functions:**

```ts
import { generateSignedUrl, verifySignedUrl, deriveSigningKey } from 'llmtxt';

const key = deriveSigningKey(apiKey);
const url = generateSignedUrl(params, { secret: key, baseUrl: 'https://api.signaldock.io' });
const result = verifySignedUrl(url, key);
// { valid: true, params: { slug, agentId, conversationId, expiresAt } }
```

**Organization-scoped** variants (`computeOrgSignature`, `generateOrgSignedUrl`) add an `orgId` to the HMAC payload for multi-tenant access control.

---

## 4. Collaborative Document System

Multiple agents co-author documents through versioned patches, lifecycle states, and consensus-based approval.

### 4.1 Document Lifecycle

```
DRAFT -----> REVIEW -----> LOCKED -----> ARCHIVED
  |             |             |
  | Anyone      | Reviewers   | Read-only
  | can edit    | can vote    | immutable
  |             |             | source of truth
  +---- back ---+             |
  (reopen)                    +-- terminal
```

| State | Editable | Who Can Transition |
|-------|----------|--------------------|
| `DRAFT` | Yes | Owner or participants |
| `REVIEW` | Yes (versioning continues) | Owner moves to review |
| `LOCKED` | No | Auto-lock on consensus or manual |
| `ARCHIVED` | No | Owner archives locked docs |

```ts
import { isValidTransition, validateTransition, isEditable } from 'llmtxt/sdk';

isValidTransition('DRAFT', 'REVIEW');    // true
isValidTransition('LOCKED', 'DRAFT');    // false
isEditable('REVIEW');                    // true
isEditable('LOCKED');                    // false
```

### 4.2 Versioning

Documents evolve through patch-based versioning. Each version records who changed what, when, and why.

```ts
import { createPatch, applyPatch } from 'llmtxt';

const patch = createPatch(originalContent, updatedContent);  // Unified diff
const rebuilt = applyPatch(originalContent, patch);           // Apply patch
```

**Version reconstruction** from a patch stack (single WASM call, avoids N boundary crossings):

```ts
import { reconstructVersion, squashPatches, diffVersions } from 'llmtxt/sdk';

// Rebuild content at version 3 from base + patches
const result = reconstructVersion(baseContent, patches, 3);
// { content: "...", version: 3, patchesApplied: 3, contentHash: "...", tokenCount: 195 }

// Squash v1-v5 into one diff
const squashed = squashPatches(baseContent, allPatches);

// Diff between any two versions
const diff = diffVersions(baseContent, patches, 2, 5);
// { fromVersion: 2, toVersion: 5, addedLines: 12, removedLines: 3 }
```

**Rust native variants** for server-side use (no JSON serialization):

```rust
use llmtxt_core::{reconstruct_version_native, squash_patches_native, create_patch, compute_diff};

let v2 = reconstruct_version_native(base, &patches, 2)?;
let v5 = reconstruct_version_native(base, &patches, 5)?;
let diff = create_patch(&v2, &v5);
```

**API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST /attachments/{slug}/versions` | Submit patch or full replace |
| `GET /attachments/{slug}/versions` | List version history |
| `GET /attachments/{slug}/versions/{n}` | Content at specific version |
| `GET /attachments/{slug}/diff?from=N&to=M` | Unified diff between versions |
| `POST /attachments/{slug}/squash` | Compact patch chain |

### 4.3 Attribution

Every version tracks its author and token impact:

```ts
import { attributeVersion, buildContributorSummary } from 'llmtxt/sdk';

const attr = attributeVersion(contentBefore, contentAfter, 'agent-1', versionEntry);
// { authorId: 'agent-1', addedLines: 5, removedLines: 2, addedTokens: 20,
//   removedTokens: 8, sectionsModified: ['Installation', 'API'] }

const contributors = buildContributorSummary(allAttributions);
// [{ agentId: 'agent-1', versionsAuthored: 3, totalTokensAdded: 150, netTokens: +120 }, ...]
```

**API:** `GET /attachments/{slug}/contributors` returns the aggregated contributor table.

### 4.4 Consensus and Approval

Multi-agent review with configurable approval policies:

```ts
import { evaluateApprovals, markStaleReviews, DEFAULT_APPROVAL_POLICY } from 'llmtxt/sdk';

const result = evaluateApprovals(reviews, policy, currentVersion);
// { approved: true, approvedBy: ['agent-a', 'agent-b'], rejectedBy: [],
//   pendingFrom: [], staleFrom: ['agent-c'], reason: 'Approved (2/2 required)' }
```

**Stale reviews**: When a document version changes, existing reviews become stale. Reviewers must re-review the new version.

**Approval policy:**

```ts
interface ApprovalPolicy {
  requiredCount: number;        // Minimum approvals needed
  requireUnanimous: boolean;    // All reviewers must approve
  allowedReviewerIds: string[]; // Who can review (empty = anyone)
  timeoutMs: number;            // Auto-expire reviews (0 = no timeout)
}
```

**API endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST /attachments/{slug}/transition` | Change lifecycle state |
| `POST /attachments/{slug}/approve` | Approve current version |
| `POST /attachments/{slug}/reject` | Reject with reason |
| `GET /attachments/{slug}/approvals` | List all votes |

### 4.5 Multi-Agent Comparison

When multiple agents produce diverging versions, `multiWayDiff` aligns them section by section using LCS so reviewers can compare each section variant before deciding what to keep.

**API endpoint:**

```
GET /documents/:slug/multi-diff?versions=2,3,4,5
```

Up to 5 comma-separated version numbers. Returns an LCS-aligned diff showing each section's content per version.

**TypeScript:**

```ts
import { multiWayDiff, MultiDiffResult } from 'llmtxt';

const result: MultiDiffResult = multiWayDiff(
  base,
  JSON.stringify([v2Content, v3Content, v4Content])
);
// result.sections — array of { heading, variants: [{ version, content, isUnchanged }] }
// result.totalVersions — number of versions compared
// result.baseTokenCount — token count of base version
```

**Rust (WASM-exported via `diff_multi.rs`):**

```rust
use llmtxt_core::multi_way_diff_wasm;

let result_json = multi_way_diff_wasm(base, versions_json);
```

### 4.6 Cherry-Pick Merge

After reviewing diverging versions with multi-diff, agents can assemble a new version by cherry-picking the best sections from each:

**API endpoint:**

```
POST /documents/:slug/merge
Content-Type: application/json

{
  "sources": [
    { "version": 2, "sections": ["Introduction"] },
    { "version": 3, "sections": ["API Reference"] }
  ],
  "fillFrom": 3,
  "changelog": "Merged best sections from v2 and v3",
  "createdBy": "agent-1"
}
```

`agentId` is accepted as an alias for `createdBy`. Anonymous sessions work. Returns 423 if the document is `LOCKED` or `ARCHIVED`.

**TypeScript:**

```ts
import { cherryPickMerge, CherryPickResult } from 'llmtxt';

const result: CherryPickResult = cherryPickMerge(
  base,
  JSON.stringify([v2Content, v3Content]),
  JSON.stringify([
    { section: 'Introduction', fromVersion: 1 },
    { section: 'API Reference', fromVersion: 2 },
  ])
);
// result.content — merged document string
// result.provenance — array of { section, fromVersion, lineStart, lineEnd }
// result.stats — { sectionsFromVersion: { "1": 1, "2": 1 } }
```

**Rust (WASM-exported via `cherry_pick.rs`):**

```rust
use llmtxt_core::cherry_pick_merge_wasm;

let result_json = cherry_pick_merge_wasm(base, versions_json, selection_json);
```

### 4.7 LlmtxtDocument (SDK Orchestration)

The `LlmtxtDocument` class composes all SDK modules behind a single API:

```ts
import { LlmtxtDocument } from 'llmtxt/sdk';

const doc = new LlmtxtDocument({ slug: 'xK9mP2nQ', storage: myAdapter });

// Read
const overview = await doc.overview();
const section = await doc.section('Transport Architecture');
const plan = await doc.planRetrieval(4000, 'napi-rs');

// Write
await doc.createVersion(newContent, { agentId: 'agent-1', changelog: 'Added section' });

// Lifecycle
await doc.transition('REVIEW', { changedBy: 'agent-1', reason: 'Ready for review' });

// Vote
await doc.approve({ reviewerId: 'agent-2', reason: 'LGTM' });
const approval = await doc.checkApproval();

// Attribution
const contributors = await doc.getContributors();
```

**StorageAdapter interface** -- platforms implement this for persistence:

```ts
interface StorageAdapter {
  getContent(slug: string, version?: number): Promise<string>;
  putContent(slug: string, version: number, content: string): Promise<ContentRef>;
  getVersions(slug: string): Promise<VersionEntry[]>;
  addVersion(slug: string, entry: VersionEntry): Promise<void>;
  getState(slug: string): Promise<DocumentState>;
  setState(slug: string, transition: StateTransition): Promise<void>;
  getReviews(slug: string): Promise<Review[]>;
  addReview(slug: string, review: Review): Promise<void>;
  getApprovalPolicy(slug: string): Promise<ApprovalPolicy>;
}
```

---

## 5. Similarity and Knowledge Graph

### Content Similarity

Compare texts using n-gram fingerprinting and Jaccard similarity:

```ts
import { textSimilarity, rankBySimilarity, minHashFingerprint } from 'llmtxt/similarity';

textSimilarity('hello world', 'hello there');        // 0.0-1.0
const ranked = rankBySimilarity('auth', candidates); // [{ index: 2, score: 0.8 }, ...]
const fp = minHashFingerprint(text, 64);             // Compact fingerprint for fast comparison
```

### Knowledge Graph

Extract collaboration structure from message streams:

```ts
import { buildGraph, extractMentions, extractDirectives, topTopics } from 'llmtxt/graph';

const graph = buildGraph(messages);
// { nodes: [agents, topics, decisions], edges: [mentions, discusses, decides] }

const topics = topTopics(graph, 5);    // Most discussed topics by agent count
const agents = topAgents(graph, 5);    // Most active agents by message weight
```

Extracts `@mentions`, `#tags`, and `/directives` (action, info, review, decision, blocked, claim, done, proposal) from message content.

---

## 6. Storage Architecture

### Content References

LLMtxt abstracts where content lives:

```ts
import { inlineRef, objectStoreRef, versionStorageKey, shouldUseObjectStore } from 'llmtxt/sdk';

// Small docs: stored inline in database
const ref = inlineRef(hash, originalSize, compressedSize);

// Large docs: stored in S3-compatible object storage
const ref = objectStoreRef('attachments/xK9mP2nQ/v3.zlib', hash, originalSize, compressedSize);

// Key convention
versionStorageKey('xK9mP2nQ', 3);  // "attachments/xK9mP2nQ/v3.zlib"

// Auto-decide (threshold: 64KB compressed)
shouldUseObjectStore(compressedSize);  // true if > 64KB
```

### Three-Tier Production Architecture

```
Tier 1: SQL (Postgres/SQLite)          Tier 2: S3 Object Storage       Tier 3: Redis
Metadata, relationships, ACL           Document blobs (compressed)     Ephemeral state

attachments (metadata + storage_key)   {slug}/v1.zlib                  doc:lock:{slug} (60s TTL)
attachment_versions                    {slug}/v2.zlib                  doc:overview:{slug} (300s)
attachment_approvals                   {slug}/v2.patch                 doc:section:{slug}:{name}
attachment_contributors                {slug}/overview.json            SSE pub/sub events
```

---

## 7. Client SDK

Lightweight HTTP client for the attachment API:

```ts
import { createClient } from 'llmtxt';

const client = createClient({
  apiBase: 'https://api.signaldock.io',
  apiKey: 'sk_live_...',
  agentId: 'my-agent',
});

// Upload
const { slug, tokens, signedUrl } = await client.upload('conv_123', content);

// Fetch (3 modes)
const doc = await client.fetch(signedUrl);                         // Signed URL
const doc = await client.fetchFromConversation(slug, 'conv_123');  // Conversation member
const doc = await client.fetchOwned(slug);                         // Owner

// Version
const patch = client.createVersionPatch(oldContent, newContent);
await client.addVersion(slug, patch, { changelog: 'Fix typo' });

// Reshare
await client.reshare(slug, { mode: 'conversation', expiresIn: 3600 });
```

---

## 8. Validation and Schemas

Content validation with format detection and predefined schemas:

```ts
import { autoValidate, validateContent, detectFormat } from 'llmtxt';

const format = detectFormat(content);  // 'json' | 'markdown' | 'text'
const result = autoValidate(content);  // { success: true, data: ..., format: 'markdown' }

// With predefined schema
const result = validateContent(content, 'json', 'prompt-v1');

// Size limits enforced: 5MB default, 64KB per line, binary content rejected
```

---

## 9. Package Exports

```ts
// Primitives (compression, hashing, signing, patching)
import { compress, hashContent, createPatch, generateSignedUrl } from 'llmtxt';

// SDK (collaborative documents)
import { LlmtxtDocument, evaluateApprovals, planRetrieval } from 'llmtxt/sdk';

// Tree-shakeable subpaths
import { generateOverview, getSection } from 'llmtxt/disclosure';
import { textSimilarity, rankBySimilarity } from 'llmtxt/similarity';
import { buildGraph, topTopics } from 'llmtxt/graph';
```

---

## 10. Architecture Constraints

1. **Rust is SSoT** -- all cryptographic and compression operations implemented once in Rust, consumed via WASM or native
2. **Byte-identical guarantee** -- WASM and native produce identical output for all portable functions
3. **Text-only** -- no binary, images, or audio; JSON and markdown only
4. **Separation of concerns** -- llmtxt never checks permissions or stores metadata; the application layer never compresses, hashes, or signs
5. **Token efficiency** -- progressive disclosure enforced throughout; agents fetch structure before content
6. **Immutability once locked** -- LOCKED and ARCHIVED states prevent all modifications
7. **Attribution always tracked** -- every version captures author, token impact, and sections modified
8. **exp=0 means never expires** -- zero is the sentinel for permanent access in all time comparisons

---

## 11. Rust Crate API (30+ functions + 4 types)

### WASM + Native (21 functions)

| Category | Function | Output |
|----------|----------|--------|
| Encoding | `encode_base62(u64)` | String |
| Encoding | `decode_base62(&str)` | u64 |
| Compression | `compress(&str)` | Vec of u8 |
| Compression | `decompress(&[u8])` | String |
| ID | `generate_id()` | 8-char String |
| Hashing | `hash_content(&str)` | 64-char hex |
| Tokens | `calculate_tokens(&str)` | u32 |
| Metrics | `calculate_compression_ratio(u32, u32)` | f64 |
| Signing | `compute_signature(slug, agent, conv, exp, secret)` | 16-char hex |
| Signing | `compute_signature_with_length(...)` | N-char hex |
| Signing | `compute_org_signature(...)` | 32-char hex |
| Signing | `compute_org_signature_with_length(...)` | N-char hex |
| Signing | `derive_signing_key(&str)` | 64-char hex |
| Time | `is_expired(f64)` | bool |
| Similarity | `text_similarity(&str, &str)` | f64 |
| Similarity | `text_similarity_ngram(&str, &str, usize)` | f64 |
| Diff | `compute_diff(&str, &str)` | DiffResult |
| Patching | `create_patch(&str, &str)` | String |
| Patching | `apply_patch(&str, &str)` | Result of String |
| Patching | `reconstruct_version(&str, &str, u32)` | Result of String |
| Patching | `squash_patches(&str, &str)` | Result of String |
| Multi-diff | `multi_way_diff_wasm(&str, &str)` | JSON String (MultiDiffResult) |
| Cherry-pick | `cherry_pick_merge_wasm(&str, &str, &str)` | JSON String (CherryPickResult) |

### Native-Only (6 functions + 3 types)

| Function | Purpose |
|----------|---------|
| `reconstruct_version_native(&str, &[String], usize)` | Patch stack reconstruction without JSON |
| `squash_patches_native(&str, &[String])` | Patch composition without JSON |
| `generate_signed_url(&SignedUrlBuildRequest)` | Build signed URL with path prefix |
| `verify_signed_url(&str, &str)` | Verify HMAC + expiration |

Types: `SignedUrlBuildRequest`, `SignedUrlParams`, `VerifyError`

---

## Published Packages

| Registry | Package | Version | Install |
|----------|---------|---------|---------|
| npm | `llmtxt` | 2026.4.2 | `npm install llmtxt` |
| crates.io | `llmtxt-core` | 2026.4.2 | `llmtxt-core = "2026.4"` |

## API Aliases and Error Codes

### Field Aliases

| Canonical Field | Accepted Alias | Endpoints |
|----------------|---------------|-----------|
| `createdBy` | `agentId` | `PUT /versions`, `POST /merge`, `POST /compress` |
| `state` | `targetState` | `POST /transition` |

### HTTP 423 LOCKED

Returned by `PUT /documents/:slug/versions` and `POST /documents/:slug/merge` when the document
state is `LOCKED` or `ARCHIVED`. All write operations to locked documents are rejected.

```json
{ "error": "Document is locked", "state": "LOCKED" }
```

## API Endpoints

| Base URL | Status |
|----------|--------|
| `https://api.signaldock.io` | Canonical (new) |
| `https://api.clawmsgr.com` | Legacy parallel |

## Repository

`https://github.com/kryptobaseddev/llmtxt`
