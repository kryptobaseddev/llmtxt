---
name: SKILL-llmtxt
description: >
  Core primitives for llmtxt: compression, validation, progressive disclosure, signed URLs, and caching for LLM agent content workflows Use when: (1) calling its 25 API functions, (2) configuring @codluv/llmtxt, (3) understanding its 20 type definitions, (4) working with its 1 classes, (5) user mentions "llm", "agent", "compression", "content", "progressive-disclosure", (6) user mentions "@codluv/llmtxt" or asks about its API.
---

# @codluv/llmtxt

Core primitives for llmtxt: compression, validation, progressive disclosure, signed URLs, and caching for LLM agent content workflows

## Quick Start

```bash
npm install @codluv/llmtxt
```

```ts
const cache = new LRUCache<string>({ maxSize: 100, ttl: 60_000 });
cache.set('key', 'value');
cache.get('key'); // "value"
```

## API

| Function | Description |
|----------|-------------|
| `encodeBase62()` | Encode a non-negative integer into a base62 string. |
| `decodeBase62()` | Decode a base62-encoded string back into a non-negative integer. |
| `compress()` | Compress a UTF-8 string using deflate. |
| `decompress()` | Decompress a deflate-compressed buffer back to a UTF-8 string. |
| `generateId()` | Generate a base62-encoded 8-character ID from a UUID. |
| `hashContent()` | Compute the SHA-256 hash of a string, returned as a hex digest. |
| `calculateTokens()` | Estimate the token count of a string using the ~4 chars/token heuristic. |
| `calculateCompressionRatio()` | Calculate the compression ratio between original and compressed sizes. |
| `getLineRange()` | Extract a range of lines from a document, returning content and token statistics. |
| `searchContent()` | Search document content for lines matching a query string or regex. |
| `detectDocumentFormat()` | Detect the structural format of a document using content heuristics. |
| `generateOverview()` | Generate a structural overview of a document for progressive disclosure. |
| `queryJsonPath()` | Execute a JSONPath-style query against JSON content. |
| `getSection()` | Extract a named section from a document by title. |
| `isPredefinedSchema()` | Type-guard that checks whether a string is a registered predefined schema name. |
| ... | 10 more — see API reference |

## Configuration

```typescript
import type { SignedUrlConfig } from "@codluv/llmtxt";

const config: Partial<SignedUrlConfig> = {
  // Shared HMAC-SHA256 secret used to sign and verify URLs.
  secret: "...",
  // Base URL for document access (e.g. `"https://llmtxt.my"`).
  baseUrl: "...",
};
```

See [references/CONFIGURATION.md](references/CONFIGURATION.md) for full details.

## Gotchas

- `queryJsonPath()` throws: Error if the JSON is invalid or the path cannot be resolved.

## Key Types

- **`CacheStats`** — Snapshot of cache performance statistics.
- **`LRUCacheOptions`** — Configuration options for constructing an `LRUCache` instance.
- **`LRUCache`** — Generic least-recently-used (LRU) cache with time-to-live support.
- **`Section`** — A logical section identified within a document.
- **`DocumentOverview`** — High-level structural overview of a document.
- **`SearchResult`** — A single match returned by `searchContent`.
- **`LineRangeResult`** — Result of extracting a line range from a document via `getLineRange`.
- **`PredefinedSchemaName`** — Union of all registered predefined schema name strings.
- **`JsonFormat`** — Inferred TypeScript type for any valid JSON value (object, array, primitive).
- **`TextFormat`** — Inferred TypeScript type for plain text content.

## References

- [references/CONFIGURATION.md](references/CONFIGURATION.md) — Full config options
- [references/API-REFERENCE.md](references/API-REFERENCE.md) — Signatures, parameters, examples
