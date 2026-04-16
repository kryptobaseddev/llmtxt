# T309: forge-ts OpenAPI 3.2 + Swagger UI + Postman

**Status**: complete
**Date**: 2026-04-16
**Epic**: T309 — Self-signed Ed25519 + forge-ts OpenAPI + Swagger UI
**Commits**: a44076b, ff38b4d, 3bd6ea9

---

## What Was Done

### Research (T310)

- Confirmed `forge-ts` is the owner's tool at `@forge-ts/cli` (v0.24.0, npm package `@forge-ts/cli`)
- `apps/backend` already had `forge-ts.config.ts`, `tsdoc.json`, and husky hooks but `@forge-ts/core`/`@forge-ts/api` were not installed
- `forge-ts build` was skipping the `api` step because `api.enabled` was not set

### Configure (T310 + T311)

**`apps/backend/forge-ts.config.ts`** — updated:
- `api.enabled = true`
- `api.openapi = true`
- `api.openapiPath = 'openapi.json'`

**`apps/backend/package.json`** — added:
- `openapi:gen` script: `forge-ts build --skip-gen && node scripts/postman-gen.mjs`
- Dev dependencies: `@forge-ts/core@0.24.0`, `@forge-ts/api@0.24.0`, `openapi-to-postmanv2@6.0.1`
- Runtime dependency: `@fastify/swagger@9.7.0`, `@fastify/swagger-ui@5.2.5`

### Annotate (T311)

**`apps/backend/src/openapi-manifest.ts`** — new file:
- 80 exported stub functions (`export function postCompress(): void {}`)
- Each has a TSDoc `@route METHOD /path` tag plus `@param`, `@body`, `@response` tags
- Covers all 68 routes across 18 categories
- forge-ts AST-walks exported symbols; this pattern avoids restructuring the entire Fastify codebase

**Key discovery**: TSDoc's parser treats `{slug}` as an inline link tag and strips braces, so routes appear as `/api/documents/slug` instead of `/api/documents/{slug}`. Solution: post-processing script.

### Generate (T312)

**`apps/backend/scripts/postprocess-openapi.mjs`**:
- Reads forge-ts output (`openapi.json`)
- Detects which path segments match parameter names from operations
- Wraps them: `slug` → `{slug}`, upgrades `in:"query"` → `in:"path"` + `required:true`
- Injects server info (`https://api.llmtxt.my`, `http://localhost:3000`)
- Result: 68 routes, 125 schemas, 49 paths with `{params}` properly formatted

**`apps/backend/scripts/postman-gen.mjs`**:
- Runs `postprocess-openapi.mjs`
- Converts to Postman v2.1 collection via `openapi-to-postmanv2` (11 top-level folders)
- Copies `openapi.json` to `apps/docs/public/api/openapi.json`

### Serve Swagger UI (T313)

**`apps/backend/src/routes/docs.ts`** — new file:
- `docsRoutes()` exported function
- Registers `@fastify/swagger` in static mode reading `openapi.json`
- Registers `@fastify/swagger-ui` at routePrefix `/docs`
- Adds `GET /openapi.json` raw spec endpoint
- Graceful fallback stub when `openapi.json` not found

**`apps/backend/src/index.ts`** — import and register:
```typescript
import { docsRoutes } from './routes/docs.js';
// ...
await app.register(docsRoutes, { prefix: '/api' });
```

Accessible at:
- `http://localhost:3000/api/docs` — Swagger UI HTML
- `http://localhost:3000/api/openapi.json` — raw JSON spec

### Postman Collection (T314)

`apps/backend/postman-collection.json` generated:
- 11 top-level folders matching the `tags` in the OpenAPI spec
- Importable via Postman → Import → Link → paste URL

### CI Drift Gate (T315)

`.github/workflows/ci.yml` — new job `openapi-drift`:
```yaml
- name: Regenerate OpenAPI spec
  working-directory: apps/backend
  run: pnpm run openapi:gen
- name: Fail if spec is out of sync
  run: git diff --exit-code apps/backend/openapi.json apps/backend/postman-collection.json || ...
```

Any PR that changes a route without regenerating `openapi.json` will fail CI.

### Docs Site (T316)

- `apps/docs/public/api/openapi.json` — static spec for tooling import
- `apps/docs/content/docs/api/spec.mdx` — Fumadocs page with:
  - Link to live Swagger UI at `https://api.llmtxt.my/api/docs`
  - Download/import instructions
  - Route summary table (68 routes, 18 categories)
- `apps/docs/content/docs/api/meta.json` — adds `spec` to docs nav

---

## Validation

| Check | Result |
|-------|--------|
| `pnpm --filter backend run openapi:gen` exits 0 | PASS |
| `openapi.json` is valid JSON with `openapi: 3.2.0` | PASS |
| `openapi.json` has 68 routes | PASS |
| 49 paths use `{param}` template notation | PASS |
| 125 TypeScript types captured as schemas | PASS |
| `postman-collection.json` is valid JSON | PASS |
| `pnpm --filter backend run build` (tsc) clean | PASS |
| `/api/docs` route registered in index.ts | PASS |
| `/api/openapi.json` route registered | PASS |
| CI `openapi-drift` job added | PASS |
| `apps/docs/content/docs/api/spec.mdx` created | PASS |

## Deferred

- Live `curl https://api.llmtxt.my/api/docs` verification requires Railway deployment (deploy via git push to main)
- T309 also includes Ed25519 self-signing (T095) — that remains in the epic for a separate implementation pass

## Known Issues / Limitations

- **TSDoc brace stripping**: `@route GET /api/documents/{slug}` becomes `/api/documents/slug` in parsed output because TSDoc treats `{...}` as inline link syntax. The post-processor (`postprocess-openapi.mjs`) compensates by matching parameter names to path segments, but may miss edge cases if a non-param segment has the same name as a declared `@param`.
- **OpenAPI 3.2 vs 3.0**: `@fastify/swagger` types only know about 3.0/3.1; we use `as any` cast. The generated JSON correctly says `openapi: 3.2.0`.

## Files Changed

- `/mnt/projects/llmtxt/apps/backend/forge-ts.config.ts` — api config added
- `/mnt/projects/llmtxt/apps/backend/package.json` — deps + scripts
- `/mnt/projects/llmtxt/apps/backend/src/openapi-manifest.ts` — NEW: 80 route stubs with @route tags
- `/mnt/projects/llmtxt/apps/backend/src/routes/docs.ts` — NEW: Swagger UI route
- `/mnt/projects/llmtxt/apps/backend/src/index.ts` — register docsRoutes
- `/mnt/projects/llmtxt/apps/backend/scripts/postman-gen.mjs` — NEW: Postman gen pipeline
- `/mnt/projects/llmtxt/apps/backend/scripts/postprocess-openapi.mjs` — NEW: path param fixer
- `/mnt/projects/llmtxt/apps/backend/openapi.json` — NEW: generated spec (committed)
- `/mnt/projects/llmtxt/apps/backend/postman-collection.json` — NEW: generated collection
- `/mnt/projects/llmtxt/apps/docs/public/api/openapi.json` — NEW: spec copy for docs
- `/mnt/projects/llmtxt/apps/docs/content/docs/api/spec.mdx` — NEW: docs spec page
- `/mnt/projects/llmtxt/apps/docs/content/docs/api/meta.json` — NEW: nav entry
- `/mnt/projects/llmtxt/.github/workflows/ci.yml` — openapi-drift job added
- `/mnt/projects/llmtxt/pnpm-lock.yaml` — updated
