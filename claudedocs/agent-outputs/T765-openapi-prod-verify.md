# T765.5: OpenAPI Production Endpoint Verification

**Date**: 2026-04-19
**Agent**: Lead (T765 ecosystem polish)
**Task**: T768

---

## Summary

Both production endpoints respond with HTTP 200. However, `/openapi.json` returns a **stub spec** (0 paths) instead of the full 76-path spec. The root cause has been identified and fixed.

---

## Endpoint Test Results

### `GET https://api.llmtxt.my/openapi.json`

| Metric | Value |
|---|---|
| HTTP Status | 200 |
| Response Time | ~366ms |
| Content-Type | application/json |
| `openapi` field | `3.1.0` |
| `paths` count | **0 (stub)** |
| Stub detected | YES |

**Raw response:**
```json
{
  "openapi": "3.1.0",
  "info": {
    "title": "LLMtxt API",
    "version": "2026.4.6",
    "description": "OpenAPI spec not found. Run `pnpm --filter backend run openapi:gen` to generate."
  },
  "paths": {}
}
```

**Verdict**: STUB — not the real spec.

### `GET https://api.llmtxt.my/docs/api`

| Metric | Value |
|---|---|
| HTTP Status | 200 |
| Content | Swagger UI HTML shell |
| CSS asset (`/docs/api/static/swagger-ui.css`) | 200 |
| JSON spec endpoint (`/docs/api/json`) | 200 |

**Verdict**: UI loads correctly. Since it renders from the stub spec, the interactive explorer shows 0 endpoints.

---

## Root Cause

The production backend is deployed via the monorepo `Dockerfile`. The runtime stage copies compiled JS (`apps/backend/dist/`) but was missing the generated `openapi.json` file:

```dockerfile
# BEFORE (runtime stage was missing this line):
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
# openapi.json was NOT copied → runtime falls back to stub
```

The `docs.ts` route resolves the spec at:
```typescript
// From dist/routes/docs.js:
const OPENAPI_PATH = resolve(__dirname, '..', '..', 'openapi.json');
// → /app/apps/backend/openapi.json  (not in image before fix)
```

---

## Fix Applied

Added the missing `COPY` line to `Dockerfile` (runtime stage):

```dockerfile
COPY --from=build /app/apps/backend/openapi.json ./apps/backend/
```

**File changed**: `Dockerfile` (root of monorepo)

This will take effect on the next Railway deploy. The local `openapi.json` is valid:

```
OpenAPI validation: apps/backend/openapi.json
  Version : 3.1.0
  Paths   : 76
  Ops     : 93
  Errors  : 0

Validation PASSED.
```

---

## Local Spec Validation (openapi-schema-validator)

Validator: `openapi-schema-validator@12.x` via `apps/backend/scripts/validate-openapi.mjs`

| Check | Result |
|---|---|
| OpenAPI version | 3.1.0 |
| Path count | 76 |
| Operation count | 93 |
| Validation errors | 0 |
| Minimum path threshold (20) | PASS |
| Overall | **PASSED** |

---

## After Fix (Expected)

Once the next Railway deploy runs with the updated Dockerfile, `GET https://api.llmtxt.my/openapi.json` should return the full 76-path spec and the Swagger UI at `/docs/api` will show all 93 operations across 31 API groups.

---

## Action Items

| Item | Status |
|---|---|
| Dockerfile fix committed | done |
| Next deploy will resolve prod stub | pending Railway redeploy |
| Local spec valid (76 paths, 0 errors) | done |
| Swagger UI HTML shell loads | done |

---

## References

- Route: `apps/backend/src/routes/docs.ts`
- Dockerfile: `Dockerfile` (monorepo root)
- Local spec: `apps/backend/openapi.json`
- Docs copy: `docs/api/openapi.json`
- Validator: `apps/backend/scripts/validate-openapi.mjs`
