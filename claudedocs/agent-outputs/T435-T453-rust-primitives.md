# T435 + T453: Rust Primitives — canonical_frontmatter + hash_blob + blob_name_validate

**Date**: 2026-04-17
**Commit**: c6d4042fff0e9b1cb665ddcc248b13fe19341a7a
**Tasks**: T435 (T427.1), T453 (T428.2)
**Status**: COMPLETE

## Summary

Added two new modules to `crates/llmtxt-core` per SSoT D001:

### canonical.rs (T435 / T427.1)

- `FrontmatterMeta` struct (title, slug, version, state, contributors, content_hash, exported_at)
- `canonical_frontmatter(meta: &FrontmatterMeta) -> String`: produces byte-stable YAML frontmatter
  - Fixed key order per spec ARCH-T427 §4.1
  - Contributors sorted lexicographically inside the function
  - LF line endings only, single trailing newline, double-quoted YAML string values
  - Special characters (`"`, `\`) escaped in YAML double-quoted scalars
- `canonical_frontmatter_wasm(meta_json: &str) -> String`: WASM binding via `#[wasm_bindgen(js_name = "canonicalFrontmatter")]`
- 8 unit tests in `src/canonical.rs` + 7 integration fixtures in `tests/canonical_test.rs`

### blob.rs (T453 / T428.2)

- `BlobNameError` enum: Empty, TooLong, PathTraversal, ForwardSlash, Backslash, NullByte, LeadingWhitespace, TrailingWhitespace
- `hash_blob(bytes: &[u8]) -> String`: lowercase hex SHA-256 (64 chars) using `sha2` crate (already a dependency)
- `blob_name_validate(name: &str) -> Result<(), BlobNameError>`: enforces spec §3.2 rules
- WASM bindings: `#[wasm_bindgen(js_name = "hashBlob")]` and `#[wasm_bindgen(js_name = "blobNameValidate")]`
- 11 unit tests in `src/blob.rs` + 14 integration tests in `tests/blob_test.rs`

### lib.rs

- Registered `pub mod canonical` and `pub mod blob` with re-exports after the `crdt` module block

## Test Results

- **lib (unit)**: 326 passed, 0 failed
- **canonical_test (integration)**: 7 passed, 0 failed
- **blob_test (integration)**: 14 passed, 0 failed
- **cross_language_vectors**: 3 passed, 0 failed
- **multi_version_diff_test**: 2 passed, 0 failed
- **doc_tests**: 9 passed, 0 failed
- **Total**: 361 passed, 0 failed

## Known SHA-256 Vectors Verified

- `""` → `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- `"hello"` → `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824`
- `"abc"` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`
- `bytes[0..255]` → `40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880`

## QA

- `rustfmt --check` passes on all 4 new files
- `cargo clippy` reports 0 warnings on new modules
- `cargo build --release` exits 0
- ferrous-forge pre-existing Clippy failures in `crdt.rs` are Worker A scope (T388/T389)

## Files Created

- `/mnt/projects/llmtxt/crates/llmtxt-core/src/canonical.rs`
- `/mnt/projects/llmtxt/crates/llmtxt-core/src/blob.rs`
- `/mnt/projects/llmtxt/crates/llmtxt-core/tests/canonical_test.rs`
- `/mnt/projects/llmtxt/crates/llmtxt-core/tests/blob_test.rs`

## Files Modified

- `/mnt/projects/llmtxt/crates/llmtxt-core/src/lib.rs` (registered new modules)
