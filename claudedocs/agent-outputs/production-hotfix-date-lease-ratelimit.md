# Production Hotfix: Date/ISO, Bodyless DELETE Lease, Per-Agent Rate-Limit

**Date**: 2026-04-16
**Tasks**: T362, T363, T364 (+ 2 undiscovered bugs found during investigation)
**Railway Deploy**: SUCCESS (baf3480b-e10f-482a-a8e2-3296772533c0)
**API Health**: `{"status":"ok"}` confirmed post-deploy

---

## Bug 1 (CRITICAL — startup crash) — crdt-compaction Date→ISO

**File**: `apps/backend/src/jobs/crdt-compaction.ts`
**Root Cause**: Line 58 interpolated a JavaScript `Date` object directly into a
drizzle-orm `sql\`...\`` tagged template literal. The `postgres-js` driver rejected
the binding with `TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of
type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`.
This crashed the compaction job on startup (run immediately after a 30s warm-up delay),
and the crash propagated to the Railway health-check loop, causing repeated 502 responses.

**Fix**: Convert `cutoffDate` to ISO 8601 string before interpolation:
```ts
// Before:
OR MIN(created_at) < ${cutoffDate}
// After:
OR MIN(created_at) < ${cutoffDate.toISOString()}
```

**Commit**: `9219982` (fix(hotfix): Date→ISO, bodyless DELETE lease, per-agent rate-limit key)

---

## Bug 2 (T363 — high) — Lease DELETE FST_ERR_CTP_EMPTY_JSON_BODY

**File**: `apps/backend/src/routes/leases.ts`
**Root Cause**: The DELETE `/documents/:slug/sections/:sid/lease` route had no body
schema. When agents sent `Content-Type: application/json` without a body (RESTful
bodyless DELETE), Fastify's JSON body parser attempted to parse an empty buffer and
emitted `FST_ERR_CTP_EMPTY_JSON_BODY` before the handler ran. All 4 lease release
attempts in Wave C returned 400.

**Fix**: Added `schema: { body: { type: 'object', nullable: true, additionalProperties: true } }`
to the DELETE route config so Fastify treats an absent or empty body as valid.

**Commit**: `9219982`

---

## Bug 3 (T362 — critical) — Scratchpad Rate-Limit by IP Instead of Agent Identity

**File**: `apps/backend/src/middleware/rate-limit.ts`
**Root Cause**: `keyGenerator` fell through to `ip:${request.ip}` for requests
carrying `x-agent-pubkey-id` or `x-agent-id` headers but no Bearer token. On Railway,
all container-to-container traffic originates from `100.64.0.x` private IP space — so
4+ agents collapsed to a single rate-limit bucket and hit the 120 req/min write limit
instantly. 240 scratchpad POSTs in Wave C all returned 429/500.

**Fix**: Added two priority levels to `keyGenerator` between session-user and IP:
1. `agent:${agentPubkeyId}` — verified identity from `verifyAgentSignature` (T147)
2. `agent:${x-agent-id header}` — self-reported, best-effort fallback

Multi-agent routes (scratchpad, CRDT, leases, A2A, BFT) now rate-limit per identity,
not per network origin.

**Commit**: `9219982`

---

## Bug 4 (undiscovered — deploy blocker) — postgres pkg missing from packages/llmtxt

**File**: `packages/llmtxt/package.json`
**Root Cause**: `packages/llmtxt/dist/pg/pg-backend.js` uses `await import('postgres')`
at runtime, but `postgres` was only declared in `apps/backend/package.json`. pnpm
installs it into `apps/backend/node_modules` only. From Node's module resolution
perspective starting at `packages/llmtxt/dist/pg/pg-backend.js`, it searches
`packages/llmtxt/node_modules` then the workspace root — neither contained `postgres`.
The Dockerfile copies `apps/backend/node_modules` separately but the resolution tree
from `packages/llmtxt` never reaches it. Resulted in `ERR_MODULE_NOT_FOUND` crash-loop
on all deployments after the three-bug commit.

**Fix**: Added `"postgres": "^3.4.9"` to `packages/llmtxt` `optionalDependencies`,
matching the existing pattern for `drizzle-orm` and `better-sqlite3`. pnpm now installs
`postgres` into `packages/llmtxt/node_modules`, which the Dockerfile includes via
`COPY --from=build /app/packages/llmtxt ./packages/llmtxt`.

**Commit**: `e357b65` (fix(deploy): add postgres as optional dep of packages/llmtxt)

---

## Bug 5 (undiscovered — non-fatal but noisy) — crdt-compaction wrong execute() result shape

**File**: `apps/backend/src/jobs/crdt-compaction.ts`
**Root Cause**: `db.execute(sql\`...\`)` with `drizzle-orm/postgres-js` returns the
rows array directly (not a `{ rows: [...] }` wrapper). The code accessed
`candidateQuery.rows` which was `undefined`, causing
`TypeError: Cannot read properties of undefined (reading 'length')` on every 6h
compaction run. Non-fatal (caught in outer try/catch) but prevented compaction from
ever running.

**Fix**: Cast the result directly as the array of row objects:
```ts
// Before:
const candidates = candidateQuery.rows as Array<{...}>;
// After:
const candidates = (candidateQuery as unknown as Array<{...}>);
```

Pattern matches the existing usage in `crdt/persistence.ts` (line 182+).

**Commit**: `e0e4d3f` (fix(crdt-compaction): use correct drizzle-orm/postgres-js execute() result shape)

---

## Railway Deploy Status

| Deployment | Status | Timestamp |
|---|---|---|
| `baf3480b` | SUCCESS | 2026-04-16T08:25 UTC |
| Previous 8 deployments | FAILED | crash-loop |

Startup log confirms:
- `[db] driver=postgres-js` — Postgres connected
- `[postgres-backend-plugin] PostgresBackend opened` — no ERR_MODULE_NOT_FOUND
- `[crdt-compaction] job scheduled (interval: 6h)` — compaction job starts
- `GET /api/health → 200` — health check passes
- No `TypeError` on startup

---

## Task Closure

| Task | Status | Notes |
|---|---|---|
| T362 | done | Rate-limit by agent identity, not IP |
| T363 | done | Bodyless DELETE lease accepted |
| T364 | done | Startup crash resolved — container stable |

---

## Files Changed

- `apps/backend/src/jobs/crdt-compaction.ts` — Date→ISO + execute() result shape
- `apps/backend/src/routes/leases.ts` — nullable body schema on DELETE
- `apps/backend/src/middleware/rate-limit.ts` — per-agent keyGenerator
- `packages/llmtxt/package.json` — postgres optional dep
- `pnpm-lock.yaml` — lock file updated
