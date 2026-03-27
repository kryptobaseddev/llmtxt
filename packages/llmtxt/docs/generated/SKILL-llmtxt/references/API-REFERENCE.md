# @codluv/llmtxt — API Reference

## Table of Contents

- [Functions](#functions)
- [Types](#types)
- [Classes](#classes)
- [Constants](#constants)

## Functions

### `encodeBase62`

Encode a non-negative integer into a base62 string.

```typescript
(num: number) => string
```

**Parameters:**

- `num` — The non-negative integer to encode.

**Returns:** The base62-encoded string representation.

```ts
encodeBase62(0);   // "0"
encodeBase62(61);  // "z"
encodeBase62(62);  // "10"
```

### `decodeBase62`

Decode a base62-encoded string back into a non-negative integer.

```typescript
(str: string) => number
```

**Parameters:**

- `str` — The base62-encoded string to decode.

**Returns:** The decoded non-negative integer.

```ts
decodeBase62("0");  // 0
decodeBase62("z");  // 61
decodeBase62("10"); // 62
```

### `compress`

Compress a UTF-8 string using deflate.

```typescript
(data: string) => Promise<Buffer>
```

**Parameters:**

- `data` — The UTF-8 string to compress.

**Returns:** A promise that resolves to the deflate-compressed buffer.

```ts
const compressed = await compress('Hello, world!');
```

### `decompress`

Decompress a deflate-compressed buffer back to a UTF-8 string.

```typescript
(data: Buffer) => Promise<string>
```

**Parameters:**

- `data` — The deflate-compressed buffer to decompress.

**Returns:** A promise that resolves to the decompressed UTF-8 string.

```ts
const original = await decompress(compressedBuffer);
```

### `generateId`

Generate a base62-encoded 8-character ID from a UUID.

```typescript
() => string
```

**Returns:** An 8-character base62-encoded identifier string.

```ts
const id = generateId(); // e.g. "xK9mP2nQ"
```

### `hashContent`

Compute the SHA-256 hash of a string, returned as a hex digest.

```typescript
(data: string) => string
```

**Parameters:**

- `data` — The UTF-8 string to hash.

**Returns:** The lowercase hex-encoded SHA-256 digest.

```ts
hashContent('hello'); // "2cf24dba5fb0a30e..."
```

### `calculateTokens`

Estimate the token count of a string using the ~4 chars/token heuristic.

```typescript
(text: string) => number
```

**Parameters:**

- `text` — The text whose token count is to be estimated.

**Returns:** The estimated number of tokens (rounded up).

```ts
calculateTokens('Hello, world!'); // 4
```

### `calculateCompressionRatio`

Calculate the compression ratio between original and compressed sizes.

```typescript
(originalSize: number, compressedSize: number) => number
```

**Parameters:**

- `originalSize` — The size of the original content in bytes.
- `compressedSize` — The size of the compressed content in bytes.

**Returns:** The compression ratio (original / compressed), rounded to two decimals.

```ts
calculateCompressionRatio(1000, 400); // 2.5
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

Auto-detect whether a string is JSON or text.

```typescript
(content: string) => "json" | "text" | "markdown"
```

**Parameters:**

- `content` — The string to inspect.

**Returns:** The detected format: `"json"` or `"text"`.

```ts
detectFormat('{"a":1}'); // "json"
detectFormat('Hello');   // "text"
```

### `validateContent`

Validate content for a given format, with optional schema enforcement.

```typescript
(content: unknown, format: "json" | "text" | "markdown", schemaName?: string) => ValidationResult
```

**Parameters:**

- `content` — The raw content to validate.
- `format` — The expected content format.
- `schemaName` — Optional predefined schema name for JSON validation.

**Returns:** A `ValidationResult` indicating success or listing errors.

```ts
const result = validateContent(payload, 'json', 'prompt-v1');
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

Compute the HMAC-SHA256 signature for a set of signed URL parameters.

```typescript
(params: SignedUrlParams, secret: string) => string
```

**Parameters:**

- `params` — The signed URL parameters to include in the signature payload.
- `secret` — The shared HMAC secret.

**Returns:** A 16-character hex string representing the truncated HMAC signature.

```ts
const sig = computeSignature(
  { slug: 'xK9mP2nQ', agentId: 'agent-1', conversationId: 'conv_1', expiresAt: 1711234567890 },
  'my-secret',
);
// sig.length === 16
```

### `generateSignedUrl`

Generate a signed URL for accessing a document.

```typescript
(params: SignedUrlParams, config: SignedUrlConfig) => string
```

**Parameters:**

- `params` — The signed URL parameters (slug, agent, conversation, expiry).
- `config` — The HMAC secret and base URL for URL construction.

**Returns:** The fully-qualified signed URL string.

```ts
const url = generateSignedUrl(
  { slug: 'xK9mP2nQ', agentId: 'my-agent', conversationId: 'conv_123', expiresAt: Date.now() + 3600000 },
  { secret: 'shared-secret', baseUrl: 'https://llmtxt.my' },
);
// => "https://llmtxt.my/xK9mP2nQ?agent=my-agent&conv=conv_123&exp=1711234567890&sig=a1b2c3d4e5f6a7b8"
```

### `verifySignedUrl`

Verify a signed URL's signature and expiration.

```typescript
(url: string | URL, secret: string) => VerifyResult
```

**Parameters:**

- `url` — The signed URL to verify (string or `URL` instance).
- `secret` — The shared HMAC secret used when the URL was generated.

**Returns:** A `VerifyResult` with `valid`, optional `reason`, and optional `params`.

```ts
const result = verifySignedUrl('https://llmtxt.my/xK9mP2nQ?agent=a&conv=c&exp=9999999999999&sig=abc123', 'secret');
if (result.valid) console.log(result.params);
```

### `generateTimedUrl`

Generate a signed URL that expires after the given duration.

```typescript
(params: Omit<SignedUrlParams, "expiresAt">, config: SignedUrlConfig, ttlMs?: number) => string
```

**Parameters:**

- `params` — Slug, agentId, and conversationId (expiresAt is calculated automatically).
- `config` — The HMAC secret and base URL for URL construction.
- `ttlMs` — Time to live in milliseconds (default: 1 hour / 3 600 000 ms).

**Returns:** The fully-qualified signed URL string with a computed expiration.

```ts
const url = generateTimedUrl(
  { slug: 'xK9mP2nQ', agentId: 'agent-1', conversationId: 'conv_1' },
  { secret: 'secret', baseUrl: 'https://llmtxt.my' },
  300_000, // 5 minutes
);
```

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
{ content: string; format: "json" | "markdown" | "text"; schema?: string | undefined; metadata?: Record<string, unknown> | undefined; }
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

### `SignedUrlParams`

Parameters that uniquely identify a signed URL access grant.

```typescript
SignedUrlParams
```

**Members:**

- `slug` — Short base62-encoded document identifier (e.g. `"xK9mP2nQ"`).
- `agentId` — Unique identifier of the agent requesting access.
- `conversationId` — Conversation scope that this access grant is bound to.
- `expiresAt` — Absolute expiration time as a Unix timestamp in milliseconds.

### `SignedUrlConfig`

Configuration for generating and verifying signed URLs.

```typescript
SignedUrlConfig
```

**Members:**

- `secret` — Shared HMAC-SHA256 secret used to sign and verify URLs.
- `baseUrl` — Base URL for document access (e.g. `"https://llmtxt.my"`).

### `VerifyResult`

Outcome of verifying a signed URL via `verifySignedUrl`.

```typescript
VerifyResult
```

**Members:**

- `valid` — Whether the signature is valid and the URL has not expired.
- `reason` — Machine-readable failure reason, present only when `valid` is `false`.
- `params` — Reconstructed request parameters, present only when `valid` is `true`.

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
z.ZodObject<{ content: z.ZodString; format: z.ZodDefault<z.ZodOptional<z.ZodEnum<["json", "text", "markdown"]>>>; schema: z.ZodOptional<z.ZodString>; metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>; }, "strip", z.ZodTypeAny, { content: string; format: "json" | "markdown" | "text"; schema?: string | undefined; metadata?: Record<string, unknown> | undefined; }, { content: string; format?: "json" | "markdown" | "text" | undefined; schema?: string | undefined; metadata?: Record<string, unknown> | undefined; }>
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
