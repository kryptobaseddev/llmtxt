# T240 — SQLite-to-Postgres Data Migration Script

**Task**: T233.7: Write one-time SQLite-to-Postgres data migration script
**Status**: complete
**Commit**: 31e1ba8
**Script**: `apps/backend/scripts/migrate-sqlite-to-postgres.ts`

## Summary

Created a one-time production cutover script that migrates all 22 tables from
a SQLite source database to PostgreSQL in FK dependency order.

## Implementation

### Script location
`apps/backend/scripts/migrate-sqlite-to-postgres.ts`

### Environment variables
- `SQLITE_SOURCE_PATH` (or alias `SQLITE_DATABASE_URL`) — path to SQLite file
- `POSTGRES_TARGET_URL` (or alias `POSTGRES_DATABASE_URL`) — PG connection string
- `BATCH_SIZE` — rows per INSERT batch (default: 1000)
- `DRY_RUN=1` — report counts only, skip inserts

### Table order (22 tables, topologically sorted)
1. users (no FKs)
2. verifications (no FKs)
3. sessions (FK: users)
4. accounts (FK: users)
5. api_keys (FK: users)
6. organizations (FK: users)
7. collections (FK: users)
8. documents (FK: users via ownerId)
9. versions (FK: documents)
10. state_transitions (FK: documents)
11. approvals (FK: documents)
12. contributors (FK: documents)
13. signed_url_tokens (FK: documents)
14. audit_logs (no FK constraint in PG schema)
15. document_roles (FK: documents, users)
16. pending_invites (FK: documents)
17. webhooks (FK: users)
18. version_attributions (FK: documents)
19. document_links (FK: documents x2)
20. org_members (FK: organizations, users)
21. document_orgs (FK: documents, organizations)
22. collection_documents (FK: collections, documents)

### Type conversions applied
- `integer({mode:'boolean'})` SQLite 0/1 → JS `boolean` (`toBool`)
  Covers: `email_verified`, `is_anonymous` on users/documents,
  `approval_require_unanimous`, `revoked` on signedUrlTokens/apiKeys, `active` on webhooks
- `integer({mode:'timestamp'})` SQLite → `Date` objects (`toDate`)
  Covers: `created_at`, `updated_at`, `expires_at` on users/sessions/accounts/verifications
- SQLite `blob` → Node.js `Buffer` for `bytea` columns (`toBuffer`)
  Covers: `compressed_data` on documents and versions

### Safety properties
- ON CONFLICT DO NOTHING on all inserts (idempotent, re-runnable)
- Source SQLite opened read-only (`{ readonly: true }`)
- Source never modified
- Count verification after migration (pgCount >= sqliteCount)
- Exits non-zero on any error or count mismatch
- Credentials redacted from logged connection string

### Driver
Uses `postgres` (postgres-js) driver with `drizzle-orm/postgres-js` adapter,
consistent with the ADR-T233 D1 decision.

## Verification

- `npx tsc --noEmit`: clean (no type errors)
- `pnpm build`: passes (`apps/backend build: Done`)
- `pnpm -F backend lint`: clean (no warnings, no errors)
- Local smoke test: not run (no local SQLite snapshot available)
- Pre-existing test failures in integration.test.ts are unrelated to this script
  (introduced by T236/T239 work; confirmed by comparing with clean main)

## Notes for operator

Run during maintenance window (writes disabled):
```bash
SQLITE_SOURCE_PATH=/app/data/data.db \
POSTGRES_TARGET_URL="${Postgres.DATABASE_URL}" \
npx tsx apps/backend/scripts/migrate-sqlite-to-postgres.ts
```

Each table emits a JSON line:
```json
{"table":"documents","read":1523,"written":1523,"durationMs":340}
```

Exit 0 = all counts match. Exit 1 = error or mismatch.
