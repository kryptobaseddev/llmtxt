# Changelog

All notable changes to the LLMtxt ecosystem (npm `llmtxt`, Rust crate `llmtxt-core`, apps/backend, apps/frontend, apps/docs).

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
