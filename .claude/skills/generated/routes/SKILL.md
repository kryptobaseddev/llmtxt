---
name: routes
description: "Skill for the Routes area of llmtxt. 30 symbols across 11 files."
---

# Routes

30 symbols | 11 files | Cohesion: 61%

## When to Use

- Working with code in `apps/`
- Understanding how apiRoutes, setCachedMetadata, invalidateAllCache work
- Modifying routes-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `apps/backend/src/routes/api.ts` | formatValidationErrors, getOptionalUser, apiRoutes, getSchemaDescription |
| `apps/backend/src/middleware/cache.ts` | setCachedMetadata, invalidateAllCache, getCacheStats, invalidateDocumentCache |
| `apps/backend/src/routes/viewTemplate.ts` | renderViewHtml, formatBytes, escapeHtml, renderMarkdown |
| `packages/llmtxt/src/cache.ts` | clear, size, getStats |
| `packages/llmtxt/src/wasm.ts` | calculateCompressionRatio, createPatch, structuredDiff |
| `apps/backend/src/routes/web.ts` | handleContentNegotiation, extractSlugWithExtension, extractSlug |
| `apps/backend/src/routes/lifecycle.ts` | buildPolicy, toSdkReviews, lifecycleRoutes |
| `apps/backend/src/routes/versions.ts` | getOptionalUser, versionRoutes |
| `apps/backend/src/index.ts` | isApiHost, main |
| `packages/llmtxt/wasm/llmtxt_core.js` | calculate_compression_ratio |

## Entry Points

Start here when exploring this area:

- **`apiRoutes`** (Function) — `apps/backend/src/routes/api.ts:79`
- **`setCachedMetadata`** (Function) — `apps/backend/src/middleware/cache.ts:87`
- **`invalidateAllCache`** (Function) — `apps/backend/src/middleware/cache.ts:103`
- **`getCacheStats`** (Function) — `apps/backend/src/middleware/cache.ts:111`
- **`calculateCompressionRatio`** (Function) — `packages/llmtxt/src/wasm.ts:51`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `apiRoutes` | Function | `apps/backend/src/routes/api.ts` | 79 |
| `setCachedMetadata` | Function | `apps/backend/src/middleware/cache.ts` | 87 |
| `invalidateAllCache` | Function | `apps/backend/src/middleware/cache.ts` | 103 |
| `getCacheStats` | Function | `apps/backend/src/middleware/cache.ts` | 111 |
| `calculateCompressionRatio` | Function | `packages/llmtxt/src/wasm.ts` | 51 |
| `createPatch` | Function | `packages/llmtxt/src/wasm.ts` | 111 |
| `structuredDiff` | Function | `packages/llmtxt/src/wasm.ts` | 184 |
| `computeReversePatch` | Function | `packages/llmtxt/src/sdk/versions.ts` | 165 |
| `versionRoutes` | Function | `apps/backend/src/routes/versions.ts` | 58 |
| `handleContentNegotiation` | Function | `apps/backend/src/routes/web.ts` | 77 |
| `extractSlugWithExtension` | Function | `apps/backend/src/routes/web.ts` | 130 |
| `extractSlug` | Function | `apps/backend/src/routes/web.ts` | 157 |
| `renderViewHtml` | Function | `apps/backend/src/routes/viewTemplate.ts` | 1 |
| `lifecycleRoutes` | Function | `apps/backend/src/routes/lifecycle.ts` | 51 |
| `invalidateDocumentCache` | Function | `apps/backend/src/middleware/cache.ts` | 95 |
| `clear` | Method | `packages/llmtxt/src/cache.ts` | 171 |
| `size` | Method | `packages/llmtxt/src/cache.ts` | 185 |
| `getStats` | Method | `packages/llmtxt/src/cache.ts` | 224 |
| `formatValidationErrors` | Function | `apps/backend/src/routes/api.ts` | 53 |
| `getOptionalUser` | Function | `apps/backend/src/routes/api.ts` | 65 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `VersionRoutes → GetUint8ArrayMemory0` | cross_community | 6 |
| `LifecycleRoutes → GetUint8ArrayMemory0` | cross_community | 6 |
| `CreateVersion → GetUint8ArrayMemory0` | cross_community | 6 |
| `Main → Delete` | cross_community | 6 |
| `HandleContentNegotiation → Delete` | cross_community | 5 |
| `ApiRoutes → FormatZodErrors` | cross_community | 4 |
| `ApiRoutes → IsPredefinedSchema` | cross_community | 4 |
| `ApiRoutes → GetPredefinedSchema` | cross_community | 4 |
| `Main → GetDocumentCacheKey` | cross_community | 4 |
| `HandleContentNegotiation → GetDocumentCacheKey` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Wasm | 14 calls |
| Middleware | 7 calls |
| Sdk | 3 calls |
| Cluster_9 | 3 calls |

## How to Explore

1. `gitnexus_context({name: "apiRoutes"})` — see callers and callees
2. `gitnexus_query({query: "routes"})` — find related execution flows
3. Read key files listed above for implementation details
