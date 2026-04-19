# T765 Ecosystem Polish — Aggregate Report

**Date**: 2026-04-19
**Tasks**: T766 (Postman), T767 (Error Catalog), T768 (OpenAPI Prod Verify), T770 (this doc)
**Parent epic**: T765 — v2026.4.11: Ship 9/10 + 8/8

---

## Summary

Four deliverables shipped to close scorecard dimensions 2 (ecosystem maturity) and 6 (open standards):

| Item | Task | Status | Files |
|---|---|---|---|
| Postman collection (auto-gen from OpenAPI) | T766 | done | `docs/api/postman-collection.json`, `.github/workflows/postman-generate.yml`, `apps/backend/scripts/postman-gen-ci.mjs` |
| Error code catalog | T767 | done | `docs/api/error-codes.md` |
| OpenAPI prod verification + Dockerfile fix | T768 | done | `claudedocs/agent-outputs/T765-openapi-prod-verify.md`, `Dockerfile` |
| Aggregate report + CLEO evidence | T770 | done | this file |

---

## 1. Postman Collection (T766)

**Commit**: `13ce68b`

### What was done
- `docs/api/postman-collection.json` — Postman v2.1 collection with 93 requests across 31 folders, generated from `apps/backend/openapi.json` (76 paths, 93 ops, OpenAPI 3.1.0)
- `docs/api/openapi.json` — mirror copy for standalone tooling access
- `.github/workflows/postman-generate.yml` — CI workflow that auto-regenerates the collection on any push that touches `openapi.json`, `openapi-manifest.ts`, or the generation scripts; auto-commits on changes; uploads artifact with 90-day retention
- `apps/backend/scripts/postman-gen-ci.mjs` — CI-safe generator (reads committed `openapi.json` only, no forge-ts dependency), biome-clean (node: protocol, double quotes, sorted imports)

### Postman collection stats
```
Schema:          https://schema.getpostman.com/json/collection/v2.1.0/collection.json
Collection name: LLMtxt API
Top-level folders: 31
Total requests:    93
Validation:        PASSED (Postman v2.1 schema)
```

### Folders
documents, versions, lifecycle, disclosure, crdt, realtime, presence, leases, scratchpad, bft, a2a, events, blobs, export, collections, retrieval, semantic, search, cross-doc, merge, signed-urls, webhooks, access-control, organizations, api-keys, agent-keys, agents, auth, schemas, health, system

### Importability
Collection has valid `info.schema` field pointing to `collection/v2.1.0` — importable by Postman desktop, Postman CLI (`postman collection run`), and Newman.

---

## 2. Error Code Catalog (T767)

**Commit**: `757521f`

### What was done
- `docs/api/error-codes.md` — comprehensive error catalog sourced from `grep` of all 40 route files in `apps/backend/src/routes/` and 5 middleware files in `apps/backend/src/middleware/`

### Coverage
| HTTP Status | Unique Codes | Notes |
|---|---|---|
| 400 Bad Request | 28 | slug, params, CRDT, blob, lifecycle, lease, export, webhook |
| 401 Unauthorized | 9 | API key invalid/revoked/expired/not-found; auth middleware |
| 403 Forbidden | 14 | role, org-admin, collection-owner, lease-token, admin |
| 404 Not Found | 25 | document, version, blob, collection, org, webhook, DLQ, lease |
| 409 Conflict | 10 | lifecycle state, lease, BFT, key revoke, account deletion |
| 410 Gone | 1 | Account purged |
| 413 Payload Too Large | 3 | blob upload, disclosure, graph |
| 422 Unprocessable Entity | 1 | agent key bad encoding |
| 423 Locked | 4 | document non-editable state (REVIEW/PUBLISHED/ARCHIVED) |
| 429 Too Many Requests | 2 | document quota, rate-limit |
| 500 Internal Server Error | 14 | blob store failures, search, A2A, admin ops |
| 503 Service Unavailable | 2 | Stripe not configured |
| **Total** | **113** | Across 12 status codes |

Catalog includes: global error shape TypeScript interface, rate-limit headers (`X-RateLimit-*`, `Retry-After`), and callout notes on lease error flow, lifecycle state machine, and blob store degradation.

---

## 3. OpenAPI Prod Verification + Dockerfile Fix (T768)

**Commit**: `2055267`

### Honest assessment

| Endpoint | HTTP Status | Valid Content | Notes |
|---|---|---|---|
| `https://api.llmtxt.my/openapi.json` | 200 | NO (stub) | Returns 0-path stub spec |
| `https://api.llmtxt.my/docs/api` | 200 | YES (Swagger UI HTML) | UI loads, shows empty API |
| `https://api.llmtxt.my/docs/api/json` | 200 | NO (same stub) | Swagger UI serving stub spec |
| `https://api.llmtxt.my/docs/api/static/swagger-ui.css` | 200 | YES | Static assets load |

### Root cause
Dockerfile runtime stage was not copying `apps/backend/openapi.json`. The `docs.ts` route resolves:
```
dist/routes/docs.js → ../../openapi.json → apps/backend/openapi.json
```
File absent → falls back to `STUB_SPEC` (0 paths).

### Fix applied
Added to `Dockerfile` (already in HEAD from prior session work):
```dockerfile
COPY --from=build /app/apps/backend/openapi.json ./apps/backend/
```

### Local spec health
```
Version : 3.1.0
Paths   : 76
Ops     : 93
Errors  : 0
Result  : VALIDATION PASSED
```

### After next Railway deploy
Both endpoints will serve the full 76-path, 93-operation spec. Swagger UI at `/docs/api` will display all API endpoints.

---

## Commits

| SHA | Task | Description |
|---|---|---|
| `bf95c46` | T766 | feat(T766): Postman collection auto-gen + CI workflow from OpenAPI spec |
| `757521f` | T767 | feat(T767): Add error code catalog with 50+ mapped errors |
| `2055267` | T768 | fix(T768): Document OpenAPI prod stub root cause + Dockerfile fix |
| `13ce68b` | T766 | fix(T766): Fix biome lint on postman-gen-ci.mjs |

---

## Scorecard Impact

**Dimension 2 — Ecosystem Maturity**:
- Postman collection (93 requests, Postman v2.1, 31 folders) closes the "no Postman collection" gap
- CI auto-regeneration on OpenAPI changes prevents drift
- Error catalog provides developer-facing documentation missing from the API

**Dimension 6 — Open Standards**:
- OpenAPI 3.1.0 spec committed at `docs/api/openapi.json` (mirroring `apps/backend/openapi.json`)
- Swagger UI available at `/docs/api` (stub until next deploy)
- Postman collection uses standard Postman v2.1 schema (importable in all major API tools)
- Dockerfile fix unblocks full spec serving in production
