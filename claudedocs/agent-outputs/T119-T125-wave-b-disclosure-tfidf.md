# T119 + T125 — Wave B Implementation Report

## Summary

Both Wave B tasks complete. Disclosure module adopted (not rewritten), tfidf module created.
All regression guards pass.

## T119 — disclosure.ts port (audit #5, #11, partial #9)

### Pre-existing code assessment: adopted-fixed-2-issues

The `crates/llmtxt-core/src/disclosure/` directory existed as untracked with 7 files from a prior
crashed worker. Assessment:
- **Code quality**: Solid. Correct port of the TS algorithm. All major functions present.
- **Issue 1**: Two tests had wrong content (only 1 markdown signal instead of required 2). Fixed.
- **Issue 2**: Module not wired into lib.rs — wired in.
- **Issue 3 (ferrous-forge)**: mod.rs was 597 lines, exceeding 200-line function limit. Refactored:
  - Extracted WASM bindings → `wasm_bindings.rs`
  - Extracted JSONPath helpers → `jsonpath.rs`
  - Extracted get_section → `section_extract.rs`
  - Extracted integration tests → `tests.rs`

### Modules delivered (9 total)

| File | Purpose |
|------|---------|
| `types.rs` | Section, DocumentOverview, SearchResult, LineRangeResult, JsonKey, TocEntry |
| `markdown.rs` | parse_markdown_sections, extract_markdown_toc |
| `code.rs` | parse_code_sections |
| `json.rs` | parse_json_sections, extract_json_keys |
| `text.rs` | parse_text_sections |
| `search.rs` | search_content |
| `jsonpath.rs` | resolve_path, parse_path_segments |
| `section_extract.rs` | get_section |
| `wasm_bindings.rs` | 6 WASM entry points |
| `tests.rs` | Integration tests (separate from unit tests in each submodule) |
| `mod.rs` | Public API: detect_document_format, get_line_range, generate_overview, query_json_path |

### TypeScript changes

- `packages/llmtxt/src/disclosure.ts`: Thinned from 729 LoC → ~100 LoC (types + re-exports)
- `packages/llmtxt/src/wasm.ts`: +190 LoC — WASM wrappers for 6 disclosure functions
- `packages/llmtxt/src/index.ts`: tfidf exports added
- `apps/backend/src/utils/sections.ts`: DELETED (redundant, audit #5)

### Byte-identity vectors (3 per key function)

All 3 vectors per function pass against expected TS output:
- detectDocumentFormat: json/markdown/text
- getLineRange: basic/clamp edge cases
- queryJsonPath: nested path, array index, invalid JSON

## T125 — LocalEmbeddingProvider TF-IDF + FNV1a (audit #15)

### New module: `crates/llmtxt-core/src/tfidf.rs`

Implements identical algorithm to TS `LocalEmbeddingProvider`:
- `fnv1a_hash(s: &str) -> u64` — FNV-1a 32-bit, returns in u64
- `tfidf_embed(text: &str, dim: usize) -> Vec<f32>` — single-doc shortcut
- `tfidf_embed_batch(texts: &[String], dim: usize) -> Vec<Vec<f32>>` — batch with shared IDF
- WASM: `fnv1a_hash_wasm`, `tfidf_embed_wasm`, `tfidf_embed_batch_wasm`

### TypeScript changes

- `apps/backend/src/utils/embeddings.ts`:
  - `LocalEmbeddingProvider.embed()` now delegates to `tfidfEmbedBatch(texts, 256)`
  - Deleted: `tokenise`, `buildVocab`, `computeTf`, `fnv1aHash` helper functions (~70 LoC)
  - Import changed: `l2Normalize` → `tfidfEmbedBatch`
- `packages/llmtxt/src/wasm.ts`: fnv1aHash, tfidfEmbed, tfidfEmbedBatch exports
- `packages/llmtxt/src/index.ts`: tfidf exports added

### Byte-identity vectors (3x FNV1a)

Three independent verifications of `fnv1a_hash` against bit-exact re-computation:
- "document", "hello_world", "tfidf_embed" — all match

## Regression Guards

| Check | Result |
|-------|--------|
| cargo test --features wasm | 278 passed (was 224), 0 failed |
| cargo fmt | clean |
| ferrous-forge validate | PASS (after refactor to stay under 200-line limit) |
| pnpm build (packages/llmtxt) | clean |
| pnpm typecheck (packages/llmtxt) | clean |
| pnpm test (apps/backend) | 67/67 pass |
| pnpm lint (apps/backend) | 0 warnings |
| git status orphan files | none in crates/llmtxt-core/ |

## Commits

- `1ae405a` — feat(T111-wave-b): port disclosure module to llmtxt-core (T119, audit #5, #11, partial #9)
- `0a0a268` — feat(T111-wave-b): port LocalEmbeddingProvider TF-IDF+FNV to llmtxt-core (T125, audit #15)

## Lines deleted from TS / added to Rust

- TS deleted: ~850 LoC (disclosure.ts: -630, sections.ts: -80, embeddings.ts helpers: -70, wasm.ts import cleanup: -50)
- Rust added: ~1100 LoC (disclosure modules: ~750, tfidf: ~230, lib.rs wiring: ~20)
- Net: -850 TS, +1100 Rust

## Wave B status

After T119 + T125, Wave B is complete. Remaining: Wave C (simple exports), Wave D (hygiene).
