# Railway Deploy Recovery — FST_ERR_DUPLICATED_ROUTE Fix

**Date**: 2026-04-16
**Commit**: 6ef4307
**Status**: SUCCESS

---

## Duplicates Found and Resolved

### Duplicate 1 — CRASH-CAUSING: `GET /documents/:slug/similar`

**Files**: `apps/backend/src/routes/similarity.ts` and `apps/backend/src/routes/search.ts`

**Why it existed**: Two different features share the same path pattern.
- `similarityRoutes` (similarity.ts, older): finds similar **sections within** a document using ngram/shingle similarity. Query param: `?q=searchterm`.
- `searchRoutes` (search.ts, T102/T103, newer): finds similar **other documents** using semantic embedding (pgvector) or TF-IDF. Query params: `?limit=5&mode=semantic`.

When `searchRoutes` was added to `v1Routes`, it introduced a second `GET /documents/:slug/similar` registration inside the same `/api/v1` scope — causing Fastify to throw `FST_ERR_DUPLICATED_ROUTE` at startup.

**Resolution**: Renamed the `searchRoutes` path from `/documents/:slug/similar` to `/documents/:slug/similar-docs` in `apps/backend/src/routes/search.ts`. This accurately reflects its purpose (cross-document similarity). The `similarityRoutes` path `/documents/:slug/similar` was kept as the canonical intra-document section similarity endpoint.

**Kept**: `similarityRoutes` at `/documents/:slug/similar` (unchanged)
**Renamed**: `searchRoutes` to `/documents/:slug/similar-docs`

---

### Duplicate 2 — STRUCTURAL: `documentEventRoutes` in legacyScope

**Files**: `apps/backend/src/index.ts` legacyScope block (line ~498)

**Why it existed**: When T148 (document event log + SSE stream with Last-Event-ID resume, hash chain, idempotency) was implemented, it was registered in the legacyScope (`/api` prefix) alongside the v1Routes registration (`/api/v1` prefix). These two paths do NOT cause an immediate Fastify crash because they use different prefixes (`/api/documents/:slug/events` vs `/api/v1/documents/:slug/events`), but the registration violated the intended architecture.

T148 is a post-v1 feature with no legacy consumers — it was never shipped under `/api` without a version prefix, and no external client or test calls `/api/documents/:slug/events` without `/v1/`. The over-registration happened because the developer who implemented T148 registered it in both places "to ensure reachability."

**Resolution**: Removed `documentEventRoutes` from the legacyScope registration in `index.ts`. Also removed the now-unused top-level `import { documentEventRoutes }` from `index.ts` (v1Routes/index.ts has its own import). T148 endpoints are only available at `/api/v1/documents/:slug/events` and `/api/v1/documents/:slug/events/stream`.

**Kept**: `documentEventRoutes` registration in `apps/backend/src/routes/v1/index.ts`
**Removed**: `documentEventRoutes` from `legacyScope` block in `apps/backend/src/index.ts`

---

## Verified Clean (Not Duplicates)

The following were audited and confirmed to NOT cause collisions:

- `webhookRoutes` — appears in `v1Routes` (→ `/api/v1/webhooks`) AND as standalone `app.register(webhookRoutes, { prefix: '/api' })` (→ `/api/webhooks`). Different prefixes, no collision.
- `wsCrdtRoutes` — mounted at `app.register(wsCrdtRoutes, { prefix: '/api/v1' })` → `/api/v1/documents/:slug/sections/:sid/collab`. Inside `v1Routes`, `crdtRoutes` (crdt.ts) registers `/documents/:slug/sections/:sid/crdt-state` and `/documents/:slug/sections/:sid/crdt-update` — different paths, no collision.
- All other routes registered in both `v1Routes` and `legacyScope` use different prefixes (`/api/v1/...` vs `/api/...`) and do not collide.
- `presenceRoutes`, `leaseRoutes`, `subscribeRoutes`, `bftRoutes`, `scratchpadRoutes`, `a2aRoutes` — only in `v1Routes`, correct.

---

## Build and Test Results

- `pnpm --filter @llmtxt/backend run build` — SUCCESS (no TypeScript errors)
- `pnpm --filter @llmtxt/backend test` — 156/156 pass, 0 fail
- Local server boot (SQLite test DB): `Server listening at http://127.0.0.1:18081` — no FST_ERR_DUPLICATED_ROUTE

---

## Railway Deploy Status — SUCCESS

**Deploy triggered by**: git push to main (commit 6ef4307)
**New container hostname**: `7e9a8e6ae115`

```
Mounting volume on: /var/lib/.../vol_edgipvgqlecr71zs
Starting Container
[INFO] event="migrations_applied" driver="postgres" applied=0 skipped=7 durationMs=1054
[db] driver=postgres-js
[INFO] Semantic routes: using embedding provider "local-tfidf" (256d)
[crdt-pubsub] Redis pub/sub initialized
Server running on http://localhost:8080
[INFO] Server listening at http://127.0.0.1:8080
[INFO] Server listening at http://10.205.206.31:8080
[INFO] incoming request ... GET /api/health ... statusCode:200
```

Healthcheck succeeded. No FST_ERR_DUPLICATED_ROUTE in logs. Production is stable.
