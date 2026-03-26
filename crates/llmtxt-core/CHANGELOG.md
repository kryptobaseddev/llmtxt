# Changelog

All notable changes to `llmtxt-core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-24

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

## [0.1.0] - 2026-03-22

### Added
- `compress` / `decompress` — RFC 1950 zlib compression
- `generate_id` — UUID to base62, 8 chars
- `hash_content` — SHA-256 content hashing
- `calculate_tokens` — ceil(len/4) token estimation
- `encode_base62` / `decode_base62` — base62 encoding
- `compute_signature` / `compute_signature_with_length` — HMAC-SHA256 signing
- `calculate_compression_ratio` — ratio helper
- `derive_signing_key` — HMAC-SHA256 key derivation with "llmtxt-signing" context
- WASM bindings via wasm-bindgen (feature-gated)
- Shared test vectors (`test-vectors.json`) between Rust and TypeScript
