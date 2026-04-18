# T169: DX — OpenAPI 3.1 Spec Auto-Generated from Routes

## Summary

Delivered a live, auto-generated OpenAPI 3.1 spec for the LLMtxt API with Swagger UI,
Postman collection, CI validation, and TypeScript client generation.

## What Shipped

### Spec Quality (openapi.json)
- **Version**: OpenAPI 3.1.0 (upgraded from 3.2.0)
- **Paths**: 76 (was 68, added blobs, export, collections, retrieval, auth routes)
- **Operations**: 93 total
- **All 93** operations have: summary, operationId, response schemas
- **0 validation errors** against `openapi-schema-validator`
- **Security schemes**: ApiKeyAuth (Bearer), SessionCookie, AgentSignature (Ed25519)
- **31 domain tags** defined: documents, versions, lifecycle, crdt, blobs, etc.

### Swagger UI
- Route changed to `/docs/api` prefix (was `/docs`)
- Public URL: `https://api.llmtxt.my/docs/api`
- Spec URL: `https://api.llmtxt.my/openapi.json`

### CI Pipeline (ci.yml — openapi-drift job)
Added steps:
1. `openapi-schema-validator` — 0 errors required
2. `openapi-typescript` — verifies TS client generates without errors
3. Upload Postman collection as GitHub Actions artifact (30-day retention)
4. Upload OpenAPI spec as GitHub Actions artifact (30-day retention)

### New Scripts (apps/backend/scripts/)
- `postprocess-openapi.mjs` — fully rewritten: injects responses, security schemes, tags, additional routes, upgrades version
- `validate-openapi.mjs` — standalone validator (exit 1 on errors or <20 paths)

### New Package Scripts
- `openapi:validate` — runs validate-openapi.mjs
- `openapi:ts-client` — generates TypeScript client to /tmp/llmtxt-api-types.ts

### New Docs
- `docs/dx/openapi.md` — complete developer guide for the spec

## Key Findings

1. **Backend is Fastify, not Hono** — the task brief mentioned Hono/`@hono/zod-openapi` but the codebase uses Fastify + `@fastify/swagger`. Both packages were already installed. No migration needed.
2. **forge-ts manifest approach** — spec is generated from TSDoc annotations in `openapi-manifest.ts` then post-processed. The postprocess script is the extensibility point.
3. **Path count**: 76 paths / 93 operations (acceptance criteria: ≥20 paths — far exceeded)
4. **Routes that resisted conversion**: None blocked — all routes captured via either forge-ts manifest or the ADDITIONAL_ROUTES injection in postprocess script
5. **Pre-existing build error**: `src/lib/rfc3161.ts` has a pre-existing TypeScript error (Buffer not assignable to BodyInit) unrelated to this epic
6. **Postman collection**: 31 top-level folders, generated at `apps/backend/postman-collection.json`

## Files Changed

- `apps/backend/scripts/postprocess-openapi.mjs` — rewritten with full response map, security schemes, tag map, additional routes
- `apps/backend/scripts/validate-openapi.mjs` — new validation script
- `apps/backend/src/routes/docs.ts` — routePrefix `/docs` → `/docs/api`, version 3.1.0
- `apps/backend/package.json` — added openapi:validate, openapi:ts-client scripts
- `apps/backend/openapi.json` — 76 paths, 93 ops, 0 errors, 3 security schemes
- `apps/docs/public/api/openapi.json` — synced
- `.github/workflows/ci.yml` — added validate, ts-client, artifact upload steps
- `docs/dx/openapi.md` — new developer guide
