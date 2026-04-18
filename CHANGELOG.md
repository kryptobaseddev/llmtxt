# Changelog

All notable changes to the LLMtxt ecosystem (npm `llmtxt`, Rust crate `llmtxt-core`, apps/backend, apps/frontend, apps/docs).

## [2026.4.9] — 2026-04-18

### Packages changed
- `llmtxt` (npm) — minor release: Shared Primitives Subpath Contract + Wave A–E features
- `llmtxt-core` (crates.io) — no change from 2026.4.6

### Summary

Full Wave A–E release shipping the Shared Primitives Subpath Contract (7 stable subpaths with CI guard + contract tests), demo harness 8/8, P0 security remediation (10 items), tamper-evident Merkle + RFC 3161 audit log, graceful shutdown, strict release runbook, OpenAPI 3.1, SLO/SLI burn-rate alerts, LLM-first content delivery, frontend DiffViewer rewrite, CSP/HSTS/COEP + XSS sanitization, webhook DLQ, PostgreSQL RLS on 21 tables, Ed25519 key rotation + KMS abstraction, anonymous mode threat model, GDPR export/retention/erasure, SOC 2 Type 1 readiness (sub-processor list, DPA, data residency), and monetization foundation (usage tracking, Stripe, Pro tier).

See `packages/llmtxt/CHANGELOG.md` for the full itemized list.

### Migration

**Shared Primitives Subpath Contract**: all 7 subpath exports (`llmtxt/sdk`, `llmtxt/crdt`, `llmtxt/blob`, `llmtxt/events`, `llmtxt/identity`, `llmtxt/transport`, `llmtxt/similarity`) are now stable. Existing imports continue to work unchanged. CLEO consumers should migrate monolithic root imports to the appropriate subpath — see `docs/cleo-migration-guide.md`.

**No database migrations required** for this release (all schema changes landed in v2026.4.6).

---

## [2026.4.8] — 2026-04-17 (npm SDK patch — fixes v2026.4.7 regression)

Only `llmtxt` (npm) is republished. `llmtxt-core` (crates.io) stays at 2026.4.6.

### Fixed
- **`import('llmtxt')` no longer triggers `better-sqlite3` / `drizzle-orm` / `postgres` resolution at load time**. v2026.4.7 moved those deps to optional peers but `packages/llmtxt/src/backend/factory.ts` kept top-level static imports of `LocalBackend` + `RemoteBackend`, whose module graph pulled `better-sqlite3` into the load-time resolution chain. Lightweight consumers (e.g. CLEO's `cleo docs generate`, which only calls `generateOverview`) hit `ERR_MODULE_NOT_FOUND: Cannot find package 'better-sqlite3'` and silently fell back.
- Factory now uses `import type { LocalBackend }` / `import type { RemoteBackend }` at the top of the file (zero-runtime type-only imports) and runs `await import('../local/index.js')` / `await import('../remote/index.js')` inside the matching `createBackend` branch. Module resolution is deferred until a consumer actually asks for `topology: 'standalone'`, `'hub-spoke'` persistent, or `'mesh'`.

### Verification
- `pnpm --filter llmtxt test` → 470/470 pass
- Lightweight consumer bundle (no `better-sqlite3` installed) successfully imports `generateOverview` and `createBackend` and instantiates an ephemeral `hub-spoke` `RemoteBackend`
- esbuild bundle test from v2026.4.7 still passes (no `onnxruntime-node` module resolution)
- Consumers wanting standalone mode still need `pnpm add better-sqlite3 drizzle-orm` per the install matrix in `packages/llmtxt/README.md`

## [2026.4.7] — 2026-04-17 (npm SDK patch)

Only `llmtxt` (npm) is republished. `llmtxt-core` (crates.io) stays at 2026.4.6 — no Rust changes.

### Fixed
- **Bundler compatibility**: `await import('onnxruntime-node')` calls in `packages/llmtxt/src/embeddings.ts` now use a runtime-constructed specifier (`['onnxruntime', 'node'].join('-')`) plus `/* @vite-ignore */` and `/* webpackIgnore: true */` hints. Previously esbuild, webpack, and vite chased the literal and tried to inline the `.node` native addon, which failed. Consumer bundles no longer need `--external onnxruntime-node` to succeed. Verified with esbuild 0.28 bundling — bundle contains no `onnxruntime-node` module resolution.

### Changed
- **Optional deps reclassified**: `better-sqlite3`, `drizzle-orm`, and `postgres` moved from `optionalDependencies` to `peerDependencies` with `peerDependenciesMeta.optional: true`. pnpm no longer auto-installs them for consumers that don't need LocalBackend / PostgresBackend. Matches how `onnxruntime-node` and `@vlcn.io/crsqlite` are already declared.
- `packages/llmtxt/README.md` adds an install matrix (which extras each topology needs) and an **esbuild / webpack / vite externalize list** for deep integrators.

### Migration
Consumers that previously relied on implicit drizzle-orm / better-sqlite3 / postgres installs MUST add them explicitly. Example for a hub-spoke deployment:

```bash
pnpm add llmtxt postgres drizzle-orm
```

## [2026.4.6] — 2026-04-17

### Added — Storage Evolution (T384/T385/T386/T426/T427/T428/T429)

- **T384 — Yrs → Loro CRDT swap**: `crates/llmtxt-core` `crdt` feature migrated from `yrs` to `loro` (`1.0`). Six CRDT functions rewritten: `crdt_new_doc`, `crdt_apply_update`, `crdt_encode_state_vector`, `crdt_merge`, `crdt_encode_update_v1`, `crdt_as_bytes`. Framing opcodes `0x01`–`0x04` replace `y-sync` wire protocol. WASM rebuild verified (6 Loro exports present). Yrs is no longer a dependency in any build target.
- **T385 — cr-sqlite CRR integration**: `@vlcn.io/crsqlite` optional peer dep added to `packages/llmtxt`. `LocalBackend` gains CRR-aware column strategy; `getChangesSince` / `applyChanges` implemented with Loro blob merge semantics. Schema migration adds CRR column tracking with graceful skip when native `.so` absent.
- **T386 — P2P mesh + Ed25519 mutual handshake**: `packages/llmtxt` `mesh` module — `MeshNode`, `MeshTransport` (HTTP + WebSocket), `MeshDiscovery` (mDNS/static peer list), `MeshSyncEngine`. Full Ed25519 mutual handshake on connect (`POST /mesh/handshake` phase 1 + 2). 5-peer convergence integration test passes. `llmtxt mesh start/stop/status/peers/sync` CLI commands added.
- **T426 — AgentSession**: `AgentSession` state machine with `open`, `contribute`, `close` lifecycle. `ContributionReceipt` with signed acknowledgement. Crash-recovery contract (50-worker swarm integration test). `llmtxt session start/stop` CLI commands.
- **T427 — Export / SSoT**: `exportDocument` and `exportAll` on `Backend` interface. Export formatters: Markdown, JSON, plain text, llmtxt envelope. `importDocument` with determinism test. `llmtxt export/import` CLI commands. HTTP `GET /documents/:id/export` route.
- **T428 — Blob attachments**: `blob_attachments` table (Drizzle migration). `Backend` gains `attachBlob`, `getBlob`, `listBlobs`, `detachBlob`, `fetchBlobByHash`. `PostgresBackend` S3/R2 + PG large-object adapter. HTTP blob routes (`POST /documents/:id/blobs`, `GET /blobs/:hash`) with hash-verify-on-read security. 5-agent hub-spoke blob integration test.
- **T429 — Hub-spoke topology**: `TopologyConfig` schema + validation + `TopologyError`. Hub-spoke wiring in mesh sync engine. Topology failure-mode tests (partition tolerance, reconnect, spoke isolation).
- **canonical_frontmatter**, **hash_blob**, **blob_name_validate** primitives added to `crates/llmtxt-core` with WASM bindings (T435, T453).
- Docs pages for all Storage Evolution epics added to `apps/docs` (T411, T425, T448, T455, T456, T466).
- CRDT docs refreshed for Loro migration; Y.js references removed (T398).

### Changed

- **Column rename**: `yrs_state` → `crdt_state` in Postgres schema (migration `T393`). Byte-identity verified — Loro encoding round-trips correctly.
- **Loro wire framing**: WS `subscribeSection()` and `getSectionText()` updated for Loro framing opcodes (`0x01`–`0x04`); replaces `y-sync` protocol in SDK.
- `packages/llmtxt/crdt-primitives` subpath export updated to expose Loro-backed helpers.

### Fixed

- **AgentIdentity CLI factory usage**: `AgentIdentity.generate()` call corrected to static factory in all test mocks.
- **CRR test graceful skip**: `LocalBackend` cr-sqlite extension load now emits a warning and continues when the native `.so` is absent rather than throwing.

### Security

- Ed25519 mutual handshake is **mandatory** for all P2P mesh peers — unauthenticated connections rejected at `POST /mesh/handshake`.
- Blob hash-verify-on-read enforced on `GET /blobs/:hash` — mismatched content returns `409 Conflict`.

## [2026.4.5] — 2026-04-16

This release ships the full Round 1+2+3 multi-agent foundation: CRDT/Yrs, signed Ed25519 identity, append-only event log, real-time presence/leases/diff-subscriptions (W1+W2), BFT consensus, agent scratchpad, A2A envelope routing (W3), a self-hosted observability stack (Grafana / Loki / Tempo / Prometheus / OTel collector / GlitchTip on Railway), OpenAPI schema generation with forge-ts integration, local semantic embeddings via pgvector + ONNX, four reference agents plus a `/demo` page, and a fully portable SDK offering `LocalBackend`, `RemoteBackend`, and `llmtxt` CLI — including a complete CLEO integration example. Also upgrades drizzle-orm/kit to `1.0.0-beta.21` and zod to `^4`.

### Added — W1+W2+W3 Multi-Agent Foundation

- **W1 (CRDT + identity + event log)**: `yrs` CRDT module in `crates/llmtxt-core` (T189+T191), Ed25519 signed identity (`identity` module, T217), append-only distributed event log with hash-chained receipts
- **W2 (presence + leases + diff subscriptions)**: agent presence tracking, exclusive section leases, real-time diff subscription SSE stream
- **W3 (BFT + scratchpad + A2A)**: Byzantine-fault-tolerant consensus primitives (`bft` module), per-agent scratchpad with isolation guarantees, A2A envelope routing with signed payloads

### Added — Self-Hosted Observability

- Grafana + Loki + Tempo + Prometheus + OTel collector + GlitchTip deployed on Railway (no paid SaaS)
- Structured JSON logging from `apps/backend` emitted to Loki; distributed traces via Tempo; errors tracked in GlitchTip

### Added — OpenAPI + forge-ts

- `openapi:gen` script in `apps/backend` regenerates `openapi.json` from live routes
- forge-ts `check` integrated into `packages/llmtxt` validate script; CI drift gate fails PRs that skip regen

### Added — Semantic Embeddings

- Local ONNX-based embedding provider for `packages/llmtxt` (optional peer dep `onnxruntime-node`)
- pgvector integration in `apps/backend` for similarity search without external embedding API

### Added — Reference Agents + /demo

- 4 reference agent implementations demonstrating CRDT collaboration, BFT decision records, A2A coordination, and real-time presence
- `/demo` page in `apps/frontend` with live multi-agent walkthrough

### Added — Portable SDK

- `LocalBackend` (T317+T321-T331): full `Backend` interface over SQLite/Drizzle — documents, versions, lifecycle, events, leases, scratchpad, A2A, identity, nonces
- `RemoteBackend` (T332): thin HTTP/WS client implementing full `Backend` interface; REST for CRUD, SSE for `subscribeStream`, WebSocket for `subscribeSection`
- Backend contract test suite (T333): 25-test parametrised harness
- Fastify `localBackend` plugin (T334)
- `llmtxt` CLI (T335+T336): `init`, `create-doc`, `push-version`, `pull`, `watch`, `search`, `keys`, `sync`; defaults `LocalBackend`, `--remote` for `RemoteBackend`
- `llmtxt sync` (T337): CRDT state-vector exchange between local and remote
- CLEO integration example (T338): 4 patterns — task attachment docs, BFT decision records, A2A coordination, real-time presence
- Docs page `embed/cleo-pm` (T339)
- Subpath exports: `llmtxt/local`, `llmtxt/remote`, `llmtxt/cli` (T340)

### Changed

- **drizzle-orm / drizzle-kit**: upgraded to `1.0.0-beta.21`; `drizzle-zod` consolidated into `drizzle-orm/zod` subpath
- **zod**: upgraded to `^4` across all packages

### Fixed

- **Migration idempotency** (7df5795): W2 leases (`20260416021212_natural_shiva`) and W3 BFT/A2A inbox (`20260416030000_w3_bft_a2a_inbox`) Postgres migrations now use `IF NOT EXISTS` guards and remove a redundant `ALTER TABLE` that caused Railway crash-loops on deploy retry.

## [2026.4.4] — 2026-04-15

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

**TypeScript types/constants exported from `packages/llmtxt`**:
- `DocumentEventType`, `DocumentEvent`, `AuditAction`
- `Permission`, `DocumentRole`, `OrgRole`, `ROLE_PERMISSIONS`
- `CONTENT_LIMITS`, `API_VERSION_REGISTRY`, `CURRENT_API_VERSION`, `LATEST_API_VERSION`, `ApiVersionInfo`
- `VALID_LINK_TYPES`
- `COLLECTION_EXPORT_SEPARATOR`, `API_KEY_PREFIX`, `API_KEY_LENGTH`, `API_KEY_DISPLAY_LENGTH`
- `STATE_CHANGING_METHODS` (deduplicated from audit + csrf middleware)

**Deleted**: `apps/backend/src/utils/sections.ts` (duplicate markdown parser, now canonical in `crates/llmtxt-core::disclosure::parse_markdown_sections`).

### Added — CI regression guard (T142)

New ESLint rule in `apps/backend` bans:
- `createHash`, `createHmac` from `node:crypto` — use `@llmtxt` WASM primitives instead
- `yjs`, `automerge` imports — CRDT work must use Yrs (Rust) via WASM

CI workflow blocks PRs that reintroduce these patterns.

### Deferred

T112 (NAPI-RS native bindings) cancelled 2026-04-15 pending production benchmark evidence that WASM is a bottleneck on hot-path operations. WASM is the sole Rust→JS binding. Reactivation trigger preserved.

### Testing

- Cargo tests: 122 → 278 (+156 new Rust tests for migrated primitives)
- Backend tests: 67/67 throughout — zero regression
- Byte-identity tests: every migrated primitive verified Rust output == previous TypeScript output for ≥3 vectors
- SDK build (wasm-pack) clean
- `cargo fmt --check` clean
- `ferrous-forge validate` clean
- TypeScript strict typecheck clean

### Commits (8 atomic)

- `bfac086` — Wave A: 4 crypto migrations (T113/T114/T116/T117)
- `37f02da` — T142: CI lint rule
- `2676483` — Wave B-1: slugify + rbac + events (T130/T128/T127)
- `a70aa93` — Wave B-2: validation + graph + similarity (T123/T122/T121)
- `1ae405a` — Wave B-3: disclosure module (T119)
- `0a0a268` — Wave B-3: TF-IDF + FNV (T125)
- `9c33a2a` — Wave C: SDK type/const exports (T132/T133/T134/T136/T137/T140)
- `1a8ec3c` — Wave D: SSOT-AUDIT resolution table
