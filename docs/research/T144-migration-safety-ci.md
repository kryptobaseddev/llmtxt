# T144 Research: Migration Safety in CI (Idempotent Schema Validation)

**Date**: 2026-04-15
**Epic**: T144
**Author**: RCASD Team Lead (LOOM)

---

## 1. Problem Statement

On 2026-04-15 a deploy outage was caused by `drizzle-kit migrate` returning exit code 0 while silently failing to apply a migration (the `api_keys` table already existed from an earlier manual intervention). The server started, but with a partially-applied schema. This violates Guiding Star property 6: "Lose nothing on failure."

Two root causes:

1. `drizzle-kit migrate` exits 0 even when it logs an error to stderr containing "already exists".
2. There is no CI gate to catch duplicate DDL across migration files before merge.

---

## 2. What Exists Today

### Migration directory

```
apps/backend/src/db/migrations/
  20260331154202_certain_aqueduct/migration.sql   ← base schema (15 tables)
  20260414032508_lovely_longshot/migration.sql    ← api_keys table
  20260414032712_calm_joseph/migration.sql        ← audit_logs table
  20260414033818_blue_dracula/migration.sql       ← webhooks table
  20260414033829_faulty_impossible_man/migration.sql ← document_orgs table
  20260414034542_sour_legion/migration.sql        ← collections tables
```

Each migration directory contains `migration.sql` and `snapshot.json`. The SQL uses drizzle's `-->statement-breakpoint` separator.

### Drizzle config

`apps/backend/drizzle.config.ts` — dialect: sqlite, schema: `./src/db/schema.ts`, out: `./src/db/migrations`.

### CI today

`.github/workflows/ci.yml` has two jobs: `rust` (cargo fmt/clippy/test) and `typescript` (build + typecheck + lint). No migration check.

### Startup sequence

`apps/backend/src/db/index.ts` opens a better-sqlite3 connection and applies Drizzle schema at module load. There is no explicit migrate-on-boot call; schema is assumed to already be applied.

---

## 3. Gap Analysis

| Gap | Risk | Fix |
|-----|------|-----|
| `drizzle-kit migrate` exits 0 on error | P0 — silent broken deploy | Wrapper script that grepping stderr + checks exit |
| No fresh-DB run in CI | P1 — cumulative drift goes undetected | CI fixture: blank SQLite → run all migrations |
| Duplicate CREATE TABLE across files not caught | P1 — root cause of the outage | Grep-based lint over all `migration.sql` files |
| No idempotency run (run twice, must not fail) | P2 — re-deployments may fail | Run migrations twice on same DB in CI fixture |
| No MIGRATIONS.md contract document | P3 — authoring errors repeat | Write and enforce contract |

---

## 4. Proposed Tooling

### 4a. Migration lint script

`apps/backend/scripts/check-migrations.sh`

Algorithm:
1. Find all `migration.sql` files under `src/db/migrations/`.
2. Extract table names from `CREATE TABLE` statements (case-insensitive).
3. Build a map: `table_name → [list of files that CREATE it]`.
4. If any table appears in more than one file → print error, exit 1.
5. Same for `CREATE INDEX` and `CREATE UNIQUE INDEX` (by index name).

This is pure grep + awk — no Node runtime required. Runs in < 1s.

### 4b. CI fresh-DB fixture

`apps/backend/scripts/ci-migrate-check.sh`

Algorithm:
1. Create a temp SQLite file: `mktemp /tmp/ci-migrate-XXXX.db`.
2. Run `DATABASE_URL=/tmp/ci-migrate-XXXX.db pnpm db:migrate 2>&1 | tee /tmp/migrate-out.txt`.
3. Capture exit code. If non-zero → exit 1.
4. Grep `/tmp/migrate-out.txt` for the literal strings `already exists`, `SQLITE_ERROR`, `error:` (case-insensitive). If found → exit 1.
5. Run migrations a second time (idempotency: drizzle should skip already-applied migrations without error).
6. Grep again for error strings. If found → exit 1.
7. Remove temp file. Exit 0.

### 4c. Docker / Railway wrapper

The existing `start` script is `node dist/index.js`. Wrap it in a shell script that calls `drizzle-kit migrate` (or the Node-based equivalent) with strict error handling before the server binds.

Pattern:
```sh
#!/bin/sh
set -e
node dist/scripts/run-migrations.js
exec node dist/index.js
```

Where `run-migrations.js` is a tiny TypeScript script that uses drizzle's programmatic API and throws on any error.

---

## 5. External References

- drizzle-kit migrate docs: https://orm.drizzle.team/docs/kit-migrate
- drizzle-orm programmatic migrations (SQLite): https://orm.drizzle.team/docs/drizzle-kit-overview#apply
- GitHub Actions job exit codes: https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#exit-codes
- SQLite "already exists" error class: SQLITE_ERROR (code 1)
- better-sqlite3 error handling: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md

---

## 6. Reuse Opportunities

- The existing `pnpm db:migrate` script in `package.json` is the hook point — no new npm script concept needed.
- The CI `typescript` job already sets up pnpm + Node 24; the migration check job can share the same setup steps (or run as an additional step within the same job).
- The `apps/backend/scripts/` directory already exists (contains `migrate-sqlite-to-pg.ts`).

---

## 7. What NOT to Build

- Do not switch ORMs.
- Do not add a PostgreSQL migration check in this epic (out of scope; pg migration path is a separate concern).
- Do not implement a DB health-check endpoint here (that belongs in T145).
- Do not auto-repair migrations — fail loudly and require human fix.
