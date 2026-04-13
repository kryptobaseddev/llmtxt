---
name: SKILL-llmtxt
description: >
  Primitives and SDK for LLM agent content workflows: compression, patching, progressive disclosure, signed URLs, collaborative document lifecycle, and retrieval planning Use when: (1) calling its 87 API functions, (2) configuring llmtxt, (3) understanding its 80 type definitions, (4) working with its 2 classes, (5) user mentions "llm", "agent", "compression", "content", "patch", (6) user mentions "llmtxt" or asks about its API.
---

# llmtxt

Primitives and SDK for LLM agent content workflows: compression, patching, progressive disclosure, signed URLs, collaborative document lifecycle, and retrieval planning

## Quick Start

```bash
npm install llmtxt
```

```ts
const cache = new LRUCache<string>({ maxSize: 100, ttl: 60_000 });
cache.set('key', 'value');
cache.get('key'); // "value"
```

## API

| Function | Description |
|----------|-------------|
| `compress()` |  |
| `decompress()` |  |
| `encodeBase62()` |  |
| `decodeBase62()` |  |
| `generateId()` |  |
| `hashContent()` |  |
| `calculateTokens()` |  |
| `calculateCompressionRatio()` |  |
| `computeSignature()` |  |
| `computeSignatureWithLength()` |  |
| `computeOrgSignature()` |  |
| `computeOrgSignatureWithLength()` |  |
| `deriveSigningKey()` |  |
| `createPatch()` |  |
| `applyPatch()` |  |
| ... | 72 more — see API reference |

## Configuration

```typescript
import type { LlmtxtClientConfig } from "llmtxt";

const config: Partial<LlmtxtClientConfig> = {
  apiBase: "...",
  apiKey: "...",
  agentId: "...",
};
```

See [references/CONFIGURATION.md](references/CONFIGURATION.md) for full details.

## Gotchas

- `multiWayDiff()` throws: Error if the Rust core returns an error object.
- `cherryPickMerge()` throws: Error if the Rust core returns an error object.
- `queryJsonPath()` throws: Error if the JSON is invalid or the path cannot be resolved.
- `reconstructVersion()` throws: If a patch in the sequence fails to apply.

## Key Types

- **`CacheStats`** — Snapshot of cache performance statistics.
- **`LRUCacheOptions`** — Configuration options for constructing an `LRUCache` instance.
- **`LRUCache`** — Generic least-recently-used (LRU) cache with time-to-live support.
- **`DiffResult`**
- **`StructuredDiffLine`** — A single line in a structured diff with type annotation and line numbers.
- **`StructuredDiffResult`** — Full structured diff result with interleaved lines and summary counts.
- **`MultiDiffVariant`** — A single version variant at a divergent line position.
- **`MultiDiffLine`** — One line entry in a multi-way diff result.
- **`MultiDiffStats`** — Aggregate statistics for a multi-way diff.
- **`MultiDiffResult`** — Full result of a multi-way diff.

## References

- [references/CONFIGURATION.md](references/CONFIGURATION.md) — Full config options
- [references/API-REFERENCE.md](references/API-REFERENCE.md) — Signatures, parameters, examples
