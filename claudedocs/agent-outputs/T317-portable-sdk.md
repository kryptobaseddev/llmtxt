# T317 Portable SDK — Agent Output

**Task**: T317 (Epic: Portable SDK — LocalBackend + RemoteBackend + CLI + CLEO integration)
**Phase**: RCASD (Decomposition)
**Date**: 2026-04-16
**Status**: complete

---

## Summary

Completed Phase 1 (RCASD): Full decomposition of T317 into 25 atomic child tasks (T318–T342), covering all domains specified in the epic.

All tasks created via `cleo add` with correct deps, sizes, priorities, and pipe-separated acceptance criteria. Decomposition document committed at `docs/decomposition/T317-decomposition-2026-04-16.md`.

---

## Tasks Created

| CLEO ID | Spec | Title | Size | Priority |
|---------|------|-------|------|----------|
| T318 | T317.1 | Backend interface — TypeScript contracts | medium | critical |
| T319 | T317.2 | Backend route inventory + coverage doc | small | high |
| T320 | T317.3 | LocalBackend SQLite schema (Drizzle) | medium | critical |
| T321 | T317.4 | LocalBackend.documents | medium | critical |
| T322 | T317.5 | LocalBackend.versions | medium | critical |
| T323 | T317.6 | LocalBackend.approvals + BFT | medium | high |
| T324 | T317.7 | LocalBackend.events (EventEmitter) | medium | high |
| T325 | T317.8 | LocalBackend.CRDT (WASM primitives) | medium | high |
| T326 | T317.9 | LocalBackend.leases + expiry reaper | small | high |
| T327 | T317.10 | LocalBackend.presence (in-memory) | small | medium |
| T328 | T317.11 | LocalBackend.scratchpad (ring buffer) | small | medium |
| T329 | T317.12 | LocalBackend.A2A inbox | small | medium |
| T330 | T317.13 | LocalBackend.search (ONNX + cosine) | large | medium |
| T331 | T317.14 | LocalBackend.identity + pubkeys table | small | critical |
| T332 | T317.15 | RemoteBackend (HTTP/WS delegate) | medium | high |
| T333 | T317.16 | Backend-agnostic contract test suite | large | critical |
| T334 | T317.17 | apps/backend thin Fastify adapter refactor | large | high |
| T335 | T317.18 | llmtxt CLI binary (all commands) | large | high |
| T336 | T317.19 | llmtxt init command | small | high |
| T337 | T317.20 | llmtxt sync command | medium | medium |
| T338 | T317.21 | apps/examples/cleo-integration/ | medium | high |
| T339 | T317.22 | Docs page embed/cleo-pm.mdx | small | medium |
| T340 | T317.23 | package.json subpath exports | small | high |
| T341 | T317.24 | README embedding guide | small | medium |
| T342 | T317.25 | Release: version bump + CHANGELOG | small | high |

---

## Execution Wave Plan

- Wave 1 (unblocks all): T318, T319, T320, T331
- Wave 2 (LocalBackend core): T321 → T322 → T323–T329 (parallel)
- Wave 3 (search + remote + tests): T330, T332, T333
- Wave 4 (refactor + CLI): T334, T335, T336
- Wave 5 (integration + docs + packaging): T337, T338, T339, T340, T341
- Wave 6 (release): T342

---

## Key Architecture Decisions Captured in Tasks

1. **Backend interface first** (T318) — unblocks all implementation tasks
2. **SSoT enforced** — all WASM primitives via crates/llmtxt-core, no direct yjs/node:crypto imports
3. **better-sqlite3 sync constraint** — all tasks explicitly document no async in transaction callbacks
4. **exp=0 guard** — every TTL task includes the never-expire guard in acceptance criteria
5. **Drizzle-kit only** — no hand-written migrations per project footgun convention
6. **Graceful degradation** — search degrades to empty if onnxruntime-node not installed

---

## Files Written

- `/mnt/projects/llmtxt/docs/decomposition/T317-decomposition-2026-04-16.md` — full decomposition doc
- `/mnt/projects/llmtxt/claudedocs/agent-outputs/T317-portable-sdk.md` — this file

---

## Next Steps (for successor agent or IVTR phase)

Start with T318 (Backend interface) — it unblocks everything. Then T319 + T320 + T331 in parallel.

T318 implementation target: `packages/llmtxt/src/core/backend.ts` + `docs/specs/backend-interface.md`
