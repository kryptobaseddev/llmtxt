# T450 + T451 + T454: CLI Export/Import + Determinism Test

**Date**: 2026-04-17
**Tasks**: T450 (T427.7), T451 (T427.8), T454 (T427.9)
**Commit**: 255a3fb8b3788cd6bf2430d169aed032ae6bf392
**Status**: complete

## Summary

Implemented the remaining three child tasks of T427 (Document Export/SSoT):

### T450 — CLI export + export-all

Added `export` and `export-all` commands to `packages/llmtxt/src/cli/llmtxt.ts`:

- `llmtxt export <slug> --format md|json|txt|llmtxt --output <path|dir> [--sign]`
- `llmtxt export-all --format md|json|txt|llmtxt --output <dir> [--sign]`
- `--format` accepts alias `md` for `markdown`; defaults to `markdown`
- `--output` auto-detects directory vs file path
- Prints `ExportDocumentResult` / `ExportAllResult` JSON to stdout
- Updated `--help` text includes new commands and flags

### T451 — importDocument() + CLI import

Added `importDocument()` to the Backend interface (`core/backend.ts`) with full RFC 2119 contract:

**New types**: `ImportDocumentParams`, `ImportDocumentResult`

**New module**: `packages/llmtxt/src/export/import-parser.ts`
- Parses `.md` and `.llmtxt` files via minimal line-by-line YAML frontmatter parser
- Parses `.json` files via `JSON.parse()`, extracts `content` field
- Parses `.txt` files as plain body (no frontmatter)
- Verifies `content_hash` from frontmatter against actual body SHA-256
- Throws `ExportError('HASH_MISMATCH')` on mismatch, `ExportError('PARSE_FAILED')` on I/O error

**Implementations**:
- `LocalBackend.importDocument()` — creates or appends version via existing DB methods
- `RemoteBackend.importDocument()` — parses locally, calls remote API to create/append
- `PostgresBackend.importDocument()` — creates or appends version via Drizzle

**Conflict strategies**:
- `onConflict='create'`: throws `ExportError('SLUG_EXISTS')` if slug exists
- `onConflict='new_version'` (default): appends new version to existing document

**CLI**: `llmtxt import <file> [--imported-by <agentId>] [--on-conflict new_version|create]`

### T454 — Determinism test suite

Created `packages/llmtxt/src/__tests__/export-determinism.test.ts`:

1. **100-iteration backend-level tests** for all 4 formats: exports a 3-version document
   100 times and verifies `content_hash` stability across all iterations (txt format: full
   byte-identity; other formats: content_hash field stability since `exported_at` differs)

2. **Formatter-level byte determinism test**: directly calls all 4 formatters 100 times with
   a fixed `exportedAt` timestamp; asserts all 100 results are byte-identical for each format.
   This is the true hash-stability guarantee from spec §6.

## Test Results

- 332/332 tests pass (`pnpm --filter llmtxt test`)
- All 5 determinism tests pass (4 format iterations + 1 formatter-level test)
- tsc `--noEmit` clean for all new files

## Key Findings

1. The Backend interface `exportDocument()` computes `exportedAt = new Date().toISOString()` internally. The spec §6 "100 iterations, byte-identical fileHash" is satisfied at the formatter level (with fixed `exportedAt`) — the test correctly demonstrates this distinction.

2. The import parser handles contributors as a YAML sequence (multi-line `  - item` format) correctly.

3. `HASH_MISMATCH` detection correctly accounts for the trailing-newline normalization applied during import (body is normalized before hashing, same as during export).

## Files Changed

- `packages/llmtxt/src/cli/llmtxt.ts` — added export/export-all/import commands
- `packages/llmtxt/src/core/backend.ts` — added ImportDocumentParams, ImportDocumentResult, importDocument() to ExportOps
- `packages/llmtxt/src/export/import-parser.ts` — new: shared file parser
- `packages/llmtxt/src/export/index.ts` — re-exports import-parser
- `packages/llmtxt/src/local/local-backend.ts` — importDocument() implementation
- `packages/llmtxt/src/remote/remote-backend.ts` — importDocument() implementation
- `packages/llmtxt/src/pg/pg-backend.ts` — importDocument() implementation
- `packages/llmtxt/src/backend/factory.ts` — importDocument() stubs (already present)
- `packages/llmtxt/src/__tests__/export-determinism.test.ts` — new: T427.9 test suite
- `packages/llmtxt/src/__tests__/helpers/test-pg.ts` — importDocument() stub in PgContractAdapter
