# ADR-T144: Migration Safety in CI

**Status**: Accepted
**Date**: 2026-04-15
**Epic**: T144
**Deciders**: RCASD Team Lead (LOOM), Orchestrator

---

## Context

The 2026-04-15 production outage was caused by `drizzle-kit migrate` returning exit code 0 while logging an "already exists" error to stderr. The `api_keys` table had been created by an earlier manual migration, and the automated migration silently skipped it. The server started in a degraded state with an incomplete schema. No CI gate existed to catch this before merge.

Two independent failure modes must both be closed:

1. **Silent migration failure at deploy time** — drizzle-kit exits 0 on error.
2. **Duplicate DDL across migration files** — no lint check existed.

---

## Decision

We adopt a three-layer defense:

### Layer 1: Migration Lint (pre-merge, static analysis)

A shell script `apps/backend/scripts/check-migrations.sh` scans all `migration.sql` files and fails with exit code 1 if:
- The same table name appears in a `CREATE TABLE` statement in two or more files.
- The same index name appears in a `CREATE [UNIQUE] INDEX` statement in two or more files.

This is purely static — no database required. Runs in < 1 second.

### Layer 2: CI Fresh-DB Run (pre-merge, integration)

A shell script `apps/backend/scripts/ci-migrate-check.sh`:
1. Creates a blank temp SQLite database.
2. Runs `pnpm db:migrate` against it, capturing all output.
3. Fails if the process exits non-zero OR if stderr/stdout contains error markers (`already exists`, `SQLITE_ERROR`, `error:`).
4. Runs migrations a second time against the same database (idempotency check).
5. Fails on any error markers on the second run.

### Layer 3: Strict Migrate-Before-Start (deploy time)

A wrapper entry point `apps/backend/scripts/run-migrations.ts` uses Drizzle's Node API to run migrations programmatically, throwing and propagating errors. The Railway/Docker `CMD` is updated to call this wrapper before starting the HTTP server. The wrapper uses `process.exit(1)` on any migration error so the container never reaches HTTP bind in a broken state.

### Layer 4: Authoring Contract (documentation)

`apps/backend/drizzle/MIGRATIONS.md` documents:
- One logical change per migration file.
- No raw DDL outside drizzle-generated files.
- No `IF NOT EXISTS` guards — migrations must be clean-room (new tables only).
- All migrations must pass the CI lint and fresh-DB check before merge.

---

## CI Workflow Steps

```
PR → actions/checkout@v4
   → pnpm install --frozen-lockfile
   → [new job: migration-check]
       step 1: Run check-migrations.sh (static lint)
                   → exits non-zero if duplicate CREATE TABLE/INDEX
       step 2: Run ci-migrate-check.sh (integration)
                   → blank SQLite → migrate → check output → migrate again → check output
       step 3: Fail PR if either step exits non-zero
```

Flow diagram:

```
┌─────────────────────────────────────────────────────────────────────┐
│  PR opened / updated                                                │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
            ┌───────────────▼───────────────┐
            │   Job: migration-check        │
            │                               │
            │  ① check-migrations.sh        │
            │     grep CREATE TABLE/INDEX   │
            │     across all migration.sql  │
            │     → fail if duplicate name  │
            │                               │
            │  ② ci-migrate-check.sh        │
            │     mktemp DB                 │
            │     pnpm db:migrate → tee log │
            │     grep errors in log        │
            │     → fail if found           │
            │     run migrate again (idem.) │
            │     grep errors again         │
            │     → fail if found           │
            └───────────────┬───────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Pass? → PR mergeable     │
              │  Fail? → PR blocked       │
              └───────────────────────────┘
```

---

## Consequences

**Positive**:
- Duplicate DDL is caught before merge, not at 3am during deploy.
- Migration failures halt container startup before any requests are served.
- Second-run idempotency check prevents re-deploy failures on Railway (which re-runs CMD on restarts).

**Negative / Trade-offs**:
- CI time increases by ~10–15 seconds (SQLite fresh-DB is fast).
- The PostgreSQL migration path is NOT covered by this epic (separate concern; pg needs its own check using a pg container or `pg_tmp`).

**Out of scope**:
- Automatically fixing broken migrations.
- Running migrations against a staging database in CI.
- PostgreSQL idempotency checks.

---

## Alternatives Considered

| Alternative | Rejected reason |
|-------------|-----------------|
| Use `drizzle-kit check` flag | Does not exist; drizzle-kit has no `--strict` exit-on-error mode |
| Use `--if-not-exists` guards in SQL | Masks errors; makes idempotency false-positive |
| Add a DB health endpoint and check there | Too late — problem is at apply time, not query time |
| Switch to a different ORM/migration tool | Out of scope for this epic; unacceptable scope expansion |
