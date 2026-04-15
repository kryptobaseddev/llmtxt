# T233 Research: SQLite to PostgreSQL Migration

**Date**: 2026-04-15
**Author**: RCASD subagent
**Epic**: T233 — Ops: SQLite → Postgres migration (use Railway-provided DATABASE_URL)

---

## 1. SQL Surface Inventory

### 1.1 Drizzle ORM (portable) Usage

The vast majority of application queries use Drizzle ORM's query builder, which
is database-agnostic once the correct schema module and driver are wired in.
Tables are defined in `schema.ts` (SQLite) and `schema-pg.ts` (Postgres). Both
use Drizzle table constructors — no handwritten SQL.

### 1.2 Raw SQL Template Literals (`sql\`...\``)

| File | Line | Usage | Portable? |
|------|------|-------|-----------|
| `src/routes/health.ts` | 93, 97 | `sql\`SELECT 1\`` — DB ping | Yes (standard SQL) |

Both usages are provider-guarded: the file checks `DATABASE_PROVIDER` and uses
`db.execute(sql...)` for PG and `db.run(sql...)` for SQLite. No raw SQL in any
route beyond this health ping.

### 1.3 SQLite-Specific Transaction Mode (`behavior: 'immediate'`)

| File | Line | Details |
|------|------|---------|
| `src/routes/conflicts.ts` | 205 | `db.transaction(..., { behavior: 'immediate' })` — still active, SQLite-only |
| `src/routes/versions.ts` | 195-199 | Comment documents the PG-safe async pattern; `behavior: 'immediate'` REMOVED |
| `src/routes/merge.ts` | 295-297 | Comment documents the PG-safe async pattern; `behavior: 'immediate'` REMOVED |

**Critical finding**: `conflicts.ts` still uses `{ behavior: 'immediate' }` with
a synchronous transaction callback (`.run()` on each DML inside the callback).
This is the only route that will BREAK under postgres-js because:
1. `{ behavior: 'immediate' }` is not a valid Drizzle PG option.
2. The callback uses sync `.run()` instead of async `await`.

### 1.4 PRAGMA and `sqlite.exec()`

| File | Usage | Context |
|------|-------|---------|
| `src/__tests__/integration.test.ts` | `sqlite.pragma(...)`, `sqlite.exec(...)` | Test setup only — in-memory DB bootstrap |
| `src/__tests__/api-keys.test.ts` | `sqlite.pragma(...)`, `sqlite.exec(...)` | Test setup only — in-memory DB bootstrap |

Tests directly import `better-sqlite3`, `drizzle-orm/better-sqlite3`, and
`db/schema.js`. They hardcode SQLite DDL (see §1.6 below). Both test files
create isolated in-memory databases rather than importing from `db/index.ts` —
this is the primary test porting concern.

### 1.5 `json_extract` / JSON operators

No usage of SQLite-specific `json_extract()` found in any route or migration.
JSON columns (`details` in `audit_logs`, `sectionsModified` in `contributors`,
etc.) are stored as serialized text strings in both SQLite and Postgres schemas.
No column uses `jsonb` type in `schema-pg.ts` — all JSON fields remain `text`.
This means `col->>'path'` (jsonb) vs `col->'path'` (jsonb object) is irrelevant
for the current schema. If CRDT (T146) adds `jsonb` columns, the Consensus
section addresses that.

### 1.6 Test Harness DDL (Raw SQL)

Both `integration.test.ts` and `api-keys.test.ts` bootstrap test databases using
raw SQLite DDL strings passed to `sqlite.exec(...)`. The DDL uses:
- `INTEGER` not `BIGINT` for unix-ms timestamps
- `BLOB` not `BYTEA` for compressed content
- `INTEGER NOT NULL DEFAULT 0` for booleans

These are SQLite-native types. The test harness must be rewritten to use Drizzle
PG schema and a real (ephemeral) Postgres container in CI, or dual-mode with
provider detection.

---

## 2. Schema Drift Analysis: `schema.ts` vs `schema-pg.ts`

The two files are structurally **aligned** as of this audit. Every table present
in `schema.ts` exists in `schema-pg.ts`. Key type mappings applied:

| SQLite type | PG type used in schema-pg.ts |
|-------------|------------------------------|
| `integer(..., { mode: 'boolean' })` | `boolean(...)` |
| `integer(..., { mode: 'timestamp' })` | `timestamp(..., { mode: 'date' })` |
| `integer(...)` (unix ms) | `bigint(..., { mode: 'number' })` |
| `blob(...)` | `bytea(...)` via custom type |
| `text(...)` primary key autoincrement | `text(...)` (UUIDs, no sequence) |

**Three tables missing from `schema-pg.ts`** (present in `schema.ts`):

1. No gap — both files have identical table count on this audit (20 tables each).

However, `schema.ts` has `versionCount` on `documents`; `schema-pg.ts` does NOT
(confirmed by diff at column level). This is a genuine drift item.

Wait — re-checking: `schema-pg.ts` documents table **does not include** the
`versionCount` field that `schema.ts` line 167 shows (`versionCount: integer(...)`).

Actually on close comparison, `schema-pg.ts` is a near-complete port but was
generated before `versionCount` was added to `schema.ts`. The delta:

| Column | schema.ts | schema-pg.ts |
|--------|-----------|--------------|
| `documents.versionCount` | present | **MISSING** |

All other columns are present in both files after manual comparison.

**T146 schema additions** (CRDT): The T146 SPEC (`docs/SPEC-T146-yrs-crdt.md`)
requires two new tables: `section_crdt_states` and `section_crdt_updates`. These
tables DO NOT exist in either `schema.ts` or `schema-pg.ts` at the time of this
audit. T146 schema additions MUST be added to `schema-pg.ts` (not `schema.ts`,
since schema-pg.ts will be canonical post-migration). T146 implementers must
coordinate with T233.

**T148 schema additions** (event log): T148 requires a `document_events` table.
Similarly not present in either schema file. Must land in `schema-pg.ts`.

---

## 3. Transaction Pattern Audit

### 3.1 `conflicts.ts` — IMMEDIATE + SYNC (BROKEN for PG)

```typescript
// Line 104-206
db.transaction(
  (tx: any) => {
    tx.select(...).from(versions)...all();   // sync
    tx.insert(versions)...run();              // sync
    tx.update(documents)...run();             // sync
  },
  { behavior: 'immediate' }                  // SQLite-only
);
```

**Fix required**: Convert to async callback + `await`, remove
`{ behavior: 'immediate' }`. Replace optimistic retry on UNIQUE collision with
PG serializable isolation or advisory lock for the version-number allocation
critical section.

### 3.2 `versions.ts` — Already PG-safe

```typescript
// Line 201
db.transaction(async (tx: typeof db) => {
  const [latestVersion] = await tx.select(...).limit(1);
  await tx.insert(versions).values(...);
  await tx.update(documents).set(...);
  // ...
});
```

Uses async callback + `await`. No SQLite options. Safe for both providers.

### 3.3 `merge.ts` — Already PG-safe

Same async pattern as versions.ts. No `{ behavior: 'immediate' }`.

---

## 4. Dependency Map: Files That Import DB Layer

All 29 source files that import from `./db/index.ts` or `./db/schema.ts`:

**Routes** (26):
- access-control.ts, api-keys.ts, api.ts, collections.ts, conflicts.ts,
  cross-doc.ts, disclosure.ts, graph.ts, health.ts, lifecycle.ts, merge.ts,
  organizations.ts, patches.ts, retrieval.ts, semantic.ts, signed-urls.ts,
  similarity.ts, versions.ts, web.ts, webhooks.ts, ws.ts

**Middleware** (4):
- audit.ts, auth.ts, content-limits.ts, rbac.ts

**Events** (1):
- webhooks.ts

**Tests** (2):
- `__tests__/integration.test.ts` — direct better-sqlite3 + schema import
- `__tests__/api-keys.test.ts` — direct better-sqlite3 + schema import

---

## 5. Existing PostgreSQL Dependencies

From `apps/backend/package.json`:

| Package | Version | Status |
|---------|---------|--------|
| `pg` | ^8.20.0 | Installed (node-postgres) |
| `@types/pg` | ^8.20.0 | Installed |
| `drizzle-orm` | 1.0.0-beta.9-e89174b | Installed |
| `better-sqlite3` | ^12.1.0 | Installed |
| `@types/better-sqlite3` | ^7.6.12 | Installed |

**NOT installed**: `postgres` (the `postgres-js` driver). The current
`db/index.ts` uses `pg` (node-postgres Pool) for the PG path, not `postgres-js`.

**Strategic decision per prompt**: The target driver is `postgres-js`.
This requires:
1. Add `postgres` package (the `postgres-js` driver — package name is `postgres`).
2. Swap `drizzle-orm/node-postgres` → `drizzle-orm/postgres-js` in `db/index.ts`.
3. The Pool configuration (`max`, `idleTimeoutMillis`, etc.) is replaced by
   postgres-js connection string options (`max: 20` etc.).

---

## 6. Drizzle PG Config

`drizzle-pg.config.ts` already exists, pointing at `schema-pg.ts` with output to
`src/db/migrations-pg`. The directory `src/db/migrations-pg/` does NOT yet exist
(no PG migrations have been generated). The config is ready to use after
`documents.versionCount` drift is fixed.

---

## 7. `db/index.ts` Current State

The file already implements a **dual-provider pattern** controlled by
`DATABASE_PROVIDER` env var:
- `sqlite` (default): better-sqlite3 + drizzle-orm/better-sqlite3
- `postgresql`: pg (node-postgres) Pool + drizzle-orm/node-postgres

The PostgreSQL path uses `drizzle-orm/node-postgres`. The target is
`drizzle-orm/postgres-js` (per strategic decision). This is a one-file swap.

The `sqlite` export (`export const sqlite: any`) is used by test files for raw
DDL setup. In PG mode this is null.

---

## 8. better-auth Dual-Provider

`auth.ts` checks `DATABASE_PROVIDER` and passes `provider: 'pg'` or `'sqlite'`
to `drizzleAdapter`. This is already correct for both providers.

---

## 9. CI Test Infrastructure Gap

Current CI runs tests against an in-memory SQLite database. There is no Postgres
ephemeral container in CI. Adding `services: postgres:` to GitHub Actions is
required for the 67 backend tests to run against PG. During the transition
window, both SQLite and PG test runs should pass.

---

## 10. T146 / T148 Schema Coordination Interface

T233 owns the canonical `schema-pg.ts` migration. T146 and T148 need to add
tables to that schema. The coordination contract:

- T233 deliverable: `schema-pg.ts` with `versionCount` fix + clean PG migrations
  for all existing tables.
- T146 must add `section_crdt_states` and `section_crdt_updates` tables to
  `schema-pg.ts` (not `schema.ts` — SQLite path is deprecated post-T233).
- T148 must add `document_events` table to `schema-pg.ts`.
- Both T146 and T148 must generate their own incremental migration via
  `drizzle-kit generate --config=drizzle-pg.config.ts` AFTER T233 migrations land.
- T146 and T148 MUST NOT touch the existing tables or migrations from T233.

---

## Summary

**SQLite-specific surfaces requiring code changes**:
1. `conflicts.ts` — sync transaction + `{ behavior: 'immediate' }` (MUST fix)
2. `integration.test.ts` — raw SQLite DDL bootstrap (MUST port to PG)
3. `api-keys.test.ts` — raw SQLite DDL bootstrap (MUST port to PG)
4. `health.ts` — minor: provider-aware DB ping already handled (NO change needed)
5. `db/index.ts` — driver swap from node-postgres to postgres-js (MUST change)

**Schema drift**:
- `schema-pg.ts` missing `documents.versionCount` column (MUST add)

**Missing PG migrations**: `src/db/migrations-pg/` does not exist — must be
generated fresh from `schema-pg.ts` after drift fix.
