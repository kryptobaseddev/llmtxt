# T111 Wave B-2: validation, graph, similarity ports

**Tasks**: T123, T122, T121
**Commit**: a70aa93
**Date**: 2026-04-15

## Summary

Three medium ports completing the T111 Wave B-2 batch. All three Rust modules
(validation.rs, graph.rs, similarity.rs) existed in the repo as untracked files
from a prior session but were not wired into lib.rs and the TS wrappers were not
thinned. This session completed the wiring, thinning, and verification.

## T123 — validation (audit #14)

**Rust module**: `crates/llmtxt-core/src/validation.rs` (new, 264 lines)
- `detect_format` — canonical name per audit #14 (disclosure.rs keeps
  `detectDocumentFormat` as its separate variant with code detection)
- `contains_binary_content` — scans first 8KB for 0x00-0x08 control chars
- `find_overlong_line` — returns 1-based line number of first overlong line (0 = none)
- Constants: `DEFAULT_MAX_CONTENT_BYTES`, `DEFAULT_MAX_LINE_BYTES`
- 14 tests including 3 byte-identity vectors

**TS wrapper**: `packages/llmtxt/src/validation.ts`
- `detectFormat` delegates to `detectFormatWasm` (WASM-backed)
- `validateContent` binary check delegates to `containsBinaryContentWasm`
- `validateContent` line check delegates to `findOverlongLineWasm`
- Zod validators (validateJson, validateText, validateContent, autoValidate)
  remain TS — documented exception (Zod cannot run in Rust)

**Judgment call**: `validateContent` itself is NOT ported to Rust because it
orchestrates Zod-dependent validators. Only the pure-computation helpers were ported.

## T122 — graph (audit #13)

**Rust module**: `crates/llmtxt-core/src/graph.rs` (new, 582 lines)
- `extract_mentions`, `extract_tags`, `extract_directives`
- `build_graph_native`, `top_topics_native`, `top_agents_native`
- WASM entry points: `extract_mentions_wasm`, `extract_tags_wasm`,
  `extract_directives_wasm`, `build_graph_wasm`, `top_topics_wasm`, `top_agents_wasm`
- 20 tests including 3 byte-identity vectors

**TS wrapper**: `packages/llmtxt/src/graph.ts`
- Pure re-export from `wasm.ts` — zero algorithm code
- `apps/backend/src/routes/graph.ts` unchanged — imports from `'llmtxt/graph'` still works

## T121 — similarity (audit #8, #12)

**Rust module**: `crates/llmtxt-core/src/similarity.rs` (new, 449 lines)
- `extract_ngrams`, `extract_word_shingles`
- `jaccard_similarity`, `text_similarity_jaccard`, `content_similarity`
- `simple_hash` (FNV-1a variant matching TS exactly)
- `min_hash_fingerprint`, `fingerprint_similarity`
- `rank_by_similarity`
- WASM entry points for all above
- 21 tests including 3 byte-identity vectors

**Judgment call**: `cosine_similarity` already exists in `semantic.rs` (Wave A, T116).
Not duplicated. similarity.rs documents this explicitly.

**lib.rs change**: The inline `text_similarity` and `text_similarity_ngram` functions
in lib.rs (WASM shims from before this module existed) now delegate to
`similarity::text_similarity_jaccard` instead of re-implementing. Existing WASM
callers (`wasmTextSimilarity`, `wasmTextSimilarityNgram` in wasm.ts) are unaffected.

**TS wrapper**: `packages/llmtxt/src/similarity.ts`
- Pure re-export from `wasm.ts` — zero algorithm code
- `textSimilarity` aliased to `jaccardSimilarity` for backward compat
- `apps/backend/src/routes/similarity.ts` unchanged — `rankBySimilarity` still works

## wasm.ts additions (277 lines)

New sections appended alphabetically:
- `containsBinaryContent`, `detectFormat`, `findOverlongLine` (validation)
- `buildGraph`, `extractDirectives`, `extractMentions`, `extractTags`,
  `topAgents`, `topTopics` (graph) + GraphNode/GraphEdge/KnowledgeGraph/MessageInput types
- `contentSimilarity`, `extractNgrams`, `extractWordShingles`, `fingerprintSimilarity`,
  `jaccardSimilarity`, `minHashFingerprint`, `rankBySimilarity` (similarity)
  + `SimilarityRankResult` type

## wasm/llmtxt_core.d.ts additions (94 lines)

Type declarations added for all new WASM exports. The WASM binary already
included these functions from a prior compiled-but-unwired session.

## index.ts changes

- Removed `detectFormat` from validation.js export (now from wasm.js to avoid dup)
- Added `SimilarityRankResult`, `GraphStats` exports
- Renamed export blocks to document WASM-backing

## Test counts

| Module | Before | After | Delta |
|--------|--------|-------|-------|
| cargo lib tests | 174 | 231 | +57 |
| validation:: | 0 | 14 | +14 |
| graph:: | 0 | 20 | +20 |
| similarity:: | 0 | 21 | +21 |
| doctests | 3+2 | 3+2+2 | +2 |
| backend | 67 | 67 | 0 |

## Lines

| File | Action | Lines |
|------|--------|-------|
| crates/llmtxt-core/src/validation.rs | created | +264 |
| crates/llmtxt-core/src/graph.rs | created | +582 |
| crates/llmtxt-core/src/similarity.rs | created | +449 |
| crates/llmtxt-core/src/lib.rs | wired + refactored | +50/-30 |
| packages/llmtxt/src/validation.ts | thinned | -120 |
| packages/llmtxt/src/graph.ts | thinned | -183 |
| packages/llmtxt/src/similarity.ts | thinned | -135 |
| packages/llmtxt/src/wasm.ts | new exports | +277 |
| packages/llmtxt/src/index.ts | updated exports | +15/-5 |
| packages/llmtxt/wasm/llmtxt_core.d.ts | type decls | +94 |
