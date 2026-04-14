---
name: sdk
description: "Skill for the Sdk area of llmtxt. 58 symbols across 15 files."
---

# Sdk

58 symbols | 15 files | Cohesion: 67%

## When to Use

- Working with code in `packages/`
- Understanding how rankBySimilarity, detectDocumentFormat, generateOverview work
- Modifying sdk-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/llmtxt/src/sdk/document.ts` | getContent, overview, getAttributions, getContributors, planRetrieval (+11) |
| `packages/llmtxt/src/sdk/storage-adapter.ts` | getContent, putContent, addVersion, getVersions, getReviews (+4) |
| `packages/llmtxt/src/similarity.ts` | rankBySimilarity, extractNgrams, extractWordShingles, jaccardSimilarity, textSimilarity (+3) |
| `packages/llmtxt/src/disclosure.ts` | detectDocumentFormat, generateOverview, extractJsonKeys, getJsonType, extractMarkdownToc (+1) |
| `packages/llmtxt/src/wasm.ts` | hashContent, applyPatch, squashPatchesWasm, computeDiff |
| `packages/llmtxt/src/sdk/versions.ts` | validatePatchApplies, squashPatches, reconstructVersion, diffVersions |
| `packages/llmtxt/src/sdk/lifecycle.ts` | isEditable, validateTransition |
| `packages/llmtxt/wasm/llmtxt_core.js` | __wrap, compute_diff |
| `packages/llmtxt/src/sdk/attribution.ts` | attributeVersion |
| `apps/backend/src/routes/similarity.ts` | similarityRoutes |

## Entry Points

Start here when exploring this area:

- **`rankBySimilarity`** (Function) — `packages/llmtxt/src/similarity.ts:119`
- **`detectDocumentFormat`** (Function) — `packages/llmtxt/src/disclosure.ts:218`
- **`generateOverview`** (Function) — `packages/llmtxt/src/disclosure.ts:274`
- **`attributeVersion`** (Function) — `packages/llmtxt/src/sdk/attribution.ts:65`
- **`similarityRoutes`** (Function) — `apps/backend/src/routes/similarity.ts:12`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `rankBySimilarity` | Function | `packages/llmtxt/src/similarity.ts` | 119 |
| `detectDocumentFormat` | Function | `packages/llmtxt/src/disclosure.ts` | 218 |
| `generateOverview` | Function | `packages/llmtxt/src/disclosure.ts` | 274 |
| `attributeVersion` | Function | `packages/llmtxt/src/sdk/attribution.ts` | 65 |
| `similarityRoutes` | Function | `apps/backend/src/routes/similarity.ts` | 12 |
| `hashContent` | Function | `packages/llmtxt/src/wasm.ts` | 39 |
| `applyPatch` | Function | `packages/llmtxt/src/wasm.ts` | 115 |
| `squashPatchesWasm` | Function | `packages/llmtxt/src/wasm.ts` | 123 |
| `validatePatchApplies` | Function | `packages/llmtxt/src/sdk/versions.ts` | 107 |
| `squashPatches` | Function | `packages/llmtxt/src/sdk/versions.ts` | 137 |
| `isEditable` | Function | `packages/llmtxt/src/sdk/lifecycle.ts` | 110 |
| `markStaleReviews` | Function | `packages/llmtxt/src/sdk/consensus.ts` | 178 |
| `patchRoutes` | Function | `apps/backend/src/routes/patches.ts` | 15 |
| `load` | Function | `apps/frontend/src/routes/doc/[slug]/+page.ts` | 5 |
| `extractNgrams` | Function | `packages/llmtxt/src/similarity.ts` | 14 |
| `extractWordShingles` | Function | `packages/llmtxt/src/similarity.ts` | 27 |
| `jaccardSimilarity` | Function | `packages/llmtxt/src/similarity.ts` | 42 |
| `textSimilarity` | Function | `packages/llmtxt/src/similarity.ts` | 61 |
| `contentSimilarity` | Function | `packages/llmtxt/src/similarity.ts` | 69 |
| `minHashFingerprint` | Function | `packages/llmtxt/src/similarity.ts` | 82 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Diff → GetUint8ArrayMemory0` | cross_community | 8 |
| `Squash → Delete` | cross_community | 8 |
| `Section → GetUint8ArrayMemory0` | cross_community | 8 |
| `PatchRoutes → Delete` | cross_community | 7 |
| `SimilarityRoutes → GetUint8ArrayMemory0` | cross_community | 7 |
| `RetrievalRoutes → GetUint8ArrayMemory0` | cross_community | 7 |
| `RetrievalRoutes → Delete` | cross_community | 7 |
| `Squash → GetUint8ArrayMemory0` | cross_community | 7 |
| `Overview → GetUint8ArrayMemory0` | cross_community | 7 |
| `PlanRetrieval → GetUint8ArrayMemory0` | cross_community | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Wasm | 18 calls |
| Routes | 2 calls |

## How to Explore

1. `gitnexus_context({name: "rankBySimilarity"})` — see callers and callees
2. `gitnexus_query({query: "sdk"})` — find related execution flows
3. Read key files listed above for implementation details
