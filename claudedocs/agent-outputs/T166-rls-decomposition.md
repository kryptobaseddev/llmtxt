# T166 Decomposition — PostgreSQL Row-Level Security

**Date**: 2026-04-18  
**Epic**: T166 — Security: Row-level security (PostgreSQL RLS policies enforce org/role/visibility at DB layer)  
**Protocol**: decomposition | Tier 2

---

## Research Findings

### Codebase Inventory

**Database connection**: `apps/backend/src/db/index.ts`
- postgres-js driver created with `postgres(url, { max: 10, prepare: false })`
- No existing session variable injection — this is where the hook goes
- `DATABASE_PROVIDER` env var gates PG vs SQLite path

**Auth layer**: `apps/backend/src/middleware/auth.ts`
- `request.user.id` is the resolved userId (string)
- Bearer API key auth and cookie session auth both populate `request.user`
- Admin check is in `apps/backend/src/middleware/admin.ts` via `ADMIN_EMAILS` env var

**RBAC layer**: `apps/backend/src/middleware/rbac.ts`
- Permission resolution logic exists at app layer
- RLS will mirror this logic at DB layer for defense-in-depth

**Tenant-scoped tables identified** (21 tables requiring RLS):

| Group | Tables |
|-------|--------|
| User-direct | api_keys, webhooks, audit_logs |
| Documents | documents (root + org/role subqueries) |
| Document children (via doc.id) | versions, approvals, state_transitions, contributors, version_attributions, section_embeddings |
| Document children (via doc.slug) | section_crdt_states, section_crdt_updates, document_events, section_leases, blob_attachments |
| Remaining | collections, collection_documents, document_roles, document_links, signed_url_tokens, agent_inbox_messages |

**Infrastructure tables** (no RLS needed — no user scoping):
users, sessions, accounts, verifications, organizations, org_members, document_orgs, pending_invites, agent_pubkeys, agent_signature_nonces, audit_checkpoints

### Migration System

Migrations live in `apps/backend/src/db/migrations-pg/` as timestamped directories. Each has `migration.sql` + `snapshot.json`. The MIGRATIONS.md contract says: no `IF NOT EXISTS` (for new tables), but the monetization and hash chain migrations use `IF NOT EXISTS` for additive-only changes — this pattern is followed here. PostgreSQL lacks `CREATE POLICY IF NOT EXISTS` so we use `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` for policy idempotency.

---

## Decomposition Output

### Children Created

| ID | Title | Size | Status | Blocks |
|----|-------|------|--------|--------|
| T533 | T166.1: withRlsContext helper — postgres-js SET LOCAL session injection | small | pending | T534, T539 |
| T534 | T166.2: Migration — enable RLS on documents table | medium | pending | T535, T536, T537, T538 |
| T535 | T166.3: Migration — enable RLS on api_keys, webhooks, audit_logs | small | pending | T539 |
| T536 | T166.4: Migration — enable RLS on versions, approvals, state_transitions, contributors, version_attributions | medium | pending | T539 |
| T537 | T166.5: Migration — enable RLS on CRDT tables | small | pending | T539 |
| T538 | T166.6: Migration — enable RLS on remaining 8 tables | medium | pending | T539 |
| T539 | T166.7: Route handler integration — inject withRlsContext | large | pending | T540 |
| T540 | T166.8: Integration test suite — pg-isolation | medium | pending | T541 |
| T541 | T166.9: Documentation — docs/security/rls.md | small | pending | — |

**Total**: 9 children. Wave 0: T533. Wave 1: T534. Wave 2: T535+T536+T537+T538 (parallel). Wave 3: T539. Wave 4: T540. Wave 5: T541.

### Key Design Decisions

1. **SET LOCAL over connection-level SET**: Session variables are scoped to the transaction, not the connection. This prevents cross-request leakage in connection pools.

2. **`withRlsContext(db, userId, isAdmin, fn)` wrapper pattern**: Rather than a Fastify middleware that mutates global state, each database call is wrapped in an explicit context. This makes the context explicit in code and avoids the risk of a stale session variable from a previous request.

3. **isAdmin defaults to false**: The admin bypass is opt-in and requires explicit `isAdmin=true` passed from routes protected by `requireAdmin`. The global connection hook never sets it to true.

4. **Documents policy uses multi-condition OR**: Mirrors the existing RBAC logic from `rbac.ts` — public visibility bypass + owner + explicit role grant + org membership. This ensures feature parity between app-layer and DB-layer enforcement.

5. **Idempotent policy creation via DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$**: PostgreSQL lacks `CREATE POLICY IF NOT EXISTS`. This pattern handles re-runs safely.

6. **Audit logs INSERT is unrestricted**: The audit log must always be writable by the app — restricting INSERT would break audit trail creation.

7. **CRDT tables join via slug not id**: `section_crdt_states`, `section_crdt_updates`, `document_events`, `section_leases` FK to `documents.slug` not `documents.id`. RLS policies join accordingly.

### Spec Location

`/mnt/projects/llmtxt/docs/specs/T166-rls.md`

---

## Status

complete
