# SPEC-T233: PostgreSQL Migration Specification

**Status**: Draft
**Date**: 2026-04-15
**Epic**: T233 — Ops: SQLite → Postgres migration
**RFC 2119 keywords**: MUST, MUST NOT, SHOULD, MAY

---

## 1. Overview

This specification defines the requirements for migrating the LLMtxt API backend
from SQLite (`better-sqlite3`) to PostgreSQL (`postgres-js` / `drizzle-orm/postgres-js`),
using the Railway-provisioned Postgres service at `${{Postgres.DATABASE_URL}}`.

Completion of this spec's MUST requirements is a gate for T146 (CRDT) and T148
(event log) IVTR.

---

## 2. Driver Requirements

### 2.1 Postgres-JS Driver

The implementation MUST use the `postgres` npm package (postgres-js) as the
database driver, replacing the existing `pg` (node-postgres) import in
`src/db/index.ts`.

The implementation MUST use `drizzle-orm/postgres-js` as the Drizzle adapter for
the PostgreSQL code path, replacing `drizzle-orm/node-postgres`.

The `pg` and `@types/pg` packages SHOULD be removed from `package.json` once no
other code references them directly.

### 2.2 Connection Configuration

The postgres-js connection MUST be configured with `max: 20` connections
(matching the previous node-postgres Pool configuration).

The connection string MUST read from `process.env.DATABASE_URL` when
`DATABASE_PROVIDER === 'postgresql'`.

The implementation MUST NOT hardcode any connection credentials.

---

## 3. Schema Requirements

### 3.1 Canonical Schema

`src/db/schema-pg.ts` MUST be the canonical schema after migration. All future
table additions MUST be made to `schema-pg.ts`.

`src/db/schema.ts` (SQLite) MUST NOT receive any new columns or tables after
T233 is merged. It MAY be kept for rollback reference.

### 3.2 Drift Correction

`schema-pg.ts` MUST include the `versionCount` column on the `documents` table:

```typescript
versionCount: integer('version_count').notNull().default(0),
```

This column is present in `schema.ts` line 166 but is absent from `schema-pg.ts`.
Its absence MUST be corrected before generating PG migrations.

### 3.3 All Existing Tables

The PG schema MUST include all 20 tables present in `schema.ts`:
users, sessions, accounts, verifications, documents, versions, stateTransitions,
approvals, contributors, signedUrlTokens, apiKeys, auditLogs, documentRoles,
organizations, orgMembers, documentOrgs, pendingInvites, webhooks, documentLinks,
collections, collectionDocuments.

---

## 4. Migration Generation Requirements

### 4.1 Fresh PG Migration Series

The implementation MUST generate PG migrations using drizzle-kit against
`schema-pg.ts`, NOT by cross-compiling or replaying SQLite migrations.

The command to generate migrations MUST be:
```bash
drizzle-kit generate --config=drizzle-pg.config.ts
```

The output MUST land in `src/db/migrations-pg/`.

### 4.2 Migration Idempotency

All PG migrations MUST be idempotent — running them twice MUST NOT produce
errors. Drizzle-generated migrations satisfy this via `IF NOT EXISTS` on CREATE
TABLE statements.

### 4.3 T146 and T148 Coordination

T233 MUST NOT pre-create `section_crdt_states`, `section_crdt_updates`, or
`document_events` tables. Those tables belong to T146 and T148 respectively and
MUST be added as incremental migrations after T233 baseline lands.

---

## 5. Data Migration Script Requirements

### 5.1 Script Location

A one-time data migration script MUST be created at:
`scripts/migrate-sqlite-to-postgres.ts`

### 5.2 Script Behavior

The script MUST:
a. Read source data from the SQLite database identified by `SQLITE_DATABASE_URL`
   env var (defaulting to the current `DATABASE_URL` if SQLite).
b. Write to the Postgres database identified by `POSTGRES_DATABASE_URL` env var.
c. Migrate tables in dependency order: users → sessions → accounts → verifications
   → documents → versions → stateTransitions → approvals → contributors →
   signedUrlTokens → apiKeys → auditLogs → documentRoles → organizations →
   orgMembers → documentOrgs → pendingInvites → webhooks → documentLinks →
   collections → collectionDocuments.
d. Wrap each table's INSERT batch in a single Postgres transaction.
e. Verify row counts after each table migration.
f. Exit non-zero if any row count mismatches.
g. Emit a summary to stdout with per-table row counts and timing.

The script MUST NOT drop any tables before migrating.
The script MUST NOT modify the source SQLite database.
The script MUST handle `Buffer` / `Uint8Array` conversion for `bytea` columns
(compressed_data fields) — SQLite stores BLOB as Node.js Buffer; Postgres
expects Buffer via bytea.

### 5.3 Boolean Conversion

SQLite stores booleans as `0`/`1` integers. The script MUST convert integer
booleans to JavaScript `boolean` before inserting into Postgres boolean columns:
- `email_verified`, `is_anonymous` in users
- `is_anonymous`, `approval_require_unanimous` in documents
- `revoked` in signed_url_tokens, api_keys, webhooks
- `active` in webhooks

---

## 6. Application Code Requirements

### 6.1 `conflicts.ts` Transaction Fix

The `persistNewVersion` function in `src/routes/conflicts.ts` MUST be converted
from synchronous to asynchronous:
- The `db.transaction(callback, { behavior: 'immediate' })` call MUST be replaced
  with `await db.transaction(async (tx) => { ... })`.
- All `.run()` calls inside the callback MUST become `await tx.insert/update/select`.
- The `{ behavior: 'immediate' }` option MUST be removed.

This MUST NOT change the semantic behavior — the UNIQUE constraint retry pattern
MUST be preserved.

### 6.2 `db/index.ts` Driver Swap

`src/db/index.ts` MUST be updated to use `postgres-js`:

```typescript
// Replace:
const { Pool } = await import('pg');
const { drizzle } = await import('drizzle-orm/node-postgres');
const pool = new Pool({ connectionString: ..., max: 20, ... });
_db = drizzle({ client: pool, schema: pgSchema });

// With:
const postgres = await import('postgres');
const { drizzle } = await import('drizzle-orm/postgres-js');
const client = postgres.default(url, { max: 20 });
_db = drizzle({ client, schema: pgSchema });
```

### 6.3 Environment Variable

The application MUST read `DATABASE_URL` from environment when in PG mode.
The `DATABASE_URL` env var on the `llmtxt-api` Railway service MUST be set to
`${{Postgres.DATABASE_URL}}` before the PG-mode deployment.

`DATABASE_PROVIDER` env var MUST be set to `postgresql` on the `llmtxt-api`
Railway service.

---

## 7. Test Requirements

### 7.1 All 67 Backend Tests MUST Pass Against PG

After migration, all 67 backend tests MUST pass when run against a Postgres
database. This is verified by running the test suite with:
```
DATABASE_PROVIDER=postgresql DATABASE_URL=<pg-url> node --import tsx/esm --test
```

### 7.2 Test Harness Port

`src/__tests__/integration.test.ts` and `src/__tests__/api-keys.test.ts` MUST
NOT use `better-sqlite3` or raw `sqlite.exec()` for test setup.

Both files MUST be refactored to use one of:
a. Drizzle PG migrations against an ephemeral Postgres container (preferred), or
b. A provider-agnostic setup helper that detects `DATABASE_PROVIDER` and
   bootstraps accordingly.

### 7.3 CI Postgres Service

The GitHub Actions CI workflow MUST include a Postgres service container for
backend tests:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: llmtxt_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

### 7.4 Concurrent Write Tests

Concurrent write tests (multiple agents appending versions simultaneously) MUST
pass against PG. The UNIQUE constraint retry mechanism MUST be verified with at
least 5 concurrent write attempts in a single test.

---

## 8. Cutover Requirements

### 8.1 Cutover Runbook

A runbook MUST be created at `docs/runbooks/postgres-cutover.md` describing the
exact sequence of operations to perform the production cutover.

### 8.2 Cutover Order of Operations

The production cutover MUST follow this exact order:
1. Enable maintenance mode (return 503 to all write endpoints).
2. Wait for in-flight requests to drain (30 seconds).
3. Run `scripts/migrate-sqlite-to-postgres.ts` from a Railway one-off instance
   with access to both SQLite volume and Postgres service.
4. Verify row counts (script outputs this automatically).
5. Update Railway env vars: set `DATABASE_URL=${{Postgres.DATABASE_URL}}`,
   set `DATABASE_PROVIDER=postgresql`.
6. Redeploy the `llmtxt-api` service.
7. Run health checks: `GET /api/health` MUST return 200, `GET /api/ready`
   MUST return 200.
8. Run 5 smoke tests (create document, read document, create version, list
   versions, health endpoints).
9. Disable maintenance mode.

### 8.3 Maximum Acceptable Downtime

The cutover MUST complete within 10 minutes total. Steps 1-9 are expected to
complete in 2-5 minutes under normal conditions.

---

## 9. Rollback Requirements

### 9.1 SQLite Volume Retention

The Railway volume containing the SQLite database MUST NOT be deleted for 30
days after successful production cutover.

### 9.2 Rollback Capability

The rollback path MUST be documented in `docs/runbooks/postgres-cutover.md`.
Rollback MUST be achievable by:
1. Reverting `DATABASE_URL` to the SQLite file path.
2. Reverting `DATABASE_PROVIDER` to `sqlite`.
3. Redeploying the previous container image.

The SQLite schema MUST remain compatible with the deployed SQLite-mode code
version for the 30-day retention window.

---

## 10. Non-Requirements (Out of Scope)

This epic MUST NOT:
- Implement Postgres Row-Level Security (tracked separately in T166).
- Implement multi-region replication (tracked in T078).
- Upgrade Drizzle ORM to a different version beyond the current beta.
- Change any API behavior, response shapes, or endpoint paths.
- Add new application features.
