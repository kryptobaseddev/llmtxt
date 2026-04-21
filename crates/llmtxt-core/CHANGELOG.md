# Changelog

All notable changes to `llmtxt-core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.4.12] - 2026-04-21

### Fixed
- `detect_document_format`: heading-only markdown documents were misclassified as "text" because the 2-of-5 markdown signal threshold required more than one signal type. Add a short-circuit: any heading is strong evidence of markdown. Cascading fix for `generate_overview` which now correctly produces sections for heading-only docs. (T814/T815)

## [2026.4.11] - 2026-04-18

### Backfill note
Historical entry reconstructed for Ferrous Forge MISSINGCHANGELOGENTRY compliance. Full release notes were not authored at the time of the original 2026.4.11 release. For authoritative change detail, see the git commit range `core-v2026.4.10..core-v2026.4.11`. Principal changes (summarized from git log):
- zstd compress/decompress primitives (T752)
- Loro 1.0 API migration complete (T384/T385 series)
- Audit Merkle chain and RFC 3161 anchoring (T107/T164)
- RetentionPolicy DSL (T168.2)
- RLS context helper for postgres-js (T533)

Note: 2026.4.6 through 2026.4.10 also lack CHANGELOG entries; those backfills are tracked as separate technical-debt work.

## [2026.4.6] - 2026-04-17

### Added

- **Loro CRDT swap** (T384/T388/T389): `crdt` feature now backed by `loro 1.0` instead of `yrs`. Six CRDT primitives rewritten — `crdt_new_doc`, `crdt_apply_update`, `crdt_encode_state_vector`, `crdt_merge`, `crdt_encode_update_v1`, `crdt_as_bytes`. Wire framing opcodes `0x01`–`0x04` replace the `y-sync` protocol. `yrs` removed from all dependency trees.
- **`canonical_frontmatter`** (T435): deterministic YAML-ish frontmatter serialiser, WASM-exported.
- **`hash_blob`** (T453): SHA-256 content-addressable blob hash helper, WASM-exported.
- **`blob_name_validate`** (T453): blob name validation (max length, allowed chars), WASM-exported.

### Changed

- `Cargo.toml` `version` bumped to `2026.4.6`.
- `loro` replaces `yrs` as the optional CRDT dependency under the `crdt` feature flag. Binary encoding is **not** backward-compatible with Yrs — clean break only (see T393 DB migration).

### Fixed

- `crdt` feature compile guard corrected so `wasm32` target builds with `--features wasm` remain clean (no `loro` pull unless `crdt` explicitly enabled).

## [2026.4.5] - 2026-04-16

### Added — W1+W2+W3 Multi-Agent Primitives

- **`crdt` module** (T189+T191): Yrs-backed CRDT document primitives — `YDoc` wrapper, awareness/state-vector exchange, update encoding/decoding, WASM-exported helpers. Enabled via `crdt` feature flag.
- **`identity` module** (T217): Ed25519 keypair generation, document signing, signature verification, DID-lite identity serialisation. WASM-exported `sign_document` / `verify_document_signature`.
- **`bft` module**: Byzantine-fault-tolerant consensus primitives — `BftRound`, vote aggregation, threshold evaluation, equivocation detection. Pure Rust, WASM-exported.
- **`a2a` module**: A2A envelope construction and routing primitives — signed payloads, envelope verification, nonce deduplication helpers.
- **`embeddings` primitives**: vocabulary building, ONNX-compatible embedding input preparation (companion to `packages/llmtxt`'s ONNX runtime provider).

### Changed

- `Cargo.toml` `version` bumped to `2026.4.5`
- `yrs` optional dependency enabled on `crdt` feature (does not affect default `wasm` build)
- All new modules gated correctly so WASM build with `--features wasm` remains clean (no `tokio` pull)

## [2026.4.4] - 2026-04-15

### Changed — SDK-First Refactor (T111)

All 22 violations from `docs/SSOT-AUDIT.md` resolved. This release consolidates all portable primitives into `crates/llmtxt-core` as the canonical Single Source of Truth (SSoT). Backward-compatible WASM exports via `packages/llmtxt`.

**Primitives migrated from TypeScript to Rust** (WASM-exported via `packages/llmtxt`):
- `crypto::sign_webhook_payload` — HMAC-SHA256 for webhook signing (replaces backend `createHmac`)
- `normalize::l2_normalize` — L2 vector normalization (replaces backend inline TS)
- `slugify::slugify` — URL slug generation (replaces backend inline TS)
- `rbac` module — `ROLE_PERMISSIONS` matrix lookups, permission validation
- `validation` module — `detect_format`, `contains_binary_content`, `find_overlong_line`
- `graph` module — mention/tag/directive extraction, graph building, ranked lookups
- `similarity` module — n-grams, Jaccard similarity, text/content comparison, min-hash
- `disclosure` module — markdown/code/json/text parsers, section search, JSONPath, overview generation
- `tfidf` module — FNV1a hashing, TF-IDF batch embedding

**Testing**: 122 → 278 cargo tests (+156 new). Byte-identity verification: every migrated primitive verified Rust output == original TypeScript for ≥3 test vectors. Zero regression in backend test suite (67/67).

## [2026.4.3] - 2026-04-13

### Added
- `multi_way_diff()` / `multi_way_diff_native()` — LCS-aligned N-way comparison across up to 5 versions with per-line consensus detection, divergence tracking, and insertion identification. Uses pairwise `structured_diff` alignment against base to handle line shifts from insertions/deletions
- `diff_multi` module — internal LCS alignment helpers for multi-way diff grid construction
- `cherry_pick_merge()` — section-based cherry-pick merge from multiple versions into a single output. Heading-keyed section claims with per-version coordinate spaces, fill-from for unclaimed sections, provenance tracking
- `cherry_pick` module — extracted from `patch.rs` into dedicated module with `find_section_line_range`, section assembly, and overlap detection
- New line type `"insertion"` in multi-diff results for lines only present in some versions
- 15+ new unit tests covering LCS alignment with insertions, multi-version section merge, duplicate section claims, parent-child heading hierarchy

### Changed
- Multi-way diff algorithm rewritten from positional comparison to LCS-based alignment — consensus percentages now reflect semantic agreement, not line positions
- Cherry-pick merge rewritten to use heading-keyed section claims instead of shared line-number keyspace — sections from different versions no longer cause false overlap errors
- Fill-from assembly emits only to next heading boundary, preventing section duplication with hierarchical headings

### Fixed
- Multi-diff false divergence when versions have insertions that shift subsequent lines
- Cherry-pick merge "Overlapping line ranges" error when merging sections from 3+ versions with different line counts
- Cherry-pick merge section duplication where fill-from appended entire base instead of replacing claimed sections

## [2026.4.2] - 2026-04-01

### Added
- `diff` module — extracted diff logic from `lib.rs` into dedicated `diff.rs` module for maintainability
- `structured_diff()` / `structured_diff_native()` — line-level LCS diff returning interleaved context/added/removed lines with old and new line numbers, summary counts, and token impact. Single source of truth for diff display across all consumers
- `StructuredDiffLine` and `StructuredDiffResult` structs with serde JSON serialization (camelCase keys for JS compatibility)
- 8 new tests covering identical, additions, removals, mixed changes, empty-to-content, content-to-empty, and JSON serialization

### Changed
- Refactored `build_lcs_table()` into a shared helper used by both `compute_diff()` and `structured_diff_native()`

## [2026.4.1] - 2026-03-31

### Added
- `lifecycle` module — `DocumentState` enum, `is_valid_transition()`, `is_editable()`, `is_terminal()`, `validate_transition()` with string and enum variants for WASM and native callers
- `consensus` module — `evaluate_approvals()`, `mark_stale_reviews()` with JSON I/O for WASM and native struct-based APIs
- `ApprovalPolicy.required_percentage` — percentage-based consensus thresholds (e.g. 51% of reviewers). Overrides `required_count` when > 0. Threshold computed as `ceil(percentage * reviewer_count / 100)`
- `diff_versions()` — reconstruct two versions and compute a diff between them in a single call (parses patch JSON once)
- `compute_sections_modified()` — detect which markdown sections changed between two document versions
- Cross-language test vectors (`tests/vectors/`) for lifecycle, consensus, and patch/diff operations
- Comprehensive integration tests: 10-version chain with arbitrary diffs, consensus threshold scenarios (51%, 20%, unanimous, rejection blocking, stale detection, timeout)

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

[Unreleased]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.12...HEAD
[2026.4.12]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.11...llmtxt-core-v2026.4.12
[2026.4.11]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.10...llmtxt-core-v2026.4.11
[2026.4.5]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.4...llmtxt-core-v2026.4.5
[2026.4.4]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.3...llmtxt-core-v2026.4.4
[2026.4.3]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.2...llmtxt-core-v2026.4.3
[2026.4.2]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.1...llmtxt-core-v2026.4.2
[2026.4.1]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.4.0...llmtxt-core-v2026.4.1
[2026.4.0]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.3.1...llmtxt-core-v2026.4.0
[2026.3.1]: https://github.com/kryptobaseddev/llmtxt/compare/llmtxt-core-v2026.3.0...llmtxt-core-v2026.3.1
[2026.3.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/llmtxt-core-v2026.3.0
[0.2.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/llmtxt-core-v0.2.0
