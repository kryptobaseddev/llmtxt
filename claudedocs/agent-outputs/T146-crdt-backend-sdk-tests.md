# T146 CRDT Backend, SDK, and Tests — Implementation Report

**Date**: 2026-04-16
**Status**: complete
**Commits**: 3 (C1: 8529db3, C2: ad0f8f4, C3: 7766a48)
**Tests**: 9 Node.js CRDT tests pass / 13 Rust CRDT tests pass / 26 existing API key tests pass (no regressions)

---

## Summary

Completed the remaining 9 subtasks of T146 (Multi-Agent CRDT Yrs integration Phase 2) across 3 commits.

---

## Commit 1 (C1): Persistence + WS Handler + Auth

### T203: Persistence helper
- `apps/backend/src/crdt/persistence.ts`
- `persistCrdtUpdate()`: atomic seq assignment via `pg_advisory_xact_lock` in a single transaction; write-before-broadcast guarantee; 4500 close on DB failure
- `loadSectionState()` / `loadPendingUpdates()`: read helpers for WS bootstrap
- SQLite fallback path (no advisory locks, single-writer safe)
- FNV-1a derived lock IDs for per-section serialisation

### T195: WS handler
- `apps/backend/src/routes/ws-crdt.ts`
- Route: `GET /api/v1/documents/:slug/sections/:sid/collab` with subprotocol `yjs-sync-v1`
- On connect: loads consolidated state + applies pending updates; sends SyncStep1 (server state vector)
- On SyncStep1 from client: replies with SyncStep2 (diff)
- On Update from client: persist → apply in-memory → broadcast local → publish pub/sub
- Per-section session registry (`activeSessions` Map) for O(n) local broadcast
- Compaction triggered on WS close (deferred 100ms)

### T197: WS auth
- Reuses `resolveWsUser()` pattern from ws.ts (Bearer via `?token=` or session cookie)
- Close 4401 for unauthenticated; 4403 for viewer attempting write subprotocol
- Document existence check via documents table; owner = editor (T076 RBAC future refinement)

---

## Commit 2 (C2): HTTP Fallback + Redis pub/sub + Compaction

### T201: HTTP fallback
- `apps/backend/src/routes/crdt.ts` registered in `/api/v1` scope
- `GET /documents/:slug/sections/:sid/crdt-state` → `{stateBase64, stateVectorBase64, clock, updatedAt}`; 503 if not initialized
- `POST /documents/:slug/sections/:sid/crdt-update` → `{updateBase64}`; persists + broadcasts; idempotent (Yrs guarantee)

### T199: Redis pub/sub
- `apps/backend/src/realtime/redis-pubsub.ts` (was uncommitted)
- `RedisPubSub` class with two ioredis connections (pub + sub); re-subscribe on reconnect; binary-safe
- `InProcessPubSub` EventEmitter fallback when `REDIS_URL` absent
- `publishCrdtUpdate()` / `subscribeCrdtUpdates()` public API

### T204: Compaction job
- `apps/backend/src/crdt/compaction.ts`
- `compactSection()`: single DB transaction with advisory lock; merges pending updates → UPSERT state; DELETE compacted rows; reset clock to 0
- Won't compact while WS sessions active (`hasSectionSessions()` check)
- `CRDT_COMPACT_THRESHOLD` / `CRDT_COMPACT_IDLE_MS` env var overrides
- `apps/backend/src/jobs/crdt-compaction.ts` (was uncommitted): periodic 6h GC job

---

## Commit 3 (C3): Tests + SDK

### T207: Byte-identity tests (Rust)
- `crates/llmtxt-core/src/crdt.rs`: added `test_crdt_byte_identity_associativity` and `test_crdt_byte_identity_idempotency`
- All 13 Rust CRDT tests pass: `cargo test --features crdt -- crdt::tests`

### T209: Integration test — two concurrent agents
- `apps/backend/src/__tests__/crdt.test.ts`
- 9 tests in 2 suites: T207 byte-identity (6 tests) + T209 convergence (3 tests)
- Agent A sends 5 updates, Agent B sends 5 concurrent updates; server applies all 10; both agents receive diff and converge to identical state
- Sync step 1+2 RTT simulation verified

### T211: SDK subscribeSection
- `packages/llmtxt/src/crdt.ts`
- `subscribeSection(slug, sectionId, callback, opts): Unsubscribe` — WS-backed, binary message framing, SectionDelta events
- `getSectionText(slug, sectionId, opts): Promise<string|null>` — HTTP fallback
- `SectionDelta`, `Unsubscribe`, `SubscribeSectionOptions` types exported from `packages/llmtxt/src/index.ts`
- yjs is optional peer dep loaded via dynamic import (ts-expect-error)

---

## Architecture Notes

### CRDT primitives layer
`apps/backend/src/crdt/primitives.ts` mirrors the six WASM exports from `crates/llmtxt-core/src/crdt.rs` using the yjs npm package. When the WASM is rebuilt with `--features crdt` (`pnpm build:wasm` from `packages/llmtxt`), callers can migrate to the WASM exports — the API is intentionally identical.

### Message framing
Binary WS frames use a 1-byte type prefix: `0x00` = SyncStep1, `0x01` = SyncStep2, `0x02` = Update. JSON control messages (auth errors) detected by `raw[0] === 0x7b`.

### Files created
- `apps/backend/src/crdt/primitives.ts`
- `apps/backend/src/crdt/persistence.ts`
- `apps/backend/src/crdt/compaction.ts`
- `apps/backend/src/routes/ws-crdt.ts`
- `apps/backend/src/routes/crdt.ts`
- `apps/backend/src/__tests__/crdt.test.ts`
- `packages/llmtxt/src/crdt.ts`

### Files previously uncommitted (now committed)
- `apps/backend/src/jobs/crdt-compaction.ts`
- `apps/backend/src/realtime/redis-pubsub.ts`

### Files modified
- `apps/backend/src/index.ts` (register wsCrdtRoutes, initCrdtPubSub, startCrdtCompactionJob)
- `apps/backend/src/routes/v1/index.ts` (register crdtRoutes)
- `crates/llmtxt-core/src/crdt.rs` (2 new byte-identity tests)
- `packages/llmtxt/src/index.ts` (export CRDT SDK types)
