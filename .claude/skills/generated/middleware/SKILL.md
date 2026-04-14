---
name: middleware
description: "Skill for the Middleware area of llmtxt. 10 symbols across 4 files."
---

# Middleware

10 symbols | 4 files | Cohesion: 70%

## When to Use

- Working with code in `apps/`
- Understanding how getDocumentWithContent, getDocumentCacheKey, shouldSkipCache work
- Modifying middleware-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `apps/backend/src/middleware/cache.ts` | getDocumentCacheKey, shouldSkipCache, cacheDocumentContent, cacheDocumentMetadata, setCachedContent |
| `apps/backend/src/middleware/auth.ts` | requireAuth, requireRegistered, requireOwner |
| `apps/backend/src/routes/web.ts` | getDocumentWithContent |
| `apps/backend/src/routes/disclosure.ts` | resolveDocument |

## Entry Points

Start here when exploring this area:

- **`getDocumentWithContent`** (Function) — `apps/backend/src/routes/web.ts:37`
- **`getDocumentCacheKey`** (Function) — `apps/backend/src/middleware/cache.ts:9`
- **`shouldSkipCache`** (Function) — `apps/backend/src/middleware/cache.ts:16`
- **`cacheDocumentContent`** (Function) — `apps/backend/src/middleware/cache.ts:25`
- **`cacheDocumentMetadata`** (Function) — `apps/backend/src/middleware/cache.ts:52`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `getDocumentWithContent` | Function | `apps/backend/src/routes/web.ts` | 37 |
| `getDocumentCacheKey` | Function | `apps/backend/src/middleware/cache.ts` | 9 |
| `shouldSkipCache` | Function | `apps/backend/src/middleware/cache.ts` | 16 |
| `cacheDocumentContent` | Function | `apps/backend/src/middleware/cache.ts` | 25 |
| `cacheDocumentMetadata` | Function | `apps/backend/src/middleware/cache.ts` | 52 |
| `setCachedContent` | Function | `apps/backend/src/middleware/cache.ts` | 79 |
| `requireAuth` | Function | `apps/backend/src/middleware/auth.ts` | 20 |
| `requireRegistered` | Function | `apps/backend/src/middleware/auth.ts` | 43 |
| `requireOwner` | Function | `apps/backend/src/middleware/auth.ts` | 57 |
| `resolveDocument` | Function | `apps/backend/src/routes/disclosure.ts` | 31 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `DisclosureRoutes → GetUint8ArrayMemory0` | cross_community | 6 |
| `DisclosureRoutes → Delete` | cross_community | 5 |
| `HandleContentNegotiation → Delete` | cross_community | 5 |
| `DisclosureRoutes → GetDocumentCacheKey` | cross_community | 4 |
| `CacheDocumentContent → Delete` | cross_community | 4 |
| `CacheDocumentMetadata → Delete` | cross_community | 4 |
| `Main → GetDocumentCacheKey` | cross_community | 4 |
| `HandleContentNegotiation → GetDocumentCacheKey` | cross_community | 4 |
| `LifecycleRoutes → GetDocumentCacheKey` | cross_community | 3 |
| `Main → ShouldSkipCache` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Wasm | 6 calls |

## How to Explore

1. `gitnexus_context({name: "getDocumentWithContent"})` — see callers and callees
2. `gitnexus_query({query: "middleware"})` — find related execution flows
3. Read key files listed above for implementation details
