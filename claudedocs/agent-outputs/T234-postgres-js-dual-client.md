# T234: postgres-js driver + dual-client db adapter

**Task**: T234 — Add postgres-js driver and swap drizzle adapter in db/index.ts
**Status**: complete
**Commit**: 20295ed
**Date**: 2026-04-15

## Summary

Swapped `pg` (node-postgres) for `postgres` (postgres-js) in the PostgreSQL code
path of `apps/backend/src/db/index.ts` and converted the sync transaction in
`conflicts.ts` to async.

## Files Modified

| File | Change |
|------|--------|
| `apps/backend/package.json` | `pg@^8.20.0` → `postgres@^3.4.9`; removed `@types/pg` |
| `apps/backend/src/db/index.ts` | Swapped `pg.Pool` + `drizzle-orm/node-postgres` → `postgres()` + `drizzle-orm/postgres-js`; added `dbDriver` export; added implicit URL-scheme detection |
| `apps/backend/src/routes/conflicts.ts` | Converted `persistNewVersion` sync tx to async; removed `{ behavior: 'immediate' }`; all `.run()` / `.all()` replaced with `await` |
| `apps/backend/src/routes/health.ts` | Updated comment (node-postgres → postgres-js) |
| `pnpm-lock.yaml` | Lockfile updated with `postgres@3.4.9` |

## package.json diff (deps)

```diff
-  "pg": "^8.20.0",
+  "postgres": "^3.4.9",
```

```diff
-  "@types/pg": "^8.20.0",
```

## Acceptance Gates Passed

- `postgres@^3.4.9` present in `apps/backend/package.json` dependencies
- `db/index.ts` uses `drizzle-orm/postgres-js` for the postgresql path
- `dbDriver: 'postgres' | 'sqlite'` exported for consumers
- Implicit scheme detection: `postgres://` / `postgresql://` URLs → PG driver
- `conflicts.ts` `persistNewVersion` fully async (no `.run()` / `.all()` remaining)
- UNIQUE retry catches both SQLite (`UNIQUE constraint failed`) and PG (`unique constraint`) error messages

## Verification

- `pnpm build` — clean tsc, 0 errors
- `pnpm test` — 67/67 pass (tests run against SQLite as DATABASE_URL is file-backed)
- `pnpm lint` — 0 warnings, 0 errors
- No raw `better-sqlite3` imports outside `db/index.ts`
- No `pg`/`@types/pg` imports remaining in source files

## Notes

- `prepare: false` passed to postgres-js constructor — required by Drizzle ORM to avoid named-portal conflicts
- Pool size set to `max: 10` (task brief) rather than the old `max: 20` PG Pool value
- DATABASE_URL is NOT changed on Railway — that is T243
- TODO comments in `db/index.ts` reference T235/T236 for the schema-pg drift fix
