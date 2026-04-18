# Row-Level Security (RLS) — Operational Guide

**Epic**: T166  
**Status**: Shipped (v2026.4.x)  
**Applies to**: PostgreSQL only (`DATABASE_PROVIDER=postgresql`)

---

## 1. Overview

LLMtxt enforces authorization at two layers:

| Layer | Mechanism | Where |
|-------|-----------|-------|
| Application | RBAC middleware (`requireAuth`, `requireAdmin`) | `src/middleware/` |
| Database | PostgreSQL Row-Level Security | PG policies on every table |

The database layer is the defense-in-depth backstop.  Even if a route handler
contains a bug (missing WHERE clause, SQL injection) the PostgreSQL engine
itself will refuse to return rows the session user is not authorized to see.

**PG-only**: SQLite does not support RLS.  `withRlsContext` is a no-op when
`DATABASE_PROVIDER=sqlite` — it calls the callback directly without opening a
transaction or issuing any SET LOCAL statements.

---

## 2. Session Variables (SET LOCAL contract)

Before every database query, the backend injects four session-scoped GUC
variables via `SET LOCAL`.  These are transaction-scoped (cleared when the
transaction commits or rolls back) so they cannot leak across connection-pool
reuse.

| Variable | Type | Description |
|----------|------|-------------|
| `app.current_user_id` | TEXT | Authenticated user UUID, or `''` for anonymous |
| `app.current_org_ids` | TEXT | Comma-separated org UUIDs, or `''` |
| `app.current_role` | TEXT | `'authenticated'` or `'anon'` |
| `app.is_admin` | TEXT | `'true'` or `'false'` — defaults to `'false'` |

### Reading variables inside policies

```sql
current_setting('app.current_user_id', true)   -- second arg = true → returns NULL if not set
current_setting('app.is_admin', true) = 'true'
```

The `true` (missing_ok) flag prevents an error when the variable has not been
set (e.g. during migration runs).

---

## 3. How withRlsContext works

```typescript
import { withRlsContext } from '../db/rls.js';

// Authenticated, non-admin:
const doc = await withRlsContext(db, { userId: session.userId }, async (tx) => {
  return tx.select().from(documents).where(eq(documents.id, docId));
});

// Admin-elevated route (must already have requireAdmin preHandler):
const all = await withRlsContext(db, { userId: adminId, isAdmin: true }, async (tx) => {
  return tx.select().from(documents);
});

// Anonymous/public request:
const pubDocs = await withRlsContext(db, { userId: '' }, async (tx) => {
  return tx.select().from(documents).where(eq(documents.visibility, 'public'));
});
```

The `withRlsContext` wrapper:
1. Opens a Drizzle transaction.
2. Executes `SET LOCAL "app.*" = ...` for each GUC.
3. Calls your callback with the transaction handle.
4. Commits (or rolls back on error).

### Fastify integration (request helpers)

Every Fastify request is decorated with:

```typescript
request.withRls(async (tx) => { /* non-admin */ });
request.withRlsAdmin(async (tx) => { /* admin — ONLY in requireAdmin-guarded routes */ });
request.rlsContext; // { userId, role, isAdmin }
```

These are registered by `plugins/rls-plugin.ts` and are no-ops in SQLite mode.

---

## 4. Admin bypass

`app.is_admin` defaults to `'false'` in every request.  It is NEVER set in the
global connection hook.

Set `isAdmin: true` only:
- In routes that have already verified admin status via `requireAdmin`.
- Using `request.withRlsAdmin(fn)` in Fastify handlers.
- Via `withRlsContext(db, { ..., isAdmin: true }, fn)` when calling directly.

```typescript
// WRONG — do not do this
const all = await withRlsContext(db, { userId: req.user.id, isAdmin: true }, fn);

// CORRECT — only after requireAdmin has verified the user
fastify.get('/admin/all-docs', { preHandler: [requireAdmin] }, async (req) => {
  return req.withRlsAdmin(async (tx) => tx.select().from(documents));
});
```

---

## 5. Tables covered

| Migration | Tables |
|-----------|--------|
| `20260418220000_rls_documents` | `documents` |
| `20260418230000_rls_user_tables` | `api_keys`, `webhooks`, `audit_logs` |
| `20260418240000_rls_doc_child_tables` | `versions`, `approvals`, `state_transitions`, `contributors`, `version_attributions` |
| `20260418250000_rls_crdt_tables` | `section_crdt_states`, `section_crdt_updates`, `document_events`, `section_leases` |
| `20260418260000_rls_remaining_tables` | `collections`, `collection_documents`, `document_roles`, `document_links`, `signed_url_tokens`, `section_embeddings`, `blob_attachments`, `agent_inbox_messages` |

---

## 6. Adding RLS to a new table

Follow this template:

```sql
-- 1. Enable RLS (idempotent)
ALTER TABLE my_new_table ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_new_table FORCE ROW LEVEL SECURITY;

-- 2. SELECT policy (always wrap in DO/EXCEPTION for idempotency)
DO $$
BEGIN
  CREATE POLICY rls_my_new_table_select ON my_new_table
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. INSERT policy
DO $$
BEGIN
  CREATE POLICY rls_my_new_table_insert ON my_new_table
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

### Rules for new migrations

- **Additive only**: Never DROP a policy or DISABLE RLS.
- **Idempotent**: Every CREATE POLICY wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`.
- **No BYPASSRLS on app role**: The `llmtxt_app` role must NOT have BYPASSRLS.
- **Migration runner**: The migration runner role (`llmtxt_bypass`) has BYPASSRLS and is exempt.
- **FORCE ROW LEVEL SECURITY**: Always add `ALTER TABLE ... FORCE ROW LEVEL SECURITY` so the table owner is also subject to policies.

---

## 7. Testing RLS

### Unit test (SQLite-safe)

```typescript
// Test that withRlsContext is a no-op in SQLite mode
it('withRlsContext is no-op in SQLite mode', async () => {
  const result = await withRlsContext(db, { userId: 'any' }, async () => 42);
  assert.equal(result, 42);
});
```

### Integration test (PG only)

```typescript
describe('isolation', { skip: !process.env.DATABASE_URL_PG }, () => {
  it('userA cannot see userB private doc', async () => {
    const rows = await withRlsContext(db, { userId: userA.id }, async (tx) => {
      return tx.select().from(documents).where(eq(documents.id, userBDocId));
    });
    assert.equal(rows.length, 0);
  });
});
```

Run against a real PG instance:
```bash
DATABASE_URL_PG=postgres://user:pass@localhost:5432/llmtxt_test \
  node --import tsx/esm --test src/__tests__/rls-isolation.test.ts
```

See `src/__tests__/rls-isolation.test.ts` for the full suite (T540).

---

## 8. Known limitations

| Limitation | Rationale |
|------------|-----------|
| SQLite not covered | SQLite does not support RLS (`SET LOCAL` is PG-only) |
| `org_ids` not enforced via app.current_org_ids | Org membership uses direct JOIN to `org_members`; CSV GUC approach is a future optimization |
| Background jobs bypass RLS | Jobs run as the migration role with BYPASSRLS |

---

## 9. References

- `apps/backend/src/db/rls.ts` — `withRlsContext` helper
- `apps/backend/src/plugins/rls-plugin.ts` — Fastify request decorators
- `apps/backend/src/__tests__/rls-context.test.ts` — Unit tests
- `apps/backend/src/__tests__/rls-isolation.test.ts` — Integration tests (T540)
- `docs/specs/T166-rls.md` — Design specification
- PostgreSQL docs: [Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
