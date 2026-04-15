# SPEC-T144: Migration Safety in CI

**Status**: Approved
**Date**: 2026-04-15
**Epic**: T144
**RFC 2119 compliance**: This specification uses MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY per RFC 2119.

---

## 1. Scope

This specification governs the CI migration safety gate and deploy-time migration strictness for `apps/backend`. It covers:

- Static lint of migration SQL files.
- CI integration test running migrations against a fresh SQLite database.
- Idempotency enforcement.
- Strict migrate-before-start at deploy time.
- Authoring contract documentation.

---

## 2. Definitions

- **Migration file**: Any `migration.sql` file under `apps/backend/src/db/migrations/`.
- **Fresh-DB run**: Running all migrations against a newly created, empty SQLite database with no prior schema.
- **Idempotency run**: Running all migrations a second time against the same database that already has the schema applied.
- **Migration lint**: Static analysis of migration SQL files without executing any SQL.
- **Duplicate DDL**: Two or more migration files containing a `CREATE TABLE <name>` or `CREATE [UNIQUE] INDEX <name>` statement with the same name.

---

## 3. Static Lint Requirements

3.1. A lint script `apps/backend/scripts/check-migrations.sh` MUST exist and be executable.

3.2. The lint script MUST scan all files matching `apps/backend/src/db/migrations/**/migration.sql`.

3.3. For each `CREATE TABLE <name>` statement found (case-insensitive), the lint script MUST build a mapping of table name to the list of files in which it appears.

3.4. If any table name appears in two or more distinct migration files, the lint script MUST print a human-readable error identifying the table name and the conflicting file paths, then MUST exit with a non-zero exit code.

3.5. The lint script MUST apply the same duplicate detection to `CREATE INDEX <name>` and `CREATE UNIQUE INDEX <name>` statements.

3.6. The lint script MUST exit 0 if no duplicates are found.

3.7. The lint script MUST NOT require a Node.js runtime, a database connection, or internet access to execute.

3.8. The lint script SHOULD complete in under 5 seconds on any standard CI runner.

---

## 4. CI Fresh-DB Integration Requirements

4.1. A migration integration script `apps/backend/scripts/ci-migrate-check.sh` MUST exist and be executable.

4.2. The script MUST create a temporary SQLite database file using `mktemp` or equivalent, ensuring the file does not persist between CI runs.

4.3. The script MUST run `pnpm db:migrate` (resolving to `drizzle-kit migrate`) with `DATABASE_URL` pointing at the temp database. It MUST capture both stdout and stderr.

4.4. The script MUST fail with exit code 1 if the `drizzle-kit migrate` process itself exits with a non-zero exit code.

4.5. The script MUST fail with exit code 1 if the captured output contains any of the following strings (case-insensitive): `already exists`, `SQLITE_ERROR`, `error:`.

4.6. After the first successful run, the script MUST run migrations a second time against the same database (the idempotency run).

4.7. The script MUST apply the same exit-code and output checks to the idempotency run (requirements 4.4 and 4.5).

4.8. The script MUST delete the temporary database file on completion, regardless of pass or fail.

4.9. The script MUST exit 0 only when both the fresh run and the idempotency run pass all checks.

---

## 5. CI Workflow Requirements

5.1. A GitHub Actions job named `migration-check` MUST be added to `.github/workflows/ci.yml`.

5.2. The `migration-check` job MUST run on every pull request targeting `main` and on every push to `main`.

5.3. The `migration-check` job MUST execute `check-migrations.sh` (the lint step) before `ci-migrate-check.sh` (the integration step).

5.4. The `migration-check` job MUST fail the PR if either script exits with a non-zero exit code.

5.5. The `migration-check` job MUST be listed as a required status check for branch protection on `main`. (This is a GitHub repo settings requirement to be applied by the repository owner.)

5.6. The `migration-check` job SHOULD reuse the pnpm + Node 24 setup already present in the `typescript` job to avoid duplicating toolchain installation.

5.7. The `migration-check` job MUST NOT require network access beyond what pnpm cache provides.

---

## 6. Deploy-Time Migration Requirements

6.1. A migration runner script `apps/backend/scripts/run-migrations.ts` MUST exist and be the entry point for apply-migrations at deploy time.

6.2. The runner script MUST use Drizzle ORM's programmatic migration API (not `drizzle-kit` CLI) so that errors are thrown as JavaScript exceptions.

6.3. The runner script MUST call `process.exit(1)` (or propagate an uncaught exception to let Node exit non-zero) if any migration fails.

6.4. The Railway/Docker start command MUST be updated to call the migration runner before starting the HTTP server.

6.5. The HTTP server MUST NOT bind to a port if the migration runner exits with a non-zero exit code.

6.6. The migration runner MUST log a structured message on success: `{ event: "migrations_applied", count: N, durationMs: M }`.

6.7. The migration runner MUST log a structured error on failure: `{ event: "migration_failed", error: "<message>" }` before exiting.

---

## 7. Authoring Contract Requirements

7.1. A file `apps/backend/drizzle/MIGRATIONS.md` MUST be created documenting the migration authoring contract.

7.2. The contract MUST state that each migration file MUST introduce only new tables or new indexes. Altering or dropping existing objects MUST be done in a separate migration.

7.3. The contract MUST state that `IF NOT EXISTS` guards MUST NOT be used in migration SQL files (they mask errors that the lint and CI check are designed to catch).

7.4. The contract MUST state that authors MUST run `check-migrations.sh` locally before opening a pull request.

7.5. The contract MUST state that raw DDL MUST NOT be executed directly against the production database outside of the drizzle migration system.

---

## 8. Acceptance Criteria (from epic T144)

8.1. The `migration-check` CI job runs on every PR to `main` and fails if `drizzle-kit migrate` exits non-zero or stderr contains "already exists".

8.2. A fixture script creates a blank SQLite then runs all migrations end-to-end; the job fails on any error.

8.3. A lint script scans all migration files and rejects if the same table name appears in two separate `CREATE TABLE` statements.

8.4. The migrate-and-start sequence in Docker/Railway uses a strict wrapper that propagates non-zero exit and halts container startup before the HTTP server binds.

8.5. `apps/backend/drizzle/MIGRATIONS.md` exists and documents the authoring contract.

---

## 9. Non-Requirements

- This spec does NOT cover PostgreSQL migration safety (separate epic).
- This spec does NOT cover automatic migration repair.
- This spec does NOT cover database backup before migration.
- This spec does NOT cover migration rollback.
