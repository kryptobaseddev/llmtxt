# @codluv/llmtxt

Core primitives for LLM agent content workflows. Compression, validation, progressive disclosure, signed URLs, and caching.

Provider-agnostic. Works with any Node.js framework. Only external dependency: `zod`.

## Install

```bash
npm install @codluv/llmtxt
```

## Modules

### Compression & Encoding

```typescript
import { compress, decompress, generateId, hashContent, calculateTokens } from '@codluv/llmtxt';

const compressed = await compress('Hello world');
const text = await decompress(compressed);
const id = generateId();           // 8-char base62 ID
const hash = hashContent(text);    // SHA-256 hex
const tokens = calculateTokens(text); // ~chars/4 estimate
```

### Validation

```typescript
import { validateContent, detectFormat, autoValidate } from '@codluv/llmtxt';

const format = detectFormat(content);       // 'json' | 'text'
const result = validateContent(content, 'json', 'prompt-v1');
// { success: true, data: {...}, format: 'json' }
```

### Progressive Disclosure

Analyze document structure and extract sections without reading the full content — saves tokens.

```typescript
import { generateOverview, getSection, searchContent, getLineRange, queryJsonPath } from '@codluv/llmtxt';

const overview = generateOverview(markdownContent);
// { format: 'markdown', lineCount, tokenCount, sections: [...], toc: [...] }

const section = getSection(content, 'API Design');
// { content: '...', tokenCount: 45, tokensSaved: 320 }

const results = searchContent(content, 'authentication', 2, 10);
const lines = getLineRange(content, 10, 25);
const value = queryJsonPath(jsonContent, '$.users[0].name');
```

### Cache

```typescript
import { LRUCache } from '@codluv/llmtxt';

const cache = new LRUCache<string>({ maxSize: 500, ttl: 3600000 });
cache.set('key', 'value');
cache.get('key');         // 'value'
cache.getStats();         // { hits, misses, size, maxSize, hitRate }
```

### Signed URLs

Conversation-scoped, time-limited access using HMAC-SHA256.

```typescript
import { generateSignedUrl, verifySignedUrl, generateTimedUrl } from '@codluv/llmtxt';

const url = generateSignedUrl(
  { slug: 'xK9mP2nQ', agentId: 'my-agent', conversationId: 'conv_123', expiresAt: Date.now() + 3600000 },
  { secret: process.env.HMAC_SECRET, baseUrl: 'https://llmtxt.my' },
);

const result = verifySignedUrl(url, process.env.HMAC_SECRET);
// { valid: true, params: { slug, agentId, conversationId, expiresAt } }

// Convenience: auto-expire in 1 hour
const timedUrl = generateTimedUrl(
  { slug: 'xK9mP2nQ', agentId: 'my-agent', conversationId: 'conv_123' },
  { secret: process.env.HMAC_SECRET, baseUrl: 'https://llmtxt.my' },
  60 * 60 * 1000,
);
```

## API Reference

### Compression

| Export | Description |
|--------|-------------|
| `compress(data)` | Deflate compress string to Buffer |
| `decompress(data)` | Inflate Buffer back to string |
| `generateId()` | 8-char base62 ID from UUID |
| `hashContent(data)` | SHA-256 hex hash |
| `calculateTokens(text)` | Estimate token count (~chars/4) |
| `calculateCompressionRatio(orig, compressed)` | Ratio (e.g. 2.5:1) |
| `encodeBase62(num)` / `decodeBase62(str)` | Base62 codec |

### Validation

| Export | Description |
|--------|-------------|
| `detectFormat(content)` | Auto-detect `'json'` or `'text'` |
| `validateContent(content, format, schema?)` | Validate with optional schema |
| `validateJson(content, schema?)` | JSON-specific validation |
| `validateText(content)` | Text/markdown validation |
| `autoValidate(content, schema?)` | Detect format then validate |

### Schemas

| Export | Description |
|--------|-------------|
| `promptV1Schema` | Zod schema for LLM prompt format |
| `predefinedSchemas` | Schema registry object |
| `isPredefinedSchema(name)` | Check if schema name exists |
| `compressRequestSchema` | Request body schema for compress API |

### Disclosure

| Export | Description |
|--------|-------------|
| `generateOverview(content)` | Structural analysis (sections, TOC, keys) |
| `getSection(content, name, depthAll?)` | Extract section by name |
| `getLineRange(content, start, end)` | Get specific line range |
| `searchContent(content, query, ctx?, max?)` | Search with context lines |
| `queryJsonPath(content, path)` | JSONPath query (`$.key[0].field`) |
| `detectDocumentFormat(content)` | Detect json/markdown/code/text |

### Cache

| Export | Description |
|--------|-------------|
| `LRUCache<T>` | Generic LRU cache class |
| `.get(key)` / `.set(key, value, ttl?)` | Read/write |
| `.getStats()` | Hit rate, size, misses |

### Signed URLs

| Export | Description |
|--------|-------------|
| `generateSignedUrl(params, config)` | Create signed URL |
| `verifySignedUrl(url, secret)` | Verify signature + expiration |
| `generateTimedUrl(params, config, ttlMs?)` | Convenience with auto-expiry |
| `computeSignature(params, secret)` | Raw HMAC computation |

## License

MIT
