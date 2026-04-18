# T401 + T403: CRR Schema Migration + LocalBackend cr-sqlite Extension Load

**Tasks**: T401 (P2.3), T403 (P2.5)
**Date**: 2026-04-17
**Commit**: 34166a29efc1761eeb8fe94d0964c27463864541
**Status**: complete

## Summary

Combined implementation for cr-sqlite CRR schema migration (T401) and
LocalBackend extension loading (T403) for parent epic T385.

## Files Changed

- `packages/llmtxt/src/local/migrations/20260417230000_crsql_as_crr/migration.sql` — New migration (T401). Documents DR-P2-04 constraint and defers crsql_as_crr() to runtime.
- `packages/llmtxt/src/local/migrations/20260417230000_crsql_as_crr/snapshot.json` — Drizzle schema snapshot for new migration.
- `packages/llmtxt/src/local/local-backend.ts` — Extended open() with extension load + _activateCRRTables(); added hasCRR property; added CRR_TABLES constant (T403).
- `packages/llmtxt/src/core/backend.ts` — Added crsqliteExtPath to BackendConfig (T403).
- `packages/llmtxt/src/__tests__/local-backend-crr.test.ts` — 4 test suites, 9 tests, all green (T403).

## Key Design Decisions

### Migration Strategy (T401)

The CRR migration SQL contains only a no-op `SELECT 'crsql_crr_migration_recorded'`
rather than the actual `crsql_as_crr()` calls. This is intentional:

- crsql_as_crr() requires the cr-sqlite native extension to be loaded
- The Drizzle migrator runs before extension loading in open()
- Putting crsql_as_crr() in migration SQL would cause migration failures when the extension is absent
- CRR activation is instead deferred to _activateCRRTables() which runs AFTER migrate() and extension load

### Extension Load Ordering (T403)

```
open() sequence:
1. Create DB + set PRAGMAs
2. drizzle() + migrate()  ← tables must exist before CRRs are activated
3. loadCrSqliteExtensionPath()  ← ESM dynamic import (NOT require())
4. rawDb.loadExtension(extPath)
5. _activateCRRTables()  ← crsql_as_crr() for all 13 tables
6. hasCRR = true
```

If step 3-5 fail for any reason (package absent, ABI mismatch), LocalBackend
falls back to local-only mode with hasCRR=false. No crash.

### DR-P2-04 Enforcement

`section_crdt_states.crdt_state` is registered as CRR (safe, registers LWW on
the whole row), but the `applyChanges()` implementation MUST intercept updates
to this column and call Loro's `crdt_merge_updates()` instead of accepting the
LWW value. This is a mandatory correctness requirement documented in:
- migration.sql comment
- _activateCRRTables() docstring
- local-backend.ts CRR_SCHEMA_VERSION constant comment
- Both spec files (P2-cr-sqlite.md §4.2, P2-crr-column-strategy.md §4)

### Graceful Degradation

LocalBackend works without cr-sqlite (DR-P2-01). If the package is absent:
- open() logs a warning and continues
- hasCRR = false
- All CRUD operations function normally
- getChangesSince() and applyChanges() will throw CrSqliteNotLoadedError
  (those methods are implemented in T404/T405)

## Test Results

9/9 tests pass in `packages/llmtxt/src/__tests__/local-backend-crr.test.ts`:
- open() does not throw when cr-sqlite unavailable
- hasCRR is a boolean
- basic CRUD works regardless of hasCRR
- open() does not throw on invalid ext path
- hasCRR is false when extension load fails
- CRUD still works after failed ext load
- hasCRR is true when package is installed (conditional skip if absent)
- applyCrdtUpdate persists state (DR-P2-04 smoke test)
- getCrdtState returns null for unknown section

6 pre-existing failures in blob-fs-adapter.test.ts (SQLITE_CONSTRAINT_UNIQUE)
from T428 blob work — unrelated to these changes.

## Constraints Enforced

| Constraint | Status |
|---|---|
| DR-P2-01: optional peer dep, no crash | Enforced — graceful fallback |
| DR-P2-02: CRR at DB init time | Enforced — _activateCRRTables() |
| DR-P2-04: Loro merge on crdt_state | Documented — enforced in applyChanges() (T405) |
| ESM-only @vlcn.io/crsqlite | Enforced — dynamic import() only |
| Migration idempotency | Enforced — no-op SELECT, crsql_as_crr() is idempotent |
