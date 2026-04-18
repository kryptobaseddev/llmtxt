# Changelog

All notable changes to `llmtxt` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2026.4.7] — 2026-04-17

### Fixed
- **Bundler compatibility for `onnxruntime-node`**: dynamic import in `embeddings.ts` now uses a runtime-constructed specifier + `/* @vite-ignore */` + `/* webpackIgnore: true */` hints. esbuild, webpack, vite, and rollup no longer try to inline the `.node` native addon. Verified with esbuild 0.28 bundle of `llmtxt` + `llmtxt/embeddings` — exit 0, no `--external` flag needed for the onnxruntime path.

### Changed
- `better-sqlite3`, `drizzle-orm`, `postgres` moved from `optionalDependencies` to `peerDependencies` + `peerDependenciesMeta.optional: true`. pnpm no longer auto-installs them — consumers must opt in per topology. Matches treatment of `onnxruntime-node` and `@vlcn.io/crsqlite`.
- README adds install matrix + esbuild/webpack/vite externalize list.

## [2026.4.5] - 2026-04-16

This release ships the full Round 1+2+3 multi-agent foundation: CRDT/Yrs, signed Ed25519 identity, append-only event log, real-time presence/leases/diff-subscriptions (W1+W2), BFT consensus, agent scratchpad, A2A envelope routing (W3), a self-hosted observability stack (Grafana / Loki / Tempo / Prometheus / OTel collector / GlitchTip on Railway), OpenAPI schema generation with forge-ts integration, local semantic embeddings via pgvector + ONNX, four reference agents plus a `/demo` page, and a fully portable SDK offering `LocalBackend`, `RemoteBackend`, and `llmtxt` CLI — including a complete CLEO integration example. Also upgrades drizzle-orm/kit to `1.0.0-beta.21` and zod to `^4`.

### Added — Portable SDK / LocalBackend (T317)

**T332: RemoteBackend** (`llmtxt/remote`) — thin HTTP/WS client implementing the
full `Backend` interface. REST for CRUD, SSE for `subscribeStream`, WebSocket for
`subscribeSection`. Drop-in replacement for `LocalBackend` for remote deployments.

**T333: Backend contract test suite** — 25-test parameterised harness that
validates any `Backend` implementation against the full interface contract.
Covers documents, versions, lifecycle transitions, events, leases, scratchpad,
A2A, identity, and nonces.

**T334: Fastify LocalBackend plugin** (`apps/backend/src/plugins/local-backend-plugin.ts`)
— Fastify plugin that decorates the app with `fastify.localBackend`. New routes
can use the portable SDK without touching the existing Drizzle/Postgres layer.

**T335 + T336: `llmtxt` CLI binary** — `packages/llmtxt/src/cli/llmtxt.ts`
compiled to `dist/cli/llmtxt.js` and listed in `package.json bin`. Commands:
`init` (SQLite + Ed25519 keypair), `create-doc`, `push-version`, `pull`, `watch`,
`search`, `keys generate|list|revoke`, `sync`. Defaults to `LocalBackend`; use
`--remote <url>` for `RemoteBackend`.

**T337: `llmtxt sync`** — pulls remote events/documents not in local, pushes
local documents/events not in remote. State vector exchange for CRDT sections.

**T338: CLEO integration example** (`apps/examples/cleo-integration/index.ts`)
— runnable end-to-end example showing 4 patterns: task attachment docs, BFT
decision records, A2A coordination, real-time presence.

**T339: Docs** (`apps/docs/content/docs/embed/cleo-pm.mdx`) — documentation
page covering all 4 CLEO + LLMtxt integration patterns with working snippets.

**T340: Subpath exports** — `llmtxt/local`, `llmtxt/remote`, `llmtxt/cli` added
to `package.json` exports map with `types` + `import` entries.

**Build**: `build` script now copies `src/local/migrations` into `dist/local/migrations`
so the CLI and embedded consumers find migrations at runtime.

### Fixed

- **Migration idempotency** (7df5795): W2 leases (`20260416021212_natural_shiva`) and W3 BFT/A2A inbox (`20260416030000_w3_bft_a2a_inbox`) Postgres migrations are now fully idempotent — all `CREATE TABLE` / `CREATE INDEX` / `ADD CONSTRAINT` statements use `IF NOT EXISTS` guards and a redundant `ALTER TABLE` that caused Railway crash-loops on retry is removed.

## [2026.4.4] - 2026-04-15

### Changed — SDK-First Refactor (T111)

All 22 violations from `docs/SSOT-AUDIT.md` resolved. `crates/llmtxt-core` is now the canonical Single Source of Truth (SSoT) for all portable primitives. `packages/llmtxt` is a thin WASM wrapper + TypeScript types. `apps/backend` imports only from the SDK — no more direct `node:crypto`, no more pure-TS re-implementations.

**Rust primitives added to `crates/llmtxt-core`** (WASM-exported via `packages/llmtxt`):
- `crypto::sign_webhook_payload` (HMAC-SHA256 for webhook signing) — replaces backend `createHmac`
- `normalize::l2_normalize` (L2 vector normalization) — replaces backend inline TS
- `slugify::slugify` — replaces backend inline TS
- `rbac` module (ROLE_PERMISSIONS matrix lookups) — replaces backend matrix + types
- `validation` module (`detect_format`, `contains_binary_content`, `find_overlong_line`) — replaces pure-TS re-implementations
- `graph` module (mentions, tags, directives, graph build + top rankings) — replaces pure-TS `graph.ts`
- `similarity` module (n-grams, jaccard, text/content similarity, min-hash, rank_by_similarity) — replaces pure-TS `similarity.ts`
- `disclosure` module with submodules (markdown/code/json/text parsers, search, jsonpath, generateOverview) — replaces pure-TS `disclosure.ts` (729 LoC → ~100 LoC wrapper)
- `tfidf` module (FNV1a hashing + TF-IDF batch embed) — replaces backend `LocalEmbeddingProvider`

**TypeScript types/constants now exported from `packages/llmtxt`**:
- `DocumentEventType`, `DocumentEvent`, `AuditAction`
- `Permission`, `DocumentRole`, `OrgRole`, `ROLE_PERMISSIONS`
- `CONTENT_LIMITS`, `API_VERSION_REGISTRY`, `CURRENT_API_VERSION`, `LATEST_API_VERSION`, `ApiVersionInfo`
- `VALID_LINK_TYPES`
- `COLLECTION_EXPORT_SEPARATOR`, `API_KEY_PREFIX`, `API_KEY_LENGTH`, `API_KEY_DISPLAY_LENGTH`
- `STATE_CHANGING_METHODS` (deduplicated from audit + csrf middleware)

### Deferred
T112 (NAPI-RS native bindings) deferred 2026-04-15 pending production benchmark evidence. WASM is the sole Rust→JS binding for `llmtxt` until benchmarks justify native.

### Testing
- Cargo tests: 122 → 278 (+156 new Rust tests for migrated primitives)
- Backend tests: 67/67 throughout — zero regression
- Byte-identity tests: every migrated primitive verified Rust output == previous TypeScript output for ≥3 vectors

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

[Unreleased]: https://github.com/kryptobaseddev/llmtxt/compare/core-v2026.4.5...HEAD
[2026.4.5]: https://github.com/kryptobaseddev/llmtxt/compare/core-v2026.4.4...core-v2026.4.5
[2026.4.4]: https://github.com/kryptobaseddev/llmtxt/compare/core-v2026.4.3...core-v2026.4.4
[2026.4.3]: https://github.com/kryptobaseddev/llmtxt/compare/core-v2026.4.2...core-v2026.4.3
[2026.4.2]: https://github.com/kryptobaseddev/llmtxt/compare/core-v2026.4.1...core-v2026.4.2
[2026.4.1]: https://github.com/kryptobaseddev/llmtxt/compare/core-v2026.4.0...core-v2026.4.1
[2026.4.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v2026.4.0
[2026.3.1]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v2026.3.1
[2026.3.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v2026.3.0
[0.4.0]: https://github.com/kryptobaseddev/llmtxt/releases/tag/core-v0.4.0
