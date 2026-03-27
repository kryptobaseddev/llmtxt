# Changelog

All notable changes to `llmtxt` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.4.0] - 2026-03-27

### Added
- **sdk**: `llmtxt/sdk` subpath export with collaborative document primitives
- **lifecycle**: `DocumentState` enum (DRAFT, REVIEW, LOCKED, ARCHIVED) and pure state transition validator `isValidTransition()`
- **lifecycle**: `StateTransition` type with full transition metadata (who, when, why, at which version)
- **versioning**: `VersionEntry` type and `reconstructVersion()` for rebuilding any version from a patch stack
- **versioning**: `validatePatchApplies()` for pre-flight patch conflict detection
- **versioning**: `squashPatches()` to compose consecutive patches into one
- **attribution**: `ContributorSummary` and `VersionAttribution` types with `buildContributorSummary()` and `attributeVersion()` helpers
- **consensus**: `ApprovalStatus` enum, `Review`, `ApprovalPolicy` types, and `evaluateApprovals()` pure evaluation logic
- **storage**: `ContentRef` type abstracting inline blobs vs object-store references
- **retrieval**: `planRetrieval()` token-budget-aware section planning using disclosure primitives
- **exports**: tree-shakeable subpath exports for `llmtxt/disclosure`, `llmtxt/similarity`, `llmtxt/graph`

### Changed
- **package**: renamed from `@codluv/llmtxt` to `llmtxt` (unscoped, shorter imports)
- **structure**: renamed `packages/core/` to `packages/llmtxt/` to match npm package name
- **description**: updated to reflect SDK capabilities alongside primitives

## [2026.3.1] - 2026-03-27

### Fixed
- **signed-url**: `verify_signed_url` now treats `exp=0` as "never expires" instead of immediately expired, aligning with `is_expired()` behavior

## [2026.3.0] - 2026-03-26

### Added

- **patching**: `createPatch` and `applyPatch` unified-diff helpers backed by the Rust core for deterministic attachment versioning workflows
- **client**: `reshare`, `addVersion`, `addVersionFromContent`, and `createVersionPatch` helpers for attachment lifecycle and version submission
- **types**: `AttachmentSharingMode`, `AttachmentReshareOptions`, `AttachmentVersionOptions`, and `AttachmentVersionResult` support for consumers integrating attachment APIs

### Changed

- **versioning**: adopt unified ecosystem CalVer across the Rust crate, WASM artifacts, and TypeScript package consumers using a Cargo-safe `YYYY.M.PATCH` format
- **client**: keep `resign` as a backward-compatible alias while standardizing on `reshare`
- **signed-url**: support configurable path prefixes and signature lengths when generating URLs
- **signed-url**: verify URLs using the actual signature length and final path segment so `/attachments/{slug}` URLs verify correctly
- **build**: add `build:wasm`, `build:all`, and `validate` scripts for release-ready consumer artifacts

## Legacy [0.4.0] - 2026-03-23

### Added

- **compression**: deflate compress/decompress, base62 encoding/decoding, SHA-256 hashing, token estimation, compression ratio calculation
- **schemas**: Zod validation schemas for JSON/text/markdown formats, `prompt-v1` predefined schema, schema registry with type exports
- **validation**: format auto-detection, content validation against schemas, `autoValidate` convenience function
- **disclosure**: progressive disclosure utilities -- document overview generation, section extraction, line-range access, content search (string + regex), JSONPath queries, TOC generation
- **cache**: generic LRU cache with configurable TTL, max size, and hit/miss statistics
- **signed-url**: HMAC-SHA256 signed URL generation and verification -- conversation-scoped, time-limited, with timing-safe comparison

[Unreleased]: https://github.com/kryptobaseddev/llmtxt/compare/core-v2026.4.0...HEAD
[2026.4.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v2026.4.0
[2026.3.1]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v2026.3.1
[2026.3.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v2026.3.0
[0.4.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v0.4.0
