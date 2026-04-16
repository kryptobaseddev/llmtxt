# T317 Portable SDK — RCASD Decomposition

**Epic**: T317 — Portable SDK (LocalBackend + RemoteBackend + CLI + CLEO integration)
**Date**: 2026-04-16
**Author**: CLEO Orchestrator
**Status**: Decomposition complete — 25 atomic tasks created (T318–T342)

---

## Strategic Context

Today the SDK assumes network calls to api.llmtxt.my. After this epic:

```typescript
import { LLMtxt } from 'llmtxt';
const llm = new LLMtxt({ backend: 'local', path: './cleo.db' });
// Full feature set works offline, zero network dependency
```

This makes LLMtxt uniquely positioned in the agent tooling space — no competitor (Liveblocks, Notion, Y-sweet) ships the full server-side feature set as an embeddable library.

---

## Dependency Graph

```
T318 (interface) ─┬─► T319 (coverage doc)
                  └─► T320 (SQLite schema) ─► T321 (docs) ─┬─► T322 (versions) ─► T323 (BFT)
                                              T331 (identity)─┤
                                                              ├─► T324 (events)
                                                              ├─► T325 (CRDT)
                                                              ├─► T326 (leases)
                                                              ├─► T327 (presence)
                                                              ├─► T328 (scratchpad)
                                                              └─► T329 (A2A)
                                              T322 ──────────► T330 (search)
T318 + T319 ──────────────────────────────► T332 (RemoteBackend)
T332 + T323–T330 ─────────────────────────► T333 (contract tests)
T333 ─────────────────────────────────────► T334 (backend refactor)
T322 + T330 + T331 ───────────────────────► T335 (CLI binary) ─► T336 (init cmd) ─► T337 (sync)
T336 + T325 + T323 + T324 ────────────────► T338 (CLEO example) ─► T339 (docs page)
T332 + T335 ───────────────────────────────► T340 (package exports) ─► T341 (README)
T341 + T334 + T333 ───────────────────────► T342 (release)
```

---

## Task Inventory

| CLEO ID | Spec ID | Title | Size | Priority | Deps |
|---------|---------|-------|------|----------|------|
| T318 | T317.1 | Design Backend interface | medium | critical | — |
| T319 | T317.2 | Inventory backend routes coverage doc | small | high | T318 |
| T320 | T317.3 | LocalBackend SQLite schema (Drizzle) | medium | critical | T318 |
| T321 | T317.4 | LocalBackend.documents | medium | critical | T320 |
| T322 | T317.5 | LocalBackend.versions | medium | critical | T321 |
| T323 | T317.6 | LocalBackend.approvals + BFT | medium | high | T322 |
| T324 | T317.7 | LocalBackend.events (EventEmitter) | medium | high | T321 |
| T325 | T317.8 | LocalBackend.CRDT (WASM) | medium | high | T321 |
| T326 | T317.9 | LocalBackend.leases + reaper | small | high | T321 |
| T327 | T317.10 | LocalBackend.presence (in-memory) | small | medium | T321 |
| T328 | T317.11 | LocalBackend.scratchpad (ring buffer) | small | medium | T321 |
| T329 | T317.12 | LocalBackend.A2A inbox | small | medium | T321 |
| T330 | T317.13 | LocalBackend.search (ONNX + cosine) | large | medium | T322 |
| T331 | T317.14 | LocalBackend.identity (pubkeys table) | small | critical | T320 |
| T332 | T317.15 | RemoteBackend (HTTP/WS delegate) | medium | high | T318, T319 |
| T333 | T317.16 | Backend-agnostic contract test suite | large | critical | T332, T323–T330 |
| T334 | T317.17 | apps/backend thin Fastify adapter | large | high | T333 |
| T335 | T317.18 | llmtxt CLI binary (all commands) | large | high | T322, T330, T331 |
| T336 | T317.19 | llmtxt init command | small | high | T335, T331 |
| T337 | T317.20 | llmtxt sync command | medium | medium | T336, T332, T325 |
| T338 | T317.21 | apps/examples/cleo-integration/ | medium | high | T336, T325, T323, T324 |
| T339 | T317.22 | Docs page embed/cleo-pm.mdx | small | medium | T338 |
| T340 | T317.23 | package.json subpath exports | small | high | T332, T335 |
| T341 | T317.24 | README.md embedding guide | small | medium | T340, T339 |
| T342 | T317.25 | Release: version bump + CHANGELOG | small | high | T341, T334, T333 |

---

## Execution Waves

### Wave 1 — Foundation (unblocks everything)
- T318: Backend interface design
- T319: Route coverage inventory (parallel with T320)
- T320: SQLite schema
- T331: Identity (parallel with T321)

### Wave 2 — LocalBackend core
- T321: documents
- T322: versions (sequential on T321)
- T323–T329: BFT, events, CRDT, leases, presence, scratchpad, A2A (parallel on T321/T322)

### Wave 3 — Search + RemoteBackend + contract tests
- T330: Search (on T322)
- T332: RemoteBackend (on T318, T319)
- T333: Contract test suite (on all of the above)

### Wave 4 — Backend refactor + CLI
- T334: apps/backend refactor (on T333)
- T335: CLI binary (on T322, T330, T331)
- T336: init command (on T335)

### Wave 5 — Integration + docs + packaging
- T337: sync command (on T336, T332, T325)
- T338: CLEO example (on T336, T323–T325)
- T339: docs page (on T338)
- T340: package exports (on T332, T335)
- T341: README (on T340, T339)

### Wave 6 — Release
- T342: version bump + CHANGELOG

---

## Architecture Decisions

### SSoT: crates/llmtxt-core
All portable primitives (hash_content, slugify, crdt merge_updates, identity verify, similarity, bft quorum) stay in Rust. LocalBackend calls them via WASM. No direct imports of yjs, node:crypto, or automerge.

### better-sqlite3 is SYNCHRONOUS
Transaction callbacks MUST NOT be async. All Drizzle SQLite ops are called synchronously. Never wrap sync calls in Promise.resolve() inside a transaction.

### Migration safety
NEVER hand-write migration SQL. Always use `drizzle-kit generate` after schema changes. The schema-pg.ts footgun (duplicate CREATE TABLE from regen) MUST NOT recur in the local schema.

### exp=0 means never-expires
In all TTL comparisons (scratchpad, A2A, presence, leases), an exp value of 0 MUST be treated as "no expiry". This guard must appear in every reaper and every query filter.

### No paid SaaS dependencies
LocalBackend uses: better-sqlite3, drizzle-orm/libsql or drizzle-orm/better-sqlite3, onnxruntime-node (optional). No Redis, no Postgres, no S3.

---

## Validation Gates (from epic acceptance criteria)

1. `pnpm --filter llmtxt build` exits 0
2. `pnpm --filter llmtxt typecheck` exits 0 (strict mode)
3. Backend-agnostic contract tests pass against LocalBackend (zero network)
4. `pnpm --filter @llmtxt/backend test` still 67/67 green after T334 refactor
5. `llmtxt init && llmtxt create-doc test --content hello && llmtxt search hello` works in scratch dir
6. `apps/examples/cleo-integration/main.ts` runs without error (node main.ts exits 0)
7. CI green on each pushed commit wave
