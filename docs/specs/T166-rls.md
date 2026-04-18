# RFC: T166 — PostgreSQL Row-Level Security (RLS) Design Specification

**Status**: ACTIVE  
**Version**: 1.0.0  
**Date**: 2026-04-18  
**Author**: CLEO orchestrator (T166)

---

## 1. Purpose and Scope

This specification defines the design, implementation approach, and operational requirements for adding PostgreSQL Row-Level Security (RLS) policies to the LLMtxt backend.

**Problem**: Authorization is currently enforced at the application layer only (see `apps/backend/src/middleware/rbac.ts` and `auth.ts`). A compromised backend process, a SQL injection vulnerability, or a missing `WHERE` clause can leak cross-tenant data.

**Solution**: RLS enforces tenant isolation at the database engine layer. No query — regardless of whether it passes through application middleware — can return a row that the session user is not authorized to see.

**Out of scope**:
- RLS for SQLite (not supported by better-sqlite3)
- Changes to the application-layer RBAC model (that is T085)
- Organization-scoped cross-document access (covered by T085 role model; RLS enforces existing visibility rules)

---

## 2. Session Variables (SET LOCAL)

The postgres-js connection hook MUST inject the following session variables at the start of every transaction:

```sql
SET LOCAL app.current_user_id  = '<uuid>';    -- authenticated user id, '' for unauthenticated
SET LOCAL app.current_org_ids  = '<csv>';     -- comma-separated org ids the user belongs to, '' if none
SET LOCAL app.current_role     = '<role>';    -- 'authenticated' | 'anon'
SET LOCAL app.is_admin         = 'false';     -- 'true' ONLY when set by verified admin routes
```

These variables are set per-transaction using `SET LOCAL` (scoped to the transaction lifetime, not the connection, preventing cross-request leakage across connection pool entries).

### Admin Elevation

The `app.is_admin` variable MUST be `'false'` by default. It MUST only be set to `'true'` in routes protected by `requireAdmin` middleware, immediately before the database operation. It is NEVER set in the global connection hook.

---

## 3. RLS Policy Design

### 3.1 Policy Naming Convention

All policies follow the pattern:

```
rls_<table>_<operation>_<condition>
```

Examples:
- `rls_documents_select_owner`
- `rls_documents_insert_owner`
- `rls_api_keys_select_owner`

### 3.2 Tables Requiring RLS

**Group A — Documents and related (user-scoped via ownerId)**

| Table | Owner Column | RLS Strategy |
|-------|-------------|--------------|
| `documents` | `owner_id` | Multi-policy: public visibility bypass + owner + org + admin |
| `versions` | via `documents.owner_id` | Join to documents; owner of parent doc |
| `approvals` | via `documents.owner_id` | Join to documents |
| `state_transitions` | via `documents.owner_id` | Join to documents |
| `contributors` | via `documents.owner_id` | Join to documents |
| `version_attributions` | via `documents.owner_id` | Join to documents |
| `section_crdt_states` | via `documents.owner_id` | Join via slug |
| `section_crdt_updates` | via `documents.owner_id` | Join via slug |
| `document_events` | via `documents.owner_id` | Join via slug |
| `section_leases` | via `documents.owner_id` | Join via slug |
| `document_links` | via `documents.owner_id` | Either source or target accessible |
| `signed_url_tokens` | `agent_id` / via document | Join to documents |
| `section_embeddings` | via `documents.owner_id` | Join to documents |
| `blob_attachments` | via `documents.owner_id` | Join via slug |
| `collections` | `owner_id` | Owner direct; public visibility bypass |
| `collection_documents` | via `collections.owner_id` | Join to collections |
| `document_roles` | `user_id` | User sees their own grants; doc owner sees all |

**Group B — User-scoped (userId column directly)**

| Table | Owner Column | RLS Strategy |
|-------|-------------|--------------|
| `api_keys` | `user_id` | Owner only + admin |
| `webhooks` | `user_id` | Owner only + admin |
| `audit_logs` | `user_id` | User sees own; admin sees all |
| `agent_inbox_messages` | `to_agent_id` / `from_agent_id` | Sender or recipient |

### 3.3 Policy Template: Owner + Admin Bypass

```sql
-- SELECT: owner sees their own rows; admin sees all
CREATE POLICY rls_<table>_select ON <table>
  FOR SELECT
  USING (
    current_setting('app.is_admin', true) = 'true'
    OR user_id = current_setting('app.current_user_id', true)
  );

-- INSERT: user_id must match session
CREATE POLICY rls_<table>_insert ON <table>
  FOR INSERT
  WITH CHECK (
    current_setting('app.is_admin', true) = 'true'
    OR user_id = current_setting('app.current_user_id', true)
  );

-- UPDATE/DELETE: same as SELECT
```

### 3.4 Policy Template: Documents (Multi-condition)

```sql
CREATE POLICY rls_documents_select ON documents
  FOR SELECT
  USING (
    -- Admin bypass
    current_setting('app.is_admin', true) = 'true'
    -- Public documents are visible to everyone
    OR visibility = 'public'
    -- Owner always sees their document
    OR owner_id = current_setting('app.current_user_id', true)
    -- Explicit role grant
    OR EXISTS (
      SELECT 1 FROM document_roles dr
      WHERE dr.document_id = documents.id
        AND dr.user_id = current_setting('app.current_user_id', true)
    )
    -- Org visibility: user is a member of an associated org
    OR (visibility = 'org' AND EXISTS (
      SELECT 1 FROM document_orgs do_
        JOIN org_members om ON om.org_id = do_.org_id
      WHERE do_.document_id = documents.id
        AND om.user_id = current_setting('app.current_user_id', true)
    ))
  );
```

### 3.5 BYPASSRLS Role

A dedicated PostgreSQL role `llmtxt_bypass` with `BYPASSRLS` privilege is used for:
- The migration runner (needs unrestricted schema access)
- Background jobs (purge, embeddings, retention) that operate across tenants

The application's primary connection role (`llmtxt_app`) does NOT have `BYPASSRLS`.

---

## 4. Session Injection Architecture

### 4.1 postgres-js Connection Hook

The postgres-js client in `apps/backend/src/db/index.ts` MUST be extended with a `beforeQuery` hook (or equivalent transaction wrapper) that sets session variables.

The injection is done via a helper function `withRlsContext(db, userId, isAdmin)` that:
1. Wraps the provided database calls in a transaction
2. Executes `SET LOCAL app.*` at the start of the transaction
3. Executes the actual queries
4. Commits

For routes where the user is not yet known (e.g., health checks, public endpoints), the session variables are set with empty strings, causing the `current_user_id` check to fail and only public visibility documents to be visible.

### 4.2 Drizzle ORM Compatibility

Drizzle ORM uses postgres-js under the hood. The `withRlsContext` wrapper uses raw SQL for the `SET LOCAL` statements to avoid any Drizzle ORM interference:

```typescript
await db.execute(sql`SET LOCAL "app.current_user_id" = ${userId}`);
await db.execute(sql`SET LOCAL "app.current_role" = 'authenticated'`);
await db.execute(sql`SET LOCAL "app.is_admin" = 'false'`);
```

---

## 5. Migration Strategy

All RLS migrations are:
- **Additive only**: enable RLS + create policies; never modify existing data
- **Idempotent**: use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for policy creation (PostgreSQL lacks `CREATE POLICY IF NOT EXISTS`)
- **Ordered**: RLS on `documents` first, then child tables, then user-scoped tables

Migration naming: `20260418200000_rls_core_documents`, `20260418210000_rls_user_tables`, `20260418220000_rls_child_tables`.

---

## 6. Testing Requirements

### 6.1 Isolation Test (Mandatory — CI Gate)

```typescript
// test: tenant isolation — user A cannot read user B's private document
it('user A cannot SELECT document owned by user B', async () => {
  await withRlsContext(db, userA.id, false, async () => {
    const rows = await db.select().from(documents)
      .where(eq(documents.id, userBPrivateDocId));
    expect(rows).toHaveLength(0);
  });
});
```

### 6.2 SQL Injection Simulation

```typescript
// test: deliberate wrong WHERE clause is blocked by RLS
it('missing WHERE clause does not leak cross-tenant rows', async () => {
  await withRlsContext(db, userA.id, false, async () => {
    // No WHERE clause — RLS should filter to only userA's rows
    const rows = await db.select().from(documents);
    for (const row of rows) {
      expect(row.ownerId).toBe(userA.id);
    }
  });
});
```

### 6.3 Admin Bypass

```typescript
// test: admin can read all documents
it('admin bypass sees all documents', async () => {
  await withRlsContext(db, adminUser.id, true, async () => {
    const rows = await db.select().from(documents);
    expect(rows.length).toBeGreaterThanOrEqual(2); // both userA and userB docs
  });
});
```

### 6.4 Public Visibility

```typescript
// test: public documents are readable without authentication
it('public documents visible to unauthenticated session', async () => {
  await withRlsContext(db, '', false, async () => {
    const rows = await db.select().from(documents)
      .where(eq(documents.visibility, 'public'));
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

---

## 7. Non-Negotiables (RFC 2119)

- Migrations MUST be additive and MUST use idempotent policy creation.
- The `app.is_admin` variable MUST default to `'false'`; it MUST NOT be set in the global connection hook.
- Every existing query that works today MUST continue to work after RLS is enabled. If a query fails, the application code MUST be updated to pass `withRlsContext` rather than weakening the policy.
- RLS MUST be disabled for the migration runner role (`llmtxt_bypass`).
- CI MUST include at least one test that verifies cross-tenant isolation at the DB layer.

---

## 8. Implementation Order

1. `T166-1`: `withRlsContext` helper + postgres-js session injection
2. `T166-2`: Migration — enable RLS on `documents` + core policies
3. `T166-3`: Migration — enable RLS on `api_keys`, `webhooks`, `audit_logs`
4. `T166-4`: Migration — enable RLS on child tables (`versions`, `approvals`, `state_transitions`, `contributors`, `version_attributions`)
5. `T166-5`: Migration — enable RLS on CRDT tables (`section_crdt_states`, `section_crdt_updates`, `document_events`, `section_leases`)
6. `T166-6`: Migration — enable RLS on remaining tables (`document_roles`, `collections`, `collection_documents`, `document_links`, `signed_url_tokens`, `section_embeddings`, `blob_attachments`, `agent_inbox_messages`)
7. `T166-7`: Update all route handlers to use `withRlsContext`
8. `T166-8`: Integration test suite — tenant isolation, admin bypass, public visibility
9. `T166-9`: Documentation (`docs/security/rls.md`)

---

## 9. References

- `apps/backend/src/db/schema-pg.ts` — table definitions
- `apps/backend/src/db/index.ts` — postgres-js connection setup
- `apps/backend/src/middleware/auth.ts` — current user resolution
- `apps/backend/src/middleware/rbac.ts` — application-layer RBAC
- `apps/backend/src/middleware/admin.ts` — admin role verification
- PostgreSQL documentation: [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
