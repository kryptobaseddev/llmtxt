# T621 Blob Code Location Audit

**Task**: T621 — Audit current blob code locations
**Date**: 2026-04-18
**Parent**: T607 Extract llmtxt/blob subpath

---

## Summary

Blob-related code currently lives in three distinct layers. The goal of T607 is to
promote the portable blob primitives into `packages/llmtxt/src/blob/` so consumers
can `import { hashBlob, validateBlobName, BlobStore } from 'llmtxt/blob'`.

---

## Layer 1 — Rust Core (crates/llmtxt-core)

| Export | Rust location | WASM binding |
|--------|---------------|--------------|
| `hash_blob` | `src/lib.rs` | `wasmModule.hashBlob(bytes)` |
| `blob_name_validate` | `src/lib.rs` | `wasmModule.blobNameValidate(name)` |

These are already in the correct location (SSOT rule). No changes needed.

---

## Layer 2 — TypeScript Package (packages/llmtxt/src/)

### Blob-specific files

| File | Role | Action |
|------|------|--------|
| `core/errors.ts` | Canonical error classes: BlobTooLargeError, BlobNameInvalidError, BlobCorruptError, BlobNotFoundError, BlobAccessDeniedError | Move re-export to blob/index.ts |
| `core/backend.ts:356-467` | Blob type interfaces (AttachBlobParams, BlobAttachment, BlobData, BlobRef, BlobOps) | Keep in core/backend.ts; re-export from blob/index.ts |
| `local/blob-fs-adapter.ts` | Filesystem blob adapter for LocalBackend (BlobFsAdapter class) | Move into blob/ subpath |
| `local/blob-changeset.ts` | Sync-layer blob changeset utilities (BlobChangeset, buildBlobChangeset, applyBlobChangeset) | Move into blob/ subpath |
| `wasm.ts:44-53` | `hashBlob()` thin wrapper around wasmModule.hashBlob | Re-export from blob/index.ts |

### Duplication hotspots in local/blob-fs-adapter.ts

Lines implementing blob logic inline (to be promoted to blob/):

```
blob-fs-adapter.ts:64-77  — validateBlobName() and hashBlobBytes() helpers
blob-fs-adapter.ts:105-224 — BlobFsAdapter.attachBlob()
blob-fs-adapter.ts:233-281 — BlobFsAdapter.getBlob()
blob-fs-adapter.ts:287-300 — BlobFsAdapter.listBlobs()
blob-fs-adapter.ts:309-334 — BlobFsAdapter.detachBlob()
blob-fs-adapter.ts:342-371 — BlobFsAdapter.fetchBlobByHash()
```

### References to blob types from other files

| File | Type of reference |
|------|-------------------|
| `compression.ts:14` | re-exports `hashBlob` from `./wasm.js` |
| `index.ts:17` | re-exports `hashBlob` from `./compression.js` |
| `local/local-backend.ts:67-94` | imports AttachBlobParams, BlobAttachment, BlobData; imports BlobFsAdapter; re-exports error classes |
| `local/schema-local.ts:421-460` | `blobAttachments` SQLite table definition |
| `pg/pg-backend.ts:352-3305` | PostgresBackend delegates blob methods to injected BlobPgAdapter |
| `remote/remote-backend.ts` | RemoteBackend delegating blob ops via HTTP |
| `mesh/sync-engine.ts` | References Loro blob mentions only (no blob API) |

### Existing tests

| Test file | Coverage |
|-----------|----------|
| `__tests__/blob-fs-adapter.test.ts` | BlobFsAdapter unit tests |
| `__tests__/blob-changeset.test.ts` | blob-changeset utilities |
| `__tests__/blob-backend.test.ts` | Backend BlobOps contract tests |
| `__tests__/blob-cli.test.ts` | CLI blob commands |
| `__tests__/blob-5-agent-hub-spoke.test.ts` | Multi-agent blob scenarios |

---

## Layer 3 — apps/backend/src/

| File | Role | Action |
|------|------|--------|
| `storage/blob-pg-adapter.ts` | PostgreSQL blob adapter (injected into PostgresBackend) | No change; stays in apps/backend (monorepo boundary) |
| `routes/blobs.ts` | HTTP routes for blob upload/download | No change |
| `plugins/postgres-backend-plugin.ts` | Injects BlobPgAdapter into PostgresBackend | No change |
| `__tests__/blob-pg-adapter.test.ts` | Tests for PG adapter | No change |
| `__tests__/blob-routes.test.ts` | Tests for HTTP blob routes | No change |
| `__tests__/blob-5-agent-hub-spoke.test.ts` | Multi-agent blob scenarios (backend) | No change |

---

## Proposed blob/ subpath public API

```ts
// packages/llmtxt/src/blob/index.ts public surface

// From core/errors.ts (re-export)
export { BlobTooLargeError, BlobNameInvalidError, BlobCorruptError, BlobNotFoundError, BlobAccessDeniedError }

// From core/backend.ts (re-export types)
export type { AttachBlobParams, BlobAttachment, BlobData, BlobRef, BlobOps }

// From wasm.ts (re-export)
export { hashBlob }

// New: validateBlobName exposed as a stable API function
export { validateBlobName }

// Moved from local/blob-fs-adapter.ts
export { BlobFsAdapter }

// Moved from local/blob-changeset.ts
export { BlobChangeset, ApplyBlobChangesetResult, BlobRefWithDocSlug, buildBlobChangeset, applyBlobChangeset, incomingWinsLWW }
```

---

## Duplication to eliminate (T625)

After T622 creates the blob/ subpath, `local/blob-fs-adapter.ts` must become a
thin re-export bridge. The inline implementations of `validateBlobName()`,
`hashBlobBytes()`, and the `BlobFsAdapter` class body must move to `blob/`.
`local/local-backend.ts` already imports from `blob-fs-adapter.ts` — it only
needs its import updated from `./blob-fs-adapter.js` to `../blob/index.js`.

---

## Files to create (T622)

1. `packages/llmtxt/src/blob/index.ts` — subpath entry + public API
2. `packages/llmtxt/src/blob/fs-adapter.ts` — BlobFsAdapter (moved from local/)
3. `packages/llmtxt/src/blob/changeset.ts` — changeset utilities (moved from local/)
4. `packages/llmtxt/src/blob/__tests__/contract.test.ts` — (T623)

## package.json exports entry (T622)

```json
"./blob": {
  "types": "./dist/blob/index.d.ts",
  "import": "./dist/blob/index.js"
}
```
