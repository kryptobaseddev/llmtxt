# Changelog

All notable changes to `llmtxt-core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `lifecycle` module — `DocumentState` enum, `is_valid_transition()`, `is_editable()`, `is_terminal()`, `validate_transition()` with string and enum variants for WASM and native callers
- `consensus` module — `evaluate_approvals()`, `mark_stale_reviews()` with JSON I/O for WASM and native struct-based APIs
- `diff_versions()` — reconstruct two versions and compute a diff between them in a single call
- `compute_sections_modified()` — detect which markdown sections changed between two document versions
- Cross-language test vectors (`tests/vectors/`) for lifecycle, consensus, and patch/diff operations

## [2026.4.0] - 2026-03-27

### Added
- `reconstruct_version` -- apply a sequence of patches to base content in a single Rust call, avoiding N WASM boundary crossings
- `squash_patches` -- apply all patches then produce a single unified diff from base to final state

## [2026.3.1] - 2026-03-27

### Fixed
- `verify_signed_url` now treats `exp=0` as "never expires" instead of immediately expired, consistent with `is_expired()` behavior

## [2026.3.0] - 2026-03-26

### Added
- `generate_signed_url` / `verify_signed_url` — native Rust helpers for path-prefixed attachment URLs and variable signature lengths
- `create_patch` / `apply_patch` — unified diff creation and application primitives for attachment versioning workflows
- `SignedUrlBuildRequest` — structured input for native Rust URL generation

### Changed
- **versioning**: adopt unified ecosystem CalVer across the Rust crate, WASM artifacts, and TypeScript consumers using a Cargo-safe `YYYY.M.PATCH` format
- switched attachment patching to `diffy` for typed parse failures and deterministic unified diff transport
- improved native signed URL verification so `/attachments/{slug}` paths and 32-character signatures verify cleanly

## Legacy [0.2.0] - 2026-03-24

### Added
- `text_similarity` — n-gram Jaccard similarity (native Rust, WASM-exported)
- `text_similarity_ngram` — configurable gram size for similarity
- `compute_org_signature` / `compute_org_signature_with_length` — org-scoped HMAC-SHA256 signing
- Session snapshot compression support via existing `compress`/`decompress`
- `is_expired` — timestamp expiry check for signed URLs

### Changed
- Edition upgraded to 2024
- `compress`/`decompress` use RFC 1950 zlib-wrapped deflate for Node.js compatibility

### Fixed
- `is_expired` off-by-one on boundary timestamps (signaldock-core-agent review)
- WASM feature flag gating — native consumers no longer pull wasm-bindgen

[Unreleased]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.3.0...HEAD
[2026.3.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/llmtxt-core-v2026.3.0
[0.2.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/llmtxt-core-v0.2.0
