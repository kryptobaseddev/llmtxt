# Changelog

All notable changes to `llmtxt` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.4.3] - 2026-04-13

### Added
- **multi-diff**: `multiWayDiff()` — LCS-aligned N-way comparison across up to 5 versions with per-line consensus, divergence, and insertion detection. WASM-backed via `multi_way_diff_wasm`
- **merge**: `cherryPickMerge()` — section-based cherry-pick merge from multiple versions. Heading-keyed claims, fill-from for unclaimed sections, provenance tracking. WASM-backed via `cherry_pick_merge_wasm`
- **types**: `MultiDiffResult`, `MultiDiffLine`, `MultiDiffVariant`, `MultiDiffStats`, `CherryPickResult`, `CherryPickProvenance`, `CherryPickStats` interfaces
- **types**: `"insertion"` line type added to `MultiDiffLine.type` union
- **backend**: `GET /documents/:slug/multi-diff?versions=2,3,4,5` — multi-version comparison endpoint
- **backend**: `POST /documents/:slug/merge` — cherry-pick merge endpoint with provenance in changelog
- **backend**: `agentId` alias accepted on PUT and POST /compress (maps to `createdBy`)
- **backend**: `targetState` alias accepted on POST /transition (maps to `state`)
- **backend**: HTTP 423 Locked response on PUT/merge/patch for LOCKED and ARCHIVED documents
- **backend**: `requireOwnerAllowAnon` middleware — anonymous doc owners can create signed URLs and transition state
- **backend**: Concurrent version creation wrapped in `BEGIN IMMEDIATE` transactions with retry on UNIQUE violation
- **backend**: Duplicate approval/rejection prevention (409 Conflict on second attempt from same reviewer)
- **backend**: Rejections cleared on REVIEW to DRAFT transition for fresh review cycles
- **backend**: autoLock race protection with atomic `WHERE state=REVIEW` check
- **frontend**: `MultiDiffViewer` component — version selector, consensus visualization, expandable divergent variants, insertion line rendering
- **frontend**: `MergeBuilder` component — cherry-pick merge UI with preview, provenance colors, inline validation
- **frontend**: Version selector dropdown on Content tab with "Version N of M" indicator
- **frontend**: Token stats clearly label original vs compressed counts
- **frontend**: Favicons, OG meta tags, Twitter cards, per-page dynamic OG tags
- **infra**: Cloudflare Configuration Rule bypassing bot detection for api.llmtxt.my

### Changed
- **backend**: Anonymous sessions can now use lifecycle transitions, approvals, rejections, patches, and signed URL creation
- **backend**: Merge provenance `fromVersion` uses actual DB version numbers instead of 0-based indices
- **backend**: Similarity results use `title` field instead of `sectionTitle` (consistent with overview/plan-retrieval)
- **frontend**: Renamed `state` variable to `docState` to avoid Svelte 5 `$state` rune collision (77 svelte-check errors resolved)

### Fixed
- Multi-diff false divergence when versions have line insertions/deletions (LCS alignment rewrite)
- Cherry-pick merge false "Overlapping line ranges" error on multi-version section merge
- Cherry-pick merge section duplication with hierarchical headings
- Concurrent version creation race condition (transaction + retry)
- HTTP 500 from async transaction callbacks in better-sqlite3 (switched to synchronous)
- Rejection permanently blocking consensus (now cleared on REVIEW to DRAFT)
- autoLock creating duplicate state transition records on simultaneous approvals
- LOCKED documents accepting write operations

## [2026.4.2] - 2026-04-01

### Added
- **diff**: `structuredDiff()` — WASM-backed structured line-level diff returning interleaved `{type, content, oldLine, newLine}` lines with summary counts. Replaces client-side patch parsing and backend set-based diff computation
- **types**: `StructuredDiffLine` and `StructuredDiffResult` interfaces exported from `llmtxt`

### Changed
- **diff**: Backend `/documents/:slug/diff` endpoint now returns `lines` array (structured diff) instead of `addedLines`/`removedLines` string arrays
- **diff**: Frontend `DiffViewer` consumes structured diff lines directly from API — no more client-side unified diff parsing
- **backend**: PUT `/documents/:slug` now upserts contributor records with accurate token stats via `structuredDiff()`
- **frontend**: `Contributor` type aligned to actual DB schema fields (`agentId`, `versionsAuthored`, `lastContribution`)
- **frontend**: Version list redesigned as compact table rows with columns for version, changelog, tokens, contributor, and date
- **frontend**: Side-by-side comparison view now highlights added/removed lines vs base version
- **frontend**: Edit page uses `invalidateAll()` before navigation to prevent stale data

## [2026.4.1] - 2026-03-31

### Added
- **consensus**: `ApprovalPolicy.requiredPercentage` — percentage-based consensus thresholds (e.g. 51% of reviewers). Overrides `requiredCount` when > 0. Threshold computed as `ceil(percentage * reviewerCount / 100)`

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
