# T238: Port integration.test.ts and api-keys.test.ts to PG Test Harness

**Task**: T238
**Date**: 2026-04-15
**Status**: complete
**Agent**: claude-sonnet-4-6

## Summary

Added a provider-agnostic test database harness and ported both test files to use it.

## Files Changed

### New File
- `apps/backend/src/__tests__/helpers/test-db.ts`
  - `setupTestDb()` — async factory; returns SQLite context by default, PG when `DATABASE_URL_PG` is set
  - `teardownTestDb(ctx)` — closes SQLite DB or drops PG schema + ends connections
  - `TestDbContext` interface exported for type-safe usage in test files
  - SQLite path: in-memory `better-sqlite3` + full DDL bootstrap via `sqlite.exec()`
  - PG path: creates isolated `test_<random>` schema, runs migration SQL from `src/db/migrations-pg/`, drops schema on cleanup

### Modified Files
- `apps/backend/src/__tests__/integration.test.ts`
  - Removed direct `better-sqlite3` and `drizzle-orm/better-sqlite3` imports
  - Removed inline `createTestDb()` function and all `sqlite.exec/pragma` calls
  - All 8 `describe` blocks updated to use `await setupTestDb()` in `before()` and `teardownTestDb()` in `after()`
  - Audit log endpoint switched from `testDb.sqlite.prepare(...)` to `testDb.db.select().from(schema.auditLogs).orderBy(desc(...)).limit(50).all()` for provider portability
  - Type annotations updated from `ReturnType<typeof createTestDb>` to `TestDbContext`

- `apps/backend/src/__tests__/api-keys.test.ts`
  - Removed direct `better-sqlite3` and `drizzle-orm/better-sqlite3` imports
  - Removed inline `createTestDb()` function and all `sqlite.exec/pragma` calls
  - All 3 integration `describe` blocks updated to use `await setupTestDb()` / `teardownTestDb()`
  - Variable renamed from `db` to `ctx` (TestDbContext) with `ctx.db` for Drizzle access

## Verification

- `cd apps/backend && pnpm test` — 67/67 pass (SQLite default)
- `cd apps/backend && pnpm build` — clean (0 errors)
- `cd apps/backend && pnpm lint` — clean (0 warnings)
- PG path: code complete, HITL-deferred to CI once T239 Postgres ephemeral service lands

## Acceptance Criteria Status

- [x] Neither test file imports better-sqlite3 directly
- [x] Neither test file uses sqlite.exec or sqlite.pragma
- [x] 67/67 tests pass with SQLite default (DATABASE_URL_PG not set)
- [x] PG path: setupTestDb creates isolated schema, runs migrations, teardown drops schema
- [ ] All 67 tests pass with DATABASE_PROVIDER=postgresql — HITL-deferred to CI (T239)

## Commit

`2e75f5ddc51a56b3bb977f3469a5b6e33ba87338`
