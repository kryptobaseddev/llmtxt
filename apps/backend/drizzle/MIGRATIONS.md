# Migration Authoring Contract

This document defines the rules every migration author MUST follow when adding
or modifying database migrations in `apps/backend/src/db/migrations/`.

For the full specification see:
- [`docs/spec/SPEC-T144-migration-safety-ci.md`](../../../docs/spec/SPEC-T144-migration-safety-ci.md)
- [`docs/adr/ADR-T144-migration-safety-ci.md`](../../../docs/adr/ADR-T144-migration-safety-ci.md)

---

## Quick Rules (do these every time)

1. Run `bash apps/backend/scripts/check-migrations.sh` before opening a PR.
2. One logical change per migration file.
3. Never use `IF NOT EXISTS` guards.
4. Never execute raw DDL against production outside the Drizzle migration system.

---

## Rules in Detail

### 1. Generate migrations with drizzle-kit — never write them by hand

```sh
# From apps/backend/
pnpm db:generate
```

Drizzle generates a timestamped directory under `src/db/migrations/` containing
`migration.sql` and `snapshot.json`. Both files are required. Do not delete or
modify `snapshot.json` — it drives idempotency detection.

**Do not** create `migration.sql` files manually. Hand-authored SQL will not have
a corresponding `snapshot.json` and will break the migration tracking system.

---

### 2. One logical change per migration file

Each migration MUST introduce exactly one self-contained schema change. Acceptable
single-migration scope:

| Good (one migration) | Bad (must split) |
|---|---|
| Add table `subscriptions` | Add table `subscriptions` AND alter `users` |
| Add index `users_email_idx` | Add two unrelated indexes |
| Add column `documents.archived_at` | Add column + backfill data |

If you need to make multiple unrelated changes, generate them in separate steps:

```sh
# Step 1: modify schema.ts for first change, then:
pnpm db:generate

# Step 2: modify schema.ts for second change, then:
pnpm db:generate
```

---

### 3. Never use IF NOT EXISTS guards

```sql
-- BAD: masks duplicate-table errors that CI is designed to catch
CREATE TABLE IF NOT EXISTS `api_keys` ( ... );

-- GOOD: clean-room new table only
CREATE TABLE `api_keys` ( ... );
```

The lint script `check-migrations.sh` and the CI fresh-DB run are designed to
catch duplicate DDL before it reaches production. `IF NOT EXISTS` silences those
checks and allows broken state to go undetected.

If you are tempted to add `IF NOT EXISTS` because a table already exists, that
means your migration is a duplicate and MUST NOT be merged. Delete the migration,
identify the original migration that created the table, and resolve the conflict.

---

### 4. No raw DDL against production

Never run `sqlite3`, `psql`, or any direct DDL command against a production or
staging database outside of the Drizzle migration system. Doing so:

- Creates schema drift that Drizzle cannot track.
- Causes the next `run-migrations.ts` or `db:migrate` run to fail.
- Was the direct cause of the 2026-04-15 production outage.

The only correct way to change the production schema is:

```
schema.ts change → pnpm db:generate → PR → CI green → merge → deploy
```

The deploy step runs `run-migrations.ts` which applies all unapplied migrations
tracked in `__drizzle_migrations` and halts the container if any migration fails.

---

### 5. Run the lint script locally before opening a PR

```sh
# From the repo root:
cd apps/backend && bash scripts/check-migrations.sh

# Expected output on a clean set:
# OK: No duplicate CREATE TABLE or CREATE INDEX names found across N migration files.
```

If the script exits non-zero, fix the duplicate DDL before opening the PR. The CI
`migration-check` job runs the same script and will block the PR if it fails.

---

### 6. Altering or dropping existing objects

Use a new migration. Never modify an already-merged `migration.sql` file.

```sql
-- migration 1 (already merged): created the table
CREATE TABLE `documents` ( `id` text PRIMARY KEY, ... );

-- migration 2 (new): adds a column
ALTER TABLE `documents` ADD COLUMN `archived_at` integer;
```

If you need to drop a table or column, generate a new migration that contains the
`DROP` statement. Never remove a `CREATE TABLE` from a prior migration file.

---

## CI Gates

Every PR targeting `main` runs the `migration-check` job which:

1. Runs `check-migrations.sh` — fails if any table or index name is created in two
   or more separate files.
2. Runs `ci-migrate-check.sh` — applies all migrations to a blank SQLite database
   and then applies them again (idempotency check). Fails if either run exits
   non-zero or if the output contains `already exists`, `SQLITE_ERROR`, or `error:`.

A PR cannot merge until both checks pass.

---

## Deploy-Time Behavior

At deploy time, Railway/Docker runs:

```
node --import tsx/esm scripts/run-migrations.ts
```

This script uses Drizzle ORM's programmatic API (not `drizzle-kit` CLI) and
**calls `process.exit(1)` on any migration error**. The HTTP server will not start
if migrations fail. Check Railway logs for a structured JSON error event:

```json
{ "event": "migration_failed", "stage": "migrate", "error": "<message>" }
```

On success you will see:

```json
{ "event": "migrations_applied", "durationMs": 15 }
```

---

## Checklist Before Opening a PR

- [ ] `pnpm db:generate` was used to create the migration (not hand-authored SQL)
- [ ] Migration contains exactly one logical change
- [ ] No `IF NOT EXISTS` in the generated SQL
- [ ] `bash apps/backend/scripts/check-migrations.sh` exits 0 locally
- [ ] No direct DDL was run against any database outside of this migration
