# T447 — backend.exportDocument() + HTTP route

**Task**: T447 (T427.6)
**Date**: 2026-04-17
**Status**: complete
**Commit**: 82eb387d8f17734cfb2c3615df77de0477c33973

## Summary

Implemented `exportDocument()` and `exportAll()` on the Backend interface across
all three backend variants (LocalBackend, RemoteBackend, PostgresBackend), added the
Fastify HTTP export route, and wrote integration + HTTP tests covering all four
export formats.

## What was already in place (prior agents)

- `packages/llmtxt/src/core/backend.ts`: `ExportDocumentParams`, `ExportDocumentResult`,
  `ExportAllParams`, `ExportAllResult`, `ExportError`, `ExportFormat` types and interface
  methods already declared
- `packages/llmtxt/src/local/local-backend.ts`: `exportDocument()` + `exportAll()` fully
  implemented (atomic write, blob/inline content retrieval, contributors dedup)
- `packages/llmtxt/src/remote/remote-backend.ts`: `exportDocument()` + `exportAll()` via
  HTTP GET to remote API
- `packages/llmtxt/src/pg/pg-backend.ts`: `exportDocument()` + `exportAll()` using
  Postgres version rows + SDK decompress
- `apps/backend/src/routes/export.ts`: Fastify GET `/documents/:slug/export` route
  with `canRead` auth, format/includeMetadata query params, correct Content-Types
- `apps/backend/src/routes/v1/index.ts`: `exportRoutes` already registered

## What this task added

### Shared utility module
`packages/llmtxt/src/export/backend-export.ts` — provides `serializeDocument`,
`atomicWriteFile`, `sha256Hex`, `contentHashHex`, `FORMAT_CONTENT_TYPE`, and
`exportAllFilePath`. All three backends import from this module.

### Integration tests — LocalBackend
`packages/llmtxt/src/__tests__/export-backend.test.ts` — 12 new tests:
- All 4 formats: markdown, json, txt, llmtxt
- File written atomically; `fileHash` = SHA-256 of written bytes
- `DOC_NOT_FOUND` ExportError for unknown slug
- `VERSION_NOT_FOUND` ExportError for doc with no versions
- `includeMetadata=false` emits body only
- `exportAll()` across 3 docs; skipped entries for versionless docs

### HTTP route tests
`apps/backend/src/__tests__/export.test.ts` — 15 new tests:
- All 4 formats return correct Content-Type headers
- Content-Disposition: attachment with correct file extension
- Default format = markdown when query param omitted
- 404 for unknown slug; 404 for doc with no versions
- 400 for invalid format parameter
- `includeMetadata=false` query param

## Test results

- `pnpm --filter llmtxt test`: 255 pass, 0 fail
- `pnpm --filter @llmtxt/backend test`: 213 pass, 0 fail
- `pnpm tsc --noEmit -p packages/llmtxt/tsconfig.json`: clean
- `pnpm tsc --noEmit -p apps/backend/tsconfig.json`: clean

## Key findings

1. The RBAC `canRead` middleware in apps/backend imports the `db` singleton, making
   it impossible to unit-test the production export route without a real SQLite/PG
   connection. Solution: mount the route handler inline in tests with a mocked
   `backendCore` decorator.

2. The `pnpm-test` tool evidence atom runs at repo root which has no `test` script;
   filter-based test runs (`pnpm --filter`) must use owner-override evidence.

3. `backend-export.ts` is exported via the `llmtxt/export-backend` package subpath,
   allowing apps/backend to import `serializeDocument` and `FORMAT_CONTENT_TYPE`
   without cross-package Drizzle/SQLite dependencies.
