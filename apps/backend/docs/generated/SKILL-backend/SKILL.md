---
name: SKILL-backend
description: >
  Users table - supports both anonymous (24hr TTL) and registered accounts.  Anonymous users get a generated ID and no credentials. They are auto-purged after `expiresAt`. Registered users provide email/password and persist indefinitely until explicitly deleted. Use when: (1) calling its 122 API functions, (2) understanding its 212 type definitions, (3) working with its 3 classes, (4) user mentions "@llmtxt/backend" or asks about its API.
---

# @llmtxt/backend

Users table - supports both anonymous (24hr TTL) and registered accounts.  Anonymous users get a generated ID and no credentials. They are auto-purged after `expiresAt`. Registered users provide email/password and persist indefinitely until explicitly deleted.

## Quick Start

```bash
npm install @llmtxt/backend
```

## API

| Function | Description |
|----------|-------------|
| `countTokens()` | Count tokens using the cl100k_base BPE tokenizer (GPT-3.5/GPT-4 compatible).  Returns the exact number of tokens the given text would consume in a GPT-4 / Claude-compatible API call. This is significantly more accurate than the `ceil(len / 4)` heuristic for content with non-ASCII characters, code, or structured markup. |
| `getDocumentCacheKey()` | Generate cache key for a document |
| `shouldSkipCache()` | Check if cache should be skipped based on query params |
| `cacheDocumentContent()` | Middleware to cache document content Usage: app.get('/documents/:slug', cacheDocumentContent, async (request, reply) =  ... ) |
| `cacheDocumentMetadata()` | Middleware to cache document metadata |
| `setCachedContent()` | Store document content in cache |
| `setCachedMetadata()` | Store document metadata in cache |
| `invalidateDocumentCache()` | Invalidate cache for a document |
| `invalidateAllCache()` | Invalidate all cache |
| `getCacheStats()` | Get cache stats for both caches |
| `keyGenerator()` | Generate a stable rate-limit key for the request.  Uses the most specific identifier available:   1. Hashed API key (from Bearer token) — identifies the key, not the user   2. User ID (from session cookie)   3. Client IP address |
| `getTierMax()` | Return the rate limit max for the given category based on the request's auth tier. |
| `registerRateLimiting()` | Register the global rate limiter on the Fastify instance.  Must be called AFTER CORS and compression plugins but BEFORE route registration. The global limit applies to all routes; individual routes may override with stricter config via writeRateLimit or authRateLimit.  The /api/health endpoint is explicitly skipped via the skip function. |
| `adaptiveThrottle()` | Adaptive throttle hook: adds artificial delay when a client approaches their rate limit ceiling ( 20% remaining). This smooths out burst traffic by slowing requests progressively rather than hard-cutting at the limit. Maximum induced delay is 500ms.  Attach as a preHandler hook on routes where burst smoothing is desired. |
| `enforceContentSize()` | Enforce the maximum document content size.  Reads `content` from the request body and rejects with 413 if the UTF-8 byte length exceeds CONTENT_LIMITS.maxDocumentSize. Safe to call on any route that accepts a `content` body field. |
| ... | 107 more — see API reference |

## Key Types

- **`User`**
- **`NewUser`**
- **`Session`**
- **`NewSession`**
- **`Document`**
- **`NewDocument`**
- **`Version`**
- **`NewVersion`**
- **`StateTransition`**
- **`NewStateTransition`**

## References

- [references/CONFIGURATION.md](references/CONFIGURATION.md) — Full config options
- [references/API-REFERENCE.md](references/API-REFERENCE.md) — Signatures, parameters, examples
