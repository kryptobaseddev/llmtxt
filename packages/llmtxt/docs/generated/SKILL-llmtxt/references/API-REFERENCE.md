# llmtxt — API Reference

## Table of Contents

- [Functions](#functions)
- [Types](#types)
- [Classes](#classes)
- [Constants](#constants)

## Functions

### `setLocalAwarenessState`

Set the local agent's awareness state on a WebSocket connection. Encodes the state and sends it to the server (which relays to peers).

```typescript
(conn: WebSocket | { send(data: Uint8Array | Buffer): void; }, state: AwarenessState) => void
```

**Parameters:**

- `conn` — Active WebSocket connection.
- `state` — The awareness state to broadcast.

### `onAwarenessChange`

Subscribe to awareness state changes on a WebSocket connection. The callback is invoked with the full current state map whenever a peer's awareness changes.

```typescript
(conn: WebSocket | { on?(event: string, handler: (data: Buffer | Uint8Array) => void): void; addEventListener?(type: string, handler: (event: { data: unknown; }) => void): void; }, fn: (states: Map<number, AwarenessState>) => void) => Unsubscribe
```

**Parameters:**

- `conn` — Active WebSocket connection.
- `fn` — Callback invoked with updated MapclientId, AwarenessState.

**Returns:** Unsubscribe function.

### `getAwarenessStates`

Get the current awareness states for all known clients on a connection.

```typescript
(conn: WebSocket | object) => Map<number, AwarenessState>
```

**Parameters:**

- `conn` — Active WebSocket connection.

**Returns:** MapclientId, AwarenessState.

### `classifyContent`

Classify the content of `input` using a three-layer pipeline: magic-byte detection → text/binary gate → heuristic text analysis.  All classification logic runs in Rust WASM (SSoT: `crates/llmtxt-core/src/classify/`). This function is a thin adapter that normalises inputs and maps enum variants.

```typescript
(input: string | Uint8Array | Buffer) => ClassificationResult
```

**Parameters:**

- `input` — Raw content as a `string`, `Uint8Array`, or `Buffer`.   - `string`: encoded to UTF-8 bytes before classification.   - `Uint8Array` / `Buffer`: passed directly (no copy if already Uint8Array).

**Returns:** A `ClassificationResult` describing the detected content type.

```ts
import { classifyContent } from 'llmtxt';

const result = classifyContent('# Hello\n\nMarkdown content.');
console.log(result.format);      // 'markdown'
console.log(result.mimeType);    // 'text/markdown'
console.log(result.confidence);  // 0.8

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
const pdfResult = classifyContent(pdfBytes);
console.log(pdfResult.format);   // 'pdf'
console.log(pdfResult.confidence); // 1.0
```

### `detectFormatFromClassification`

Map a `ClassificationResult` to the legacy four-value format string.  Used internally by the `detectDocumentFormat` back-compat reroute (T828). External callers should use `classifyContent` directly for new code.

```typescript
(result: ClassificationResult) => "json" | "markdown" | "code" | "text"
```

### `compress`

Compress a UTF-8 string using zstd (RFC 8478), level 3.  New writes use zstd. Existing zlib-compressed rows are still readable via `decompress`, which detects the codec by magic bytes.  Delegates to crates/llmtxt-core::compress (Rust WASM).

```typescript
(data: string) => Promise<Buffer>
```

### `decompress`

Decompress bytes back to a UTF-8 string.  Auto-detects codec by magic bytes: - `0xFD 0x2F 0xB5 0x28` → zstd (new writes) - `0x78 __` → zlib/deflate (legacy rows — backward compatible)  Delegates to crates/llmtxt-core::decompress (Rust WASM).

```typescript
(data: Buffer) => Promise<string>
```

### `zstdCompressBytes`

Compress raw bytes using zstd, returning compressed bytes.  Use this for binary payloads (blobs, CRDT snapshots) where the input is not a UTF-8 string. Delegates to crates/llmtxt-core::zstd_compress_bytes.

```typescript
(data: Uint8Array) => Uint8Array
```

**Parameters:**

- `data` — Raw bytes to compress.

**Returns:** Compressed bytes with zstd magic header.

### `zstdDecompressBytes`

Decompress raw zstd bytes back to raw bytes.  Delegates to crates/llmtxt-core::zstd_decompress_bytes.

```typescript
(data: Uint8Array) => Uint8Array
```

**Parameters:**

- `data` — zstd-compressed bytes.

**Returns:** Decompressed raw bytes.

### `encodeBase62`

```typescript
(num: number) => string
```

### `decodeBase62`

```typescript
(str: string) => number
```

### `generateId`

```typescript
() => string
```

### `hashContent`

```typescript
(data: string) => string
```

### `hashBlob`

Compute SHA-256 hash of raw binary data. Returns a lowercase hex string (64 characters).  Use this for blob content-addressing — mirrors crates/llmtxt-core::hash_blob. Prefer this over node:crypto createHash (SSOT rule — see docs/SSOT.md).

```typescript
(data: Uint8Array) => string
```

### `calculateTokens`

```typescript
(text: string) => number
```

### `calculateCompressionRatio`

```typescript
(originalSize: number, compressedSize: number) => number
```

### `computeSignature`

```typescript
(slug: string, agentId: string, conversationId: string, expiresAt: number, secret: string) => string
```

### `computeSignatureWithLength`

```typescript
(slug: string, agentId: string, conversationId: string, expiresAt: number, secret: string, sigLength: number) => string
```

### `computeOrgSignature`

```typescript
(slug: string, agentId: string, conversationId: string, orgId: string, expiresAt: number, secret: string) => string
```

### `computeOrgSignatureWithLength`

```typescript
(slug: string, agentId: string, conversationId: string, orgId: string, expiresAt: number, secret: string, sigLength: number) => string
```

### `deriveSigningKey`

```typescript
(apiKey: string) => string
```

### `createPatch`

```typescript
(original: string, modified: string) => string
```

### `applyPatch`

```typescript
(original: string, patchText: string) => string
```

### `reconstructVersion`

```typescript
(base: string, patchesJson: string, target: number) => string
```

### `squashPatchesWasm`

```typescript
(base: string, patchesJson: string) => string
```

### `wasmTextSimilarity`

```typescript
(a: string, b: string) => number
```

### `wasmTextSimilarityNgram`

```typescript
(a: string, b: string, n: number) => number
```

### `isExpired`

```typescript
(expiresAtMs: number) => boolean
```

### `computeDiff`

```typescript
(oldText: string, newText: string) => DiffResult
```

### `structuredDiff`

Compute a structured line-level diff between two texts via the Rust LCS algorithm.

```typescript
(oldText: string, newText: string) => StructuredDiffResult
```

### `multiWayDiff`

Compute per-line diff variants across N versions of a document.

```typescript
(base: string, versions: string | string[]) => MultiDiffResult
```

**Parameters:**

- `base` — Base version content.
- `versions` — Either an array of version strings (preferred) OR a   JSON-encoded array of strings (legacy, still supported for back-compat).

**Returns:** Parsed MultiDiffResult.

### `cherryPickMerge`

Assemble document content from line ranges and sections across multiple versions.

```typescript
(base: string, versionsJson: string, selectionJson: string) => CherryPickResult
```

**Parameters:**

- `base` — Base version content (index 0 if not supplied in versionsJson).
- `versionsJson` — JSON object mapping version index strings to content strings.
- `selectionJson` — JSON selection spec `{ sources: [...], fillFrom?: number }`.

**Returns:** Parsed CherryPickResult.

### `threeWayMerge`

Perform a 3-way merge of `base`, `ours`, and `theirs`.  Regions modified by only one side are auto-merged.  Regions modified by both sides produce conflict markers in the output:

```typescript
(base: string, ours: string, theirs: string) => ThreeWayMergeResult
```

**Parameters:**

- `base` — Common ancestor content.
- `ours` — Our version of the document.
- `theirs` — Their version of the document.

**Returns:** Parsed ThreeWayMergeResult.

### `l2Normalize`

L2-normalize a vector of numbers to unit length.  Delegates to crates/llmtxt-core::normalize::l2_normalize via WASM.

```typescript
(vecJson: string) => string
```

**Parameters:**

- `vecJson` — JSON array of numbers, e.g. `"[3.0, 4.0]"`.

**Returns:** JSON array string of normalized values, or `"[]"` on parse error.

### `signWebhookPayload`

Compute the HMAC-SHA256 webhook signature for a payload.  Returns `"sha256=<hex>"` — the canonical format for the `X-LLMtxt-Signature` request header.  Delegates to crates/llmtxt-core::crypto::sign_webhook_payload.

```typescript
(secret: string, payload: string) => string
```

**Parameters:**

- `secret` — The webhook signing secret.
- `payload` — The raw request body string to sign.

**Returns:** `sha256=<hex HMAC-SHA256>` or empty string on HMAC error.

### `constantTimeEqHex`

Compare two hex-encoded digest strings in constant time.  Use this whenever you need to compare API key hashes, HMAC signatures, or any other secret-derived values. JavaScript `===` on strings is NOT timing-safe and MUST NOT be used for secrets.  Delegates to `crates/llmtxt-core::crypto::constant_time_eq_hex` which uses the `subtle` crate for guaranteed constant-time byte comparison.

```typescript
(a: string, b: string) => boolean
```

**Parameters:**

- `a` — First hex digest string (e.g. a SHA-256 hash)
- `b` — Second hex digest string

**Returns:** `true` if and only if `a === b` in constant time

### `verifyContentHash`

Verify that `content` matches an expected SHA-256 hex hash.  T-02: Client-side content integrity helper for the SDK.  Computes the SHA-256 hash of the provided content using the Rust WASM primitive and then performs a constant-time comparison against the expected digest.  Typical usage: after downloading a document version, call this with the `content_hash` field from the server response to detect tampering in transit.

```typescript
(content: string, expectedHash: string) => boolean
```

**Parameters:**

- `content` — UTF-8 document content string
- `expectedHash` — Lowercase hex SHA-256 digest to compare against

**Returns:** `true` when `sha256(content) === expectedHash` in constant time

### `cosineSimilarity`

Compute cosine similarity between two embedding vectors.  Delegates to crates/llmtxt-core::semantic::cosine_similarity_wasm.

```typescript
(aJson: string, bJson: string) => number
```

**Parameters:**

- `a` — Embedding vector as a JSON array string, e.g. `"[1.0, 0.0]"`.
- `b` — Embedding vector as a JSON array string.

**Returns:** Cosine similarity in `[-1.0, 1.0]`, or `0.0` on invalid input.

### `semanticDiff`

Compute a semantic diff between two sets of pre-embedded document sections.

```typescript
(sectionsAJson: string, sectionsBJson: string) => SemanticDiffResult
```

**Parameters:**

- `sectionsAJson` — JSON array of `{ title, content, embedding: number[] }` for version A.
- `sectionsBJson` — JSON array of `{ title, content, embedding: number[] }` for version B.

**Returns:** Parsed SemanticDiffResult.

### `rolePermissions`

Return the permissions for a document role as a JSON array of strings.  Delegates to crates/llmtxt-core::rbac::role_permissions via WASM.

```typescript
(role: string) => string
```

**Parameters:**

- `role` — One of `"owner"`, `"editor"`, `"viewer"`.

**Returns:** JSON array string, e.g. `'["read","write","approve"]'`. Returns `"[]"` for unknown roles.

### `roleHasPermission`

Check whether a document role has a specific permission.  Delegates to crates/llmtxt-core::rbac::role_has_permission via WASM.

```typescript
(role: string, permission: string) => boolean
```

**Parameters:**

- `role` — One of `"owner"`, `"editor"`, `"viewer"`.
- `permission` — One of `"read"`, `"write"`, `"delete"`, `"manage"`, `"approve"`.

**Returns:** `true` when the role grants that permission.

### `slugify`

Convert a collection or document name to a URL-safe slug.  Delegates to crates/llmtxt-core::slugify::slugify via WASM.

```typescript
(name: string) => string
```

**Parameters:**

- `name` — The raw name to slugify.

**Returns:** A lowercase, hyphen-separated slug (max 80 chars).

```ts
slugify('Hello World'); // "hello-world"
slugify('My Collection 2024'); // "my-collection-2024"
```

### `semanticConsensus`

Evaluate semantic consensus across a set of pre-embedded reviews.

```typescript
(reviewsJson: string, threshold: number) => SemanticConsensusResult
```

**Parameters:**

- `reviewsJson` — JSON array of `{ reviewerId, content, embedding: number[] }`.
- `threshold` — Cosine similarity threshold for clustering (e.g. 0.80).

**Returns:** Parsed SemanticConsensusResult.

```ts
// Embed reviews first (e.g. with LocalEmbeddingProvider)
const reviews = [
  { reviewerId: 'agent-1', content: 'This API is well-designed.', embedding: [...] },
  { reviewerId: 'agent-2', content: 'The API design is excellent.', embedding: [...] },
];

const result = semanticConsensus(JSON.stringify(reviews), 0.80);
if (result.consensus) {
  console.log('Agreement found:', result.agreementScore);
}
```

### `contentSimilarity`

Compute similarity between two texts using word shingles.  Delegates to crates/llmtxt-core::similarity::content_similarity_wasm.

```typescript
(a: string, b: string) => number
```

**Parameters:**

- `a` — First text.
- `b` — Second text.

**Returns:** Jaccard similarity of word bigrams, 0.0 to 1.0.

### `detectFormat`

Auto-detect whether a string is JSON, markdown, or plain text.  Delegates to crates/llmtxt-core::validation::detect_format.

```typescript
(content: string) => "json" | "markdown" | "text"
```

**Parameters:**

- `content` — The string to inspect.

**Returns:** `"json"`, `"markdown"`, or `"text"`.

### `containsBinaryContent`

Check for binary content (control chars 0x00–0x08) in the first 8 KB.  Delegates to crates/llmtxt-core::validation::contains_binary_content.

```typescript
(content: string) => boolean
```

### `extractMentions`

Extract  from message content. Returns unique names (excluding all).  Delegates to crates/llmtxt-core::graph::extract_mentions_wasm.

```typescript
(content: string) => string[]
```

**Returns:** JSON array string of mention strings.

### `extractNgrams`

Extract character-level n-grams from text.  Delegates to crates/llmtxt-core::similarity::extract_ngrams_wasm.

```typescript
(text: string, n?: number) => string[]
```

**Parameters:**

- `text` — Input text.
- `n` — N-gram size (default 3).

**Returns:** Sorted array of n-gram strings.

### `extractTags`

Extract #tags from message content. Returns unique tag names.  Delegates to crates/llmtxt-core::graph::extract_tags_wasm.

```typescript
(content: string) => string[]
```

### `extractDirectives`

Extract /directives from message content. Returns unique directive keywords.  Delegates to crates/llmtxt-core::graph::extract_directives_wasm.

```typescript
(content: string) => string[]
```

### `extractWordShingles`

Extract word-level n-gram shingles from text.  Delegates to crates/llmtxt-core::similarity::extract_word_shingles_wasm.

```typescript
(text: string, n?: number) => string[]
```

**Parameters:**

- `text` — Input text.
- `n` — Shingle size (default 2).

**Returns:** Sorted array of shingle strings.

### `findOverlongLine`

Find the 1-based line number of the first line exceeding max_chars. Returns 0 if no overlong line exists.  Delegates to crates/llmtxt-core::validation::find_overlong_line.

```typescript
(content: string, maxChars: number) => number
```

### `fingerprintSimilarity`

Estimate similarity between two MinHash fingerprints.

```typescript
(a: number[], b: number[]) => number
```

**Parameters:**

- `a` — Fingerprint array (from minHashFingerprint).
- `b` — Fingerprint array (from minHashFingerprint).

**Returns:** Approximate Jaccard similarity, 0.0 to 1.0.

### `buildGraph`

Build a knowledge graph from an array of messages.  Delegates to crates/llmtxt-core::graph::build_graph_wasm.

```typescript
(messages: MessageInput[]) => KnowledgeGraph
```

**Parameters:**

- `messages` — Array of MessageInput objects.

**Returns:** Parsed KnowledgeGraph.

### `topTopics`

Find the most connected topics in the graph.  Delegates to crates/llmtxt-core::graph::top_topics_wasm.

```typescript
(graph: KnowledgeGraph, limit?: number) => Array<{ topic: string; agents: number; }>
```

**Parameters:**

- `graph` — A KnowledgeGraph returned by buildGraph.
- `limit` — Maximum number of results (default 10).

**Returns:** Array of `{ topic, agents }` sorted by agent count descending.

### `topAgents`

Find the most active agents in the graph.  Delegates to crates/llmtxt-core::graph::top_agents_wasm.

```typescript
(graph: KnowledgeGraph, limit?: number) => Array<{ agent: string; activity: number; }>
```

**Parameters:**

- `graph` — A KnowledgeGraph returned by buildGraph.
- `limit` — Maximum number of results (default 10).

**Returns:** Array of `{ agent, activity }` sorted by activity descending.

### `jaccardSimilarity`

Compute Jaccard similarity between two texts using character n-grams.  Delegates to crates/llmtxt-core::similarity::jaccard_similarity_wasm.

```typescript
(a: string, b: string) => number
```

**Parameters:**

- `a` — First text.
- `b` — Second text.

**Returns:** Jaccard similarity with n=3, 0.0 to 1.0.

### `detectDocumentFormat`

Detect the structural format of a document.  Returns `"json"`, `"markdown"`, `"code"`, or `"text"`. Extends crates/llmtxt-core::validation::detect_format with "code" detection.  Delegates to crates/llmtxt-core::disclosure::detect_document_format_wasm.

```typescript
(content: string) => "json" | "markdown" | "code" | "text"
```

### `generateOverview`

Generate a structural overview of a document.  Delegates to crates/llmtxt-core::disclosure::generate_overview_wasm.

```typescript
(content: string) => import("./disclosure.js").DocumentOverview
```

**Returns:** Parsed DocumentOverview.

### `getLineRange`

Extract a line range from a document.  Delegates to crates/llmtxt-core::disclosure::get_line_range_wasm.

```typescript
(content: string, start: number, end: number) => import("./disclosure.js").LineRangeResult
```

**Returns:** Parsed LineRangeResult.

### `searchContent`

Search document content for lines matching a query.  Delegates to crates/llmtxt-core::disclosure::search_content_wasm.

```typescript
(content: string, query: string, contextLines?: number, maxResults?: number) => import("./disclosure.js").SearchResult[]
```

**Parameters:**

- `contextLines` — Number of surrounding context lines (default 2).
- `maxResults` — Maximum number of results to return (default 20).

**Returns:** Array of SearchResult.

### `queryJsonPath`

Execute a JSONPath-style query against JSON content.  Delegates to crates/llmtxt-core::disclosure::query_json_path_wasm.

```typescript
(content: string, path: string) => { result: unknown; tokenCount: number; path: string; }
```

**Returns:** `{ result, tokenCount, path }` object.

### `getSection`

Extract a named section from a document.  Delegates to crates/llmtxt-core::disclosure::get_section_wasm.

```typescript
(content: string, sectionName: string, depthAll?: boolean) => { section: import("./disclosure.js").Section; content: string; tokenCount: number; totalTokens: number; tokensSaved: number; } | null
```

**Parameters:**

- `depthAll` — If true, include nested sub-sections.

**Returns:** Section result or null if not found.

### `fnv1aHash`

FNV-1a hash of a string (32-bit unsigned integer).  Identical to the TS `fnv1aHash()` function in embeddings.ts. Delegates to crates/llmtxt-core::tfidf::fnv1a_hash_wasm.

```typescript
(s: string) => number
```

**Parameters:**

- `s` — Input string.

**Returns:** 32-bit unsigned integer hash.

### `tfidfEmbed`

Embed a single text using TF-IDF into a float vector.  Delegates to crates/llmtxt-core::tfidf::tfidf_embed_wasm.

```typescript
(text: string, dim?: number) => number[]
```

**Parameters:**

- `text` — Input text.
- `dim` — Output dimensionality (default 256, matching LocalEmbeddingProvider).

**Returns:** Array of float32 values, L2-normalized.

### `tfidfEmbedBatch`

Embed a batch of texts using TF-IDF with shared IDF weighting.  This matches the `LocalEmbeddingProvider.embed()` TypeScript implementation exactly — IDF is computed across the entire batch, not per-document.  Delegates to crates/llmtxt-core::tfidf::tfidf_embed_batch_wasm.

```typescript
(texts: string[], dim?: number) => number[][]
```

**Parameters:**

- `texts` — Array of input strings.
- `dim` — Output dimensionality (default 256).

**Returns:** Array of float32 arrays, each L2-normalized.

### `minHashFingerprint`

Generate a MinHash fingerprint for content.  Delegates to crates/llmtxt-core::similarity::min_hash_fingerprint_wasm.

```typescript
(text: string, numHashes?: number, ngramSize?: number) => number[]
```

**Parameters:**

- `text` — Input text.
- `numHashes` — Number of hash functions (default 64).
- `ngramSize` — N-gram size (default 3).

**Returns:** Array of minimum hash values.

### `rankBySimilarity`

Rank a list of texts by similarity to a query.  Delegates to crates/llmtxt-core::similarity::rank_by_similarity_wasm.

```typescript
(query: string, candidates: string[], options?: { method?: "ngram" | "shingle"; threshold?: number; }) => SimilarityRankResult[]
```

**Parameters:**

- `query` — Query string.
- `candidates` — Array of candidate strings.
- `options` — `{ method?: "ngram" | "shingle", threshold?: number }`.

**Returns:** Array of `{ index, score }` sorted by descending score.

### `createClient`

```typescript
(config: LlmtxtClientConfig) => { upload(conversationId: string, content: string, options?: { format?: string; title?: string; expiresIn?: number; }): Promise<UploadResult>; fetch(signedUrl: string): Promise<FetchResult>; fetchFromConversation(slug: string, conversationId: string): Promise<FetchResult>; fetchOwned(slug: string): Promise<FetchResult>; reshare(slug: string, options?: AttachmentReshareOptions): Promise<ReshareResult>; resign(slug: string, options?: AttachmentReshareOptions): Promise<ResignResult>; createVersionPatch(original: string, updated: string): string; addVersion(slug: string, patchText: string, options?: AttachmentVersionOptions): Promise<AttachmentVersionResult>; addVersionFromContent(slug: string, original: string, updated: string, options?: AttachmentVersionOptions): Promise<AttachmentVersionResult>; isValid(signedUrl: string): boolean; }
```

### `crdt_new_doc`

Create an empty Loro Doc and return its initial snapshot bytes.  NOTE: Unlike the previous Yrs implementation, this returns a full Loro snapshot blob — NOT a Y.js state vector. The returned bytes are an opaque Loro state blob. Callers MUST treat the return value as a state blob and pass it to crdt_state_vector() to get the VersionVector bytes for SyncStep1.  The magic header bytes are 0x6c 0x6f 0x72 0x6f ("loro").

```typescript
() => Buffer
```

### `crdt_encode_state_as_update`

Encode the full doc state as a Loro snapshot blob.  Used to bootstrap a new client: send them the full state so they can import it locally and arrive at the current document content.  In Loro, a snapshot serves as the bootstrap update — there is no separate "state-as-update" format; snapshot == full state transfer.

```typescript
(state: Buffer) => Buffer
```

**Parameters:**

- `state` — bytes from section_crdt_states.crdt_state (Loro snapshot).   May be empty for a new section; returns the canonical empty-doc snapshot.

### `crdt_apply_update`

Apply a Loro update or snapshot to a state snapshot, returning the new state.  Core persistence operation: called before writing to section_crdt_states. Loro import is idempotent — applying the same update twice yields the same result (CRDT property).

```typescript
(state: Buffer, update: Buffer) => Buffer
```

**Parameters:**

- `state` — current state bytes (may be empty for a new section).   Empty state is treated as an empty Loro Doc.
- `update` — incoming Loro update or snapshot bytes from a client.

**Returns:** New Loro snapshot bytes ready for section_crdt_states.crdt_state.

### `crdt_merge_updates`

Merge multiple Loro update blobs into a single consolidated snapshot.  Used by the compaction job to fold section_crdt_updates into section_crdt_states. Convergence is guaranteed by CRDT invariants.  The WASM function expects a packed buffer: `[len1:u32le][bytes1][len2:u32le]...`

```typescript
(updates: Buffer[]) => Buffer
```

**Parameters:**

- `updates` — array of Loro update Buffers from section_crdt_updates.

**Returns:** Single Loro snapshot encoding the merged state.

### `crdt_state_vector`

Extract the Loro VersionVector from a state snapshot.  Sent as SyncStep1 (0x01 prefix) so the remote can compute the diff update.  IMPORTANT: The returned bytes are Loro VersionVector bytes encoded via VersionVector::encode() — they are NOT Y.js state vector bytes and are bitwise INCOMPATIBLE with lib0 v1 state vector encoding. Remote peers MUST call VersionVector::decode() (or the equivalent) on received SyncStep1 payloads — they MUST NOT pass these bytes to any Yrs / lib0 decoder.

```typescript
(state: Buffer) => Buffer
```

**Parameters:**

- `state` — bytes from section_crdt_states.crdt_state (may be empty).   Empty state gives the VersionVector of an empty Loro Doc.

### `crdt_diff_update`

Compute the diff update between server state and a remote Loro VersionVector.  SyncStep2: returns only the Loro operations the remote is missing.

```typescript
(state: Buffer, remoteSv: Buffer) => Buffer
```

**Parameters:**

- `state` — server state bytes from section_crdt_states.crdt_state.
- `remoteSv` — the client's Loro VersionVector bytes (from crdt_state_vector).   Empty remoteSv means "give me everything" (full snapshot).  NOTE: `remoteSv` MUST be Loro VersionVector bytes (from crdt_state_vector or sent via SyncStep1 0x01 framing). Do NOT pass Y.js state vector bytes here.

### `crdt_get_text`

Extract the plain text string from a Loro state snapshot.  Used by HTTP fallback endpoints and tests. Delegates to the loro-crdt npm package (crdt_get_text is not available in the WASM build — it is marked #[cfg(not(target_arch = "wasm32"))] in Rust).

```typescript
(state: Buffer) => string
```

**Parameters:**

- `state` — Loro snapshot bytes from section_crdt_states.crdt_state (may be empty).

**Returns:** Plain text string from the "content" LoroText root.

### `crdt_make_state`

Create a new Loro Doc, insert `content` into the "content" LoroText root, and return its full state as a Loro snapshot Buffer.  This helper exists so that test files can construct seed states without importing `loro-crdt` directly.

```typescript
(content: string) => Buffer
```

### `crdt_make_incremental_update`

Append `content` to an existing Loro Doc represented as a state Buffer, then return an incremental update Buffer (the delta only, not a full state).  Useful in tests to generate realistic incremental updates.

```typescript
(state: Buffer, content: string) => Buffer
```

**Parameters:**

- `state` — current Loro snapshot bytes.
- `content` — string to append.

**Returns:** - incremental Loro update bytes (NOT full snapshot).

### `crdt_apply_to_local_doc`

Apply a Loro update directly to a local Loro Doc and return the resulting full state. Used by tests that need to simulate a client-side doc receiving a server diff.

```typescript
(docState: Buffer, update: Buffer) => Buffer
```

**Parameters:**

- `docState` — current full Loro snapshot bytes of the local doc.
- `update` — incoming Loro update bytes.

**Returns:** - new full Loro snapshot bytes after applying the update.

### `subscribeSection`

Subscribe to real-time CRDT delta events for a single section.  Opens a WebSocket connection using the `loro-sync-v1` subprotocol and performs the Loro sync protocol (SyncStep1 → SyncStep2 exchange). Subsequent updates from other agents are imported into the local Loro Doc and emitted as `SectionDelta` events to `callback`.  Wire protocol (spec P1 §3.2):  1. On open: encode local VersionVector → send as 0x01 SyncStep1.  2. On receive 0x02 (SyncStep2): import Loro update blob (full diff from server).  3. On receive 0x03 (Update): import incremental Loro update blob from peer.  4. On receive 0x04 (AwarenessRelay): pass to options.onAwareness if set.  5. Stray 0x00 frames (legacy Yjs SyncStep1) are dropped and never sent.

```typescript
(slug: string, sectionId: string, callback: (delta: SectionDelta) => void, options?: SubscribeSectionOptions) => Unsubscribe
```

**Parameters:**

- `slug` — Document slug
- `sectionId` — Section identifier
- `callback` — Called each time the section changes
- `options` — Auth and endpoint configuration

**Returns:** - `Unsubscribe` function; call it to close the WS

### `getSectionText`

Fetch the current plain-text content of a section via the HTTP fallback.  Does not require WebSocket support. Returns the text extracted from the consolidated Loro CRDT state. Returns null if the section has not been initialized (HTTP 503).  The server returns a base64-encoded Loro snapshot blob. This function:  1. Decodes the base64 → Loro binary bytes.  2. Creates a local Loro Doc and imports the bytes.  3. Reads the "content" LoroText root and returns its string value.  Wire-format note: the stateBase64 field contains Loro binary (magic header 0x6c 0x6f 0x72 0x6f "loro"). Do NOT pass these bytes to any Y.js / lib0 decoder — they are bitwise incompatible.

```typescript
(slug: string, sectionId: string, options?: SubscribeSectionOptions) => Promise<string | null>
```

**Parameters:**

- `slug` — Document slug
- `sectionId` — Section identifier
- `options` — Auth and endpoint configuration

### `loadCrSqliteExtensionPath`

Attempts to dynamically import vlcn.io/crsqlite and resolve the native SQLite extension path.

```typescript
() => Promise<string | null>
```

**Returns:** The absolute path to the crsqlite native extension (.so / .dylib /   .dll), or null if the package is not installed.

### `embed`

Embed a single text string into a 384-dimensional Float32Array.  Model is loaded lazily on first call (~1-2s cold start, instant thereafter). No external API calls are made — inference runs locally via onnxruntime-node.

```typescript
(text: string) => Promise<Float32Array>
```

**Parameters:**

- `text` — Input text to embed.

**Returns:** L2-normalised 384-dim embedding vector.

### `embedBatch`

Embed a batch of texts in a single ONNX session run.  For large batches, texts are split into chunks of 32 to avoid OOM.

```typescript
(texts: string[]) => Promise<Float32Array[]>
```

**Parameters:**

- `texts` — Array of texts to embed.

**Returns:** Array of L2-normalised 384-dim embedding vectors.

### `bodyHashHex`

SHA-256 body hash returned as lowercase hex (64 chars).  Matches what the backend `computeBodyHash` function computes: `hashContent(body.toString('utf8'))` → SHA-256 of the UTF-8 string. This in turn matches the Rust `identity_body_hash_hex(body)` WASM export.

```typescript
(body: Uint8Array | string) => Promise<string>
```

### `buildCanonicalPayload`

Build the canonical payload bytes (UTF-8 encoded).  Format (newline-separated, same as Rust `canonical_payload()`):

```typescript
(opts: CanonicalPayloadOptions) => Uint8Array
```

### `randomNonceHex`

Generate 16 cryptographically-random bytes as lowercase hex (32 chars).

```typescript
() => string
```

### `createIdentity`

Generate a fresh `AgentIdentity` and persist it. Convenience wrapper around `AgentIdentity.generate()`.

```typescript
() => Promise<AgentIdentity>
```

### `loadIdentity`

Load the persisted `AgentIdentity`. Returns `null` if no identity has been persisted yet. Convenience wrapper around `AgentIdentity.load()`.

```typescript
() => Promise<AgentIdentity | null>
```

### `identityFromSeed`

Construct an `AgentIdentity` from a raw 32-byte seed. Does NOT persist. Useful for tests and CLI scenarios. Convenience wrapper around `AgentIdentity.fromSeed()`.

```typescript
(seed: Uint8Array) => Promise<AgentIdentity>
```

### `signRequest`

Build X-Agent-* signature headers for a mutating HTTP request.  Convenience function equivalent to `identity.buildSignatureHeaders(…)`.

```typescript
(identity: AgentIdentity, method: string, path: string, body: string | Uint8Array, agentId: string, nowMs?: number, nonce?: string) => Promise<SignatureHeaders>
```

**Parameters:**

- `identity` — The caller's `AgentIdentity`
- `method` — HTTP method (e.g. `"PUT"`)
- `path` — Path and optional query (e.g. `"/api/v1/documents/abc"`)
- `body` — Request body (string or bytes; use `""` for empty)
- `agentId` — The `agent_id` registered on the server
- `nowMs` — Timestamp override (default: `Date.now()`)
- `nonce` — Nonce override (default: 16 random bytes)

### `verifySignature`

Verify an Ed25519 signature over the given canonical payload bytes.

```typescript
(payload: Uint8Array, sigHex: string, pubkeyHex: string) => Promise<boolean>
```

**Parameters:**

- `payload` — Canonical payload bytes (from `buildCanonicalPayload`)
- `sigHex` — 128-char hex-encoded 64-byte signature
- `pubkeyHex` — 64-char hex-encoded 32-byte Ed25519 public key

**Returns:** `true` if the signature is valid; `false` for any mismatch

### `isPredefinedSchema`

Type-guard that checks whether a string is a registered predefined schema name.

```typescript
(name: string) => name is PredefinedSchemaName
```

**Parameters:**

- `name` — The schema name to check.

**Returns:** `true` if `name` is a key in the predefined schema registry.

```ts
if (isPredefinedSchema('prompt-v1')) {
  const schema = predefinedSchemas['prompt-v1'];
}
```

### `getPredefinedSchema`

Retrieve a predefined Zod schema by name.

```typescript
(name: string) => z.ZodType | undefined
```

**Parameters:**

- `name` — The schema name to look up.

**Returns:** The matching Zod schema, or `undefined` if not found.

```ts
const schema = getPredefinedSchema('prompt-v1');
if (schema) schema.parse(data);
```

### `validateJson`

Validate content as JSON, optionally against a predefined schema.

```typescript
(content: unknown, schemaName?: string) => ValidationResult
```

**Parameters:**

- `content` — The raw content to validate (string or pre-parsed value).
- `schemaName` — Optional name of a predefined schema to enforce.

**Returns:** A `ValidationResult` indicating success or listing errors.

```ts
const result = validateJson('{"key": "value"}');
if (result.success) console.log(result.data);
```

### `validateText`

Validate content as plain text or markdown.

```typescript
(content: unknown) => ValidationResult<string>
```

**Parameters:**

- `content` — The value to validate as text.

**Returns:** A `ValidationResult` with `format` set to `"text"` on success.

```ts
const result = validateText('# Hello');
```

### `detectFormat`

Auto-detect whether a string is JSON, markdown, or plain text.

```typescript
(content: string) => "json" | "text" | "markdown"
```

**Parameters:**

- `content` — The string to inspect.

**Returns:** The detected format: `"json"`, `"markdown"`, or `"text"`.

```ts
detectFormat('{"a":1}');                    // "json"
detectFormat('# Title\n- item');            // "markdown"
detectFormat('Hello');                      // "text"
```

### `validateContent`

Validate content for a given format, with optional schema enforcement and content size limits.

```typescript
(content: unknown, format: "json" | "text" | "markdown", schemaNameOrOptions?: string | ValidateContentOptions) => ValidationResult
```

**Parameters:**

- `content` — The raw content to validate.
- `format` — The expected content format.
- `schemaNameOrOptions` — A schema name string (backward compat) or options object.

**Returns:** A `ValidationResult` indicating success or listing errors.

```ts
validateContent(payload, 'json', 'prompt-v1');
validateContent(payload, 'text', { maxBytes: 10 * 1024 * 1024 });
```

### `autoValidate`

Auto-detect the content format and then validate accordingly.

```typescript
(content: unknown, schemaName?: string) => ValidationResult
```

**Parameters:**

- `content` — The raw content to auto-detect and validate.
- `schemaName` — Optional predefined schema name for JSON validation.

**Returns:** A `ValidationResult` with the detected format and validated data.

```ts
const result = autoValidate('{"messages":[{"role":"user","content":"hi"}]}', 'prompt-v1');
```

### `computeSignature`

Compute the HMAC-SHA256 signature for signed URL parameters. Delegates to the Rust WASM module.

```typescript
(params: SignedUrlParams, secret: string) => string
```

### `computeSignatureWithLength`

Compute signature with configurable length. Use 16 for short-lived URLs (default), 32 for long-lived URLs (128 bits).

```typescript
(params: SignedUrlParams, secret: string, sigLength: number) => string
```

### `generateSignedUrl`

Generate a signed URL for accessing a document.

```typescript
(params: SignedUrlParams, config: SignedUrlConfig) => string
```

### `verifySignedUrl`

Verify a signed URL's signature and expiration. Uses timing-safe comparison to prevent timing attacks.

```typescript
(url: string | URL, secret: string) => VerifyResult
```

### `computeOrgSignature`

Compute the HMAC-SHA256 signature for org-scoped signed URL parameters. Includes orgId in the HMAC payload for organization-level access control. Returns 32 hex characters (128 bits) by default.

```typescript
(params: OrgSignedUrlParams, secret: string) => string
```

### `computeOrgSignatureWithLength`

Compute org-scoped signature with configurable length.

```typescript
(params: OrgSignedUrlParams, secret: string, sigLength: number) => string
```

### `generateOrgSignedUrl`

Generate an org-scoped signed URL for accessing a document. The URL includes the org parameter for organization-level access verification.

```typescript
(params: OrgSignedUrlParams, config: SignedUrlConfig) => string
```

### `verifyOrgSignedUrl`

Verify an org-scoped signed URL's signature and expiration.

```typescript
(url: string | URL, secret: string) => VerifyResult & { orgId?: string; }
```

### `generateTimedUrl`

Generate a signed URL that expires after the given duration.

```typescript
(params: Omit<SignedUrlParams, "expiresAt">, config: SignedUrlConfig, ttlMs?: number) => string
```

### `deriveSigningKey`

Derive a per-agent signing key from their API key. Delegates to the Rust WASM module.

```typescript
(apiKey: string) => string
```

### `isExpired`

Check whether a timestamp has expired. Returns false for null/undefined (no expiration set).

```typescript
(expiresAt: number | null | undefined) => boolean
```

### `compressSnapshot`

Compress a session snapshot JSON string. Returns compressed data + metadata for storage/retrieval.

```typescript
(jsonStr: string, sessionId: string, agentId: string) => Promise<CompressedSnapshot>
```

### `decompressSnapshot`

Decompress a snapshot back to JSON string. Verifies integrity via content hash if provided.

```typescript
(data: Buffer, expectedHash?: string) => Promise<string>
```

### `compressSessionData`

Compress a session snapshot object directly. Serializes to JSON, then compresses.

```typescript
(sessionData: Record<string, unknown>, sessionId: string, agentId: string, options?: SnapshotOptions) => Promise<CompressedSnapshot>
```

### `decompressSessionData`

Decompress and parse a snapshot back to an object.

```typescript
<T = Record<string, unknown>>(data: Buffer, expectedHash?: string) => Promise<T>
```

### `snapshotSummary`

Generate a human-readable summary of a snapshot for handoff messages. Useful for agents posting session summaries to ClawMsgr.

```typescript
(meta: SnapshotMeta) => string
```

### `watchDocument`

Watch a document's event stream.

```typescript
(baseUrl: string, slug: string, options?: WatchDocumentOptions) => AsyncGenerator<DocumentEventLogEntry>
```

**Parameters:**

- `baseUrl` — Base URL of the llmtxt API, e.g. `https://api.llmtxt.my`.
- `slug` — Document slug.
- `options` — Optional configuration (fromSeq, apiKey, maxReconnects, signal).

### `isValidTransition`

Check whether a state transition is allowed.

```typescript
(from: DocumentState, to: DocumentState) => boolean
```

**Parameters:**

- `from` — Current document state.
- `to` — Target document state.

**Returns:** `true` if the transition is permitted by the lifecycle rules.

### `validateTransition`

Validate a proposed state transition with a detailed result.

```typescript
(from: DocumentState, to: DocumentState) => TransitionResult
```

**Parameters:**

- `from` — Current document state.
- `to` — Target document state.

**Returns:** A result object indicating validity and allowed alternatives.

### `isEditable`

Check whether a document state allows content modifications.

```typescript
(state: DocumentState) => boolean
```

**Parameters:**

- `state` — Current document state.

**Returns:** `true` if new versions can be created in this state.

### `isTerminal`

Check whether a document state is terminal (no further transitions).

```typescript
(state: DocumentState) => boolean
```

**Parameters:**

- `state` — Current document state.

**Returns:** `true` if the state has no outgoing transitions.

### `reconstructVersion`

Reconstruct a document at a specific version by applying patches sequentially from the base content.

```typescript
(baseContent: string, patches: VersionEntry[], targetVersion?: number) => ReconstructionResult
```

**Parameters:**

- `baseContent` — The original document content (version 0).
- `patches` — Ordered array of version entries.
- `targetVersion` — The version to reconstruct. Defaults to latest.

**Returns:** The reconstructed document content and metadata.

### `validatePatchApplies`

Check whether a patch applies cleanly to the given content.

```typescript
(content: string, patchText: string) => PatchValidationResult
```

**Parameters:**

- `content` — The current document content.
- `patchText` — The unified diff to test.

**Returns:** Whether the patch applies and the resulting content.

### `squashPatches`

Squash a sequence of patches into a single unified diff.  Applies all patches sequentially to the base content, then produces one diff from base to final state.

```typescript
(baseContent: string, patches: VersionEntry[]) => { patchText: string; contentHash: string; tokenCount: number; }
```

**Parameters:**

- `baseContent` — The content before the first patch.
- `patches` — Ordered array of version entries to squash.

**Returns:** A single patch text and the final content hash.

### `computeReversePatch`

Compute a reverse patch that undoes a version's changes.

```typescript
(contentBefore: string, contentAfter: string) => string
```

**Parameters:**

- `contentBefore` — Document content before the patch was applied.
- `contentAfter` — Document content after the patch was applied.

**Returns:** A unified diff that reverts `contentAfter` back to `contentBefore`.

### `diffVersions`

Compute a diff summary between two versions of a document.

```typescript
(baseContent: string, patches: VersionEntry[], fromVersion: number, toVersion: number) => VersionDiffSummary
```

**Parameters:**

- `baseContent` — The original document content (version 0).
- `patches` — Full ordered patch stack.
- `fromVersion` — Start version.
- `toVersion` — End version.

**Returns:** Diff statistics and patch text between the two versions.

### `evaluateApprovals`

Evaluate reviews against an approval policy.  Filters out stale and timed-out reviews, then checks whether the remaining approvals meet the policy threshold.

```typescript
(reviews: Review[], policy: ApprovalPolicy, currentVersion: number, now?: number) => ApprovalResult
```

**Parameters:**

- `reviews` — All reviews submitted for the document.
- `policy` — The approval policy to evaluate against.
- `currentVersion` — Current document version (reviews for older versions are stale).
- `now` — Current timestamp (ms since epoch). Defaults to `Date.now()`.

**Returns:** The approval evaluation result.

### `markStaleReviews`

Mark reviews as stale when a document version changes.  Returns a new array with updated review statuses. Does not mutate input.

```typescript
(reviews: Review[], currentVersion: number) => Review[]
```

**Parameters:**

- `reviews` — Current reviews.
- `currentVersion` — The new document version.

**Returns:** Reviews with outdated entries marked as STALE.

### `inlineRef`

Create a content reference for inline storage.

```typescript
(contentHash: string, originalSize: number, compressedSize: number) => ContentRef
```

**Parameters:**

- `contentHash` — SHA-256 hash of the uncompressed content.
- `originalSize` — Size of the uncompressed content in bytes.
- `compressedSize` — Size of the compressed content in bytes.

**Returns:** An inline content reference.

### `objectStoreRef`

Create a content reference for object-store storage.

```typescript
(storageKey: string, contentHash: string, originalSize: number, compressedSize: number) => ContentRef
```

**Parameters:**

- `storageKey` — The object key in the store.
- `contentHash` — SHA-256 hash of the uncompressed content.
- `originalSize` — Size of the uncompressed content in bytes.
- `compressedSize` — Size of the compressed content in bytes.

**Returns:** An object-store content reference.

### `versionStorageKey`

Generate a storage key for a document version.  Convention: `attachments/{slug}/v{version}.zlib`

```typescript
(slug: string, version: number) => string
```

**Parameters:**

- `slug` — Document slug.
- `version` — Version number.

**Returns:** The object storage key.

### `shouldUseObjectStore`

Determine whether content should be stored in object-store vs inline.  Threshold: content larger than 64KB compressed goes to object-store.

```typescript
(compressedSize: number, threshold?: number) => boolean
```

**Parameters:**

- `compressedSize` — Size of the compressed content in bytes.
- `threshold` — Size threshold in bytes. Defaults to 65536 (64KB).

**Returns:** `true` if the content should use object-store.

### `attributeVersion`

Compute attribution data for a single version change.

```typescript
(contentBefore: string, contentAfter: string, authorId: string, entry: Pick<VersionEntry, "versionNumber" | "changelog" | "createdAt">) => VersionAttribution
```

**Parameters:**

- `contentBefore` — Document content before the change.
- `contentAfter` — Document content after the change.
- `authorId` — Agent that made the change.
- `entry` — The version entry metadata.

**Returns:** Attribution data for this version.

### `buildContributorSummary`

Build aggregated contributor summaries from version attributions.

```typescript
(attributions: VersionAttribution[]) => ContributorSummary[]
```

**Parameters:**

- `attributions` — Array of per-version attribution data.

**Returns:** Contributor summaries sorted by total versions authored (descending).

### `planRetrieval`

Plan which sections to retrieve given a token budget.  When a query is provided, sections are ranked by text similarity to the query and packed greedily by descending score. Without a query, sections are packed in document order.

```typescript
(overview: DocumentOverview, tokenBudget: number, query?: string, options?: RetrievalOptions) => RetrievalPlan
```

**Parameters:**

- `overview` — Structural overview from generateOverview().
- `tokenBudget` — Maximum tokens to use.
- `query` — Optional search query to rank sections by relevance.
- `options` — Planning options.

**Returns:** A retrieval plan with selected sections and budget accounting.

### `estimateRetrievalCost`

Estimate the token cost of fetching specific sections.

```typescript
(overview: DocumentOverview, sectionIndices: number[]) => number
```

**Parameters:**

- `overview` — Document overview.
- `sectionIndices` — Indices of sections to fetch.

**Returns:** Total token count for the requested sections.

### `subscribe`

Open a differential SSE subscription.  Compatible with both browser (EventSource) and Node.js (via the `eventsource` npm polyfill, automatically detected).

```typescript
(pathPattern: string, options: SubscribeOptions, onEvent: (event: SubscriptionEvent) => void) => Unsubscribe
```

**Parameters:**

- `pathPattern` — URL pattern to match (e.g. '/docs/:slug', '/docs/*').
- `options` — Connection options including baseUrl, apiKey, and mode.
- `onEvent` — Callback invoked for each matching event.

**Returns:** Unsubscribe function; call it to close the connection.

### `fetchSectionDelta`

Fetch a section delta since a given sequence number.  Calls GET /api/v1/documents/:slug/sections/:name?since= and returns a typed SectionDeltaResponse. Store currentSeq and pass it as `since` on the next poll to achieve incremental updates.

```typescript
(slug: string, name: string, since: number, options: { baseUrl: string; apiKey: string; }) => Promise<SectionDeltaResponse>
```

**Parameters:**

- `slug` — Document slug.
- `name` — Section name.
- `since` — Last known sequence number (use 0 for the first fetch).
- `options` — Connection options.

### `validateTopologyConfig`

Validate an unknown value as a `TopologyConfig`.  Throws `TopologyConfigError` with exact messages from ARCH-T429 spec §3.3 on any validation failure.

```typescript
(config: unknown) => TopologyConfig
```

**Parameters:**

- `config` — The unknown input to validate.

**Returns:** The validated `TopologyConfig`.

### `canonicalFrontmatter`

Produce the canonical YAML frontmatter block for a document export.  Delegates to the WASM `canonicalFrontmatter` binding when available (post wasm-pack rebuild). Falls back to the pure-TS implementation that is byte-identical to the Rust function.  Output:

```typescript
(meta: FrontmatterMeta) => string
```

### `formatMarkdown`

Serialize a document snapshot to the Markdown export format.

```typescript
(doc: DocumentExportState, opts?: ExportOpts) => string
```

**Parameters:**

- `doc` — Self-contained document snapshot.
- `opts` — Optional formatting flags (default: include metadata).

**Returns:** UTF-8 string with LF line endings and a single trailing newline.

### `formatJson`

Serialize a document snapshot to the JSON export format.  The `opts` parameter is accepted for API consistency but is not used by this formatter — JSON export always includes all metadata fields.

```typescript
(doc: DocumentExportState, _opts?: ExportOpts) => string
```

**Parameters:**

- `doc` — Self-contained document snapshot.
- `_opts` — Unused; accepted for API consistency.

**Returns:** UTF-8 JSON string with 2-space indent, LF line endings, single trailing newline.

### `formatTxt`

Serialize the body of a document snapshot to plain text.  This formatter intentionally ignores all metadata. The `opts` parameter is not accepted because plain-text format has no configurable behaviour.

```typescript
(doc: DocumentExportState) => string
```

**Parameters:**

- `doc` — Self-contained document snapshot.

**Returns:** UTF-8 string with LF line endings and a single trailing newline.

### `formatLlmtxt`

Serialize a document snapshot to the native `.llmtxt` format.

```typescript
(doc: DocumentExportState, opts?: ExportOpts) => string
```

**Parameters:**

- `doc` — Self-contained document snapshot.               `doc.chainRef` may be `null` when no BFT approval chain exists.
- `opts` — Optional formatting flags (default: include metadata).

**Returns:** UTF-8 string with LF line endings and a single trailing newline.

### `serializeDocument`

Serialize a DocumentExportState to a string using the requested format.

```typescript
(state: DocumentExportState, format: ExportFormat, opts: { includeMetadata?: boolean; }) => string
```

### `sha256Hex`

Compute SHA-256 hex of a UTF-8 string's bytes.

```typescript
(content: Buffer) => string
```

### `contentHashHex`

Compute SHA-256 hex of the body content (used as content_hash in frontmatter).

```typescript
(body: string) => string
```

### `writeExportFile`

Write a DocumentExportState to disk and return an ExportDocumentResult.  This is the canonical implementation shared by all Backend variants. Backends build the `state` from their storage layer, then call this.

```typescript
(state: DocumentExportState, params: ExportDocumentParams, identityPath?: string) => Promise<ExportDocumentResult>
```

**Parameters:**

- `state` — Fully populated document snapshot.
- `params` — ExportDocumentParams from the caller.
- `identityPath` — Optional path to identity keypair (for sign=true).

**Returns:** Resolved ExportDocumentResult.

### `exportAllFilePath`

Build the output file path for an exportAll() call.  File name is `<slug>.<ext>` inside `outputDir`.

```typescript
(outputDir: string, slug: string, format: ExportFormat) => string
```

### `parseImportFile`

Parse an import file and return a ParsedImport.

```typescript
(filePath: string) => ParsedImport
```

### `validateBlobName`

Validate a blob attachment name using the Rust WASM primitive.  Throws `BlobNameInvalidError` when any of the following are true:   - name is empty or exceeds 255 bytes (UTF-8)   - name contains path traversal sequences (`..`)   - name contains path separators (`/` or `\`)   - name contains null bytes (`\0`)   - name has leading or trailing whitespace  Delegates to crates/llmtxt-core::blob_name_validate via WASM.

```typescript
(name: string) => void
```

**Parameters:**

- `name` — The attachment name to validate (e.g. "diagram.png")

### `createBackend`

Create a Backend instance appropriate for the given topology config.  This is the primary entry point for all agent code that needs a Backend. Prefer this over constructing LocalBackend or RemoteBackend directly.  Validation (ARCH-T429 §3.3) runs before any backend is constructed: - `hub-spoke` without `hubUrl` → throws `TopologyConfigError` - `hub-spoke` with `persistLocally=true` without `storagePath` → throws `TopologyConfigError` - `mesh` without `storagePath` → throws `TopologyConfigError` - Unknown `topology` value → throws `TopologyConfigError`  The returned backend must have `open()` called before use.

```typescript
(config: TopologyConfig) => Promise<Backend>
```

**Parameters:**

- `config` — A validated `TopologyConfig`. Unknown shapes are   rejected by `validateTopologyConfig` before dispatch.

**Returns:** A `Backend` instance for the requested topology.

### `sanitizeHtmlAsync`

Sanitize an HTML string (async, works in both Node.js and browser).  Prefer `sanitizeHtmlSync` in browser contexts where DOMPurify is available on the global window. Use this async version in server-side (Node.js) contexts where JSDOM must be initialized.

```typescript
(html: string) => Promise<string>
```

**Parameters:**

- `html` — Raw HTML string (e.g. from a markdown renderer).

**Returns:** Safe HTML string with all XSS vectors removed.

### `sanitizeHtmlSync`

Sanitize an HTML string synchronously (browser-only).  This function requires `window.DOMPurify` or a pre-loaded DOMPurify instance. In a browser it uses the native DOM parser. In Node.js, call `sanitizeHtmlAsync` instead.

```typescript
(html: string) => string
```

**Parameters:**

- `html` — Raw HTML string.

**Returns:** Safe HTML string.

### `isSafeUri`

Check whether a URI is safe according to the platform allowlist.  Useful for validating href/src attributes before inserting them into the DOM without going through a full sanitization pass.

```typescript
(uri: string) => boolean
```

**Parameters:**

- `uri` — The URI string to validate.

**Returns:** `true` if the URI matches the allowlist, `false` otherwise.

### `createPgBackend`

Create an isolated PostgresBackend instance backed by a temporary Postgres schema.  Applies all migrations (except pgvector), injects schema + stubs, and returns a cleanup callback to drop the schema after the test suite.  Throws if DATABASE_URL_PG is not set.

```typescript
() => Promise<PgBackendHandle>
```

### `buildBlobChangeset`

Collect BlobRef entries for all active blobs modified since `sinceMs`.  The sync layer calls this after `getChangesSince` to augment the binary changeset with blob manifest metadata. The caller passes the combined BlobChangeset to the receiving peer.  `sinceMs = 0` returns refs for all active blobs on the document.

```typescript
(db: BetterSQLite3Database<Record<string, never>>, crsqlBytes: Uint8Array, docSlug?: string, sinceMs?: number) => BlobChangeset
```

**Parameters:**

- `db` — The SQLite Drizzle instance
- `crsqlBytes` — The binary cr-sqlite changeset to embed
- `docSlug` — The document slug to scope blob refs to (optional)
- `sinceMs` — Only include blobs with uploadedAt  sinceMs (0 = all)

### `incomingWinsLWW`

Returns true if `incoming` wins over `existing` under the LWW rule.  LWW rule per ARCH-T428 §3.4:   - newer uploadedAt wins   - tie-break: higher uploadedBy lexicographically (deterministic)   - same (uploadedAt, uploadedBy) = same record, no-op

```typescript
(incoming: BlobRef, existing: { uploadedAt: number; uploadedBy: string; }) => boolean
```

### `applyBlobChangeset`

Apply incoming BlobRef entries from a received changeset.  For each ref:   1. Query the local manifest for (docSlug, blobName).   2. Apply LWW: incoming wins if uploadedAt is newer or tie-breaks higher.   3. If incoming wins: soft-delete local record (if any), insert new record.   4. If the winner's hash is NOT on disk, schedule a lazy fetch.

```typescript
(db: BetterSQLite3Database<Record<string, never>>, blobFs: BlobFsAdapter, refs: BlobRef[], pendingFetches: Set<string>, scheduleFetch?: (docSlug: string, hash: string) => void) => ApplyBlobChangesetResult
```

**Parameters:**

- `db` — Drizzle SQLite instance
- `blobFs` — The BlobFsAdapter for hash-presence check + fetch
- `refs` — BlobRef array from the incoming changeset
- `pendingFetches` — Mutable Set used to track in-flight pulls (dedup)
- `scheduleFetch` — Optional callback invoked for each hash that needs                         a background pull; receives (docSlug, hash)

### `makeEventStream`

Create an `AsyncIterable<T>` backed by `emitter` channel `channel`.

```typescript
<T>(emitter: EmitterLike, channel: string) => AsyncIterable<T>
```

**Parameters:**

- `emitter` — Any object implementing `on` / `off`.
- `channel` — The event channel name to subscribe on.

**Returns:** An `AsyncIterable<T>` that yields every event emitted on                 `channel` after the iterable is opened.

### `createMeshChangesetHandler`

Create a framework-agnostic handler for the POST /mesh/changeset endpoint.  Intended usage in apps/backend (Hono):

```typescript
(options: MeshChangesetRouteOptions) => (changesetBytes: Uint8Array, peerSinceXid: number) => Promise<MeshChangesetResult>
```

**Parameters:**

- `options` — Route handler options.

**Returns:** An async handler function `(changesetBytes, peerSinceXid) => MeshChangesetResult`.  TODO: Wire into apps/backend/src/routes/ once adapter is fully implemented.

### `buildA2AMessage`

Build and sign an A2A message.  The payload is JSON-serialized and base64-encoded. The signature covers the canonical bytes (matches Rust A2AMessage::canonical_bytes()).

```typescript
(opts: BuildA2AOptions) => Promise<A2AMessage>
```

### `sendToInbox`

Send an A2A message to an agent's HTTP inbox.

```typescript
(baseUrl: string, toAgentId: string, msg: A2AMessage, headers?: Record<string, string>) => Promise<InboxDeliveryResponse>
```

**Parameters:**

- `baseUrl` — API base URL (e.g. "https://api.llmtxt.my/api/v1")
- `toAgentId` — Recipient agent identifier
- `msg` — Signed A2A message
- `headers` — Optional extra headers (e.g. Authorization)

### `pollInbox`

Poll an agent's inbox for messages.

```typescript
(baseUrl: string, agentId: string, opts?: { since?: number; limit?: number; unreadOnly?: boolean; }, headers?: Record<string, string>) => Promise<InboxPollResponse>
```

**Parameters:**

- `baseUrl` — API base URL
- `agentId` — Recipient agent identifier
- `opts` — Poll options
- `headers` — Auth headers required

### `onDirectMessage`

Subscribe to direct messages via polling loop.  Polls every `pollIntervalMs` milliseconds (default 5000ms). Returns a `stop()` function.

```typescript
(baseUrl: string, agentId: string, onMessage: (msg: InboxMessage) => void, headers?: Record<string, string>, pollIntervalMs?: number) => () => void
```

### `bftQuorum`

Compute BFT quorum for given fault tolerance f. Formula: 2f + 1.

```typescript
(f: number) => number
```

### `buildApprovalCanonicalPayload`

Build the canonical approval payload string (to be signed).  Format: `documentSlug\nreviewerId\nstatus\natVersion\ntimestamp`

```typescript
(documentSlug: string, reviewerId: string, status: BFTApprovalStatus, atVersion: number, timestamp: number) => string
```

### `signApproval`

Sign an approval with the given AgentIdentity.  Returns a `SignedApprovalEnvelope` ready for POST to /bft/approve.

```typescript
(identity: AgentIdentity, slug: string, agentId: string, status: BFTApprovalStatus, atVersion: number, comment?: string, nowMs?: number) => Promise<SignedApprovalEnvelope>
```

**Parameters:**

- `identity` — Agent's Ed25519 identity
- `slug` — Document slug
- `agentId` — Agent identifier (must match the registered pubkey)
- `status` — APPROVED or REJECTED
- `atVersion` — Document version being approved
- `comment` — Optional human-readable comment
- `nowMs` — Override for timestamp (default: Date.now())

### `submitSignedApproval`

Submit a signed approval to the backend.

```typescript
(baseUrl: string, slug: string, envelope: SignedApprovalEnvelope, headers?: Record<string, string>) => Promise<BFTApprovalResponse>
```

**Parameters:**

- `baseUrl` — API base URL (e.g. "https://api.llmtxt.my/api/v1")
- `slug` — Document slug
- `envelope` — From `signApproval`
- `headers` — Optional extra headers (e.g. Authorization)

### `getBFTStatus`

Get current BFT quorum status for a document.

```typescript
(baseUrl: string, slug: string, headers?: Record<string, string>) => Promise<BFTStatusResponse>
```

### `verifyApprovalChain`

Verify the tamper-evident approval chain for a document.

```typescript
(baseUrl: string, slug: string, headers?: Record<string, string>) => Promise<ChainVerificationResponse>
```

### `sendScratchpad`

Publish a message to a document's scratchpad.  If `identity` and `agentId` are provided, the message will be signed with Ed25519 using the canonical format.

```typescript
(baseUrl: string, slug: string, opts: SendScratchpadOptions, headers?: Record<string, string>) => Promise<ScratchpadMessage>
```

**Parameters:**

- `baseUrl` — API base URL (e.g. "https://api.llmtxt.my/api/v1")
- `slug` — Document slug
- `opts` — Message options
- `headers` — Optional extra headers (e.g. Authorization)

### `readScratchpad`

Read scratchpad messages (poll).

```typescript
(baseUrl: string, slug: string, opts?: ReadScratchpadOptions, headers?: Record<string, string>) => Promise<ScratchpadMessage[]>
```

**Parameters:**

- `baseUrl` — API base URL
- `slug` — Document slug
- `opts` — Read options
- `headers` — Optional extra headers

### `onScratchpadMessage`

Subscribe to live scratchpad messages via Server-Sent Events.  Returns a `stop()` function to close the SSE connection.

```typescript
(baseUrl: string, slug: string, onMessage: (msg: ScratchpadMessage) => void, opts?: { threadId?: string; lastId?: string; }, _authHeaders?: Record<string, string>) => () => void
```

**Parameters:**

- `baseUrl` — API base URL
- `slug` — Document slug
- `onMessage` — Callback invoked on each new message
- `opts` — Subscribe options (threadId, lastId)
- `authHeaders` — Optional auth headers (added to query params since SSE can't set headers)

## Types

### `AwarenessState`

Presence state for a single agent.

```typescript
AwarenessState
```

**Members:**

- `agentId`
- `section`
- `cursorOffset`
- `lastSeen`

### `AwarenessEventType`

Events emitted when awareness state changes.

```typescript
AwarenessEventType
```

### `AwarenessEvent`

```typescript
AwarenessEvent
```

**Members:**

- `type`
- `clientId`
- `state`

### `Unsubscribe`

Unsubscribe function returned by onAwarenessChange.

```typescript
Unsubscribe
```

### `CacheStats`

Snapshot of cache performance statistics.

```typescript
CacheStats
```

**Members:**

- `hits` — Total number of cache hits since last reset.
- `misses` — Total number of cache misses since last reset.
- `size` — Current number of live (non-expired) entries in the cache.
- `maxSize` — Maximum number of entries the cache can hold.
- `hitRate` — Hit rate as a percentage (0-100), rounded to two decimal places.

### `LRUCacheOptions`

Configuration options for constructing an `LRUCache` instance.

```typescript
LRUCacheOptions
```

**Members:**

- `maxSize` — Maximum number of entries before the least-recently-used entry is evicted (default: 1000).
- `ttl` — Default time-to-live in milliseconds for new entries (default: 24 hours).

### `ClassificationResult`

Result of `classifyContent`.  Mirrors `ClassificationResult` from `crates/llmtxt-core/src/classify/types.rs`.

```typescript
ClassificationResult
```

**Members:**

- `mimeType` — IANA MIME type, e.g. `"application/pdf"`, `"text/markdown"`, `"image/png"`.
- `category` — Coarse content category.
- `format` — Specific content format.  Binary: `'pdf'` | `'png'` | `'jpeg'` | `'gif'` | `'webp'` | `'avif'` | `'svg'` |         `'mp4'` | `'webm'` | `'mp3'` | `'wav'` | `'ogg'` | `'zip'`  Text:   `'markdown'` | `'json'` | `'javascript'` | `'typescript'` | `'python'` |         `'rust'` | `'go'` | `'plainText'`  Fallback: `'unknown'`
- `confidence` — Classification confidence in `[0.0, 1.0]`. See Rust spec for semantics.
- `isExtractable` — Whether useful text content can be extracted from this format. `true` for text formats and PDF; `false` for images, audio, video, zip.

### `Section`

A logical section identified within a document.

```typescript
Section
```

**Members:**

- `title` — Display title of the section (heading text, JSON key, or symbol name).
- `depth` — Nesting depth (0-based). Headings use depth = level - 1.
- `startLine` — 1-based line number where the section begins.
- `endLine` — 1-based line number where the section ends (inclusive).
- `tokenCount` — Estimated token count for the section content.
- `type` — The structural type of the section.

### `DocumentOverview`

High-level structural overview of a document.

```typescript
DocumentOverview
```

**Members:**

- `format` — The detected document format.
- `lineCount` — Total number of lines in the document.
- `tokenCount` — Estimated total token count for the entire document.
- `sections` — Ordered list of sections found in the document.
- `keys` — Top-level JSON keys with type info and preview (JSON documents only).
- `toc` — Markdown table of contents entries (markdown documents only).

### `SearchResult`

A single match returned by `searchContent`.

```typescript
SearchResult
```

**Members:**

- `line` — 1-based line number of the matching line.
- `content` — The full text of the matching line.
- `contextBefore` — Lines immediately preceding the match (up to `contextLines`).
- `contextAfter` — Lines immediately following the match (up to `contextLines`).

### `LineRangeResult`

Result of extracting a line range from a document via `getLineRange`.

```typescript
LineRangeResult
```

**Members:**

- `startLine` — 1-based line number where the extracted range begins.
- `endLine` — 1-based line number where the extracted range ends (inclusive).
- `content` — The extracted text content for the requested line range.
- `tokenCount` — Estimated token count for the extracted content.
- `totalLines` — Total number of lines in the full document.
- `totalTokens` — Estimated total token count for the full document.
- `tokensSaved` — Number of tokens saved by extracting only this range.

### `DiffResult`

```typescript
DiffResult
```

**Members:**

- `addedLines`
- `removedLines`
- `addedTokens`
- `removedTokens`

### `StructuredDiffLine`

A single line in a structured diff with type annotation and line numbers.

```typescript
StructuredDiffLine
```

**Members:**

- `type`
- `content`
- `oldLine`
- `newLine`

### `StructuredDiffResult`

Full structured diff result with interleaved lines and summary counts.

```typescript
StructuredDiffResult
```

**Members:**

- `lines`
- `addedLineCount`
- `removedLineCount`
- `addedTokens`
- `removedTokens`

### `MultiDiffVariant`

A single version variant at a divergent line position.

```typescript
MultiDiffVariant
```

**Members:**

- `versionIndex`
- `content`

### `MultiDiffLine`

One line entry in a multi-way diff result.

```typescript
MultiDiffLine
```

**Members:**

- `lineNumber`
- `type` — "consensus" when all versions agree, "divergent" when versions differ,  "insertion" when a version adds a line not present in the base.
- `content`
- `agreement` — How many versions have `content` at this position.
- `total` — Total number of versions (including the base).
- `variants` — Per-version contents when type is "divergent"; empty for "consensus".

### `MultiDiffStats`

Aggregate statistics for a multi-way diff.

```typescript
MultiDiffStats
```

**Members:**

- `totalLines`
- `consensusLines`
- `divergentLines`
- `consensusPercentage`

### `MultiDiffResult`

Full result of a multi-way diff.

```typescript
MultiDiffResult
```

**Members:**

- `baseVersion`
- `versionCount`
- `lines`
- `stats`

### `CherryPickProvenance`

A single provenance entry in the cherry-pick merged output.

```typescript
CherryPickProvenance
```

**Members:**

- `lineStart`
- `lineEnd`
- `fromVersion`
- `fillFrom`

### `CherryPickStats`

Statistics for a cherry-pick merge operation.

```typescript
CherryPickStats
```

**Members:**

- `totalLines`
- `sourcesUsed`
- `sectionsExtracted`
- `lineRangesExtracted`

### `CherryPickResult`

Return value of a cherry-pick merge operation.

```typescript
CherryPickResult
```

**Members:**

- `content`
- `provenance`
- `stats`

### `Conflict`

A single conflict region from a 3-way merge.

```typescript
Conflict
```

**Members:**

- `oursStart` — 1-based start line of the conflicting region in `ours`.
- `oursEnd` — 1-based end line of the conflicting region in `ours` (inclusive).
- `theirsStart` — 1-based start line of the conflicting region in `theirs`.
- `theirsEnd` — 1-based end line of the conflicting region in `theirs` (inclusive).
- `baseStart` — 1-based start line of the conflicting region in the common ancestor.
- `baseEnd` — 1-based end line of the conflicting region in the common ancestor.
- `oursContent` — The conflicting text from `ours`.
- `theirsContent` — The conflicting text from `theirs`.
- `baseContent` — The original text from the common ancestor.

### `MergeStats`

Statistics for a 3-way merge operation.

```typescript
MergeStats
```

**Members:**

- `totalLines` — Total lines in the merged output (including conflict markers).
- `autoMergedLines` — Number of lines accepted without conflict.
- `conflictCount` — Number of distinct conflict regions.

### `ThreeWayMergeResult`

Full result of a 3-way merge operation.

```typescript
ThreeWayMergeResult
```

**Members:**

- `merged` — The merged document content, with conflict markers where applicable.
- `hasConflicts` — `true` when at least one conflict could not be auto-merged.
- `conflicts` — Details of each conflict region.
- `stats` — Summary statistics for the merge.

### `SectionAlignment`

How a section from version A maps to version B.

```typescript
SectionAlignment
```

### `SectionSimilarity`

Per-section similarity record produced by semantic diff.

```typescript
SectionSimilarity
```

**Members:**

- `sectionA`
- `sectionB`
- `similarity`
- `alignment`

### `SemanticChange`

A semantic change annotation for a matched/renamed section pair.

```typescript
SemanticChange
```

**Members:**

- `changeType` — One of: "unchanged", "rephrased", "modified", "rewritten".
- `section`
- `similarity`
- `description`

### `SemanticDiffResult`

Full result of a semantic diff between two document versions.

```typescript
SemanticDiffResult
```

**Members:**

- `overallSimilarity`
- `sectionSimilarities`
- `semanticChanges`

### `ReviewCluster`

A cluster of reviewers whose embeddings are mutually similar.

```typescript
ReviewCluster
```

**Members:**

- `members`
- `avgSimilarity`

### `SemanticConsensusResult`

Result of semantic consensus evaluation across a set of reviews.

```typescript
SemanticConsensusResult
```

**Members:**

- `consensus`
- `agreementScore`
- `clusters`
- `outliers`

### `GraphNode`

A node in the knowledge graph.

```typescript
GraphNode
```

**Members:**

- `id`
- `type`
- `label`
- `weight`

### `GraphEdge`

An edge in the knowledge graph.

```typescript
GraphEdge
```

**Members:**

- `source`
- `target`
- `type`
- `weight`

### `GraphStats`

Statistics for a knowledge graph.

```typescript
GraphStats
```

**Members:**

- `agentCount`
- `topicCount`
- `decisionCount`
- `edgeCount`

### `KnowledgeGraph`

A knowledge graph containing nodes, edges, and statistics.

```typescript
KnowledgeGraph
```

**Members:**

- `nodes`
- `edges`
- `stats`

### `MessageInput`

Input message for graph construction.

```typescript
MessageInput
```

**Members:**

- `id`
- `fromAgentId`
- `content`
- `metadata`
- `createdAt`

### `SimilarityRankResult`

Result entry from rankBySimilarity.

```typescript
SimilarityRankResult
```

**Members:**

- `index`
- `score`

### `AuditAction`

Action type for audit logging. Represents the type of operation that occurred.

```typescript
AuditAction
```

### `ApiVersionInfo`

Metadata for a specific API version.

```typescript
ApiVersionInfo
```

**Members:**

- `version`
- `deprecated`
- `sunset` — ISO 8601 date on which this version will stop being served.

### `LinkType`

Type for a cross-document link relationship.

```typescript
"references" | "depends_on" | "derived_from" | "supersedes" | "related"
```

### `ContentFormat`

Supported content formats.

```typescript
ContentFormat
```

### `DocumentMode`

Lifecycle state for collaborative documents.

```typescript
DocumentMode
```

### `DocumentMeta`

Metadata for a stored document.

```typescript
DocumentMeta
```

**Members:**

- `id`
- `slug`
- `format`
- `contentHash`
- `originalSize`
- `compressedSize`
- `tokenCount`
- `createdAt`
- `expiresAt`
- `accessCount`
- `lastAccessedAt`
- `mode` — Lifecycle state (collaborative documents).
- `versionCount` — Total number of versions.
- `currentVersion` — Current version number.
- `storageKey` — Object storage key when content lives in S3 instead of inline.

### `VersionMeta`

Metadata for a single document version.

```typescript
VersionMeta
```

**Members:**

- `id`
- `documentId`
- `versionNumber`
- `contentHash`
- `tokenCount`
- `createdAt`
- `createdBy`
- `changelog`

### `VersionSummary`

Summary of a version for listing (no content).

```typescript
VersionSummary
```

**Members:**

- `versionNumber`
- `tokenCount`
- `createdAt`
- `createdBy`
- `changelog`

### `VersionDiff`

Result of comparing two versions.

```typescript
VersionDiff
```

**Members:**

- `documentId`
- `fromVersion`
- `toVersion`
- `addedTokens`
- `removedTokens`
- `addedLines`
- `removedLines`

### `LlmtxtRef`

Reference to an llmtxt document shared in a message.

```typescript
LlmtxtRef
```

**Members:**

- `slug`
- `url`
- `format`
- `tokenCount`
- `preview`

### `AttachmentOptions`

Options for creating an attachment via the bridge.

```typescript
AttachmentOptions
```

**Members:**

- `content`
- `format`
- `conversationId`
- `fromAgentId`
- `expiresInMs`

### `AttachmentAccessMode`

Attachment fetch mode supported by the bridge/API layer.

```typescript
AttachmentAccessMode
```

### `AttachmentSharingMode`

Share state persisted by the API layer for an attachment.

```typescript
AttachmentSharingMode
```

### `AttachmentReshareOptions`

Options for re-sharing an existing attachment.

```typescript
AttachmentReshareOptions
```

**Members:**

- `expiresIn`
- `mode`

### `AttachmentVersionOptions`

Options for appending a version to an existing attachment slug.

```typescript
AttachmentVersionOptions
```

**Members:**

- `baseVersion`
- `changelog`

### `Permission`

Fine-grained permission on a document. Canonical definition; mirrors crates/llmtxt-core::rbac::Permission.

```typescript
Permission
```

### `DocumentRole`

Role a user holds on a specific document. Canonical definition; mirrors crates/llmtxt-core::rbac::DocumentRole.

```typescript
DocumentRole
```

### `OrgRole`

Role a user holds within an organisation. Canonical definition; mirrors crates/llmtxt-core::rbac::OrgRole.

```typescript
OrgRole
```

### `DocumentEventType`

Discriminant for document lifecycle events emitted by the event bus.  Consumers should use this type when subscribing to the bus or when filtering events in webhook handlers.

```typescript
DocumentEventType
```

### `DocumentEvent`

Payload for a document lifecycle event.  Emitted by the in-process event bus after a successful database write. Consumers include WebSocket/SSE streams and webhook delivery workers.

```typescript
DocumentEvent
```

**Members:**

- `type` — Discriminant — consumers can switch on this.
- `slug` — Short URL slug of the affected document.
- `documentId` — Opaque document primary key.
- `timestamp` — Unix timestamp in milliseconds.
- `actor` — userId or agentId that triggered the event. 'system' for auto-actions.
- `data` — Event-specific supplemental data.

### `LlmtxtClientConfig`

```typescript
LlmtxtClientConfig
```

**Members:**

- `apiBase`
- `apiKey`
- `agentId`

### `UploadResult`

```typescript
UploadResult
```

**Members:**

- `slug`
- `contentHash`
- `originalSize`
- `compressedSize`
- `compressionRatio`
- `tokens`
- `signedUrl`
- `expiresAt`

### `FetchResult`

```typescript
FetchResult
```

**Members:**

- `slug`
- `content`
- `format`
- `title`
- `contentHash`
- `originalSize`
- `tokens`

### `ReshareResult`

```typescript
ReshareResult
```

**Members:**

- `slug`
- `mode`
- `signedUrl`
- `expiresAt`

### `ResignResult`

Backward-compatible alias. Prefer `ReshareResult`.

```typescript
ReshareResult
```

### `AttachmentVersionResult`

```typescript
AttachmentVersionResult
```

**Members:**

- `slug`
- `versionNumber`
- `patchText`
- `contentHash`
- `createdAt`
- `createdBy`
- `changelog`

### `SectionDelta`

A delta event emitted when the CRDT state for a section changes.

```typescript
SectionDelta
```

**Members:**

- `slug` — Document slug.
- `sectionId` — Section identifier.
- `text` — Current plain-text content of the section after applying the delta.
- `updateBytes` — Raw Loro update bytes that caused this delta (Uint8Array). These are Loro binary format bytes — bitwise incompatible with the previous Yrs lib0 v1 format.
- `receivedAt` — Wall clock timestamp (ms since epoch) when the update was received.

### `Unsubscribe`

Function to call to unsubscribe and close the WebSocket connection.

```typescript
Unsubscribe
```

### `SubscribeSectionOptions`

Options for `subscribeSection`.

```typescript
SubscribeSectionOptions
```

**Members:**

- `baseUrl` — Base URL of the llmtxt API. Defaults to `https://api.llmtxt.my`.
- `token` — Bearer token for authentication. Pass your API key here (llmtxt_... format).
- `onError` — Called when the WebSocket encounters an error.
- `onAwareness` — Called when an AwarenessRelay (0x04) message is received. The payload is the raw awareness bytes relayed from a peer.

### `EmbeddingProvider`

Standard embedding provider interface — matches apps/backend/src/utils/embeddings.ts. Implemented by both the local ONNX provider and the TF-IDF fallback.

```typescript
EmbeddingProvider
```

**Members:**

- `embed`
- `dimensions`
- `model`
- `provider`

### `SignatureHeaders`

HTTP headers produced by `AgentIdentity.buildSignatureHeaders` / `signRequest`.

```typescript
SignatureHeaders
```

**Members:**

- `'X-Agent-Pubkey-Id'` — Agent identifier used to look up the registered public key on the server.
- `'X-Agent-Signature'` — Hex-encoded 64-byte Ed25519 signature over the canonical payload.
- `'X-Agent-Nonce'` — Hex-encoded random nonce (16 bytes = 32 hex chars).
- `'X-Agent-Timestamp'` — Milliseconds since epoch as a decimal string.

### `CanonicalPayloadOptions`

Options for `buildCanonicalPayload`.  All fields map directly to the Rust `canonical_payload()` parameters in `crates/llmtxt-core/src/identity.rs`.

```typescript
CanonicalPayloadOptions
```

**Members:**

- `method` — HTTP method, uppercase (e.g. "PUT").
- `path` — Path and query string (e.g. "/api/v1/documents/abc").
- `timestampMs` — Milliseconds since epoch.
- `agentId` — Agent identifier registered on the server.
- `nonceHex` — Hex-encoded nonce (≥ 16 bytes = ≥ 32 hex chars).
- `bodyHashHex` — Lowercase hex SHA-256 of the request body bytes (64 chars).

### `PredefinedSchemaName`

Union of all registered predefined schema name strings.

```typescript
"prompt-v1"
```

### `JsonFormat`

Inferred TypeScript type for any valid JSON value (object, array, primitive).

```typescript
string | number | boolean | Record<string, unknown> | unknown[] | null
```

### `TextFormat`

Inferred TypeScript type for plain text content.

```typescript
string
```

### `MarkdownFormat`

Inferred TypeScript type for markdown content (string alias).

```typescript
string
```

### `PromptV1`

Inferred TypeScript type for the standard LLM prompt format.

```typescript
{ messages: { role: "system" | "user" | "assistant"; content: string; }[]; system?: string | undefined; temperature?: number | undefined; max_tokens?: number | undefined; }
```

### `PromptMessage`

Inferred TypeScript type for a single prompt message with role and content.

```typescript
{ role: "system" | "user" | "assistant"; content: string; }
```

### `CompressRequest`

Inferred TypeScript type for content compression request payloads.

```typescript
{ content: string; format: "text" | "markdown" | "json"; schema?: string | undefined; metadata?: Record<string, unknown> | undefined; }
```

### `DecompressRequest`

Inferred TypeScript type for content decompression request payloads.

```typescript
{ slug: string; }
```

### `SearchRequest`

Inferred TypeScript type for content search request payloads.

```typescript
{ query: string; slugs: string[]; }
```

### `ValidationResult`

Outcome of a content validation operation.

```typescript
ValidationResult<T>
```

**Members:**

- `success` — Whether the validation passed without errors.
- `data` — The parsed/validated data, present only when `success` is `true`.
- `errors` — List of validation errors, present only when `success` is `false`.
- `format` — The detected or requested content format, when determinable.

### `ValidationError`

A single validation error with location, message, and error code.

```typescript
ValidationError
```

**Members:**

- `path` — Dot-delimited path to the field that failed validation (empty string for root).
- `message` — Human-readable description of the validation failure.
- `code` — Machine-readable error code (e.g. `"invalid_json"`, `"unknown_schema"`).

### `ValidateContentOptions`

Options for content validation.

```typescript
ValidateContentOptions
```

**Members:**

- `schemaName` — Optional predefined schema name for JSON validation.
- `maxBytes` — Maximum content size in bytes. Set to 0 to disable. Default: 5 MB.
- `maxLineBytes` — Maximum line length in bytes. Set to 0 to disable. Default: 64 KB.
- `rejectBinary` — Reject content with binary control characters (0x00-0x08). Default: true.

### `SignedUrlParams`

Parameters that uniquely identify a signed URL access grant.

```typescript
SignedUrlParams
```

**Members:**

- `slug`
- `agentId`
- `conversationId`
- `expiresAt`

### `SignedUrlConfig`

Configuration for generating and verifying signed URLs.

```typescript
SignedUrlConfig
```

**Members:**

- `secret`
- `baseUrl`
- `pathPrefix` — Optional path prefix like `/attachments`. Default: root path.
- `signatureLength` — Signature length in hex chars. Default: 16.

### `VerifyResult`

Outcome of verifying a signed URL.

```typescript
VerifyResult
```

**Members:**

- `valid`
- `reason`
- `params`

### `OrgSignedUrlParams`

Parameters for org-scoped signed URLs (Phase 5 enterprise). Extends conversation-scoped params with an organization ID.

```typescript
OrgSignedUrlParams
```

**Members:**

- `orgId`

### `SnapshotMeta`

```typescript
SnapshotMeta
```

**Members:**

- `sessionId`
- `agentId`
- `createdAt`
- `originalSize`
- `compressedSize`
- `compressionRatio`
- `tokens`
- `contentHash`

### `CompressedSnapshot`

```typescript
CompressedSnapshot
```

**Members:**

- `meta`
- `data`

### `SnapshotOptions`

```typescript
SnapshotOptions
```

**Members:**

- `includeDecisions` — Include full decision log (default: true)
- `includeObservations` — Include brain observations (default: true)
- `maxSize` — Max content size before compression in bytes (default: 5MB)

### `DocumentEventLogEntry`

A single event row from the document event log.

```typescript
DocumentEventLogEntry
```

**Members:**

- `id`
- `seq` — Monotonically increasing per-document sequence number (as string — bigint-safe).
- `event_type`
- `actor_id`
- `payload`
- `created_at`

### `WatchDocumentOptions`

```typescript
WatchDocumentOptions
```

**Members:**

- `fromSeq` — Resume from this sequence number (exclusive). If unset, starts from the beginning.
- `apiKey` — Bearer token or API key for authenticated requests. Passed as `Authorization: Bearer <apiKey>` header.
- `maxReconnects` — Maximum reconnect attempts within the circuit-breaker window (60s). Defaults to 5.
- `signal` — AbortSignal to cancel the stream externally.

### `DocumentState`

Lifecycle state of a collaborative document.

```typescript
DocumentState
```

### `StateTransition`

Record of a lifecycle state change.

```typescript
StateTransition
```

**Members:**

- `from` — State before the transition.
- `to` — State after the transition.
- `changedBy` — Agent that initiated the transition.
- `changedAt` — Timestamp of the transition (ms since epoch).
- `reason` — Human-readable reason for the transition.
- `atVersion` — Document version number at the time of transition.

### `TransitionResult`

Result of attempting a state transition.

```typescript
TransitionResult
```

**Members:**

- `valid` — Whether the transition is allowed.
- `reason` — Human-readable explanation when invalid.
- `allowedTargets` — The allowed targets from the current state (for error context).

### `VersionEntry`

A single version entry in a document's patch stack.

```typescript
VersionEntry
```

**Members:**

- `versionNumber` — Sequential version number (1-based).
- `patchText` — Unified diff patch text.
- `createdBy` — Agent that authored this version.
- `changelog` — One-line description of the change.
- `contentHash` — SHA-256 hash of the resulting content after applying this patch.
- `createdAt` — Timestamp of creation (ms since epoch).

### `ReconstructionResult`

Result of reconstructing a document at a specific version.

```typescript
ReconstructionResult
```

**Members:**

- `content` — The document content at the requested version.
- `version` — The version number that was reconstructed.
- `patchesApplied` — Number of patches applied to reach this version.
- `contentHash` — SHA-256 hash of the reconstructed content.
- `tokenCount` — Token count of the reconstructed content.

### `PatchValidationResult`

Result of validating whether a patch applies cleanly.

```typescript
PatchValidationResult
```

**Members:**

- `applies` — Whether the patch can be applied without conflicts.
- `error` — Error message if the patch does not apply.
- `resultContent` — The content that would result if the patch applies.

### `VersionDiffSummary`

Summary of changes between two versions.

```typescript
VersionDiffSummary
```

**Members:**

- `fromVersion` — Source version number.
- `toVersion` — Target version number.
- `addedLines` — Lines added between versions.
- `removedLines` — Lines removed between versions.
- `addedTokens` — Tokens added between versions.
- `removedTokens` — Tokens removed between versions.
- `patchText` — Unified diff text.

### `ApprovalStatus`

Status of an individual review.

```typescript
ApprovalStatus
```

### `Review`

A single review from an agent.

```typescript
Review
```

**Members:**

- `reviewerId` — Agent that submitted the review.
- `status` — Current status of this review.
- `timestamp` — Timestamp of the review action (ms since epoch).
- `reason` — Reason or comment provided with the review.
- `atVersion` — Version number the review applies to (`STALE` if document changed since).

### `ApprovalPolicy`

Policy governing how approvals are evaluated.

```typescript
ApprovalPolicy
```

**Members:**

- `requiredCount` — Minimum number of approvals required (absolute count).  Ignored when `requiredPercentage` is set ( 0).
- `requireUnanimous` — If true, all allowed reviewers must approve (overrides count/percentage).
- `allowedReviewerIds` — Agent IDs allowed to review. Empty means anyone can review.
- `timeoutMs` — Auto-expire reviews older than this (ms). 0 means no timeout.
- `requiredPercentage` — Percentage of effective reviewers required (0-100). 0 means use requiredCount.  When  0, threshold = ceil(percentage * effectiveReviewerCount / 100).

### `ApprovalResult`

Result of evaluating reviews against a policy.

```typescript
ApprovalResult
```

**Members:**

- `approved` — Whether the approval threshold is met.
- `approvedBy` — Reviewers that have approved.
- `rejectedBy` — Reviewers that have rejected.
- `pendingFrom` — Reviewers that are still pending.
- `staleFrom` — Reviewers whose reviews are stale (document changed since).
- `reason` — Human-readable summary of the evaluation.

### `StorageType`

How document content is stored.

```typescript
StorageType
```

### `CompressionMethod`

Compression method used for stored content.

```typescript
CompressionMethod
```

### `ContentRef`

Reference to where a document's compressed content lives.  Inline: content is stored directly in the database (small documents). Object-store: content is stored in S3-compatible storage, referenced by key.

```typescript
ContentRef
```

**Members:**

- `type` — Storage backend type.
- `storageKey` — Location of the content. - For `inline`: not used (content is in the database row). - For `object-store`: the object key (e.g. `attachments/xK9mP2nQ/v3.zlib`).
- `contentHash` — SHA-256 hash of the uncompressed content for integrity verification.
- `originalSize` — Size of the uncompressed content in bytes.
- `compressedSize` — Size of the compressed content in bytes.
- `compression` — Compression method used.

### `StorageMetadata`

Metadata about a stored document blob.

```typescript
StorageMetadata
```

**Members:**

- `ref` — Content reference.
- `createdAt` — When the content was first stored (ms since epoch).
- `lastAccessedAt` — When the content was last accessed (ms since epoch).
- `accessCount` — Number of times the content has been accessed.

### `StorageAdapter`

Storage adapter that platforms implement.

```typescript
StorageAdapter
```

**Members:**

- `getContent` — Retrieve document content at a specific version. When version is omitted, returns the latest version's content.
- `putContent` — Store document content for a specific version. Returns a ContentRef indicating where the content was stored.
- `getVersions` — Get the ordered list of version entries for a document.
- `addVersion` — Append a new version entry to the document's version stack.
- `getState` — Get the current lifecycle state of a document.
- `setState` — Record a lifecycle state transition.
- `getReviews` — Get all reviews for a document.
- `addReview` — Add or update a review for a document.
- `getApprovalPolicy` — Get the approval policy for a document.

### `VersionAttribution`

Attribution data for a single version.

```typescript
VersionAttribution
```

**Members:**

- `versionNumber` — Version number this attribution describes.
- `authorId` — Agent that authored the change.
- `addedLines` — Lines added in this version.
- `removedLines` — Lines removed in this version.
- `addedTokens` — Tokens added in this version.
- `removedTokens` — Tokens removed in this version.
- `sectionsModified` — Section titles that were modified (detected via structural analysis).
- `changelog` — One-line change description.
- `createdAt` — Timestamp of the change.

### `ContributorSummary`

Aggregated contribution summary for a single agent.

```typescript
ContributorSummary
```

**Members:**

- `agentId` — Agent identifier.
- `versionsAuthored` — Number of versions this agent authored.
- `totalTokensAdded` — Total tokens added across all versions.
- `totalTokensRemoved` — Total tokens removed across all versions.
- `netTokens` — Net token impact (added - removed).
- `firstContribution` — Timestamp of first contribution.
- `lastContribution` — Timestamp of most recent contribution.
- `sectionsModified` — Unique section titles this agent modified.

### `PlannedSection`

A section selected for retrieval.

```typescript
PlannedSection
```

**Members:**

- `sectionIndex` — Index into the overview's sections array.
- `title` — Section title.
- `tokenCount` — Estimated token cost for this section.
- `reason` — Why this section was selected.
- `score` — Relevance score (0-1) when selected by query match.

### `RetrievalPlan`

The output of retrieval planning.

```typescript
RetrievalPlan
```

**Members:**

- `sections` — Sections selected for retrieval, ordered by relevance.
- `totalTokens` — Total tokens across all selected sections.
- `budgetRemaining` — Remaining token budget after selection.
- `tokensSaved` — Tokens saved compared to fetching the full document.
- `fullDocumentFits` — Whether the full document fits within budget (no planning needed).

### `RetrievalOptions`

Options for retrieval planning.

```typescript
RetrievalOptions
```

**Members:**

- `minScore` — Minimum similarity score to include a section (0-1). Default: 0.1
- `includeIntro` — Always include the first section (typically title/intro). Default: true

### `CreateVersionOptions`

Options for creating a new version.

```typescript
CreateVersionOptions
```

**Members:**

- `agentId` — Agent creating this version.
- `changelog` — One-line change description.

### `LlmtxtDocumentOptions`

Options for constructing an LlmtxtDocument.

```typescript
LlmtxtDocumentOptions
```

**Members:**

- `slug` — Document slug.
- `storage` — Storage adapter for persistence.

### `Lease`

```typescript
Lease
```

**Members:**

- `leaseId`
- `holder`
- `expiresAt`

### `LeaseOptions`

```typescript
LeaseOptions
```

**Members:**

- `baseUrl`
- `apiKey`

### `SectionDelta`

Section-level delta returned by fetchSectionDelta and included in diff-mode SSE payloads.

```typescript
SectionDelta
```

**Members:**

- `added`
- `modified`
- `deleted`
- `fromSeq`
- `toSeq`

### `SectionDeltaResponse`

```typescript
SectionDeltaResponse
```

**Members:**

- `delta`
- `currentSeq`

### `SubscribeOptions`

```typescript
SubscribeOptions
```

**Members:**

- `since` — Resume from a specific sequence number (sent as Last-Event-ID).
- `mode` — 'events' = raw event payloads; 'diff' = payloads include computed content diffs.
- `baseUrl` — Base URL of the API (no trailing slash).
- `apiKey` — Bearer API key.

### `SubscriptionEvent`

```typescript
SubscriptionEvent
```

**Members:**

- `seq` — Monotonic sequence number (from Last-Event-ID).
- `type` — Event type string (e.g. 'version.published', 'SECTION_LEASED').
- `path` — The path pattern the subscription was opened with.
- `payload` — Raw event payload.
- `delta` — Section-level delta, present when mode='diff' and the server computed one.

### `Unsubscribe`

Call to close the SSE subscription.

```typescript
Unsubscribe
```

### `TopologyMode`

The three supported deployment topologies.  - `standalone` — one agent, one local .db file, zero network dependency. - `hub-spoke` — N ephemeral or persistent spokes connected to a central hub. - `mesh` — N persistent peers syncing via P2P transport (T386).

```typescript
TopologyMode
```

### `StandaloneConfig`

Config for standalone topology.  One agent, one local `.db` file, zero network dependency. Use for single developer or single agent, offline-first operation, local testing.

```typescript
StandaloneConfig
```

**Members:**

- `topology`
- `storagePath` — Path for the local .db file. Defaults to '.llmtxt'.
- `identityPath` — Optional path to agent identity keypair.
- `crsqlite` — Set true to enable cr-sqlite (T385). Default: false.
- `crsqliteExtPath` — Path to crsqlite extension (optional, see P2-cr-sqlite.md).

### `HubSpokeConfig`

Config for hub-and-spoke topology.  One hub (PostgresBackend or a designated LocalBackend) is the Single Source of Truth. N spokes are RemoteBackend clients that write to and read from the hub. Ephemeral swarm workers are spokes with no local `.db` file.

```typescript
HubSpokeConfig
```

**Members:**

- `topology`
- `hubUrl` — URL of the hub API instance (e.g. 'https://api.llmtxt.my'). REQUIRED — validation MUST fail fast if absent.
- `apiKey` — API key for authenticating with the hub. MUST be present for write operations.
- `identityPath` — Ed25519 private key hex for signing writes (alternative to apiKey). If both are supplied, Ed25519 signed writes take precedence.
- `persistLocally` — When true, this spoke maintains a local cr-sqlite replica. Requires T385 (cr-sqlite) to be installed. Default: false (ephemeral swarm worker mode — no .db file).
- `storagePath` — Required when persistLocally=true. Path to local .db file.

### `MeshConfig`

Config for mesh topology.  N persistent peers, each with their own cr-sqlite LocalBackend. No central hub is required. Peers sync directly with each other via the P2P transport defined in T386. Use for offline-first P2P collaboration, air-gapped environments, or small teams of persistent agents (≤10 peers).

```typescript
MeshConfig
```

**Members:**

- `topology`
- `storagePath` — Path for the local cr-sqlite .db file. REQUIRED for mesh.
- `identityPath` — Optional path to agent identity keypair. Defaults to storagePath/identity.json.
- `peers` — Known peers at startup. Each entry is a transport address. Format: 'unix:/path/to/sock' | 'http://host:port'
- `meshDir` — Directory where peer advertisement files are written and read. Defaults to $LLMTXT_MESH_DIR or '/tmp/llmtxt-mesh'.
- `transport` — Transport to listen on. Default: 'unix'.
- `port` — Port for http transport. Default: 7642.

### `TopologyConfig`

Discriminated union of all topology configs, keyed on the `topology` field.

```typescript
TopologyConfig
```

### `BackendConfig`

Configuration for a Backend instance.  BackendConfig is passed to the backend constructor. LocalBackend uses storagePath + identityPath; RemoteBackend uses baseUrl + apiKey.

```typescript
BackendConfig
```

**Members:**

- `storagePath` — Directory where the backend stores its data. For LocalBackend: SQLite DB and large content blobs live here. Defaults to '.llmtxt' relative to the working directory.
- `identityPath` — Path to the agent identity keypair JSON file. Defaults to /identity.json.
- `baseUrl` — Base URL of a remote LLMtxt API instance. Required for RemoteBackend. MUST include scheme (https://).
- `apiKey` — API key for authenticating with the remote instance. Used by RemoteBackend in the Authorization header.
- `wal` — SQLite WAL mode. Defaults to true. Only relevant for LocalBackend.
- `leaseReaperIntervalMs` — Lease reaper interval in milliseconds. Defaults to 10_000. Only relevant for LocalBackend.
- `presenceTtlMs` — Presence TTL in milliseconds. Defaults to 30_000. Only relevant for LocalBackend.
- `crsqliteExtPath` — Absolute path to a pre-downloaded crsqlite native extension (.so / .dylib / .dll). When supplied, LocalBackend uses this path instead of resolving the extension via vlcn.io/crsqlite. Useful in air-gapped or bundled environments where the install-time binary download is not possible.  DR-P2-01: If absent, LocalBackend attempts to resolve the path from the vlcn.io/crsqlite optional peer dependency. If neither is available, LocalBackend opens without cr-sqlite (hasCRR = false, no crash).
- `maxBlobSizeBytes` — Maximum blob size in bytes. Defaults to 100 * 1024 * 1024 (100 MB).
- `blobStorageMode` — Blob storage mode for PostgresBackend. 's3' uses S3/R2 object storage (default). 'pg-lo' uses PostgreSQL large objects.
- `s3Endpoint` — S3/R2 endpoint URL (e.g. "https://s3.us-east-1.amazonaws.com").
- `s3Bucket` — S3/R2 bucket name. Required when blobStorageMode = 's3'.
- `s3Region` — S3/R2 region (e.g. "us-east-1").
- `s3AccessKeyId` — S3/R2 access key ID.
- `s3SecretAccessKey` — S3/R2 secret access key.

### `Document`

A stored document record.

```typescript
Document
```

**Members:**

- `id` — Unique document identifier (nanoid).
- `slug` — URL-safe slug derived from the title. Unique per backend.
- `title` — Human-readable document title.
- `state` — Current lifecycle state.
- `createdBy` — Agent that created the document.
- `createdAt` — Creation timestamp (ms since epoch).
- `updatedAt` — Last modified timestamp (ms since epoch).
- `versionCount` — Current version count.
- `labels` — Arbitrary metadata labels.

### `CreateDocumentParams`

Parameters for creating a document.

```typescript
CreateDocumentParams
```

**Members:**

- `title`
- `createdBy`
- `labels`
- `slug` — If supplied, slug is used as-is instead of being derived from title.

### `ListDocumentsParams`

Parameters for listing documents.

```typescript
ListDocumentsParams
```

**Members:**

- `cursor` — Cursor for pagination (document id).
- `limit` — Maximum number of results. Defaults to 20.
- `state` — Filter by state.
- `createdBy` — Filter by creator.

### `ListResult`

Paginated list result.

```typescript
ListResult<T>
```

**Members:**

- `items`
- `nextCursor` — Cursor to pass for the next page, or null if no more results.

### `PublishVersionParams`

Parameters for publishing a new version.

```typescript
PublishVersionParams
```

**Members:**

- `documentId`
- `content` — Full content of this version (before patching).
- `patchText` — Unified diff patch text from previous version. Empty string for v1.
- `createdBy` — Agent creating this version.
- `changelog` — One-line description of the change.

### `TransitionParams`

Parameters for transitioning a document's lifecycle state.

```typescript
TransitionParams
```

**Members:**

- `documentId`
- `to`
- `changedBy`
- `reason`

### `DocumentEvent`

A single document event entry.

```typescript
DocumentEvent
```

**Members:**

- `id`
- `documentId`
- `type`
- `agentId`
- `payload`
- `createdAt`

### `AppendEventParams`

Parameters for appending an event.

```typescript
AppendEventParams
```

**Members:**

- `documentId`
- `type`
- `agentId`
- `payload`

### `QueryEventsParams`

Parameters for querying events.

```typescript
QueryEventsParams
```

**Members:**

- `documentId`
- `type` — Filter by event type.
- `since` — Return events after this cursor (event id).
- `limit` — Maximum results. Defaults to 50.

### `CrdtUpdate`

A CRDT update payload for a document section.

```typescript
CrdtUpdate
```

**Members:**

- `documentId`
- `sectionKey`
- `updateBase64` — Yjs binary update encoded as base64.
- `agentId`
- `createdAt`

### `CrdtState`

Current CRDT state for a section.

```typescript
CrdtState
```

**Members:**

- `documentId`
- `sectionKey`
- `stateVectorBase64` — Serialized Yjs state vector as base64.
- `snapshotBase64` — Current merged document state as base64.
- `updatedAt`

### `Lease`

A distributed lock / lease record.

```typescript
Lease
```

**Members:**

- `id`
- `resource` — Resource being locked (e.g. 'document:abc123').
- `holder` — Agent holding the lease.
- `expiresAt` — Expiry timestamp (ms since epoch). 0 = never expires.
- `acquiredAt`

### `AcquireLeaseParams`

Parameters for acquiring a lease.

```typescript
AcquireLeaseParams
```

**Members:**

- `resource`
- `holder`
- `ttlMs` — Lease TTL in milliseconds.

### `PresenceEntry`

A presence record for an agent viewing a document.

```typescript
PresenceEntry
```

**Members:**

- `agentId`
- `documentId`
- `meta` — Agent metadata (cursor position, color, etc.).
- `lastSeen`
- `expiresAt` — Expiry timestamp (ms since epoch).

### `ScratchpadMessage`

A scratchpad message entry.

```typescript
ScratchpadMessage
```

**Members:**

- `id`
- `toAgentId` — Recipient agent id.
- `fromAgentId` — Sender agent id.
- `payload`
- `createdAt`
- `exp` — Expiry (ms since epoch). 0 = never expires.

### `SendScratchpadParams`

Parameters for sending a scratchpad message.

```typescript
SendScratchpadParams
```

**Members:**

- `toAgentId`
- `fromAgentId`
- `payload`
- `ttlMs` — TTL in ms. 0 = never expires. Defaults to 24h.

### `A2AMessage`

An A2A (Agent-to-Agent) inbox message.

```typescript
A2AMessage
```

**Members:**

- `id`
- `toAgentId` — Recipient agent id.
- `envelopeJson` — Ed25519-signed envelope JSON string.
- `createdAt`
- `exp` — Expiry (ms since epoch). 0 = never expires.

### `SearchResult`

A single semantic search result.

```typescript
SearchResult
```

**Members:**

- `documentId`
- `slug`
- `title`
- `score` — Cosine similarity score in [0, 1].
- `snippet` — Matching snippet (optional).

### `SearchParams`

Parameters for semantic search.

```typescript
SearchParams
```

**Members:**

- `query`
- `topK` — Maximum results. Defaults to 10.
- `minScore` — Minimum similarity score (0–1). Defaults to 0.0.

### `AgentPubkeyRecord`

A registered agent public key record.

```typescript
AgentPubkeyRecord
```

**Members:**

- `agentId`
- `pubkeyHex` — Hex-encoded Ed25519 public key.
- `label`
- `createdAt`
- `revokedAt` — If set, this key has been revoked.

### `AttachBlobParams`

Parameters for attaching a blob to a document.

```typescript
AttachBlobParams
```

**Members:**

- `docSlug` — Document slug the blob is attached to.
- `name` — User-visible attachment name (e.g. "diagram.png").
- `contentType` — MIME content type.
- `data` — Raw binary data.
- `uploadedBy` — Agent performing the upload.

### `BlobAttachment`

A stored blob attachment record.

```typescript
BlobAttachment
```

**Members:**

- `id`
- `docSlug`
- `blobName`
- `hash`
- `size`
- `contentType`
- `uploadedBy`
- `uploadedAt`

### `BlobData`

Result of fetching a blob.

```typescript
BlobData
```

**Members:**

- `data` — Raw blob bytes. Only present when fetched with includeData=true.

### `BlobRef`

Changeset blob reference (bytes omitted — lazy pull).

```typescript
BlobRef
```

**Members:**

- `blobName`
- `hash`
- `size`
- `contentType`
- `uploadedBy`
- `uploadedAt`

### `BlobOps`

Blob storage and retrieval operations.

```typescript
BlobOps
```

**Members:**

- `attachBlob` — Attach a binary blob to a document.  MUST compute SHA-256 hash of data and use it as the storage key. MUST validate the attachment name via llmtxt-core blob_name_validate. MUST enforce maxBlobSizeBytes (default 100MB). MUST apply LWW: if a blob with the same name already exists on the document,   it is soft-deleted and the new record becomes active. MUST NOT store duplicate bytes when hash already exists in the store   (content-addressed dedup within the same backend instance). MUST return the new BlobAttachment record.
- `getBlob` — Retrieve a blob attachment, optionally including bytes.  MUST return null (not throw) if blobName is not attached to the document. MUST verify hash on read when includeData=true. Return BlobCorruptError if mismatch. Default: includeData = false (manifest metadata only).
- `listBlobs` — List all active (non-deleted) blob attachments for a document.  MUST return an empty array (not throw) when no blobs are attached. MUST NOT include bytes (manifest metadata only).
- `detachBlob` — Detach (soft-delete) a named blob from a document.  MUST return false (not throw) if no active attachment with blobName exists. MUST set deleted_at = now(). Actual byte storage is NOT cleaned up   (orphan collection is a deferred concern). MUST NOT affect other documents sharing the same blob hash.
- `fetchBlobByHash` — Fetch blob bytes by hash directly (used during lazy sync pull).  MUST return null if no blob with this hash exists in the store. MUST verify hash on return. This method bypasses the manifest and is used by the sync layer.

### `DocumentOps`

Document CRUD operations.

```typescript
DocumentOps
```

**Members:**

- `createDocument` — Create a new document. MUST generate a unique slug from the title if not provided.
- `getDocument` — Retrieve a document by its id. MUST return null (not throw) when the document does not exist.
- `getDocumentBySlug` — Retrieve a document by its slug. MUST return null (not throw) when the document does not exist.
- `listDocuments` — List documents with optional filtering and cursor-based pagination.
- `deleteDocument` — Delete a document and all associated data. MUST return false (not throw) if the document does not exist.

### `VersionOps`

Version stack operations.

```typescript
VersionOps
```

**Members:**

- `publishVersion` — Publish a new version of a document. MUST compute and store the content hash via llmtxt-core hash_content. MUST increment the document's versionCount.
- `getVersion` — Retrieve a version entry by document id and version number. MUST return null when the version does not exist.
- `listVersions` — List all version entries for a document in ascending order.
- `transitionVersion` — Transition a document's lifecycle state. MUST validate the transition via sdk/lifecycle.ts validateTransition. MUST return an error result (not throw) for invalid transitions.

### `ApprovalOps`

BFT approval operations.

```typescript
ApprovalOps
```

**Members:**

- `submitSignedApproval` — Submit a signed approval (or rejection) for a document version. MUST verify the Ed25519 signature before persisting. MUST reject duplicate approvals from the same reviewer.
- `getApprovalProgress` — Get current approval progress for a document version.
- `getApprovalPolicy` — Get or set the approval policy for a document.
- `setApprovalPolicy`

### `EventOps`

Document event log operations.

```typescript
EventOps
```

**Members:**

- `appendEvent` — Append an event to a document's event log. MUST emit the event on the local bus for subscribeStream consumers.
- `queryEvents` — Query the event log for a document with optional filtering.
- `subscribeStream` — Subscribe to the event stream for a document. MUST return an AsyncIterable that yields events as they are appended. MUST clean up listeners when the consumer calls .return() or the iterator is GC'd. LocalBackend uses in-process EventEmitter; RemoteBackend uses SSE.

### `CrdtOps`

CRDT section operations.

```typescript
CrdtOps
```

**Members:**

- `applyCrdtUpdate` — Apply a Yjs binary update to a document section. MUST merge via llmtxt-core WASM merge_updates. MUST persist the raw update and update the section snapshot.
- `getCrdtState` — Get the current CRDT state for a section. MUST return null when no state exists for the section.
- `subscribeSection` — Subscribe to CRDT updates for a document section. LocalBackend uses in-process EventEmitter; RemoteBackend uses WS.

### `LeaseOps`

Distributed lease operations.

```typescript
LeaseOps
```

**Members:**

- `acquireLease` — Acquire a lease on a resource. MUST fail (return null) if a non-expired lease exists for a different holder. MUST succeed (return existing) if the same holder re-acquires.
- `renewLease` — Renew an existing lease, extending its TTL. MUST return null if the lease does not exist or is held by a different agent.
- `releaseLease` — Release a lease immediately. MUST return false if the lease does not exist or holder mismatch.
- `getLease` — Get the current lease for a resource. Returns null if no active lease exists.

### `PresenceOps`

Presence (real-time who-is-viewing) operations.

```typescript
PresenceOps
```

**Members:**

- `joinPresence` — Join or update presence for an agent on a document. Presence is NOT persisted across restarts — in-memory only.
- `leavePresence` — Remove an agent from a document's presence.
- `listPresence` — List all non-expired presence entries for a document.
- `heartbeatPresence` — Refresh the lastSeen timestamp for an agent's presence.

### `ScratchpadOps`

Scratchpad ephemeral message operations.

```typescript
ScratchpadOps
```

**Members:**

- `sendScratchpad` — Send a scratchpad message to an agent. Default TTL is 24 hours. exp=0 means never expires.
- `pollScratchpad` — Poll scratchpad messages for an agent. MUST only return non-expired messages. MUST treat exp=0 entries as never-expired.
- `deleteScratchpadMessage` — Delete scratchpad messages for an agent (after consumption).

### `A2AOps`

A2A (Agent-to-Agent) inbox operations.

```typescript
A2AOps
```

**Members:**

- `sendA2AMessage` — Deliver a signed A2A message to an agent's inbox. MUST verify the sender's Ed25519 signature before persisting. Default TTL is 48 hours.
- `pollA2AInbox` — Poll messages from an agent's inbox. MUST only return non-expired messages.
- `deleteA2AMessage` — Delete a message from an agent's inbox.

### `SearchOps`

Semantic search operations.

```typescript
SearchOps
```

**Members:**

- `indexDocument` — Index a document version for semantic search. MUST compute an embedding vector and store it. SHOULD degrade gracefully when onnxruntime-node is not installed.
- `search` — Perform semantic search across indexed documents. MUST return results sorted by cosine similarity descending. SHOULD return empty array (not throw) when embedding model is unavailable.

### `IdentityOps`

Agent identity and pubkey registry operations.

```typescript
IdentityOps
```

**Members:**

- `registerAgentPubkey` — Register an agent's public key. MUST be idempotent — registering the same key twice MUST NOT error.
- `lookupAgentPubkey` — Look up an agent's registered public key. MUST return null when the agent has no registered key.
- `listAgentPubkeys` — List all active (non-revoked) public key records. SHOULD support optional userId filter when the backend tracks ownership.
- `revokeAgentPubkey` — Revoke an agent's public key. MUST set revokedAt on the key record.
- `recordSignatureNonce` — Record a signature nonce to prevent replay attacks. MUST fail if the nonce has already been recorded.
- `hasNonceBeenUsed` — Check whether a nonce has already been used.

### `ContributorRecord`

A contributor record tracking per-agent token attribution.

```typescript
ContributorRecord
```

**Members:**

- `documentId`
- `agentId`
- `netTokens` — Net token contribution (positive = added, negative = removed).
- `versionCount` — Number of versions this agent has contributed.
- `lastContributedAt`

### `Collection`

A named collection of documents.

```typescript
Collection
```

**Members:**

- `id`
- `slug`
- `name`
- `description`
- `ownerId`
- `createdAt`
- `updatedAt`
- `documentSlugs` — Ordered list of document slugs in this collection.

### `CreateCollectionParams`

Parameters for creating a collection.

```typescript
CreateCollectionParams
```

**Members:**

- `name`
- `description`
- `ownerId`
- `slug`

### `ListCollectionsParams`

Parameters for listing collections.

```typescript
ListCollectionsParams
```

**Members:**

- `ownerId`
- `cursor`
- `limit`

### `CollectionExport`

Export format for a collection.

```typescript
CollectionExport
```

**Members:**

- `collection`
- `documents`
- `exportedAt`

### `DocumentLink`

A directed link between two documents.

```typescript
DocumentLink
```

**Members:**

- `id`
- `sourceDocumentId`
- `targetDocumentId`
- `label` — Optional link label (e.g., 'references', 'extends').
- `createdAt`

### `CreateDocLinkParams`

Parameters for creating a document link.

```typescript
CreateDocLinkParams
```

**Members:**

- `sourceDocumentId`
- `targetDocumentId`
- `label`

### `GraphResult`

Global knowledge graph result.

```typescript
GraphResult
```

**Members:**

- `nodes`
- `edges`

### `Webhook`

A webhook registration.

```typescript
Webhook
```

**Members:**

- `id`
- `ownerId`
- `url`
- `secret` — HMAC signing secret (hex).
- `events` — Subscribed event types.
- `enabled`
- `createdAt`
- `updatedAt`

### `CreateWebhookParams`

Parameters for creating a webhook.

```typescript
CreateWebhookParams
```

**Members:**

- `ownerId`
- `url`
- `secret`
- `events`

### `WebhookTestResult`

Result of a webhook test delivery.

```typescript
WebhookTestResult
```

**Members:**

- `webhookId`
- `delivered`
- `statusCode`
- `responseBody`
- `durationMs`

### `SignedUrl`

A time-limited signed access token for a document.

```typescript
SignedUrl
```

**Members:**

- `token`
- `documentId`
- `expiresAt` — Expiry timestamp (ms since epoch). 0 = never expires.
- `permission` — Permission granted by this token.
- `createdAt`

### `CreateSignedUrlParams`

Parameters for creating a signed URL.

```typescript
CreateSignedUrlParams
```

**Members:**

- `documentId`
- `ttlMs` — TTL in milliseconds. 0 = never expires. Defaults to 24 hours.
- `permission`

### `DocumentVisibility`

Document visibility level.

```typescript
DocumentVisibility
```

### `RoleGrant`

A role grant entry.

```typescript
RoleGrant
```

**Members:**

- `userId`
- `role`
- `grantedAt`

### `AccessControlList`

The full access control list for a document.

```typescript
AccessControlList
```

**Members:**

- `documentId`
- `visibility`
- `grants`

### `GrantAccessParams`

Parameters for granting access.

```typescript
GrantAccessParams
```

**Members:**

- `userId`
- `role`

### `Organization`

An organization grouping users and documents.

```typescript
Organization
```

**Members:**

- `id`
- `slug`
- `name`
- `ownerId`
- `createdAt`
- `updatedAt`

### `CreateOrgParams`

Parameters for creating an organization.

```typescript
CreateOrgParams
```

**Members:**

- `name`
- `ownerId`
- `slug`

### `ApiKey`

An API key record (secret never returned after creation).

```typescript
ApiKey
```

**Members:**

- `id`
- `userId`
- `name`
- `prefix` — Key prefix for display (first 8 chars of hash). Never the full secret.
- `createdAt`
- `revokedAt` — If set, this key has been revoked.

### `CreateApiKeyParams`

Parameters for creating an API key.

```typescript
CreateApiKeyParams
```

**Members:**

- `userId`
- `name`

### `ApiKeyWithSecret`

Full API key including secret — only returned at creation time.

```typescript
ApiKeyWithSecret
```

**Members:**

- `secret` — The full API key secret. Shown ONCE at creation; store securely.

### `ApprovalChainEntry`

An entry in the tamper-evident approval chain.

```typescript
ApprovalChainEntry
```

**Members:**

- `approvalId`
- `reviewerId`
- `status`
- `atVersion`
- `timestamp`
- `chainHash`
- `prevChainHash`
- `sigHex`

### `ApprovalChainResult`

Result of verifying the approval chain for a document.

```typescript
ApprovalChainResult
```

**Members:**

- `valid`
- `length`
- `firstInvalidAt`
- `entries`

### `ContributorOps`

Contributor attribution operations.

```typescript
ContributorOps
```

**Members:**

- `listContributors` — List all contributors for a document, ordered by net token contribution. MUST return an empty array (not throw) when no contributors exist.

### `BftOps`

BFT consensus chain operations.

```typescript
BftOps
```

**Members:**

- `getApprovalChain` — Retrieve the tamper-evident approval chain for a document. MUST verify each chain link and report the first invalid position. MUST return an empty chain (not throw) when no approvals exist.

### `CollectionOps`

Collection CRUD and membership operations.

```typescript
CollectionOps
```

**Members:**

- `createCollection` — Create a new collection. MUST generate a unique slug from the name if not provided.
- `getCollection` — Retrieve a collection by slug. MUST return null (not throw) when the collection does not exist.
- `listCollections` — List collections with optional owner filter and pagination.
- `addDocToCollection` — Add a document to a collection at an optional position. MUST be idempotent — adding the same document twice MUST NOT error.
- `removeDocFromCollection` — Remove a document from a collection. MUST return false (not throw) when the document is not in the collection.
- `reorderCollection` — Reorder documents in a collection. MUST accept the full ordered list of document slugs as the new order.
- `exportCollection` — Export a collection with all its documents' latest versions.

### `CrossDocOps`

Cross-document link and graph operations.

```typescript
CrossDocOps
```

**Members:**

- `createDocumentLink` — Create a directed link between two documents. MUST be idempotent — duplicate links SHOULD be deduplicated.
- `getDocumentLinks` — Get all links originating from or pointing to a document.
- `deleteDocumentLink` — Delete a document link. MUST return false (not throw) if the link does not exist.
- `getGlobalGraph` — Get the global document knowledge graph. SHOULD limit results for large backends (e.g., max 500 nodes).

### `WebhookOps`

Webhook registration and delivery operations.

```typescript
WebhookOps
```

**Members:**

- `createWebhook` — Register a new webhook endpoint. MUST generate a signing secret if not provided.
- `listWebhooks` — List webhooks owned by a user.
- `deleteWebhook` — Delete a webhook. MUST verify ownership before deletion. MUST return false (not throw) if the webhook does not exist.
- `testWebhook` — Send a synthetic test delivery to a webhook. MUST deliver an HTTP POST to the webhook URL. SHOULD return the response status and body.

### `SignedUrlOps`

Signed URL (time-limited access token) operations.

```typescript
SignedUrlOps
```

**Members:**

- `createSignedUrl` — Create a time-limited signed access token for a document. ttlMs=0 means never expires. Default TTL is 24 hours.
- `verifySignedUrl` — Verify a signed URL token and return the associated document and permission. MUST return null when the token is invalid or expired.

### `AccessControlOps`

Document access control operations.

```typescript
AccessControlOps
```

**Members:**

- `getDocumentAccess` — Get the full access control list (visibility + role grants) for a document.
- `grantDocumentAccess` — Grant a user a role on a document. MUST be idempotent — granting the same role twice MUST NOT error.
- `revokeDocumentAccess` — Revoke all role grants for a user on a document. MUST return false (not throw) when the user has no grant.
- `setDocumentVisibility` — Set the document's visibility level.

### `OrganizationOps`

Organization management operations.

```typescript
OrganizationOps
```

**Members:**

- `createOrganization` — Create a new organization. MUST generate a unique slug from the name if not provided.
- `getOrganization` — Retrieve an organization by slug. MUST return null (not throw) when the organization does not exist.
- `listOrganizations` — List organizations the user belongs to or owns.
- `addOrgMember` — Add a user to an organization. MUST be idempotent — adding the same member twice MUST NOT error.
- `removeOrgMember` — Remove a user from an organization. MUST return false (not throw) when the user is not a member.

### `ApiKeyOps`

API key management operations.

```typescript
ApiKeyOps
```

**Members:**

- `createApiKey` — Create a new API key for a user. MUST return the full secret exactly once in ApiKeyWithSecret. Subsequent retrieval via listApiKeys MUST NOT return the secret.
- `listApiKeys` — List all active API keys for a user (without secrets).
- `deleteApiKey` — Revoke an API key. MUST verify ownership before revoking. MUST return false (not throw) if the key does not exist.
- `rotateApiKey` — Rotate an API key: revoke the old one and issue a new one with the same name. MUST verify ownership before rotation.

### `Backend`

Backend — the complete LLMtxt persistence and coordination interface.  Implementations MUST satisfy all sub-interfaces. Consumers of this interface SHOULD NOT depend on any implementation-specific methods.  Both LocalBackend (packages/llmtxt/src/local/) and RemoteBackend (packages/llmtxt/src/remote/) implement this interface.

```typescript
Backend
```

**Members:**

- `open` — Open the backend connection / apply migrations. MUST be called before any other method. MUST be idempotent (calling open twice MUST NOT error).
- `close` — Close the backend, releasing resources (DB handles, timers, sockets). MUST stop all background reapers and interval timers. MUST be safe to call multiple times.
- `config` — The BackendConfig this instance was constructed with.

```ts
import { LocalBackend } from 'llmtxt/local';
const backend: Backend = new LocalBackend({ storagePath: './.llmtxt' });
await backend.open();
const doc = await backend.createDocument({ title: 'My Doc', createdBy: 'agent-1' });
await backend.close();
```

### `ExportErrorCode`

Error codes for the document export subsystem.

```typescript
ExportErrorCode
```

### `ExportFormat`

Supported document export formats.

```typescript
ExportFormat
```

### `ExportDocumentParams`

Parameters for exporting a single document.

```typescript
ExportDocumentParams
```

**Members:**

- `slug` — URL-safe document slug.
- `format` — Export format.
- `outputPath` — Absolute or relative path to write the output file.
- `includeMetadata` — Whether to include metadata (frontmatter/structured fields). Default true.
- `sign` — If true, sign the export manifest with the local Ed25519 identity. Default false.

### `ExportDocumentResult`

Result returned by exportDocument().

```typescript
ExportDocumentResult
```

**Members:**

- `filePath` — Absolute path of the written file.
- `slug` — Slug of the exported document.
- `version` — Version number exported.
- `fileHash` — SHA-256 hex of the written file bytes.
- `byteCount` — Number of bytes written.
- `exportedAt` — ISO 8601 UTC timestamp of export.
- `signatureHex` — Ed25519 signature hex over fileHash, if sign=true. Null otherwise.

### `ExportAllParams`

Parameters for exporting all documents to a directory.

```typescript
ExportAllParams
```

**Members:**

- `format`
- `outputDir` — Directory to write files into. One file per document, named `<slug>.<ext>`.
- `state` — Filter by lifecycle state. If absent, exports all documents.
- `includeMetadata`
- `sign`

### `ExportAllResult`

Result returned by exportAll().

```typescript
ExportAllResult
```

**Members:**

- `exported`
- `skipped`
- `totalCount`
- `failedCount`

### `ImportDocumentParams`

Parameters for importing a document from a file.

```typescript
ImportDocumentParams
```

**Members:**

- `filePath` — Path to the file to import (.md, .json, .txt, .llmtxt).
- `importedBy` — Agent performing the import.
- `onConflict` — Conflict strategy when a document with the same slug already exists. 'new_version': publish the imported content as a new version (default). 'create': fail with ExportError('SLUG_EXISTS') if the slug already exists.

### `ImportDocumentResult`

Result returned by importDocument().

```typescript
ImportDocumentResult
```

**Members:**

- `action` — Whether a new document was created or a version was appended.
- `slug`
- `documentId`
- `versionNumber`
- `contentHash`

### `ExportOps`

Document export operations.

```typescript
ExportOps
```

**Members:**

- `exportDocument` — Export a single document to a file on disk.  MUST resolve slug to a document; MUST throw ExportError('DOC_NOT_FOUND') if absent. MUST fetch the latest version content from the backend. MUST write the file atomically (write to .tmp then rename). MUST return the SHA-256 hash of the written bytes. MUST create intermediate directories via mkdirSync recursive. MUST NOT mutate any document, version, or event row in the database.
- `exportAll` — Export all documents to a directory.  MUST iterate all documents (paginating via listDocuments). MUST call exportDocument for each; individual failures MUST be collected in skipped, not thrown. MUST write each file as . inside outputDir.
- `importDocument` — Import a document from a file on disk.  MUST parse frontmatter from .md and .llmtxt files. MUST parse the `content` field from .json files. MUST read raw body from .txt files (no frontmatter). MUST NOT silently ignore a frontmatter content_hash that does not match the body. MUST create a new document if no document with the slug exists. MUST publish a new version if the document exists and onConflict='new_version'. MUST return ExportError('SLUG_EXISTS') if document exists and onConflict='create'.
- `getChangesSince` — Returns all changes made to this database since `dbVersion`.  `dbVersion = 0n` returns the full change history. Returns an empty Uint8Array (not null) when no changes exist.  The changeset is the cr-sqlite binary wire format as defined in docs/specs/P2-cr-sqlite.md §3.3 (DR-P2-03).
- `applyChanges` — Applies a changeset received from a peer.  MUST be idempotent: applying the same changeset twice produces identical state.  For rows affecting section_crdt_states.crdt_state, the implementation MUST perform application-level Loro merge instead of cr-sqlite LWW (DR-P2-04).

### `FrontmatterMeta`

Structured input for `canonicalFrontmatter`.  Mirrors `FrontmatterMeta` in `crates/llmtxt-core/src/canonical.rs`. Contributors are sorted inside this function — callers MUST NOT pre-sort.

```typescript
FrontmatterMeta
```

**Members:**

- `title` — Document title (UTF-8, double-quoted in output).
- `slug` — URL-safe slug.
- `version` — Integer version number of the exported state.
- `state` — Lifecycle state string (e.g. "DRAFT", "APPROVED").
- `contributors` — Agent IDs — sorted lexicographically by this function.
- `content_hash` — SHA-256 hex of the body content (64 lowercase chars).
- `exported_at` — ISO 8601 UTC timestamp with millisecond precision.

### `DocumentExportState`

Self-contained document snapshot passed to all format serializers.  All fields required by the canonical frontmatter schema are present at the top level; additional fields feed the JSON format.

```typescript
DocumentExportState
```

**Members:**

- `title` — Human-readable document title.
- `slug` — URL-safe slug.
- `version` — Version number of the exported state (integer, 1-based).
- `state` — Lifecycle state string (DRAFT | REVIEW | LOCKED | ARCHIVED).
- `contributors` — Agent IDs that have contributed to this document. Formatters MUST sort these lexicographically before serialization.
- `contentHash` — SHA-256 hex of the body content (64 lowercase hex chars). Callers compute this; formatters embed it verbatim.
- `exportedAt` — ISO 8601 UTC timestamp with millisecond precision. Injected by the caller so that determinism is achievable across repeated calls.
- `content` — Full body content of the exported version.
- `labels` — Arbitrary metadata labels. Present if available; omitted or null otherwise.
- `createdBy` — Agent that created the document.
- `createdAt` — Creation timestamp (Unix milliseconds).
- `updatedAt` — Last-modified timestamp (Unix milliseconds).
- `versionCount` — Total number of versions for this document.
- `chainRef` — BFT approval chain hash from `getApprovalChain`. Null when no approvals exist or when CRDT state is unavailable (T451 stub).

### `ExportOpts`

Options controlling format serializer behaviour.  All fields are optional. Formatters use sensible defaults when absent.

```typescript
ExportOpts
```

**Members:**

- `includeMetadata` — Whether to include metadata (frontmatter / structured fields). Defaults to `true`.  When `false`: - `formatMarkdown` emits body only (no frontmatter fences). - `formatLlmtxt` behaves identically to `formatMarkdown` with `includeMetadata: false`. - `formatJson` ignores this flag (JSON format always includes metadata). - `formatTxt` ignores this flag (plain-text format never includes metadata).

### `ParsedImport`

```typescript
ParsedImport
```

**Members:**

- `slug` — URL-safe slug (from frontmatter, or derived from filename).
- `title` — Human-readable title (from frontmatter, or derived from filename).
- `content` — Raw body content.
- `expectedContentHash` — Expected SHA-256 hex of content, if present in frontmatter. Callers MUST verify this matches the actual body before importing.

### `Document`

```typescript
{ slug: string; expiresAt: number | null; createdAt: number; id: string; title: string; state: string; createdBy: string; visibility: string; updatedAt: number; versionCount: number; labelsJson: string; eventSeqCounter: number; bftF: number; requiredApprovals: number; approvalTimeoutMs: number; }
```

### `NewDocument`

```typescript
{ slug: string; createdAt: number; id: string; title: string; createdBy: string; updatedAt: number; expiresAt?: number | null | undefined; state?: string | undefined; visibility?: string | undefined; versionCount?: number | undefined; labelsJson?: string | undefined; eventSeqCounter?: number | undefined; bftF?: number | undefined; requiredApprovals?: number | undefined; approvalTimeoutMs?: number | undefined; }
```

### `Version`

```typescript
{ versionNumber: number; changelog: string | null; createdAt: number; id: string; createdBy: string | null; documentId: string; compressedData: unknown; contentHash: string; tokenCount: number | null; patchText: string | null; baseVersion: number | null; storageType: string; storageKey: string | null; }
```

### `NewVersion`

```typescript
{ versionNumber: number; createdAt: number; id: string; documentId: string; contentHash: string; changelog?: string | null | undefined; createdBy?: string | null | undefined; compressedData?: unknown; tokenCount?: number | null | undefined; patchText?: string | null | undefined; baseVersion?: number | null | undefined; storageType?: string | undefined; storageKey?: string | null | undefined; }
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
{ timestamp: number; id: string; bftF: number; documentId: string; reason: string | null; atVersion: number; reviewerId: string; status: string; sigHex: string | null; canonicalPayload: string | null; chainHash: string | null; prevChainHash: string | null; }
```

### `NewApproval`

```typescript
{ timestamp: number; id: string; documentId: string; atVersion: number; reviewerId: string; status: string; bftF?: number | undefined; reason?: string | null | undefined; sigHex?: string | null | undefined; canonicalPayload?: string | null | undefined; chainHash?: string | null | undefined; prevChainHash?: string | null | undefined; }
```

### `SectionCrdtState`

```typescript
{ updatedAt: number; documentId: string; sectionId: string; clock: number; crdtState: unknown; }
```

### `NewSectionCrdtState`

```typescript
{ updatedAt: number; documentId: string; sectionId: string; crdtState: unknown; clock?: number | undefined; }
```

### `SectionCrdtUpdate`

```typescript
{ createdAt: number; id: string; documentId: string; sectionId: string; updateBlob: unknown; clientId: string; seq: number; }
```

### `NewSectionCrdtUpdate`

```typescript
{ createdAt: number; id: string; documentId: string; sectionId: string; updateBlob: unknown; clientId: string; seq: number; }
```

### `DocumentEvent`

```typescript
{ createdAt: number; id: string; documentId: string; seq: number; eventType: string; actorId: string; payloadJson: string; idempotencyKey: string | null; prevHash: string | null; }
```

### `NewDocumentEvent`

```typescript
{ createdAt: number; id: string; documentId: string; seq: number; eventType: string; actorId: string; payloadJson?: string | undefined; idempotencyKey?: string | null | undefined; prevHash?: string | null | undefined; }
```

### `AgentPubkey`

```typescript
{ agentId: string; createdAt: number; id: string; pubkeyHex: string; label: string | null; revokedAt: number | null; }
```

### `NewAgentPubkey`

```typescript
{ agentId: string; createdAt: number; id: string; pubkeyHex: string; label?: string | null | undefined; revokedAt?: number | null | undefined; }
```

### `AgentSignatureNonce`

```typescript
{ expiresAt: number; agentId: string; nonce: string; firstSeen: number; }
```

### `NewAgentSignatureNonce`

```typescript
{ expiresAt: number; agentId: string; nonce: string; firstSeen: number; }
```

### `SectionLease`

```typescript
{ expiresAt: number; id: string; resource: string; holder: string; acquiredAt: number; }
```

### `NewSectionLease`

```typescript
{ expiresAt: number; id: string; resource: string; holder: string; acquiredAt: number; }
```

### `AgentInboxMessage`

```typescript
{ createdAt: number; id: string; toAgentId: string; envelopeJson: string; exp: number; }
```

### `NewAgentInboxMessage`

```typescript
{ createdAt: number; id: string; toAgentId: string; envelopeJson: string; exp: number; }
```

### `ScratchpadEntry`

```typescript
{ createdAt: number; id: string; payloadJson: string; toAgentId: string; exp: number; fromAgentId: string; }
```

### `NewScratchpadEntry`

```typescript
{ createdAt: number; id: string; toAgentId: string; exp: number; fromAgentId: string; payloadJson?: string | undefined; }
```

### `SectionEmbedding`

```typescript
{ versionNumber: number; createdAt: number; id: string; documentId: string; sectionKey: string; embeddingBlob: unknown; dimensions: number; modelId: string; }
```

### `NewSectionEmbedding`

```typescript
{ versionNumber: number; createdAt: number; id: string; documentId: string; embeddingBlob: unknown; dimensions: number; modelId: string; sectionKey?: string | undefined; }
```

### `BlobAttachment`

```typescript
{ id: string; docSlug: string; blobName: string; hash: string; size: number; contentType: string; uploadedBy: string; uploadedAt: number; deletedAt: number | null; }
```

### `NewBlobAttachment`

```typescript
{ id: string; docSlug: string; blobName: string; hash: string; size: number; contentType: string; uploadedBy: string; uploadedAt: number; deletedAt?: number | null | undefined; }
```

### `InsertDocument`

```typescript
{ id: string; slug: string; title: string; createdBy: string; createdAt: number; updatedAt: number; state?: string | undefined; visibility?: string | undefined; versionCount?: number | undefined; labelsJson?: string | undefined; expiresAt?: number | null | undefined; eventSeqCounter?: number | undefined; bftF?: number | undefined; requiredApprovals?: number | undefined; approvalTimeoutMs?: number | undefined; }
```

### `SelectDocument`

```typescript
{ id: string; slug: string; title: string; state: string; createdBy: string; visibility: string; createdAt: number; updatedAt: number; versionCount: number; labelsJson: string; expiresAt: number | null; eventSeqCounter: number; bftF: number; requiredApprovals: number; approvalTimeoutMs: number; }
```

### `PeerTransport`

PeerTransport — transport abstraction for P2P mesh (P3 spec §4.1).  Implementations MUST complete Ed25519 mutual handshake before any changeset data is exchanged. Unauthenticated peers MUST be rejected.

```typescript
PeerTransport
```

**Members:**

- `type` — Transport type identifier (e.g., `"unix"`, `"http"`).
- `listen` — Listen for incoming connections.  MUST complete Ed25519 mutual handshake before calling `onChangeset()`. MUST reject connections that fail the handshake. MUST call `onChangeset()` for each received, authenticated changeset.
- `sendChangeset` — Send a changeset to a specific peer.  MUST complete Ed25519 mutual handshake before sending any data. MUST throw `PeerUnreachableError` if the peer is unreachable after `MAX_RETRIES` attempts.
- `close` — Graceful shutdown — close all open connections and stop listening.

### `TransportIdentity`

Local identity used by the transport layer for handshakes.

```typescript
TransportIdentity
```

**Members:**

- `agentId` — Hex-encoded SHA-256 of the public key bytes.
- `publicKey` — 32-byte Ed25519 public key.
- `privateKey` — 32-byte Ed25519 private key seed.

### `PeerInfo`

```typescript
PeerInfo
```

**Members:**

- `agentId` — Hex-encoded public key hash (agentId).
- `address` — Transport address (e.g. "unix:/tmp/agent.sock" or "http://host:port").
- `pubkeyBase64` — Base64-encoded Ed25519 public key.

### `PeerRegistry`

```typescript
PeerRegistry
```

**Members:**

- `discover` — Returns the current set of discovered peers (excluding self).
- `markInactive` — Mark a peer as temporarily inactive after repeated failures.

### `PeerSyncState`

In-memory peer sync state. Persisted externally via llmtxt_mesh_state table.

```typescript
PeerSyncState
```

**Members:**

- `lastSyncVersion`
- `failureCount`
- `lastFailureAt`

### `SyncEngineOptions`

```typescript
SyncEngineOptions
```

**Members:**

- `backend`
- `transport`
- `discovery`
- `identity`
- `syncIntervalMs`
- `maxPeerFailures` — Maximum consecutive failures before a peer is marked inactive.

### `A2AEnvelope`

A2A message envelope. Spec §7.1:    type, from, to, payload, sig, sentAt   sig = base64-encoded Ed25519 signature over canonical JSON of        type, from, to, payload, sentAt  (fields alphabetically sorted,       no trailing whitespace).

```typescript
A2AEnvelope
```

**Members:**

- `type`
- `from`
- `to`
- `payload`
- `sig`
- `sentAt`

### `MeshMessengerOptions`

```typescript
MeshMessengerOptions
```

**Members:**

- `identity`
- `transport`
- `discovery`
- `onMessage` — Handler called when a valid, verified A2A message arrives for THIS agent.

### `PostgresBackendConfig`

Extended config for PostgresBackend.

```typescript
PostgresBackendConfig
```

**Members:**

- `connectionString` — PostgreSQL connection string. MUST be in the format: postgresql://user:passhost:5432/dbname Defaults to DATABASE_URL environment variable.
- `maxConnections` — Maximum number of connections in the pool. Defaults to 10.

### `PgBackendHandle`

```typescript
PgBackendHandle
```

**Members:**

- `adapter` — The contract-test-ready adapter.
- `cleanup` — Drop the test schema and end connections.

### `BlobChangeset`

Extended changeset type carrying optional blob references.  This wraps the existing cr-sqlite binary changeset (Uint8Array) with a separate `blobs` array that carries manifest metadata — never raw bytes. The blob bytes are pulled lazily on first `getBlob(includeData=true)` call.

```typescript
BlobChangeset
```

**Members:**

- `crsqlChangeset` — The cr-sqlite binary changeset (may be empty Uint8Array).
- `blobs` — Blob references for all blob operations in the transaction window.

### `ApplyBlobChangesetResult`

Result of applying a BlobChangeset.

```typescript
ApplyBlobChangesetResult
```

**Members:**

- `applied` — Number of blob refs successfully applied (winners inserted).
- `discarded` — Number of blob refs that lost LWW and were discarded.
- `pendingFetches` — Hashes scheduled for lazy background pull.

### `BlobRefWithDocSlug`

Extended BlobRef used internally in the sync layer. docSlug is required for manifest writes but is omitted from the public BlobRef spec interface (which is scoped to a document context by the caller).

```typescript
BlobRefWithDocSlug
```

**Members:**

- `docSlug`

### `PeerRegistration`

Raw format of a `.peer` file written by a running agent (P3 spec §3.2).  All fields are required. Peer files missing any field are rejected.

```typescript
PeerRegistration
```

**Members:**

- `agentId` — Hex-encoded SHA-256 of the agent's Ed25519 public key bytes.
- `transport` — Transport address string. Format: `unix:<absolute-path>` or `http://host:port`.
- `pubkey` — Base64-encoded 32-byte Ed25519 public key.
- `capabilities` — Capabilities advertised by this peer.
- `startedAt` — ISO-8601 timestamp when the agent started.

### `PeerInfo`

A validated peer — returned from `discover()` and `loadStaticConfig()`. All entries here have been security-checked.

```typescript
PeerInfo
```

**Members:**

- `active` — Whether the peer is considered active (startedAt within PEER_TTL_MS).

### `EventPublisher`

An object that can publish typed events onto a named channel.  Implementations MUST be synchronous-safe — callers do not await publish().

```typescript
EventPublisher<T>
```

**Members:**

- `publish` — Emit `event` on `channel`.  All active subscribers on `channel` MUST receive the event in FIFO order. Delivery to a slow subscriber MUST NOT block other subscribers.

### `EventSubscriber`

An object that can return an async iterable of typed events from a channel.  The iterable MUST yield events in the order they were published. Calling `return()` on the iterator MUST unsubscribe from the channel.

```typescript
EventSubscriber<T>
```

**Members:**

- `subscribe` — Return an `AsyncIterable<T>` that yields every event published on `channel` after the subscription is opened.  Past events (before the subscription was opened) MUST NOT be replayed unless the implementation explicitly supports seek/cursor semantics.

### `EventStream`

A bidirectional event stream that can both publish and subscribe.

```typescript
EventStream<T>
```

### `EmitterLike`

Minimal EventEmitter surface required by makeEventStream.

```typescript
EmitterLike
```

**Members:**

- `on`
- `off`

### `DocumentEventBusLike`

Shape of the document event bus used by PostgresBackend (injected from apps/backend realtime layer).  Uses a single `'document'` channel and emits objects shaped as `{ type, slug, documentId, timestamp, actor, data }`.

```typescript
DocumentEventBusLike
```

**Members:**

- `on`
- `off`

### `PresenceEntry`

Presence state broadcast by an agent to all connected peers. Matches the JSON structure in spec §6.1.

```typescript
PresenceEntry
```

**Members:**

- `agentId` — Hex-encoded public key hash.
- `documentId` — Document the agent is currently editing (null if idle).
- `sectionId` — Section within the document (null if not section-level).
- `updatedAt` — ISO-8601 timestamp of last update.
- `ttl` — Time-to-live in seconds. Entries expire after this many seconds.
- `receivedAt` — Wall-clock epoch ms when this entry was received/created locally.

### `PresenceManagerOptions`

```typescript
PresenceManagerOptions
```

**Members:**

- `agentId`
- `transport`
- `discovery`
- `ttlSeconds` — Default TTL in seconds (spec default: 30).
- `broadcastIntervalMs` — Broadcast interval in ms (spec: 10 s).
- `rateLimitWindowMs` — Rate limit window in ms — max 1 message per peer per window (spec: 5 s).
- `initialDocumentId` — Current document/section the agent is editing (updated via setPresence).
- `initialSectionId`

### `AgentSessionState`

Session state machine: Idle - Open - Active - Closing - Closed  - Idle: Initial state, waiting for open() - Open: Backend initialization in progress (transient; transitions to Active) - Active: Ready for contributions via contribute() - Closing: Teardown in progress (mutex-protected) - Closed: Teardown complete, receipt emitted

```typescript
AgentSessionState
```

### `ContributionReceipt`

Contribution Receipt: auditable proof of work performed during a session.  RFC 2119 requirement: All fields are mandatory except signature (which is mandatory only for RemoteBackend).

```typescript
ContributionReceipt
```

**Members:**

- `sessionId` — Session ID (128-bit random, unguessable).
- `agentId` — Agent identity ID (must match authenticated identity in backend).
- `documentIds` — Unique document IDs written during the session (sorted for determinism).
- `eventCount` — Total successful write operations performed via contribute().
- `sessionDurationMs` — Session duration in milliseconds (closedAt - openedAt).
- `openedAt` — ISO 8601 UTC timestamp of session open.
- `closedAt` — ISO 8601 UTC timestamp of session close.
- `signature` — Ed25519 signature over the canonical receipt payload. MUST be present when backend is RemoteBackend (cross-network). MAY be omitted for LocalBackend (same-process).  Signature covers: SHA-256(sessionId + agentId + documentIds.sort().join(',') +                   eventCount + openedAt + closedAt)  Stub for now — T461 will add Ed25519 signing to AgentSession.

### `CloseStepError`

Error raised when one or more close() teardown steps fail while the session still reaches the Closed state. Callers can inspect `errors` for details and `receipt` for the partial receipt.

```typescript
CloseStepError
```

**Members:**

- `step`
- `error`

### `AgentSessionOptions`

AgentSessionOptions: constructor configuration.

```typescript
AgentSessionOptions
```

**Members:**

- `backend` — Backend to operate through (LocalBackend or RemoteBackend). Typed as Backend to enable proper method calls; consumers pass concrete implementations (LocalBackend or RemoteBackend).
- `agentId` — Agent identity. MUST match the authenticated identity registered in the backend's identity primitives.
- `sessionId` — Cryptographically random session ID (128-bit entropy minimum). If omitted, AgentSession generates one using crypto.randomUUID(). MUST be unguessable; predictable IDs allow session hijacking.
- `label` — Human-readable label for this session. Used in receipts. Defaults to agentId + timestamp ISO string.

### `PostgresRowChange`

A single row-level change captured from Postgres.  In a full implementation this would be populated via Postgres LISTEN/NOTIFY on a changes table, or via logical decoding (pg_logical_emit_message).

```typescript
PostgresRowChange
```

**Members:**

- `table` — Name of the table that changed (e.g., "documents", "versions").
- `op` — Operation type.
- `newRow` — The row data after the change (null for DELETE).
- `oldRow` — The row data before the change (null for INSERT).
- `txid` — Postgres transaction ID (xid) — used as a logical "db_version".
- `changedAt` — ISO-8601 timestamp of the change.

### `PostgresChangeset`

Wire format for a PostgresChangeset batch.  TODO: Align with the binary format produced by LocalBackend.getChangesSince() once the cr-sqlite changeset schema is stabilised in P2.6.

```typescript
PostgresChangeset
```

**Members:**

- `txids` — Postgres transaction IDs included in this batch.
- `changes` — Serialized row changes (JSON for now; binary in full implementation).
- `maxTxid` — The highest txid in this batch (used as "sinceVersion" by the receiver).

### `PostgresChangesetAdapterOptions`

Options for constructing a PostgresChangesetAdapter.

```typescript
PostgresChangesetAdapterOptions
```

**Members:**

- `db` — Postgres client or connection pool used for querying row changes.  TODO: Replace `unknown` with the concrete postgres.js client type once the full implementation is written.
- `sinceXid` — The last synced Postgres transaction ID (xid) for a given peer. Rows with txid  sinceXid will be included in the next changeset. Defaults to 0 (full snapshot).

### `MeshChangesetRouteOptions`

Options for the POST /mesh/changeset route handler.

```typescript
MeshChangesetRouteOptions
```

**Members:**

- `adapter` — PostgresChangesetAdapter instance wired to the PostgresBackend.
- `maxChangesetBytes` — Maximum changeset size in bytes (default: 10 MB per P3 spec §10).

### `MeshChangesetResult`

Generic POST /mesh/changeset handler result.  The route handler is framework-agnostic: the caller (Hono/Express/etc.) provides the request body and receives a structured result to render.

```typescript
MeshChangesetResult
```

**Members:**

- `status` — HTTP status code to return.
- `body` — Response body as an object (caller serializes to JSON).
- `delta` — Delta changeset bytes to return in the response body (bidirectional sync).

### `A2AEnvelope`

Canonical A2A message envelope (matches crates/llmtxt-core/src/a2a.rs).

```typescript
A2AEnvelope
```

**Members:**

- `from`
- `to`
- `nonce`
- `timestamp_ms`
- `signature`
- `content_type`
- `payload` — Base64-encoded payload bytes.

### `BuildA2AOptions`

Options for building an A2A message.

```typescript
BuildA2AOptions
```

**Members:**

- `from`
- `to`
- `payload`
- `contentType`
- `identity`
- `nowMs`
- `nonce`

### `InboxDeliveryResponse`

Response from POST /agents/:id/inbox.

```typescript
InboxDeliveryResponse
```

**Members:**

- `delivered`
- `to`
- `from`
- `nonce`
- `sig_verified`
- `expires_at`

### `InboxMessage`

Message in agent inbox response.

```typescript
InboxMessage
```

**Members:**

- `id`
- `from`
- `to`
- `envelope`
- `received_at`
- `expires_at`
- `read`

### `InboxPollResponse`

Response from GET /agents/:id/inbox.

```typescript
InboxPollResponse
```

**Members:**

- `messages`
- `count`

### `BFTApprovalStatus`

BFT approval status.

```typescript
BFTApprovalStatus
```

### `SignedApprovalEnvelope`

Signed approval envelope ready to POST to /bft/approve.

```typescript
SignedApprovalEnvelope
```

**Members:**

- `status`
- `sig_hex`
- `canonical_payload`
- `comment`

### `BFTApprovalResponse`

Response from POST /documents/:slug/bft/approve.

```typescript
BFTApprovalResponse
```

**Members:**

- `slug`
- `approvalId`
- `status`
- `sigVerified`
- `chainHash`
- `bftF`
- `quorum`
- `currentApprovals`
- `quorumReached`

### `BFTStatusResponse`

Response from GET /documents/:slug/bft/status.

```typescript
BFTStatusResponse
```

**Members:**

- `slug`
- `bftF`
- `quorum`
- `currentApprovals`
- `quorumReached`
- `approvers`

### `ChainVerificationResponse`

Response from GET /documents/:slug/chain.

```typescript
ChainVerificationResponse
```

**Members:**

- `valid`
- `length`
- `firstInvalidAt`
- `slug`

### `ScratchpadMessage`

A scratchpad message as returned by the API.

```typescript
ScratchpadMessage
```

**Members:**

- `id`
- `agent_id`
- `content`
- `content_type`
- `thread_id`
- `sig_hex`
- `timestamp_ms`

### `SendScratchpadOptions`

Options for sending a scratchpad message.

```typescript
SendScratchpadOptions
```

**Members:**

- `content` — Message content body.
- `contentType` — MIME content type (default: "text/plain").
- `threadId` — Optional thread identifier for reply chains.
- `identity` — Agent identity for signing (optional — unsigned if omitted).
- `agentId` — Agent ID to include in the request (required if identity provided).

### `ReadScratchpadOptions`

Options for reading scratchpad messages.

```typescript
ReadScratchpadOptions
```

**Members:**

- `lastId` — Return messages after this stream ID.
- `threadId` — Filter by thread.
- `limit` — Maximum number of messages to return. Default 100.

## Classes

### `LRUCache`

Generic least-recently-used (LRU) cache with time-to-live support.

```typescript
typeof LRUCache
```

**Members:**

- `cache` — Internal map storing cache entries in insertion (LRU) order.
- `maxSize` — Maximum number of entries before eviction.
- `defaultTtl` — Default time-to-live in milliseconds for new entries.
- `stats` — Running hit/miss counters for observability.
- `get` — Retrieve a cached value by key.
- `set` — Insert or update a cache entry.
- `delete` — Remove a single entry from the cache by key.
- `clear` — Remove all entries from the cache and reset hit/miss statistics.
- `size` — Return the number of live (non-expired) entries in the cache.
- `has` — Check whether a non-expired entry exists for the given key.
- `getStats` — Retrieve a snapshot of cache performance statistics.
- `resetStats` — Reset the hit/miss counters to zero without clearing cached entries.

```ts
const cache = new LRUCache<string>({ maxSize: 100, ttl: 60_000 });
cache.set('key', 'value');
cache.get('key'); // "value"
```

### `CrSqliteNotLoadedError`

Typed error thrown by LocalBackend when cr-sqlite support is requested but the vlcn.io/crsqlite package is not installed.

```typescript
typeof CrSqliteNotLoadedError
```

### `LocalOnnxEmbeddingProvider`

Local ONNX embedding provider — wraps `embedBatch` to conform to the `EmbeddingProvider` interface used by the backend routes.  Drop-in replacement for `LocalEmbeddingProvider` (TF-IDF):

```typescript
typeof LocalOnnxEmbeddingProvider
```

**Members:**

- `dimensions`
- `model`
- `provider`
- `embed`

### `AgentIdentity`

Ed25519 agent identity — keypair management, signing, and header generation.  ## Usage  ## Storage - Node.js: `~/.llmtxt/identity.key` (mode 0o600) - Browser: `localStorage['llmtxt_identity_sk']`  WARNING: The private key (`sk`) is security-sensitive. Never log or expose it.

```typescript
typeof AgentIdentity
```

**Members:**

- `sk` — 32-byte private key (Ed25519 seed). WARNING: keep secret.
- `pk` — 32-byte public key (compressed point).
- `generate` — Generate a fresh Ed25519 keypair and persist it.  Persists to `~/.llmtxt/identity.key` (Node, 0o600) or `localStorage['llmtxt_identity_sk']` (browser).
- `load` — Restore an identity from the persisted private key. Returns `null` if no persisted key exists.
- `fromSeed` — Construct from a 32-byte private key seed. Does NOT persist. Useful for tests and CLI scenarios where the seed is provided externally.
- `sign` — Sign arbitrary bytes with the private key. Returns the 64-byte raw Ed25519 signature.
- `verify` — Verify a signature against this identity's public key.
- `buildSignatureHeaders` — Build the X-Agent-* signature headers for a mutating HTTP request.

### `LlmtxtDocument`

High-level document orchestration object.  Each instance wraps a single document slug and delegates all persistence to the provided StorageAdapter. All computation (diffing, hashing, disclosure, consensus) uses the pure SDK functions.

```typescript
typeof LlmtxtDocument
```

**Members:**

- `slug`
- `storage`
- `getContent` — Get document content at a specific version (defaults to latest).
- `reconstruct` — Reconstruct content from base + patch stack at a specific version.
- `overview` — Generate structural overview of the current document.
- `section` — Extract a named section from the current document.
- `getVersions` — Get all version entries.
- `createVersion` — Create a new version from updated content.
- `diff` — Compute a diff summary between two versions.
- `squash` — Squash all patches into a single diff.
- `getState` — Get current document state.
- `transition` — Transition document to a new state.
- `checkApproval` — Check current approval status against policy.
- `approve` — Submit an approval for the current version.
- `reject` — Submit a rejection for the current version.
- `getAttributions` — Compute attribution for all versions.
- `getContributors` — Get aggregated contributor summaries.
- `planRetrieval` — Plan which sections to retrieve given a token budget.

### `LeaseConflictError`

Thrown by LeaseManager.acquire() when the section is already held.

```typescript
typeof LeaseConflictError
```

**Members:**

- `holder`
- `expiresAt`

### `LeaseManager`

```typescript
typeof LeaseManager
```

**Members:**

- `baseUrl`
- `apiKey`
- `_leaseId`
- `_expiresAt`
- `_slug`
- `_sectionId`
- `_autoRenewTimer`
- `leaseUrl`
- `headers`
- `acquire` — Acquire an advisory lease on a section.
- `release` — Release the currently held lease.
- `renew` — Renew the currently held lease.
- `startAutoRenew` — Start an auto-renew loop. Renews the lease when time-to-expiry drops below thresholdSeconds.
- `stopAutoRenew` — Stop the auto-renew loop.

### `TopologyConfigError`

Thrown when a topology config fails validation.

```typescript
typeof TopologyConfigError
```

**Members:**

- `code`
- `field`

### `BlobTooLargeError`

Thrown when blob size exceeds the configured maximum (default 100 MB).  MUST be thrown before any storage allocation occurs. The error message MUST include the configured limit in human-readable form.

```typescript
typeof BlobTooLargeError
```

### `BlobNameInvalidError`

Thrown when a blob attachment name fails validation.  Triggered by any of: path traversal sequences (".."), path separators ("/" or ""), null bytes ("0"), leading/trailing whitespace, empty name, or name exceeding 255 bytes (UTF-8).

```typescript
typeof BlobNameInvalidError
```

### `BlobCorruptError`

Thrown when SHA-256 hash verification fails on a read.  Indicates storage corruption or tampering. The implementation MUST NOT return the corrupt bytes to the caller. The corrupt file SHOULD be quarantined (renamed to ".corrupt") before throwing.

```typescript
typeof BlobCorruptError
```

### `BlobNotFoundError`

Thrown when a blob hash is not found in the store.  Used by the lazy sync pull path when fetchBlobByHash cannot resolve the requested hash from any known peer.

```typescript
typeof BlobNotFoundError
```

### `BlobAccessDeniedError`

Thrown when the caller lacks the required access to perform a blob operation.  Blob access inherits the document's access control policy:   - READ permission required for getBlob, listBlobs, fetchBlobByHash   - WRITE permission required for attachBlob, detachBlob

```typescript
typeof BlobAccessDeniedError
```

### `ExportError`

Typed error for the document export subsystem. Thrown by exportDocument() and exportAll() on failure.

```typescript
typeof ExportError
```

### `BlobFsAdapter`

Filesystem blob adapter.  Stores bytes at `<storagePath>/blobs/<hash>`. Uses atomic writes (tmp → rename) to prevent partial writes. Verifies SHA-256 hash on every `getBlob(includeData=true)` call.  This class is used by LocalBackend. It can also be instantiated directly in tests or custom local-storage scenarios.

```typescript
typeof BlobFsAdapter
```

**Members:**

- `blobsDir`
- `maxBlobSizeBytes`
- `ensureBlobsDir` — Ensure the blobs directory exists. Called lazily on first use.
- `blobPath` — Full path to a blob file given its hash.
- `attachBlob` — Attach a binary blob to a document.  - Validates the blob name via WASM blobNameValidate. - Enforces maxBlobSizeBytes. - Computes SHA-256 hash via WASM hashBlob. - Writes bytes atomically to `<blobsDir>/<hash>` if not already present. - Applies LWW: soft-deletes any existing active record for (docSlug, blobName)   if it exists, then inserts the new record. - Returns the new BlobAttachment record.
- `getBlob` — Retrieve a blob attachment record, optionally with bytes.  Returns null if the blobName is not attached to docSlug. When includeData=true, reads bytes from disk and verifies the SHA-256 hash. Throws BlobCorruptError if hash mismatch detected.
- `listBlobs` — List all active (non-deleted) blob attachments for a document. Returns metadata only — no bytes.
- `detachBlob` — Soft-delete a named blob attachment from a document.  Sets deleted_at = now(). Does NOT delete bytes from disk (orphan GC is a deferred concern). Returns false if no active attachment exists.
- `fetchBlobByHash` — Fetch blob bytes directly by hash (used by the lazy sync pull path).  Returns null if no file exists for this hash. Verifies hash on return.

### `LocalBackend`

```typescript
typeof LocalBackend
```

**Members:**

- `config`
- `db`
- `rawDb`
- `opened`
- `blobAdapter`
- `hasCRR` — True if the cr-sqlite extension was successfully loaded and CRR tables are activated. False if cr-sqlite is unavailable (local-only mode, no sync).  Callers MUST check hasCRR before calling getChangesSince() or applyChanges(). Those methods throw CrSqliteNotLoadedError when hasCRR is false.  DR-P2-01: Graceful degradation — LocalBackend MUST work without cr-sqlite.
- `bus` — In-process event bus for subscribeStream / subscribeSection.
- `presenceMap` — In-memory presence store: key = `${docId}::${agentId}`
- `timers` — Background timers — stopped in close().
- `open`
- `_activateCRRTables` — Activates CRR on all LocalBackend tables via crsql_as_crr().  Called from open() after successfully loading the cr-sqlite extension. crsql_as_crr() is idempotent: calling it on an already-CRR table is safe.  DR-P2-02: CRR activation happens at database initialisation time. DR-P2-04: section_crdt_states is registered as CRR here (safe), but the crdt_state blob column MUST use application-level Loro merge in applyChanges() — LWW on this column is PROHIBITED.
- `close`
- `_assertOpen`
- `_startReapers`
- `createDocument`
- `getDocument`
- `getDocumentBySlug`
- `listDocuments`
- `deleteDocument`
- `_rowToDocument`
- `publishVersion`
- `getVersion`
- `listVersions`
- `transitionVersion`
- `submitSignedApproval`
- `getApprovalProgress`
- `getApprovalPolicy`
- `setApprovalPolicy`
- `appendEvent`
- `queryEvents`
- `subscribeStream`
- `applyCrdtUpdate`
- `getCrdtState`
- `subscribeSection`
- `acquireLease`
- `renewLease`
- `releaseLease`
- `getLease`
- `joinPresence`
- `leavePresence`
- `listPresence`
- `heartbeatPresence`
- `sendScratchpad`
- `pollScratchpad`
- `deleteScratchpadMessage`
- `sendA2AMessage`
- `pollA2AInbox`
- `deleteA2AMessage`
- `indexDocument`
- `search`
- `registerAgentPubkey`
- `lookupAgentPubkey`
- `revokeAgentPubkey`
- `recordSignatureNonce`
- `hasNonceBeenUsed`
- `listAgentPubkeys`
- `listContributors`
- `getApprovalChain`
- `createCollection`
- `getCollection`
- `listCollections`
- `addDocToCollection`
- `removeDocFromCollection`
- `reorderCollection`
- `exportCollection`
- `createDocumentLink`
- `getDocumentLinks`
- `deleteDocumentLink`
- `getGlobalGraph`
- `createWebhook`
- `listWebhooks`
- `deleteWebhook`
- `testWebhook`
- `createSignedUrl`
- `verifySignedUrl`
- `getDocumentAccess`
- `grantDocumentAccess`
- `revokeDocumentAccess`
- `setDocumentVisibility`
- `createOrganization`
- `getOrganization`
- `listOrganizations`
- `addOrgMember`
- `removeOrgMember`
- `createApiKey`
- `listApiKeys`
- `deleteApiKey`
- `rotateApiKey`
- `getChangesSince` — Returns all changes made to this database since `dbVersion`.  Wraps: SELECT * FROM crsql_changes WHERE db_version  ?  The changeset is serialized as a compact binary format:   [4-byte row count LE] [per-row entries...]  Each row entry:   [1-byte col count] [table name: 1-byte len + bytes]   [col values: per column — 1-byte type tag + payload]  Type tags: 0=null, 1=integer (8-byte LE), 2=real (8-byte IEEE 754),            3=text (4-byte len LE + UTF-8 bytes), 4=blob (4-byte len LE + bytes)  DR-P2-03: Binary wire format to minimize size. Callers needing HTTP transport MUST base64-encode the returned Uint8Array.  dbVersion=0 returns the full history. Returns empty Uint8Array (not null) when no changes exist.
- `applyChanges` — Applies a changeset received from a peer.  Steps (all in a single better-sqlite3 transaction — synchronous):  1. Deserialize the changeset from Uint8Array wire format.  2. INSERT each row into crsql_changes (cr-sqlite applies LWW for all     relational columns).  3. Post-process rows where the table is `section_crdt_states` and the     column is `crdt_state`: fetch local blob, merge via crdt_merge_updates,     write merged result back. (DR-P2-04 MANDATORY — not LWW.)  4. Recompute documents.version_count for any document_id seen in the     changeset (spec §6 of P2-crr-column-strategy.md).  5. Return SELECT crsql_db_version() as bigint.  Idempotent: cr-sqlite guarantees idempotency for relational columns; the Loro merge is also idempotent (CRDT property).  Invalid crdt_state blob in the changeset: logs a warning and retains the local blob rather than corrupting the transaction.
- `attachBlob`
- `getBlob`
- `listBlobs`
- `detachBlob`
- `fetchBlobByHash`
- `exportDocument` — Export a single document to a file on disk.  Content retrieval strategy (spec §11 — LocalBackend):  1. Call listVersions(doc.id) to get all version entries (ascending).  2. Take the last entry (highest versionNumber = latest).  3. Check if storageType=filesystem → read from blobs/.  4. Otherwise read inline from the compressedData column (raw UTF-8 bytes).
- `exportAll` — Export all documents to a directory.  Iterates via listDocuments (cursor-based pagination). Individual document failures are collected in skipped, not thrown.
- `importDocument` — Import a document from a file on disk.  Parsing strategy:  - .md / .llmtxt: parse YAML frontmatter; body follows closing fence.  - .json: parse JSON; use 'content' field as body.  - .txt: entire file is body; slug derived from filename stem.  Conflict strategy:  - 'create': throw ExportError('SLUG_EXISTS') if slug is already in use.  - 'new_version' (default): append a new version to the existing document.

### `RemoteBackend`

```typescript
typeof RemoteBackend
```

**Members:**

- `config`
- `opened`
- `open`
- `close`
- `_assertOpen`
- `fetch`
- `createDocument`
- `getDocument`
- `getDocumentBySlug`
- `listDocuments`
- `deleteDocument`
- `publishVersion`
- `getVersion`
- `listVersions`
- `transitionVersion`
- `submitSignedApproval`
- `getApprovalProgress`
- `getApprovalPolicy`
- `setApprovalPolicy`
- `appendEvent`
- `queryEvents`
- `subscribeStream`
- `applyCrdtUpdate`
- `getCrdtState`
- `subscribeSection`
- `acquireLease`
- `renewLease`
- `releaseLease`
- `getLease`
- `joinPresence`
- `leavePresence`
- `listPresence`
- `heartbeatPresence`
- `sendScratchpad`
- `pollScratchpad`
- `deleteScratchpadMessage`
- `sendA2AMessage`
- `pollA2AInbox`
- `deleteA2AMessage`
- `indexDocument`
- `search`
- `registerAgentPubkey`
- `lookupAgentPubkey`
- `revokeAgentPubkey`
- `recordSignatureNonce`
- `hasNonceBeenUsed`
- `listAgentPubkeys`
- `listContributors`
- `getApprovalChain`
- `createCollection`
- `getCollection`
- `listCollections`
- `addDocToCollection`
- `removeDocFromCollection`
- `reorderCollection`
- `exportCollection`
- `createDocumentLink`
- `getDocumentLinks`
- `deleteDocumentLink`
- `getGlobalGraph`
- `createWebhook`
- `listWebhooks`
- `deleteWebhook`
- `testWebhook`
- `createSignedUrl`
- `verifySignedUrl`
- `getDocumentAccess`
- `grantDocumentAccess`
- `revokeDocumentAccess`
- `setDocumentVisibility`
- `createOrganization`
- `getOrganization`
- `listOrganizations`
- `addOrgMember`
- `removeOrgMember`
- `createApiKey`
- `listApiKeys`
- `deleteApiKey`
- `rotateApiKey`
- `attachBlob`
- `getBlob`
- `listBlobs`
- `detachBlob`
- `fetchBlobByHash`
- `exportDocument` — Export a document from the remote backend to a local file.  Content retrieval: calls `GET /v1/documents/:slug/versions/:n` and extracts the `content` field. Then serializes and writes locally using writeExportFile.
- `exportAll` — Export all documents from the remote backend to a directory.  Iterates via listDocuments (cursor-based pagination). Individual document failures are collected in skipped, not thrown.
- `importDocument` — Import a document from a file on disk into the remote backend.  Parses the file locally (same logic as LocalBackend), then uses the remote API to create or update the document.
- `getChangesSince` — Not supported by RemoteBackend — cr-sqlite sync is a LocalBackend feature. The remote api.llmtxt.my endpoint for changeset exchange is planned in P3.
- `applyChanges`

### `MeshNotImplementedError`

Thrown when a mesh-specific sync method is called on `MeshBackend` before the T386 P2P sync engine has been installed.  The MeshBackend stub delegates all standard Backend interface methods to its internal LocalBackend. Only the T386-specific mesh methods (peer negotiation, changeset exchange, etc.) throw this error, so agents that do not call those methods can use MeshBackend today without blocking on T386.  To resolve: implement T386 (P2P Mesh Sync Engine) and replace the stub with the real MeshBackend from packages/llmtxt/src/mesh/.

```typescript
typeof MeshNotImplementedError
```

**Members:**

- `code`

### `HubUnreachableError`

Thrown when a hub-and-spoke spoke cannot reach the hub for a write operation.  Ephemeral spokes MUST fail fast with this error — writes are never silently dropped (ARCH-T429 §7.1). The `cause` property holds the underlying network error for diagnostics.

```typescript
typeof HubUnreachableError
```

**Members:**

- `code`
- `cause`

### `HubWriteQueueFullError`

Thrown when a persistent spoke's write queue exceeds the 1000-entry limit (ARCH-T429 §7.1). The 1001st write while the hub is unreachable must be rejected with this error rather than silently dropped or discarded.

```typescript
typeof HubWriteQueueFullError
```

**Members:**

- `code`
- `queueSize`

### `HubSpokeBackend`

Composite Backend for hub-and-spoke topology with `persistLocally=true`.  Routing semantics (ARCH-T429 §5.2 persistent spoke): - Reads (documents, versions, events, CRDT sections, presence) → LocalBackend (replica). - Writes (createDocument, publishVersion, A2A, scratchpad, leases) → RemoteBackend (hub). - CRDT applyCrdtUpdate → RemoteBackend (hub is authoritative); local replica is updated   on next background sync. - Signed URLs, webhooks, org/API-key ops → RemoteBackend (hub-owned resources).  TODO(T449): Implement write-queue persistence in local SQLite (`hub_write_queue` table) so queued writes survive agent restart. Current behaviour: writes fail fast when the hub is unreachable, matching ephemeral-spoke semantics. Track in T449.  TODO(T449): Implement background sync loop (poll hub for new events and replicate to local replica). Current behaviour: local replica is only updated when hub writes are acknowledged inline.

```typescript
typeof HubSpokeBackend
```

**Members:**

- `config`
- `local`
- `remote`
- `_hubWrite` — Wrap a hub write operation so network failures surface as HubUnreachableError rather than raw fetch errors. This ensures writes are never silently dropped (ARCH-T429 §7.1).
- `open`
- `close`
- `createDocument`
- `getDocument`
- `getDocumentBySlug`
- `listDocuments`
- `deleteDocument`
- `publishVersion`
- `getVersion`
- `listVersions`
- `transitionVersion`
- `submitSignedApproval`
- `getApprovalProgress`
- `getApprovalPolicy`
- `setApprovalPolicy`
- `listContributors`
- `getApprovalChain`
- `appendEvent`
- `queryEvents`
- `subscribeStream`
- `applyCrdtUpdate`
- `getCrdtState`
- `subscribeSection`
- `acquireLease`
- `renewLease`
- `releaseLease`
- `getLease`
- `joinPresence`
- `leavePresence`
- `listPresence`
- `heartbeatPresence`
- `sendScratchpad`
- `pollScratchpad`
- `deleteScratchpadMessage`
- `sendA2AMessage`
- `pollA2AInbox`
- `deleteA2AMessage`
- `indexDocument`
- `search`
- `registerAgentPubkey`
- `lookupAgentPubkey`
- `listAgentPubkeys`
- `revokeAgentPubkey`
- `recordSignatureNonce`
- `hasNonceBeenUsed`
- `createCollection`
- `getCollection`
- `listCollections`
- `addDocToCollection`
- `removeDocFromCollection`
- `reorderCollection`
- `exportCollection`
- `createDocumentLink`
- `getDocumentLinks`
- `deleteDocumentLink`
- `getGlobalGraph`
- `createWebhook`
- `listWebhooks`
- `deleteWebhook`
- `testWebhook`
- `createSignedUrl`
- `verifySignedUrl`
- `getDocumentAccess`
- `grantDocumentAccess`
- `revokeDocumentAccess`
- `setDocumentVisibility`
- `createOrganization`
- `getOrganization`
- `listOrganizations`
- `addOrgMember`
- `removeOrgMember`
- `createApiKey`
- `listApiKeys`
- `deleteApiKey`
- `rotateApiKey`
- `attachBlob`
- `getBlob`
- `listBlobs`
- `detachBlob`
- `fetchBlobByHash`
- `exportDocument`
- `exportAll`
- `importDocument`
- `getChangesSince`
- `applyChanges`

### `MeshBackend`

Stub Backend for mesh topology.  All standard `Backend` interface methods delegate to an internal `LocalBackend`. This means a mesh-topology agent can do meaningful local work (create docs, publish versions, etc.) today, before T386 (P2P Mesh Sync Engine) is installed.  The P2P sync engine (peer discovery, cr-sqlite changeset exchange, Ed25519 mutual handshake) is provided by T386. Until T386 ships, this stub emits a warning on `open()` to signal that sync is not active. T386-specific mesh methods that are not part of the Backend interface throw `MeshNotImplementedError` with a clear follow-up pointer.

```typescript
typeof MeshBackend
```

**Members:**

- `config`
- `local`
- `meshConfig`
- `open`
- `close`
- `createDocument`
- `getDocument`
- `getDocumentBySlug`
- `listDocuments`
- `deleteDocument`
- `publishVersion`
- `getVersion`
- `listVersions`
- `transitionVersion`
- `submitSignedApproval`
- `getApprovalProgress`
- `getApprovalPolicy`
- `setApprovalPolicy`
- `listContributors`
- `getApprovalChain`
- `appendEvent`
- `queryEvents`
- `subscribeStream`
- `applyCrdtUpdate`
- `getCrdtState`
- `subscribeSection`
- `acquireLease`
- `renewLease`
- `releaseLease`
- `getLease`
- `joinPresence`
- `leavePresence`
- `listPresence`
- `heartbeatPresence`
- `sendScratchpad`
- `pollScratchpad`
- `deleteScratchpadMessage`
- `sendA2AMessage`
- `pollA2AInbox`
- `deleteA2AMessage`
- `indexDocument`
- `search`
- `registerAgentPubkey`
- `lookupAgentPubkey`
- `listAgentPubkeys`
- `revokeAgentPubkey`
- `recordSignatureNonce`
- `hasNonceBeenUsed`
- `createCollection`
- `getCollection`
- `listCollections`
- `addDocToCollection`
- `removeDocFromCollection`
- `reorderCollection`
- `exportCollection`
- `createDocumentLink`
- `getDocumentLinks`
- `deleteDocumentLink`
- `getGlobalGraph`
- `createWebhook`
- `listWebhooks`
- `deleteWebhook`
- `testWebhook`
- `createSignedUrl`
- `verifySignedUrl`
- `getDocumentAccess`
- `grantDocumentAccess`
- `revokeDocumentAccess`
- `setDocumentVisibility`
- `createOrganization`
- `getOrganization`
- `listOrganizations`
- `addOrgMember`
- `removeOrgMember`
- `createApiKey`
- `listApiKeys`
- `deleteApiKey`
- `rotateApiKey`
- `attachBlob`
- `getBlob`
- `listBlobs`
- `detachBlob`
- `fetchBlobByHash`
- `exportDocument`
- `exportAll`
- `importDocument`
- `getChangesSince`
- `applyChanges`

### `HandshakeFailedError`

Thrown when the Ed25519 mutual handshake fails.

```typescript
typeof HandshakeFailedError
```

**Members:**

- `code`

### `PeerUnreachableError`

Thrown when a peer is unreachable after max retries.

```typescript
typeof PeerUnreachableError
```

**Members:**

- `code`

### `ChangesetTooLargeError`

Thrown when a changeset exceeds the maximum size.

```typescript
typeof ChangesetTooLargeError
```

**Members:**

- `code`

### `UnixSocketTransport`

UnixSocketTransport — primary transport for same-machine collaboration.  - Listens on a Unix domain socket. - Frames messages with 4-byte LE length prefix. - Completes Ed25519 mutual handshake before passing changesets to the sync engine. - Handles reconnection with 3-retry exponential backoff. - Emits `peerError` events for unreachable peers.  Spec: P3 spec §4.2, §4.3

```typescript
typeof UnixSocketTransport
```

**Members:**

- `type`
- `identity`
- `socketPath`
- `server`
- `listen` — Listen for incoming connections on the Unix socket. MUST NOT call onChangeset until the handshake completes.
- `handleIncomingConnection` — Handle an incoming connection: run handshake as responder, then receive changesets.  Uses an async generator over framed messages so each async step (signature verify, sign) completes before the next message is processed — no race between async callbacks and socket close events.
- `sendChangeset` — Send a changeset to a peer. Runs the full handshake as the initiator, then sends the changeset. Retries up to MAX_RETRIES times with exponential backoff.
- `sendOnce` — One connection attempt: connect, handshake as initiator, send changeset.  Uses async generator for sequential message processing to avoid race conditions between async crypto operations and socket events.
- `close` — Graceful shutdown: close the server and stop accepting connections.

### `HttpTransport`

HttpTransport — secondary transport for cross-machine collaboration.  - Listens on a local HTTP port. - Changeset exchange: POST /mesh/changeset (binary body). - Ed25519 handshake: POST /mesh/handshake (JSON body). - Handles reconnection with 3-retry exponential backoff. - Emits `peerError` events for unreachable peers.  Spec: P3 spec §4.2, §4.3

```typescript
typeof HttpTransport
```

**Members:**

- `type`
- `identity`
- `port`
- `host`
- `server`
- `sessions` — In-memory session store: maps `peerId -> { verified: true, peerPublicKey }`. A session is established after the handshake and used to authorize changeset delivery.
- `listen` — Start the HTTP server and listen for incoming handshake + changeset requests.
- `handleRequest`
- `handleHandshakeRequest` — POST /mesh/handshake — 3-message handshake over HTTP.  Phase 1 (client sends INIT JSON):    "phase": 1, "agentId": "...", "pubkey": "base64", "challenge": "base64"  Server responds:    "agentId": "...", "pubkey": "base64", "sig": "base64", "challenge": "base64"   Phase 2 (client sends FINAL JSON):    "phase": 2, "agentId": "...", "sig": "base64"  Server responds:    "ok": true
- `handleChangesetRequest` — POST /mesh/changeset — receive a changeset from an authenticated peer.  MUST have a valid authenticated session (completed handshake). Request headers: `X-Agent-Id: <agentId>`. Body: raw binary changeset (application/octet-stream). Response: 200 OK with empty body (or delta body in future bidirectional sync).
- `sendChangeset` — Send a changeset to a peer via HTTP. Performs the 2-phase handshake first, then POST /mesh/changeset. Retries up to MAX_RETRIES times.
- `sendOnce`
- `close` — Graceful shutdown.

### `SyncEngine`

SyncEngine — periodic + event-driven peer-to-peer changeset exchange.  Security guarantees (per spec §5.1, §5.2, §10):  - Unsigned changesets are rejected before applyChanges.  - SHA-256 hash mismatch → changeset rejected + peer failure recorded.  - Corrupted Loro blobs detected by applyChanges + hash mismatch on inbound.  - Oversized changesets (10 MB) rejected.  - One peer failure does not block sync with other peers.

```typescript
typeof SyncEngine
```

**Members:**

- `backend`
- `transport`
- `discovery`
- `identity`
- `syncIntervalMs`
- `maxPeerFailures`
- `peerState` — Per-peer sync state (agentId → PeerSyncState).
- `syncTimer`
- `running`
- `inFlightSyncs`
- `dirty` — Dirty flag: set when local backend is mutated; cleared after sync.
- `start` — Start the sync engine:  1. Begin listening for inbound changesets via transport.  2. Start periodic sync loop.  3. Load persisted peer versions from backend (if supported).
- `stop` — Stop the sync engine gracefully:  - Drain in-flight syncs.  - Shut down transport.
- `syncNow` — Trigger an immediate sync with all peers (or a specific peer).
- `_syncAllPeers`
- `_syncPeer`
- `_handleInbound`
- `_buildEnvelope`
- `_verifyEnvelopeSignature`
- `_serializeEnvelope`
- `_deserializeEnvelope`
- `_getPeerState`
- `_recordPeerFailure`
- `_loadMeshState` — Load lastSyncVersion per peer from the backend's llmtxt_mesh_state table. Falls back gracefully if the table/method does not exist.
- `_saveMeshState`
- `getPeerStates` — Return current peer sync states for monitoring.
- `sha256Hex` — SHA-256 of arbitrary bytes — exposed for testing integrity verification.
- `sha256Bytes`

### `MeshMessenger`

MeshMessenger — signed agent-to-agent routing over mesh transport.  Security guarantees (spec §7.1, §10):  - Outbound messages are Ed25519-signed before sending.  - Inbound messages are signature-verified against sender's known pubkey.  - Unsigned or invalid-signature messages are REJECTED silently (+ warn log).  - Payload 1 MB is rejected at send time.  - 1-hop relay for peers not directly connected.  - Local queue + retry on reconnect when no path exists.

```typescript
typeof MeshMessenger
```

**Members:**

- `identity`
- `transport`
- `discovery`
- `onMessage`
- `knownPubkeys` — agentId → pubkeyHex mapping built from discovered peers.
- `queue` — Local queue for messages with no current path.
- `running`
- `start`
- `stop`
- `send` — Send an A2A message to `to` agent.  Security: Signs the envelope with own Ed25519 key before sending. Payload must be JSON-serialisable and 1 MB.  Routing:  1. If `to` is in the current peer list → direct send.  2. Else → relay via any connected peer that knows `to` (1 hop).  3. If no path after MAX_RELAY_ATTEMPTS → queue locally.
- `retryQueued` — Retry queued messages for all known peers. Call after discovery refresh or reconnect event.
- `_relay`
- `_handleInbound`
- `_handleRelay`
- `_canonicalize` — Build canonical JSON for signing (sorted keys, no whitespace).
- `_buildEnvelope`
- `_verifySignature`
- `_enqueue`
- `_flushQueue`
- `_serialize`
- `_serializeRelay`
- `_updateKnownPubkeys`
- `getQueueStatus` — Returns number of queued messages per target.

### `PostgresBackend`

PostgresBackend — Backend implementation using drizzle-orm/postgres-js.  Registers as `fastify.backendCore` via apps/backend/src/plugins/postgres-backend-plugin.ts. All route handlers call `fastify.backendCore.*` instead of querying Drizzle directly.

```typescript
typeof PostgresBackend
```

**Members:**

- `config`
- `_db`
- `_sql`
- `_isOpen`
- `_s`
- `_orm`
- `_appendDocumentEvent`
- `_persistCrdtUpdate`
- `_loadSectionState`
- `_subscribeCrdtUpdates`
- `_eventBus`
- `_crdtStateVector`
- `_presenceRegistry`
- `_scratchpadPublish`
- `_scratchpadRead`
- `_scratchpadSubscribe`
- `_blobAdapter`
- `open` — Open the PostgreSQL connection pool. MUST be called before any other method. MUST be idempotent — calling open twice MUST NOT error.
- `setSchema`
- `setWaveBDeps` — Inject Wave B event-log and CRDT dependencies. Called by postgres-backend-plugin.ts after open().  These dependencies live in apps/backend and cannot be statically imported from this package (monorepo boundary). Injecting them at plugin registration time keeps this class free of cross-package imports.
- `setBlobAdapter`
- `setWaveCDeps` — Inject Wave C presence + scratchpad dependencies. Called by postgres-backend-plugin.ts after open().  Presence is in-memory only (no PG persistence) — we delegate to the shared presenceRegistry singleton. Scratchpad uses Redis Streams with an in-process EventEmitter fallback.
- `close` — Close the PostgreSQL connection pool. MUST stop all active connections. MUST be safe to call multiple times.
- `_assertOpen`
- `createDocument`
- `getDocument`
- `getDocumentBySlug`
- `listDocuments`
- `deleteDocument`
- `publishVersion`
- `getVersion`
- `listVersions`
- `transitionVersion`
- `submitSignedApproval` — submitSignedApproval — Wave A-2 implementation.  Transactionally inserts an approval record, evaluates consensus, and auto-locks the document when consensus is reached. Appends approval.submitted / approval.rejected event if appendDocumentEvent has been injected.  params: documentId (slug), versionNumber, reviewerId, status, reason?,         signatureBase64 — plus optional idempotencyKey (cast via Record).
- `getApprovalProgress`
- `getApprovalPolicy`
- `setApprovalPolicy`
- `listContributors`
- `getApprovalChain`
- `appendEvent`
- `queryEvents`
- `subscribeStream`
- `applyCrdtUpdate`
- `getCrdtState`
- `subscribeSection`
- `_parseLeaseResource` — Parse resource string "docSlug:sectionId" into docId, sectionId.
- `acquireLease`
- `renewLease`
- `releaseLease`
- `getLease`
- `_assertPresenceRegistry`
- `joinPresence`
- `leavePresence`
- `listPresence`
- `heartbeatPresence`
- `_assertScratchpad`
- `sendScratchpad`
- `pollScratchpad`
- `deleteScratchpadMessage`
- `sendA2AMessage`
- `pollA2AInbox`
- `deleteA2AMessage`
- `indexDocument`
- `search`
- `registerAgentPubkey`
- `lookupAgentPubkey`
- `listAgentPubkeys`
- `revokeAgentPubkey`
- `recordSignatureNonce`
- `hasNonceBeenUsed`
- `createCollection`
- `getCollection`
- `listCollections`
- `addDocToCollection`
- `removeDocFromCollection`
- `reorderCollection`
- `exportCollection`
- `createDocumentLink`
- `getDocumentLinks`
- `deleteDocumentLink`
- `getGlobalGraph`
- `createWebhook`
- `listWebhooks`
- `deleteWebhook`
- `testWebhook`
- `createSignedUrl`
- `verifySignedUrl`
- `getDocumentAccess`
- `grantDocumentAccess`
- `revokeDocumentAccess`
- `setDocumentVisibility`
- `createOrganization`
- `getOrganization`
- `listOrganizations`
- `addOrgMember`
- `removeOrgMember`
- `createApiKey`
- `listApiKeys`
- `deleteApiKey`
- `rotateApiKey`
- `attachBlob`
- `getBlob`
- `listBlobs`
- `detachBlob`
- `fetchBlobByHash`
- `exportDocument` — Export a single document from Postgres to a file on disk.  Content retrieval:  1. Resolve slug → document row.  2. listVersions() to find the latest version.  3. getVersion() to get the full row (including compressedData).  4. Decompress compressedData → string content via the SDK decompress().
- `exportAll` — Export all documents from the Postgres backend to a directory.
- `importDocument` — Import a document from a file on disk into the Postgres backend.
- `getChangesSince` — Not supported by PgBackend — cr-sqlite sync is a LocalBackend feature. PostgresBackend participates in P2P sync via a different protocol (P3).
- `applyChanges`

```ts
import { PostgresBackend } from 'llmtxt/pg';

const backend = new PostgresBackend({
  connectionString: process.env.DATABASE_URL,
});
await backend.open();
const doc = await backend.createDocument({ title: 'My Doc', createdBy: 'agent-1' });
await backend.close();
```

### `PgContractAdapter`

PgContractAdapter wraps PostgresBackend to satisfy the Backend interface expected by the contract test suite.  It caches title/createdBy per document id so assertions like `assert.equal(doc.title, 'Contract Test Doc')` pass even though the PG schema does not have a title column.

```typescript
typeof PgContractAdapter
```

**Members:**

- `_inner`
- `_meta`
- `_publishCount`
- `open`
- `close`
- `createDocument`
- `getDocument`
- `getDocumentBySlug`
- `listDocuments`
- `deleteDocument`
- `publishVersion`
- `getVersion`
- `listVersions`
- `transitionVersion`
- `submitSignedApproval`
- `getApprovalProgress`
- `getApprovalPolicy`
- `setApprovalPolicy`
- `listContributors`
- `getApprovalChain`
- `appendEvent`
- `queryEvents`
- `subscribeStream`
- `applyCrdtUpdate`
- `getCrdtState`
- `subscribeSection`
- `_leaseDocCreated`
- `_ensureLeaseDoc`
- `acquireLease`
- `renewLease`
- `releaseLease`
- `getLease`
- `joinPresence`
- `leavePresence`
- `listPresence`
- `heartbeatPresence`
- `sendScratchpad`
- `pollScratchpad`
- `deleteScratchpadMessage`
- `sendA2AMessage`
- `pollA2AInbox`
- `deleteA2AMessage`
- `indexDocument`
- `search`
- `registerAgentPubkey`
- `lookupAgentPubkey`
- `listAgentPubkeys`
- `revokeAgentPubkey`
- `recordSignatureNonce`
- `hasNonceBeenUsed`
- `createCollection`
- `getCollection`
- `listCollections`
- `addDocToCollection`
- `removeDocFromCollection`
- `reorderCollection`
- `exportCollection`
- `createDocumentLink`
- `getDocumentLinks`
- `deleteDocumentLink`
- `getGlobalGraph`
- `createWebhook`
- `listWebhooks`
- `deleteWebhook`
- `testWebhook`
- `createSignedUrl`
- `verifySignedUrl`
- `getDocumentAccess`
- `grantDocumentAccess`
- `revokeDocumentAccess`
- `setDocumentVisibility`
- `createOrganization`
- `getOrganization`
- `listOrganizations`
- `addOrgMember`
- `removeOrgMember`
- `createApiKey`
- `listApiKeys`
- `deleteApiKey`
- `rotateApiKey`
- `attachBlob`
- `getBlob`
- `listBlobs`
- `detachBlob`
- `fetchBlobByHash`
- `exportDocument`
- `exportAll`
- `importDocument`
- `getChangesSince`
- `applyChanges`

### `PeerRegistry`

PeerRegistry manages peer discovery for the P2P mesh.  ## Usage

```typescript
typeof PeerRegistry
```

**Members:**

- `meshDir`
- `agentId`
- `pubkeyB64`
- `cleanupRegistered`
- `register` — Write this agent's `.peer` file to `$LLMTXT_MESH_DIR/<agentId>.peer`.  Also registers a `beforeExit` / `SIGTERM` handler to call `deregister()` on clean shutdown (P3 spec §3.2).
- `deregister` — Delete this agent's `.peer` file (clean shutdown). No-op if the file does not exist.
- `discover` — Discover all peers by reading `*.peer` files from `$LLMTXT_MESH_DIR`.  Security: peer advertisements missing a valid `pubkey` or whose `pubkey` is inconsistent with their `agentId` are REJECTED and never returned. Stale peers (startedAt older than PEER_TTL_MS) are returned with `active: false`.
- `loadStaticConfig` — Load a static peer list from a JSON config file.  The file must contain an array of `PeerRegistration` objects. Entries missing a valid `pubkey` are rejected.
- `peerFilePath`

### `EventBus`

In-process EventBus.  Implements `EventStream<unknown>` but callers typically use the typed helpers `publishTyped<T>` / `subscribeTyped<T>` for type safety.

```typescript
typeof EventBus
```

**Members:**

- `_emitter`
- `publish` — Emit `event` on `channel`. All subscribers receive it synchronously.
- `subscribe` — Return an `AsyncIterable` that yields every event published on `channel` after the iterator is opened.
- `publishTyped` — Typed publish helper — no runtime cost, pure TS convenience.
- `subscribeTyped` — Typed subscribe helper — no runtime cost, pure TS convenience.

### `ExternalBusAdapter`

Adapts a `DocumentEventBusLike` (single `'document'` channel, slug-filtered) into an `EventSubscriber` that filters by `documentId` slug.  `ExternalBusAdapter` does NOT implement `EventPublisher` — publishing on the external bus is owned by the backend service layer (apps/backend), not by the SDK.  Usage in PostgresBackend:

```typescript
typeof ExternalBusAdapter
```

**Members:**

- `subscribeBySlug` — Subscribe to all `'document'` events and filter by `slug`.  Transforms the raw `BusDocumentEvent` shape into the SDK `DocumentEvent` shape.
- `subscribe`

### `PresenceManager`

PresenceManager — in-memory, TTL-based presence state across mesh peers.  Thread-safety: Node.js is single-threaded; no locks required.  Security: Rate-limits inbound presence to max 1/peer/5s (spec §10, presence flood).

```typescript
typeof PresenceManager
```

**Members:**

- `agentId`
- `transport`
- `discovery`
- `ttlSeconds`
- `broadcastIntervalMs`
- `rateLimitWindowMs`
- `registry` — Registry: agentId → PresenceEntry (includes self).
- `lastReceived` — Rate-limit tracker: agentId → last-received epoch ms.
- `currentDocumentId` — Own editable presence fields.
- `currentSectionId`
- `broadcastTimer`
- `running`
- `start`
- `stop`
- `setPresence` — Update own presence state (document/section being edited). Triggers an immediate broadcast.
- `getPresence` — Returns all active (non-expired) agents currently in a document.
- `getAll` — Returns ALL active presence entries across all documents.
- `_handleInbound` — Called by the transport listener for every incoming byte frame. Only processes messages with type byte 0x02 (presence).
- `_broadcastPresence`
- `_serializePresence`
- `_isExpired`
- `_evictExpired`

### `AgentSessionError`

AgentSessionError: custom error for session lifecycle violations.  Code taxonomy: - SESSION_NOT_FOUND: No session found (e.g., during recovery) - SESSION_ALREADY_OPEN: open() called when not in Idle state - SESSION_NOT_ACTIVE: contribute() called when not in Active state - INVALID_STATE: Invalid state transition attempt - BACKEND_ERROR: Backend rejected the operation (wrapped original error) - SESSION_CLOSE_PARTIAL: close() completed with failures; see attached errors

```typescript
typeof AgentSessionError
```

**Members:**

- `code`
- `cause`
- `receipt` — Partial receipt attached when code is SESSION_CLOSE_PARTIAL.
- `errors` — Step-level errors attached when code is SESSION_CLOSE_PARTIAL.

### `AgentSession`

AgentSession: explicit, auditable lifecycle for ephemeral and persistent agents.  Usage:    const session = new AgentSession(     backend: remoteBackend,     agentId: 'agent-12345',   );    await session.open();   const result = await session.contribute((backend) =      return backend.createDocument( title: 'My Doc', createdBy: 'agent-12345' );   );   const receipt = await session.close();  State machine is mutex-protected to prevent concurrent close() calls.  Backend interface note (T461 follow-up):   The current Backend interface has no registerSession / unregisterSession /   flushPendingWrites / releaseAllLeases methods. open() uses joinPresence()   on a sentinel document ID derived from the sessionId to signal activity.   T461 will add dedicated session primitives to the Backend interface.  Receipt persistence note (T461 follow-up):   When documents were touched, close() calls backend.appendEvent() to persist   the receipt as a 'session.closed' event on the first touched document.   A dedicated backend.persistContributionReceipt() is deferred to T461.

```typescript
typeof AgentSession
```

**Members:**

- `state`
- `sessionId`
- `agentId`
- `backend`
- `label`
- `openedAt`
- `closedAt`
- `cachedReceipt`
- `_documentIds`
- `_eventCount`
- `closeGuard` — Mutex to protect close() from concurrent execution.
- `getState` — Get the current session state.
- `getSessionId` — Get the session ID.
- `getAgentId` — Get the agent ID.
- `getDocumentIds` — Get tracked document IDs.
- `getEventCount` — Get event count.
- `open` — open(): Transition Idle - Open - Active.  Initialization steps (spec §3.2): 1. Guard: throw SESSION_ALREADY_OPEN if state !== Idle (not re-entrant) 2. Transition to Open 3. Record openedAt timestamp 4. Register presence via backend.joinPresence() (SHOULD per spec §3.2.4)    — uses a session sentinel doc ID since Backend has no registerSession().    T461 will add dedicated session primitives to Backend interface. 5. Transition to Active  Throws AgentSessionError: - SESSION_ALREADY_OPEN if state is not Idle - BACKEND_ERROR if backend rejects synchronously (async rejections are tolerated)
- `contribute` — contribute(fn): Wrap and track a unit of work.  Requires state === Active. Wraps the caller's function and (spec §3.3): 1. Guard: throw SESSION_NOT_ACTIVE if state !== Active 2. Pass the session's backend instance to fn 3. On success:    a. Extract documentId / documentIds from the result (if object-shaped)    b. Increment eventCount 4. On error: propagate WITHOUT modifying eventCount or documentIds  Document ID tracking strategy:   The spec offers two options — proxy interception or caller-returned IDs.   We use the caller-returned approach: if fn returns an object with   `documentId` (string) or `documentIds` (string[]) fields, those are   extracted. This is zero-overhead and does not require Proxy.  Throws: - AgentSessionError(SESSION_NOT_ACTIVE) if state is not Active - Re-throws any error raised by fn (after leaving state as Active)
- `close` — close(): Transition Active - Closing - Closed.  Teardown steps (spec §3.4 — all attempted even if earlier steps fail): 1. Flush pending writes via backend.flushPendingWrites() if available 2. Drain A2A inbox: backend.pollA2AInbox(agentId) until empty 3. Release all leases (none tracked at session level — T461 will add    per-resource lease tracking; skipped with T461 note) 4. For LocalBackend: temp .db cleanup is deferred to T461 (backend owns paths) 5. Deregister presence: backend.leavePresence() 6. Build ContributionReceipt (documentIds sorted for determinism) 7. Persist receipt via backend.appendEvent() on first touched document 8. Return receipt  All teardown steps MUST be attempted even if earlier steps fail. Failures are collected and surfaced as SESSION_CLOSE_PARTIAL with the partial receipt and a list of CloseStepError. The receipt is always returned (or rethrown attached to the error).  Idempotency: calling close() on an already-closed session returns the cached receipt immediately without re-executing teardown steps.  Throws AgentSessionError: - INVALID_STATE if state is not Active or Closed (i.e., Idle, Open, Closing) - SESSION_CLOSE_PARTIAL if teardown completed with step failures  Note on leases: Per spec §3.4 step 3, leases should be released here. The current Backend interface tracks leases by resource key, not by session. AgentSession does not intercept acquireLease calls (it wraps via contribute()), so it cannot enumerate what the agent acquired. T461 will add a backend.releaseSessionLeases(sessionId) primitive. Until then, caller-acquired leases expire via TTL per the crash recovery contract (spec §5).

### `PostgresChangesetAdapter`

PostgresChangesetAdapter — bridges PostgresBackend and the cr-sqlite mesh.  This adapter translates between:   - cr-sqlite binary changesets (used by LocalBackend for P2P sync), and   - Postgres row operations (used by PostgresBackend for persistence).  It is used by the optional POST /mesh/changeset route in apps/backend to allow api.llmtxt.my to participate as a mesh peer.  ## Usage (when fully implemented)

```typescript
typeof PostgresChangesetAdapter
```

**Members:**

- `options`
- `applyChangeset` — Apply a cr-sqlite binary changeset received from a LocalBackend mesh peer.  Steps (full implementation):   1. Deserialize the changeset using the cr-sqlite wire format.   2. For each row change, translate to a Postgres INSERT/UPDATE/DELETE.   3. Apply with LWW (Last-Write-Wins) conflict resolution using the      `crdt_state_hash` column for CRDT blob columns.   4. Return the new Postgres LSN/txid as the "applied db_version".
- `_applyRowChange` — Apply a single row change to Postgres.  For INSERT/UPDATE: use ON CONFLICT DO UPDATE (upsert) for idempotency. For DELETE: soft-delete via a `deleted_at` timestamp if the schema supports it; hard-delete otherwise.  TODO: Implement per-table upsert logic.
- `getChangesSince` — Serialize Postgres row changes since `sinceXid` into a cr-sqlite-compatible changeset binary for delivery to LocalBackend mesh peers.  Steps (full implementation):   1. Query all changed rows with txid  sinceXid from a Postgres audit/CDC table      (or use Postgres logical replication + pg_logical_emit_message).   2. Translate each Postgres row to a cr-sqlite changeset row entry.   3. Serialize to binary cr-sqlite changeset format.   4. Sign the changeset bytes (for SyncEngine signature verification).
- `isReady` — Returns true if the adapter has been configured with a valid Postgres connection and is ready to accept inbound changesets.  In the stub implementation, always returns false (adapter not functional). Full implementation should ping the database.

### `A2AMessage`

Signed A2A message envelope with builder API.  Construct via `buildA2AMessage` factory.

```typescript
typeof A2AMessage
```

**Members:**

- `envelope`
- `verify` — Verify this message's signature against a public key (32-byte hex or Uint8Array).
- `toJSON` — Serialize to JSON string.

## Constants

### `STATE_CHANGING_METHODS`

HTTP methods that cause state changes and trigger audit logging.

```typescript
ReadonlySet<string>
```

### `CONTENT_LIMITS`

Hard content and resource limits enforced across the LLMtxt API. These limits are immutable and apply to all users regardless of tier.

```typescript
{ readonly maxDocumentSize: number; readonly maxPatchSize: number; readonly maxBatchSize: 50; readonly maxVersionsPerDocument: 1000; readonly maxDocumentsPerUser: 10000; readonly maxWebhooksPerUser: 20; readonly maxMergeSources: 10; }
```

### `API_VERSION_REGISTRY`

Registry of all supported API versions. Add an entry here when a new API version ships.

```typescript
Readonly<Record<number, ApiVersionInfo>>
```

### `CURRENT_API_VERSION`

Current default API version served for unversioned requests.

```typescript
1
```

### `LATEST_API_VERSION`

Latest supported API version (derived from registry).

```typescript
number
```

### `VALID_LINK_TYPES`

Valid types for cross-document links. Used when linking one document to another with semantic meaning.

```typescript
readonly ["references", "depends_on", "derived_from", "supersedes", "related"]
```

### `COLLECTION_EXPORT_SEPARATOR`

Separator string used when exporting multiple documents from a collection. Documents are joined with double newlines for readability.

```typescript
"\n\n"
```

### `API_KEY_PREFIX`

Prefix for API keys generated by the system. Keys take the form: llmtxt_43 chars base64url = 50 chars total

```typescript
"llmtxt_"
```

### `API_KEY_LENGTH`

Total length of a valid API key including prefix. Calculated as: 7 (prefix) + 43 (base64url of 32 random bytes) = 50

```typescript
50
```

### `API_KEY_DISPLAY_LENGTH`

Length of the display prefix for API keys. Shows the first 8 random characters after the prefix for user identification.

```typescript
15
```

### `ROLE_PERMISSIONS`

Permission matrix for document roles. Mirrors the ROLE_PERMISSIONS constant from the Rust core — exported here so TypeScript consumers do not need to call the WASM `rolePermissions` helper for static look-ups.

```typescript
Readonly<Record<DocumentRole, readonly Permission[]>>
```

### `MODEL_DIMS`

Output dimensionality of the bundled model.

```typescript
384
```

### `PROVIDER_NAME`

Provider identifier used in database records.

```typescript
"local-onnx-minilm-l6"
```

### `MODEL_NAME`

Model name stored in database records.

```typescript
"all-MiniLM-L6-v2"
```

### `jsonFormatSchema`

Schema that accepts any valid JSON value.

```typescript
z.ZodUnion<readonly [z.ZodRecord<z.ZodString, z.ZodUnknown>, z.ZodArray<z.ZodUnknown>, z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>
```

### `textFormatSchema`

Schema that accepts any string value (plain text or markdown).

```typescript
z.ZodString
```

### `markdownFormatSchema`

Schema for markdown content, stored as a plain string.

```typescript
z.ZodString
```

### `promptMessageSchema`

Schema for a single message within an LLM prompt conversation.

```typescript
z.ZodObject<{ role: z.ZodEnum<{ system: "system"; user: "user"; assistant: "assistant"; }>; content: z.ZodString; }, z.core.$strip>
```

### `promptV1Schema`

Schema for the standard LLM prompt format (OpenAI / Anthropic style).

```typescript
z.ZodObject<{ system: z.ZodOptional<z.ZodString>; messages: z.ZodArray<z.ZodObject<{ role: z.ZodEnum<{ system: "system"; user: "user"; assistant: "assistant"; }>; content: z.ZodString; }, z.core.$strip>>; temperature: z.ZodOptional<z.ZodNumber>; max_tokens: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>
```

### `predefinedSchemas`

Registry of predefined content schemas keyed by name.

```typescript
{ readonly 'prompt-v1': z.ZodObject<{ system: z.ZodOptional<z.ZodString>; messages: z.ZodArray<z.ZodObject<{ role: z.ZodEnum<{ system: "system"; user: "user"; assistant: "assistant"; }>; content: z.ZodString; }, z.core.$strip>>; temperature: z.ZodOptional<z.ZodNumber>; max_tokens: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>; }
```

### `compressRequestSchema`

Schema for incoming content compression requests.

```typescript
z.ZodObject<{ content: z.ZodString; format: z.ZodDefault<z.ZodOptional<z.ZodEnum<{ text: "text"; markdown: "markdown"; json: "json"; }>>>; schema: z.ZodOptional<z.ZodString>; metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>; }, z.core.$strip>
```

### `decompressRequestSchema`

Schema for incoming content decompression requests.

```typescript
z.ZodObject<{ slug: z.ZodString; }, z.core.$strip>
```

### `searchRequestSchema`

Schema for incoming content search requests.

```typescript
z.ZodObject<{ query: z.ZodString; slugs: z.ZodArray<z.ZodString>; }, z.core.$strip>
```

### `DEFAULT_MAX_CONTENT_BYTES`

Default maximum content size in bytes (5 MB).

```typescript
number
```

### `DEFAULT_MAX_LINE_BYTES`

Default maximum line length in bytes (64 KB).

```typescript
number
```

### `DOCUMENT_STATES`

All valid document states in lifecycle order.

```typescript
readonly DocumentState[]
```

### `DEFAULT_APPROVAL_POLICY`

Default approval policy: 1 approval, no timeout.

```typescript
ApprovalPolicy
```

### `standaloneConfigSchema`

Zod schema for `StandaloneConfig`.

```typescript
z.ZodObject<{ topology: z.ZodLiteral<"standalone">; storagePath: z.ZodOptional<z.ZodString>; identityPath: z.ZodOptional<z.ZodString>; crsqlite: z.ZodOptional<z.ZodBoolean>; crsqliteExtPath: z.ZodOptional<z.ZodString>; }, z.core.$strip>
```

### `hubSpokeConfigSchema`

Zod schema for `HubSpokeConfig`.

```typescript
z.ZodObject<{ topology: z.ZodLiteral<"hub-spoke">; hubUrl: z.ZodString; apiKey: z.ZodOptional<z.ZodString>; identityPath: z.ZodOptional<z.ZodString>; persistLocally: z.ZodOptional<z.ZodBoolean>; storagePath: z.ZodOptional<z.ZodString>; }, z.core.$strip>
```

### `meshConfigSchema`

Zod schema for `MeshConfig`.

```typescript
z.ZodObject<{ topology: z.ZodLiteral<"mesh">; storagePath: z.ZodString; identityPath: z.ZodOptional<z.ZodString>; peers: z.ZodOptional<z.ZodArray<z.ZodString>>; meshDir: z.ZodOptional<z.ZodString>; transport: z.ZodOptional<z.ZodEnum<{ unix: "unix"; http: "http"; }>>; port: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>
```

### `topologyConfigSchema`

Discriminated-union Zod schema for any `TopologyConfig`.

```typescript
z.ZodDiscriminatedUnion<[z.ZodObject<{ topology: z.ZodLiteral<"standalone">; storagePath: z.ZodOptional<z.ZodString>; identityPath: z.ZodOptional<z.ZodString>; crsqlite: z.ZodOptional<z.ZodBoolean>; crsqliteExtPath: z.ZodOptional<z.ZodString>; }, z.core.$strip>, z.ZodObject<{ topology: z.ZodLiteral<"hub-spoke">; hubUrl: z.ZodString; apiKey: z.ZodOptional<z.ZodString>; identityPath: z.ZodOptional<z.ZodString>; persistLocally: z.ZodOptional<z.ZodBoolean>; storagePath: z.ZodOptional<z.ZodString>; }, z.core.$strip>, z.ZodObject<{ topology: z.ZodLiteral<"mesh">; storagePath: z.ZodString; identityPath: z.ZodOptional<z.ZodString>; peers: z.ZodOptional<z.ZodArray<z.ZodString>>; meshDir: z.ZodOptional<z.ZodString>; transport: z.ZodOptional<z.ZodEnum<{ unix: "unix"; http: "http"; }>>; port: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>], "topology">
```

### `FORMAT_EXT`

Map from export format to file extension.

```typescript
Record<ExportFormat, string>
```

### `FORMAT_CONTENT_TYPE`

Map from export format to HTTP Content-Type.

```typescript
Record<ExportFormat, string>
```

### `documents`

Documents table. The primary entity for the LocalBackend. Each document has a unique slug used in URLs and CRDT operations.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "documents"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; title: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; state: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; labelsJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; eventSeqCounter: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; bftF: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; requiredApprovals: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalTimeoutMs: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `versions`

Versions table. Each row represents one version of a document. Incremental patches are stored alongside full content snapshots. Large content ( 10 KB) is written to the filesystem; content_ref stores the relative path.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "versions"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; patchText: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; baseVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `stateTransitions`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "state_transitions"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; fromState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "state_transitions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `approvals`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "approvals"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reviewerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; status: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sigHex: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; canonicalPayload: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; chainHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; prevChainHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; bftF: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `sectionCrdtStates`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "section_crdt_states"; schema: undefined; columns: { documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; clock: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; crdtState: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_states"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `sectionCrdtUpdates`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "section_crdt_updates"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updateBlob: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; clientId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; seq: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_crdt_updates"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `documentEvents`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "document_events"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; seq: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; eventType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; actorId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; payloadJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; idempotencyKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; prevHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `agentPubkeys`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "agent_pubkeys"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; pubkeyHex: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; label: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revokedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `agentSignatureNonces`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "agent_signature_nonces"; schema: undefined; columns: { nonce: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_signature_nonces"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; firstSeen: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_signature_nonces"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_signature_nonces"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `sectionLeases`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "section_leases"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resource: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; holder: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; acquiredAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `agentInboxMessages`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "agent_inbox_messages"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; envelopeJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; exp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `scratchpadEntries`

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "scratchpad_entries"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; fromAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; payloadJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; exp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `sectionEmbeddings`

Semantic embedding vectors for documents.  Unlike Postgres (which uses pgvector), LocalBackend stores vectors as raw Float32Array serialized to Buffers. Cosine similarity is computed in-memory via llmtxt-core WASM (similarity.rs). Acceptable for corpora up to ~10 000 documents.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "section_embeddings"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sectionKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; embeddingBlob: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; dimensions: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; modelId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_embeddings"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `blobAttachments`

Blob attachments table for LocalBackend.  Each row represents one attachment of a binary blob to a document. Bytes are stored on disk at /blobs/. LWW semantics: only one active record per (doc_slug, blob_name). Soft-delete: deleted_at non-null = detached.

```typescript
import("drizzle-orm/sqlite-core").SQLiteTableWithColumns<{ name: "blob_attachments"; schema: undefined; columns: { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; docSlug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; blobName: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; hash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; size: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; uploadedBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; uploadedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; deletedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "blob_attachments"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }; dialect: "sqlite"; }>
```

### `insertDocumentSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; title: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; state: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; labelsJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; eventSeqCounter: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; bftF: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; requiredApprovals: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalTimeoutMs: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectDocumentSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; slug: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; title: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; state: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; visibility: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; updatedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; labelsJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; eventSeqCounter: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; bftF: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; requiredApprovals: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; approvalTimeoutMs: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "documents"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `insertVersionSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; patchText: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; baseVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectVersionSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; versionNumber: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; compressedData: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "object json"; data: unknown; driverParam: Buffer<ArrayBufferLike>; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; contentHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; tokenCount: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdBy: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; changelog: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; patchText: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; baseVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; storageKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "versions"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `insertApprovalSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reviewerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; status: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sigHex: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; canonicalPayload: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; chainHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; prevChainHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; bftF: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectApprovalSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reviewerId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; status: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; timestamp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; reason: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; atVersion: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; sigHex: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; canonicalPayload: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; chainHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; prevChainHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; bftF: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "approvals"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `insertDocumentEventSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; seq: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; eventType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; actorId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; payloadJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; idempotencyKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; prevHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectDocumentEventSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; documentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; seq: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; eventType: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; actorId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; payloadJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; idempotencyKey: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; prevHash: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "document_events"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `insertAgentPubkeySchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; pubkeyHex: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; label: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revokedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectAgentPubkeySchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; agentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; pubkeyHex: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; label: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "string"; data: string; driverParam: string; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; revokedAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_pubkeys"; dataType: "number int53"; data: number; driverParam: number; notNull: false; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `insertSectionLeaseSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resource: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; holder: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; acquiredAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectSectionLeaseSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; resource: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; holder: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; acquiredAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; expiresAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "section_leases"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `insertAgentInboxMessageSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; envelopeJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; exp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectAgentInboxMessageSchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; envelopeJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; exp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "agent_inbox_messages"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `insertScratchpadEntrySchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"insert", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; fromAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; payloadJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; exp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `selectScratchpadEntrySchema`

```typescript
import("drizzle-orm/zod").BuildSchema<"select", { id: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: true; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; toAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; fromAgentId: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; payloadJson: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "string"; data: string; driverParam: string; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: [string, ...string[]]; baseColumn: never; identity: undefined; generated: undefined; }, {}>; createdAt: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; exp: import("drizzle-orm/sqlite-core").SQLiteColumn<{ name: string; tableName: "scratchpad_entries"; dataType: "number int53"; data: number; driverParam: number; notNull: true; hasDefault: false; isPrimaryKey: false; isAutoincrement: false; hasRuntimeDefault: false; enumValues: undefined; baseColumn: never; identity: undefined; generated: undefined; }, {}>; }, undefined, undefined>
```

### `ALLOWED_URI_REGEXP`

URI allowlist: only permit http:, https:, mailto:, and relative URIs. This blocks javascript:, data:, vbscript:, and other dangerous schemes.  The regex matches from the start of the URI value and allows: - http:// and https:// URIs - mailto: URIs - Relative URIs (starting with /, ./, ../  or a letter that is not a   protocol scheme character)  It denies any URI starting with a protocol label (word+colon) that is not explicitly http, https, or mailto.

```typescript
RegExp
```

### `ALLOWED_TAGS`

Allowed HTML elements for markdown-rendered content. Deliberately excludes: script, style, iframe, object, embed, form, input, button.

```typescript
readonly ["h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "ul", "ol", "li", "blockquote", "pre", "code", "strong", "em", "b", "i", "u", "s", "del", "ins", "a", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "img"]
```

### `ALLOWED_ATTR`

Allowed HTML attributes. Excludes all event handler attributes (on*).

```typescript
readonly ["href", "title", "target", "rel", "src", "alt", "width", "height", "class", "id", "style"]
```

### `FORBIDDEN_ATTR`

Forbidden event handler attributes (comprehensive list covering OWASP cheat sheet payloads and SVG-specific handlers).

```typescript
readonly ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur", "onchange", "oninput", "onkeydown", "onkeyup", "onkeypress", "onmousedown", "onmouseup", "onmousemove", "onmouseout", "onsubmit", "onreset", "onselect", "onscroll", "ondblclick", "oncontextmenu", "ondrag", "ondrop", "onpaste", "oncopy", "oncut", "onpointerdown", "onpointerup", "onpointermove", "onpointercancel", "onpointerover", "onpointerout", "onpointerenter", "onpointerleave", "onbegin", "onend", "onrepeat", "ondomcontentloaded", "onreadystatechange"]
```

### `FORBIDDEN_CONTENTS`

Elements whose content must be stripped entirely (not just the tag). This prevents payloads like `<script>alert(1)</script>` from appearing as text content even after the script tag is removed.

```typescript
readonly ["script", "style", "iframe", "object", "embed", "form", "input", "button"]
```

### `MAX_CHANGESET_BYTES`

Maximum changeset size: 10 MB (P3 spec §10).

```typescript
number
```

### `MAX_RETRIES`

Number of retry attempts before giving up.

```typescript
3
```

### `RETRY_BASE_MS`

Base backoff delay in milliseconds (doubles each retry).

```typescript
1000
```

### `PG_AVAILABLE`

True when DATABASE_URL_PG env var is set and the PG suite should run.

```typescript
boolean
```

### `PEER_TTL_MS`

Peer TTL in milliseconds. Peer files older than this and whose host is unreachable will be excluded (stale detection). Default: 5 minutes (300_000 ms).

```typescript
number
```

### `AgentSessionState`

```typescript
{ Idle: "Idle"; Open: "Open"; Active: "Active"; Closing: "Closing"; Closed: "Closed"; }
```
