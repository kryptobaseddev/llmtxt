---
name: SKILL-web
description: >
  Users table - supports both anonymous (24hr TTL) and registered accounts.  Anonymous users get a generated ID and no credentials. They are auto-purged after `expiresAt`. Registered users provide email/password and persist indefinitely until explicitly deleted. Use when: (1) calling its 27 API functions, (2) understanding its 36 type definitions, (3) user mentions "@llmtxt/web" or asks about its API.
---

# @llmtxt/web

Users table - supports both anonymous (24hr TTL) and registered accounts.  Anonymous users get a generated ID and no credentials. They are auto-purged after `expiresAt`. Registered users provide email/password and persist indefinitely until explicitly deleted.

## Quick Start

```bash
npm install @llmtxt/web
```

## API

| Function | Description |
|----------|-------------|
| `getDocumentCacheKey()` | Generate cache key for a document |
| `shouldSkipCache()` | Check if cache should be skipped based on query params |
| `cacheDocumentContent()` | Middleware to cache document content Usage: app.get('/documents/:slug', cacheDocumentContent, async (request, reply) =  ... ) |
| `cacheDocumentMetadata()` | Middleware to cache document metadata |
| `setCachedContent()` | Store document content in cache |
| `setCachedMetadata()` | Store document metadata in cache |
| `invalidateDocumentCache()` | Invalidate cache for a document |
| `invalidateAllCache()` | Invalidate all cache |
| `getCacheStats()` | Get cache stats for both caches |
| `apiRoutes()` |  |
| `disclosureRoutes()` |  |
| `versionRoutes()` |  |
| `authRoutes()` |  |
| `requireAuth()` |  |
| `requireRegistered()` |  |
| ... | 12 more — see API reference |

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
