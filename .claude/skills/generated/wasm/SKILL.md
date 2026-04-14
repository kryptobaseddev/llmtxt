---
name: wasm
description: "Skill for the Wasm area of llmtxt. 88 symbols across 13 files."
---

# Wasm

88 symbols | 13 files | Cohesion: 81%

## When to Use

- Working with code in `packages/`
- Understanding how encodeBase62, decodeBase62, computeSignature work
- Modifying wasm-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `packages/llmtxt/wasm/llmtxt_core.js` | apply_patch, batch_diff_versions, compress, compute_org_signature, compute_org_signature_with_length (+36) |
| `packages/llmtxt/src/wasm.ts` | encodeBase62, decodeBase62, computeSignature, computeSignatureWithLength, computeOrgSignature (+8) |
| `packages/llmtxt/src/disclosure.ts` | getLineRange, searchContent, queryJsonPath, getSection, parseJsonSections (+6) |
| `packages/llmtxt/src/graph.ts` | extractMentions, extractTags, extractDirectives, buildGraph, getOrCreateNode (+3) |
| `packages/llmtxt/src/cache.ts` | get, set, delete, has |
| `packages/llmtxt/src/signed-url.ts` | computeSignatureWithLength, generateSignedUrl, generateTimedUrl |
| `crates/llmtxt-core/src/lib.rs` | text_similarity, text_similarity_ngram |
| `packages/llmtxt/src/sdk/consensus.ts` | evaluateApprovals |
| `packages/llmtxt/src/sdk/attribution.ts` | buildContributorSummary |
| `apps/backend/src/routes/graph.ts` | graphRoutes |

## Entry Points

Start here when exploring this area:

- **`encodeBase62`** (Function) — `packages/llmtxt/src/wasm.ts:23`
- **`decodeBase62`** (Function) — `packages/llmtxt/src/wasm.ts:27`
- **`computeSignature`** (Function) — `packages/llmtxt/src/wasm.ts:60`
- **`computeSignatureWithLength`** (Function) — `packages/llmtxt/src/wasm.ts:70`
- **`computeOrgSignature`** (Function) — `packages/llmtxt/src/wasm.ts:81`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `encodeBase62` | Function | `packages/llmtxt/src/wasm.ts` | 23 |
| `decodeBase62` | Function | `packages/llmtxt/src/wasm.ts` | 27 |
| `computeSignature` | Function | `packages/llmtxt/src/wasm.ts` | 60 |
| `computeSignatureWithLength` | Function | `packages/llmtxt/src/wasm.ts` | 70 |
| `computeOrgSignature` | Function | `packages/llmtxt/src/wasm.ts` | 81 |
| `computeOrgSignatureWithLength` | Function | `packages/llmtxt/src/wasm.ts` | 92 |
| `deriveSigningKey` | Function | `packages/llmtxt/src/wasm.ts` | 104 |
| `reconstructVersion` | Function | `packages/llmtxt/src/wasm.ts` | 119 |
| `wasmTextSimilarity` | Function | `packages/llmtxt/src/wasm.ts` | 129 |
| `wasmTextSimilarityNgram` | Function | `packages/llmtxt/src/wasm.ts` | 133 |
| `extractMentions` | Function | `packages/llmtxt/src/graph.ts` | 56 |
| `extractTags` | Function | `packages/llmtxt/src/graph.ts` | 64 |
| `extractDirectives` | Function | `packages/llmtxt/src/graph.ts` | 72 |
| `buildGraph` | Function | `packages/llmtxt/src/graph.ts` | 85 |
| `getOrCreateNode` | Function | `packages/llmtxt/src/graph.ts` | 89 |
| `addEdge` | Function | `packages/llmtxt/src/graph.ts` | 100 |
| `topTopics` | Function | `packages/llmtxt/src/graph.ts` | 159 |
| `topAgents` | Function | `packages/llmtxt/src/graph.ts` | 180 |
| `text_similarity` | Function | `crates/llmtxt-core/src/lib.rs` | 315 |
| `text_similarity_ngram` | Function | `crates/llmtxt-core/src/lib.rs` | 321 |

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
| Sdk | 3 calls |
| Middleware | 2 calls |
| Cluster_14 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "encodeBase62"})` — see callers and callees
2. `gitnexus_query({query: "wasm"})` — find related execution flows
3. Read key files listed above for implementation details
