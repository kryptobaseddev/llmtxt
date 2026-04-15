# ADR-T233: PostgreSQL Migration Architecture

**Status**: Proposed
**Date**: 2026-04-15
**Epic**: T233 — Ops: SQLite → Postgres migration
**Authors**: RCASD subagent
**Supersedes**: N/A

---

## Context

LLMtxt API currently runs `better-sqlite3` against a Railway volume-backed
file (`/app/data/data.db`). Railway already provisions a Postgres service at
`${{Postgres.DATABASE_URL}}`. Downstream epics T146 (CRDT Yrs) and T148 (event
log) have Postgres as a hard dependency in their SPECs; neither can ship IVTR
until this migration completes.

---

## Current Architecture

```
[Fastify API]
    │
    ▼
[better-sqlite3]
    │
    ▼
[/app/data/data.db]  ← Railway volume (persistent)
```

Driver chain: `better-sqlite3` → `drizzle-orm/better-sqlite3` → Drizzle ORM

Schema source of truth: `src/db/schema.ts` (sqliteTable constructors)
Migrations: `src/db/migrations/` (6 SQLite migration files)

---

## Target Architecture

```
[Fastify API]
    │
    ▼
[postgres-js driver]
    │  (Railway internal network)
    ▼
[Railway Postgres]  ← postgres.railway.internal:5432 / database: railway
```

Driver chain: `postgres` (postgres-js) → `drizzle-orm/postgres-js` → Drizzle ORM

Schema source of truth: `src/db/schema-pg.ts` (pgTable constructors)
Migrations: `src/db/migrations-pg/` (fresh PG migration series)

---

## Decisions

### D1: Driver — `postgres-js` over `node-postgres`

**Decision**: Replace `pg` (node-postgres) Pool with `postgres` (postgres-js).

**Rationale**:
- postgres-js has better native async ergonomics — single `sql` tag replaces
  Pool boilerplate.
- postgres-js is the recommended driver in drizzle-orm documentation for PG.
- `node-postgres` (`pg`) is already in `package.json` but was never the
  preferred choice; the strategic decision in the epic brief locks `postgres-js`.
- Migration: swap one dynamic import in `db/index.ts`.

**Rejected**: Staying on node-postgres — inconsistent with strategic decision.

### D2: Schema Source of Truth — `schema-pg.ts` becomes canonical

**Decision**: `schema-pg.ts` is the canonical schema after migration. `schema.ts`
is preserved as a read-only SQLite reference for rollback purposes but receives
no further feature development.

**Rationale**: A single canonical schema eliminates the drift risk that already
produced one missing column (`documents.versionCount`). Future epics (T146, T148)
add tables only to `schema-pg.ts`.

**Consequences**: T146 and T148 MUST add their new tables to `schema-pg.ts`,
not `schema.ts`.

### D3: PG Migration Strategy — Fresh series from `schema-pg.ts`

**Decision**: Do NOT attempt to cross-compile or replay the 6 SQLite migration
files. Instead, run `drizzle-kit generate --config=drizzle-pg.config.ts` to
generate a single baseline migration from the current `schema-pg.ts` (after
drift fix). This migration creates all tables in one shot on a fresh PG database.

**Rationale**: SQLite migrations include `INTEGER` types, `BLOB` columns, and
boolean-as-integer patterns that are incompatible with PG DDL. Cross-compilation
is error-prone and produces migrations that are hard to audit.

**Trade-off**: Production PG database is created clean; data is transferred via
the migration script, not via schema replay.

### D4: Data Migration — One-Time Node Script

**Decision**: Write `scripts/migrate-sqlite-to-postgres.ts` — a standalone Node
script that:
1. Opens the SQLite database using the `DATABASE_URL` env var (SQLite path).
2. Opens a Postgres connection using `POSTGRES_DATABASE_URL` env var.
3. Iterates each table in dependency order (parents before children).
4. Wraps each table's INSERT in a single PG transaction for atomicity.
5. Verifies row counts post-migration.
6. Emits a final summary JSON.

**NOT chosen**: Automated on-boot migration — too risky for production, no retry
mechanism, hides failures in logs.

**NOT chosen**: Cross-compile SQLite WAL replay — not supported by Postgres.

### D5: Concurrent Write Handling — UNIQUE Retry Pattern

**Decision**: Retain the existing UNIQUE-constraint-collision retry pattern in
`versions.ts` and `merge.ts` (retry once when `unique constraint` error). This
is already PG-compatible (`msg.includes('unique constraint')`).

For `conflicts.ts` (currently uses `{ behavior: 'immediate' }`):

**Decision**: Remove `{ behavior: 'immediate' }` and convert to async callback.
Rely on Postgres READ COMMITTED isolation (default) plus the same UNIQUE retry.
Do NOT use serializable transactions or advisory locks — the existing read-then-
write-with-retry pattern is sufficient and avoids deadlock risk.

**Rationale**: The version number uniqueness constraint (`UNIQUE(document_id,
version_number)`) enforces ordering at the database level regardless of isolation
level. The retry handles the rare collision case.

### D6: Deployment — Blue/Green via Railway PR Deploy

**Decision**:
1. Deploy the PG-backed build to a Railway preview environment.
2. Populate preview DB from a SQLite snapshot via the migration script.
3. Smoke-test against preview.
4. Cutover sequence on production:
   a. STOP writes (set maintenance mode / temporary 503).
   b. Run migration script (SQLite → PG).
   c. Flip `DATABASE_URL=${{Postgres.DATABASE_URL}}` and `DATABASE_PROVIDER=postgresql` in Railway env.
   d. Remove `DATABASE_URL` (SQLite file path) variable.
   e. Redeploy API container.
   f. Verify health endpoint + 5 smoke tests.
   g. Lift maintenance mode.
5. Estimated downtime: 2–5 minutes.

### D7: Rollback — SQLite Volume as Cold Backup

**Decision**: Keep the Railway volume (SQLite file) mounted for 30 days after
cutover. Rollback path: revert `DATABASE_PROVIDER` env var to `sqlite`, repoint
`DATABASE_URL` to the volume path, redeploy.

**NOT deleted**: The volume is not destroyed until 30 days post-cutover.
**NOT automated**: Volume is kept as cold backup — no automated sync back.

### D8: Connection Pool

**Decision**: `max: 20` connections for the postgres-js pool, consistent with the
existing node-postgres Pool config. Railway provides a single service instance;
20 connections is appropriate headroom.

---

## Schema Changes Required

### Fix: Add `versionCount` to `schema-pg.ts` documents table

The column is present in `schema.ts` but was missing from `schema-pg.ts` (drift).

```typescript
versionCount: integer('version_count').notNull().default(0),
```

### Future: T146 and T148 schema additions

T146 adds to `schema-pg.ts` (NOT `schema.ts`):
- `section_crdt_states` table
- `section_crdt_updates` table

T148 adds to `schema-pg.ts` (NOT `schema.ts`):
- `document_events` table

These must be separate incremental migrations generated AFTER T233 baseline
migration lands.

---

## Code Changes Required

| File | Change |
|------|--------|
| `apps/backend/package.json` | Add `postgres` (postgres-js) dependency |
| `apps/backend/src/db/schema-pg.ts` | Add `versionCount` to documents table |
| `apps/backend/src/db/index.ts` | Swap `drizzle-orm/node-postgres` + `pg.Pool` → `drizzle-orm/postgres-js` + `postgres(url)` |
| `apps/backend/src/routes/conflicts.ts` | Convert sync tx callback to async; remove `{ behavior: 'immediate' }` |
| `apps/backend/src/__tests__/integration.test.ts` | Port test bootstrap from raw SQLite DDL to PG container |
| `apps/backend/src/__tests__/api-keys.test.ts` | Port test bootstrap from raw SQLite DDL to PG container |
| `.github/workflows/*.yml` | Add `services: postgres:` ephemeral container for tests |
| `scripts/migrate-sqlite-to-postgres.ts` | New: one-time data migration script |
| `docs/runbooks/postgres-cutover.md` | New: step-by-step cutover runbook |

---

## Infrastructure Changes

| Item | Action |
|------|--------|
| Railway `DATABASE_URL` env | Change from SQLite file path to `${{Postgres.DATABASE_URL}}` |
| Railway `DATABASE_PROVIDER` env | Set to `postgresql` |
| Railway volume | Keep mounted for 30 days (cold backup) |
| Railway Postgres service | Already provisioned — no new service needed |

---

## Interface with T146 and T148

T233 delivers the empty, schema-correct PG database. T146 and T148 then add
their tables via incremental `drizzle-kit generate` migrations. The interface is:

**T233 delivers**: Baseline PG migration file(s) in `src/db/migrations-pg/` that
create all 20 existing tables. All tests pass against PG.

**T146 contract**: After T233 is merged, T146 generates `migrations-pg/0002_*`
adding `section_crdt_states` and `section_crdt_updates`.

**T148 contract**: After T233 is merged (T148 does not depend on T146), T148
generates `migrations-pg/0002_*` (or `0003_*` if T146 lands first) adding
`document_events`.

**MUST NOT**: Either T146 or T148 modify T233's baseline migration or alter
any existing table columns.
