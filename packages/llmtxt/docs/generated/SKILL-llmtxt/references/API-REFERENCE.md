# llmtxt — API Reference

## Table of Contents

- [Functions](#functions)
- [Types](#types)
- [Classes](#classes)
- [Constants](#constants)

## Functions

### `compress`

```typescript
(data: string) => Promise<Buffer>
```

### `decompress`

```typescript
(data: Buffer) => Promise<string>
```

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

Compute a multi-way diff across a base version and up to 4 additional versions.

```typescript
(base: string, versionsJson: string) => MultiDiffResult
```

**Parameters:**

- `base` — Base version content (typically v1).
- `versionsJson` — JSON array of strings, one per additional version.

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

### `createClient`

```typescript
(config: LlmtxtClientConfig) => { upload(conversationId: string, content: string, options?: { format?: string; title?: string; expiresIn?: number; }): Promise<UploadResult>; fetch(signedUrl: string): Promise<FetchResult>; fetchFromConversation(slug: string, conversationId: string): Promise<FetchResult>; fetchOwned(slug: string): Promise<FetchResult>; reshare(slug: string, options?: AttachmentReshareOptions): Promise<ReshareResult>; resign(slug: string, options?: AttachmentReshareOptions): Promise<ResignResult>; createVersionPatch(original: string, updated: string): string; addVersion(slug: string, patchText: string, options?: AttachmentVersionOptions): Promise<AttachmentVersionResult>; addVersionFromContent(slug: string, original: string, updated: string, options?: AttachmentVersionOptions): Promise<AttachmentVersionResult>; isValid(signedUrl: string): boolean; }
```

### `getLineRange`

Extract a range of lines from a document, returning content and token statistics.

```typescript
(content: string, start: number, end: number) => LineRangeResult
```

**Parameters:**

- `content` — The full document content.
- `start` — The 1-based starting line number.
- `end` — The 1-based ending line number (inclusive).

**Returns:** A `LineRangeResult` with the extracted content and token savings.

```ts
const range = getLineRange(doc, 10, 25);
console.log(`Saved ${range.tokensSaved} tokens`);
```

### `searchContent`

Search document content for lines matching a query string or regex.

```typescript
(content: string, query: string, contextLines?: number, maxResults?: number) => SearchResult[]
```

**Parameters:**

- `content` — The full document content to search.
- `query` — A plain-text substring or `/regex/flags` pattern.
- `contextLines` — Number of context lines before and after each match (default: 2).
- `maxResults` — Maximum number of matches to return (default: 20).

**Returns:** An array of `SearchResult` objects for each matching line.

```ts
const hits = searchContent(doc, 'TODO', 3, 10);
```

### `detectDocumentFormat`

Detect the structural format of a document using content heuristics.

```typescript
(content: string) => "json" | "markdown" | "code" | "text"
```

**Parameters:**

- `content` — The document content to classify.

**Returns:** The detected format: `"json"`, `"markdown"`, `"code"`, or `"text"`.

```ts
detectDocumentFormat('# Title\n- item'); // "markdown"
```

### `generateOverview`

Generate a structural overview of a document for progressive disclosure.

```typescript
(content: string) => DocumentOverview
```

**Parameters:**

- `content` — The full document content to analyze.

**Returns:** A `DocumentOverview` with format, sections, and token counts.

```ts
const overview = generateOverview(markdownDoc);
console.log(`${overview.sections.length} sections, ${overview.tokenCount} tokens`);
```

### `queryJsonPath`

Execute a JSONPath-style query against JSON content.

```typescript
(content: string, path: string) => { result: unknown; tokenCount: number; path: string; }
```

**Parameters:**

- `content` — A valid JSON string to query.
- `path` — A JSONPath expression (e.g. `"$.key"`, `"items[0].name"`).

**Returns:** An object containing the resolved `result`, its `tokenCount`, and the original `path`.

```ts
const { result } = queryJsonPath('{"a":{"b":42}}', '$.a.b');
// result === 42
```

### `getSection`

Extract a named section from a document by title.

```typescript
(content: string, sectionName: string, depthAll?: boolean) => { section: Section; content: string; tokenCount: number; totalTokens: number; tokensSaved: number; } | null
```

**Parameters:**

- `content` — The full document content.
- `sectionName` — The section title (or substring) to search for.
- `depthAll` — When `true`, include all child sections nested under the match (default: `false`).

**Returns:** An object with the matched section, extracted content, and token savings, or `null` if not found.

```ts
const section = getSection(doc, 'Installation', true);
if (section) console.log(section.content);
```

### `extractMentions`

Extract  from message content.

```typescript
(content: string) => string[]
```

### `extractTags`

Extract #tags from message content.

```typescript
(content: string) => string[]
```

### `extractDirectives`

Extract /directives from message content.

```typescript
(content: string) => string[]
```

### `buildGraph`

Build a knowledge graph from an array of messages.  Nodes: agents (from fromAgentId + mentions), topics (#tags), decisions (/decision messages) Edges: mentions (agent→agent), discusses (agent→topic), decides (agent→decision), participates (agent→agent in same conversation)

```typescript
(messages: MessageInput[]) => KnowledgeGraph
```

### `topTopics`

Find the most connected topics in the graph. Returns topics sorted by number of discussing agents.

```typescript
(graph: KnowledgeGraph, limit?: number) => Array<{ topic: string; agents: number; }>
```

### `topAgents`

Find the most active agents in the graph. Returns agents sorted by total edge weight (mentions + discussions + decisions).

```typescript
(graph: KnowledgeGraph, limit?: number) => Array<{ agent: string; activity: number; }>
```

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
(name: string) => z.ZodSchema | undefined
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

### `extractNgrams`

Extract character-level n-grams from text. Normalizes whitespace and lowercases before extraction.

```typescript
(text: string, n?: number) => Set<string>
```

### `extractWordShingles`

Extract word-level n-grams (shingles) from text. Better for longer content where word order matters.

```typescript
(text: string, n?: number) => Set<string>
```

### `jaccardSimilarity`

Jaccard similarity: |A ∩ B| / |A ∪ B|. Returns 0.0 (no overlap) to 1.0 (identical).

```typescript
(a: Set<string>, b: Set<string>) => number
```

### `textSimilarity`

Compute similarity between two texts using character n-grams. Returns 0.0 to 1.0.

```typescript
(a: string, b: string, ngramSize?: number) => number
```

### `contentSimilarity`

Compute similarity using word shingles. Better for comparing messages or documents where word choice matters more than character patterns.

```typescript
(a: string, b: string, shingleSize?: number) => number
```

### `minHashFingerprint`

Generate a compact fingerprint for content using MinHash. The fingerprint is an array of hash values that can be compared for approximate similarity without storing the full n-gram set.  Two fingerprints with many matching values indicate similar content.

```typescript
(text: string, numHashes?: number, ngramSize?: number) => number[]
```

### `fingerprintSimilarity`

Estimate similarity between two MinHash fingerprints. Returns approximate Jaccard similarity (0.0 to 1.0).

```typescript
(a: number[], b: number[]) => number
```

### `rankBySimilarity`

Rank a list of texts by similarity to a query. Returns indices sorted by descending similarity, with scores.

```typescript
(query: string, candidates: string[], options?: { method?: "ngram" | "shingle"; threshold?: number; }) => Array<{ index: number; score: number; }>
```

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

## Types

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

### `GraphNode`

```typescript
GraphNode
```

**Members:**

- `id`
- `type`
- `label`
- `weight`

### `GraphEdge`

```typescript
GraphEdge
```

**Members:**

- `source`
- `target`
- `type`
- `weight`

### `KnowledgeGraph`

```typescript
KnowledgeGraph
```

**Members:**

- `nodes`
- `edges`
- `stats`

### `MessageInput`

```typescript
MessageInput
```

**Members:**

- `id`
- `fromAgentId`
- `content`
- `metadata`
- `createdAt`

### `PredefinedSchemaName`

Union of all registered predefined schema name strings.

```typescript
"prompt-v1"
```

### `JsonFormat`

Inferred TypeScript type for any valid JSON value (object, array, primitive).

```typescript
string | number | boolean | unknown[] | Record<string, unknown> | null
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
{ content: string; format: "json" | "text" | "markdown"; schema?: string | undefined; metadata?: Record<string, unknown> | undefined; }
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

## Constants

### `jsonFormatSchema`

Schema that accepts any valid JSON value.

```typescript
z.ZodUnion<[z.ZodRecord<z.ZodString, z.ZodUnknown>, z.ZodArray<z.ZodUnknown, "many">, z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>
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
z.ZodObject<{ role: z.ZodEnum<["system", "user", "assistant"]>; content: z.ZodString; }, "strip", z.ZodTypeAny, { role: "system" | "user" | "assistant"; content: string; }, { role: "system" | "user" | "assistant"; content: string; }>
```

### `promptV1Schema`

Schema for the standard LLM prompt format (OpenAI / Anthropic style).

```typescript
z.ZodObject<{ system: z.ZodOptional<z.ZodString>; messages: z.ZodArray<z.ZodObject<{ role: z.ZodEnum<["system", "user", "assistant"]>; content: z.ZodString; }, "strip", z.ZodTypeAny, { role: "system" | "user" | "assistant"; content: string; }, { role: "system" | "user" | "assistant"; content: string; }>, "many">; temperature: z.ZodOptional<z.ZodNumber>; max_tokens: z.ZodOptional<z.ZodNumber>; }, "strip", z.ZodTypeAny, { messages: { role: "system" | "user" | "assistant"; content: string; }[]; system?: string | undefined; temperature?: number | undefined; max_tokens?: number | undefined; }, { messages: { role: "system" | "user" | "assistant"; content: string; }[]; system?: string | undefined; temperature?: number | undefined; max_tokens?: number | undefined; }>
```

### `predefinedSchemas`

Registry of predefined content schemas keyed by name.

```typescript
{ readonly 'prompt-v1': z.ZodObject<{ system: z.ZodOptional<z.ZodString>; messages: z.ZodArray<z.ZodObject<{ role: z.ZodEnum<["system", "user", "assistant"]>; content: z.ZodString; }, "strip", z.ZodTypeAny, { role: "system" | "user" | "assistant"; content: string; }, { role: "system" | "user" | "assistant"; content: string; }>, "many">; temperature: z.ZodOptional<z.ZodNumber>; max_tokens: z.ZodOptional<z.ZodNumber>; }, "strip", z.ZodTypeAny, { messages: { role: "system" | "user" | "assistant"; content: string; }[]; system?: string | undefined; temperature?: number | undefined; max_tokens?: number | undefined; }, { messages: { role: "system" | "user" | "assistant"; content: string; }[]; system?: string | undefined; temperature?: number | undefined; max_tokens?: number | undefined; }>; }
```

### `compressRequestSchema`

Schema for incoming content compression requests.

```typescript
z.ZodObject<{ content: z.ZodString; format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["json", "text", "markdown"]>>>; schema: z.ZodOptional<z.ZodString>; metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>; }, "strip", z.ZodTypeAny, { content: string; format: "json" | "text" | "markdown"; schema?: string | undefined; metadata?: Record<string, unknown> | undefined; }, { content: string; format?: "json" | "text" | "markdown" | undefined; schema?: string | undefined; metadata?: Record<string, unknown> | undefined; }>
```

### `decompressRequestSchema`

Schema for incoming content decompression requests.

```typescript
z.ZodObject<{ slug: z.ZodString; }, "strip", z.ZodTypeAny, { slug: string; }, { slug: string; }>
```

### `searchRequestSchema`

Schema for incoming content search requests.

```typescript
z.ZodObject<{ query: z.ZodString; slugs: z.ZodArray<z.ZodString, "many">; }, "strip", z.ZodTypeAny, { query: string; slugs: string[]; }, { query: string; slugs: string[]; }>
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
