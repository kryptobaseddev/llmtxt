# ARCH-T428: Binary Blob Attachments

**Status**: Specification  
**Date**: 2026-04-17  
**Epic**: T428  
**Author**: CLEO RCASD Team Lead  
**Dependencies**: T384 (Loro CRDT ops stable), T385 (cr-sqlite changeset exchange)

---

## 1. Motivation and Scope

LLMtxt is currently text/JSON only. Agents operating in a multi-agent collaboration hub
frequently need to share binary artifacts: rendered diagrams, screenshots, compiled
outputs, model weight snapshots, and data files. These artifacts MUST travel alongside
documents without corrupting the text CRDT layer.

Binary blobs are NOT mergeable in the same way text is. A PNG image from two concurrent
editors cannot be CRDT-merged. The correct primitive is **Last Write Wins (LWW) per
attachment name**: the agent with the newest `uploadedAt` timestamp owns the canonical
byte content for that name on a given document.

### Scope

This epic covers:
- Content-addressed blob storage (SHA-256 hash = storage key)
- Attachment registry per document (LWW per `blobName`)
- LocalBackend filesystem adapter (`.llmtxt/blobs/<hash>`)
- PostgresBackend object storage adapter (S3/R2 primary, PG large objects fallback)
- Backend interface extensions (`BlobOps` sub-interface)
- Changeset integration: blob references travel in sync payload; bytes are lazy-pulled
- CLI commands: `attach`, `detach`, `blobs`
- Security: hash verification, access control, name validation (no path traversal)
- Integration testing: 5-agent hub-spoke attach/detach/fetch with LWW resolution

### Out of Scope

- CRDT merge of blob bytes (explicitly rejected; LWW only)
- Replacing the text CRDT layer (complementary, not replacement)
- Automatic garbage collection of unreferenced blobs (deferred; can be added later)
- Blob deduplication across documents (single-document scope for V1)

---

## 2. Terminology (RFC 2119)

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this
document are to be interpreted as described in RFC 2119.

---

## 3. Core Concepts

### 3.1 Content Addressing

Every blob is identified by its **SHA-256 hash** (hex string, 64 chars). The hash is
the storage key. Two attachments with identical bytes share one storage object. The hash
is computed in `crates/llmtxt-core` by a new `hash_blob` function that takes `&[u8]`
and returns the hex SHA-256 digest.

```
hash = sha256(bytes)  // hex string, 64 characters
```

Implementations MUST verify the hash on every read. If the stored bytes produce a
different hash than the recorded `hash` field, the implementation MUST return an error
and MUST NOT return the corrupt bytes to the caller.

### 3.2 Attachment Name

An **attachment name** is the user-visible label for a blob within a document (e.g.,
`diagram.png`, `report.pdf`). Names are scoped per document. The same name on two
different documents refers to two independent attachment records.

Attachment names MUST satisfy the following validation rules (enforced in
`crates/llmtxt-core::blob_name_validate`):

- Length: 1–255 bytes (UTF-8)
- MUST NOT contain `..` (path traversal prefix)
- MUST NOT contain `/` or `\` (path separator)
- MUST NOT contain null bytes (`\0`)
- MUST NOT start or end with whitespace

Implementations MUST reject names that fail validation with a descriptive error before
any storage operation.

### 3.3 Attachment Manifest

Each document has an **attachment manifest**: a set of (blobName → AttachmentRecord)
pairs. The manifest is the authoritative registry of which blobs are attached to a
document and their current metadata.

```typescript
interface AttachmentRecord {
  docSlug: string;        // FK to documents.slug
  blobName: string;       // user-visible attachment name
  hash: string;           // SHA-256 hex (content address)
  size: number;           // bytes (original, uncompressed)
  contentType: string;    // MIME type (e.g. "image/png")
  uploadedBy: string;     // agentId of the uploader
  uploadedAt: number;     // unix timestamp ms
}
```

### 3.4 LWW Merge Rule

When two agents independently upload an attachment with the same `blobName` on the
same document, the conflict is resolved by **Last Write Wins per attachment name**:

```
winner = argmax(uploadedAt) over competing attachment records for same (docSlug, blobName)
tie-break = argmax(uploadedBy) lexicographically (deterministic)
```

Implementations MUST apply this rule when merging changesets carrying blob references.
The LWW rule applies to the **manifest record only**. Blob bytes are not merged; the
winning record's `hash` determines which bytes are canonical.

---

## 4. Storage Backends

### 4.1 LocalBackend — Filesystem

LocalBackend MUST store blob bytes at:

```
<storagePath>/blobs/<hash>
```

Where `<storagePath>` defaults to `.llmtxt` and `<hash>` is the 64-char lowercase hex
SHA-256 digest. Example: `.llmtxt/blobs/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

Rules:
- The `blobs/` subdirectory MUST be created on first use (mkdirSync with recursive=true).
- Write MUST be atomic: write to `<hash>.tmp` first, then rename.
- Read MUST verify hash on return. If verification fails, MUST delete the corrupt file and return `BlobCorruptError`.
- Implementation MUST NOT write blob bytes above `maxBlobSizeBytes` (default: `100 * 1024 * 1024`).

### 4.2 PostgresBackend — S3/R2 + PG Large Objects

PostgresBackend MUST support two storage modes, controlled by `blobStorageMode` in `BackendConfig`:

#### Mode A: S3/R2 Object Storage (default, `blobStorageMode: 's3'`)

Configuration added to `BackendConfig`:

```typescript
interface BackendConfig {
  // ...existing fields...
  blobStorageMode?: 's3' | 'pg-lo';      // default: 's3'
  s3Endpoint?: string;                    // e.g. "https://s3.us-east-1.amazonaws.com"
  s3Bucket?: string;                      // required when blobStorageMode = 's3'
  s3Region?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  maxBlobSizeBytes?: number;              // default: 100 * 1024 * 1024
}
```

Object key format: `blobs/<hash>`

Rules:
- Upload MUST use server-side SHA256 integrity check (`x-amz-checksum-sha256`) where supported.
- Download MUST verify hash after fetch. Hash mismatch → `BlobCorruptError`.
- S3/R2 credentials MUST be read from config, not environment variables (portability).

#### Mode B: PostgreSQL Large Objects (fallback, `blobStorageMode: 'pg-lo'`)

When S3 is not configured, the backend MUST fall back to PG large objects stored in the
`pg_largeobject` catalog via `lo_creat`, `lo_write`, `lo_read`, `lo_unlink`.

The `blob_attachments` table stores the `pg_lo_oid` for this mode (nullable when using S3).

Rules:
- Large object creation and blob_attachments insert MUST be in the same transaction.
- Bytes MUST be written in 64KB chunks to avoid memory pressure.
- Hash verification MUST be applied after reading all chunks.

---

## 5. Database Schema

### 5.1 `blob_attachments` Table (Postgres)

```sql
CREATE TABLE blob_attachments (
  id              TEXT PRIMARY KEY,         -- nanoid
  doc_slug        TEXT NOT NULL,            -- FK to documents.slug (logical FK, no constraint for perf)
  blob_name       TEXT NOT NULL,            -- user-visible attachment name
  hash            TEXT NOT NULL,            -- SHA-256 hex (64 chars)
  size            BIGINT NOT NULL,          -- original byte count
  content_type    TEXT NOT NULL,            -- MIME type
  uploaded_by     TEXT NOT NULL,            -- agentId
  uploaded_at     BIGINT NOT NULL,          -- unix ms
  pg_lo_oid       BIGINT,                   -- non-null when blobStorageMode = 'pg-lo'
  deleted_at      BIGINT,                   -- soft-delete timestamp ms (null = active)

  CONSTRAINT blob_name_max_length CHECK (length(blob_name) <= 255)
);

-- Active attachment per name (LWW canonical record)
CREATE UNIQUE INDEX blob_attachments_active_name_idx
  ON blob_attachments (doc_slug, blob_name)
  WHERE deleted_at IS NULL;

-- Fast listing of all attachments for a document
CREATE INDEX blob_attachments_doc_slug_idx ON blob_attachments (doc_slug);

-- Fast lookup by hash (for dedup and verif)
CREATE INDEX blob_attachments_hash_idx ON blob_attachments (hash);
```

### 5.2 SQLite Schema (LocalBackend)

LocalBackend uses a matching `blob_attachments` table in the SQLite schema:

```sql
CREATE TABLE blob_attachments (
  id            TEXT PRIMARY KEY,
  doc_slug      TEXT NOT NULL,
  blob_name     TEXT NOT NULL,
  hash          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  content_type  TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL,
  uploaded_at   INTEGER NOT NULL,
  deleted_at    INTEGER
);

CREATE UNIQUE INDEX blob_attachments_active_name_idx
  ON blob_attachments (doc_slug, blob_name)
  WHERE deleted_at IS NULL;

CREATE INDEX blob_attachments_doc_slug_idx ON blob_attachments (doc_slug);
CREATE INDEX blob_attachments_hash_idx ON blob_attachments (hash);
```

---

## 6. Backend Interface Extension

A new `BlobOps` sub-interface is added to `packages/llmtxt/src/core/backend.ts`. The
`Backend` interface MUST extend `BlobOps`.

```typescript
// ── Blob types ─────────────────────────────────────────────────

/** Parameters for attaching a blob to a document. */
export interface AttachBlobParams {
  /** Document slug the blob is attached to. */
  docSlug: string;
  /** User-visible attachment name (e.g. "diagram.png"). */
  name: string;
  /** MIME content type. */
  contentType: string;
  /** Raw binary data. */
  data: Buffer | Uint8Array;
  /** Agent performing the upload. */
  uploadedBy: string;
}

/** A stored blob attachment record. */
export interface BlobAttachment {
  id: string;
  docSlug: string;
  blobName: string;
  hash: string;           // SHA-256 hex
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;     // unix ms
}

/** Result of fetching a blob. */
export interface BlobData extends BlobAttachment {
  /** Raw blob bytes. Only present when fetched with includeData=true. */
  data?: Buffer;
}

/** Changeset blob reference (bytes omitted — lazy pull). */
export interface BlobRef {
  blobName: string;
  hash: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;
}

/** Blob storage and retrieval operations. */
export interface BlobOps {
  /**
   * Attach a binary blob to a document.
   *
   * MUST compute SHA-256 hash of data and use it as the storage key.
   * MUST validate the attachment name via llmtxt-core blob_name_validate.
   * MUST enforce maxBlobSizeBytes (default 100MB).
   * MUST apply LWW: if a blob with the same name already exists on the document,
   *   it is soft-deleted and the new record becomes active.
   * MUST NOT store duplicate bytes when hash already exists in the store
   *   (content-addressed dedup within the same backend instance).
   * MUST return the new BlobAttachment record.
   */
  attachBlob(params: AttachBlobParams): Promise<BlobAttachment>;

  /**
   * Retrieve a blob attachment, optionally including bytes.
   *
   * MUST return null (not throw) if blobName is not attached to the document.
   * MUST verify hash on read when includeData=true. Return BlobCorruptError if mismatch.
   * Default: includeData = false (manifest metadata only).
   */
  getBlob(
    docSlug: string,
    blobName: string,
    opts?: { includeData?: boolean }
  ): Promise<BlobData | null>;

  /**
   * List all active (non-deleted) blob attachments for a document.
   *
   * MUST return an empty array (not throw) when no blobs are attached.
   * MUST NOT include bytes (manifest metadata only).
   */
  listBlobs(docSlug: string): Promise<BlobAttachment[]>;

  /**
   * Detach (soft-delete) a named blob from a document.
   *
   * MUST return false (not throw) if no active attachment with blobName exists.
   * MUST set deleted_at = now(). Actual byte storage is NOT cleaned up
   *   (orphan collection is a deferred concern).
   * MUST NOT affect other documents sharing the same blob hash.
   */
  detachBlob(docSlug: string, blobName: string, detachedBy: string): Promise<boolean>;

  /**
   * Fetch blob bytes by hash directly (used during lazy sync pull).
   *
   * MUST return null if no blob with this hash exists in the store.
   * MUST verify hash on return.
   * This method bypasses the manifest and is used by the sync layer.
   */
  fetchBlobByHash(hash: string): Promise<Buffer | null>;
}
```

---

## 7. Changeset Integration

### 7.1 Changeset Schema Extension

The existing changeset format (T385) is extended with an optional `blobs` field:

```typescript
interface Changeset {
  // ...existing fields...
  blobs?: BlobRef[];   // blob references; bytes NOT included
}
```

When a changeset is created after a blob attach or detach, the sync layer MUST include
`BlobRef` entries for all blobs modified in that transaction window.

### 7.2 Lazy Pull Protocol

On changeset receive, the recipient:

1. Receives changeset with `blobs: [{ blobName, hash, size, contentType, uploadedBy, uploadedAt }]`.
2. Applies LWW rule to the local manifest for each `BlobRef`.
3. If the winner's `hash` is NOT present in the local blob store, schedules a background pull via `fetchBlobByHash(hash)` from the origin peer.
4. Bytes are NOT pulled eagerly. The manifest record is written immediately; bytes are fetched on first `getBlob(..., { includeData: true })` call.

Implementations MUST support the lazy pull pattern. Implementations SHOULD track
`pendingFetch` state per hash to avoid duplicate in-flight requests.

### 7.3 LWW Application

When applying blob refs from an incoming changeset, the implementation MUST:

```
for each ref in changeset.blobs:
  local = db.query("SELECT * FROM blob_attachments WHERE doc_slug=$1 AND blob_name=$2 AND deleted_at IS NULL")
  if local is null OR ref.uploadedAt > local.uploadedAt OR
    (ref.uploadedAt == local.uploadedAt AND ref.uploadedBy > local.uploadedBy):
      soft-delete local if exists
      insert new record with ref's metadata
      mark hash as pending-fetch if not in blob store
```

---

## 8. CLI Commands

The CLI (`packages/llmtxt/src/cli/`) MUST gain three new commands:

### `llmtxt attach <slug> <filepath>`

```
USAGE: llmtxt attach <slug> <filepath> [--name <name>] [--content-type <mime>]

Arguments:
  slug       Document slug
  filepath   Path to the file to attach

Options:
  --name          Attachment name (default: basename of filepath)
  --content-type  MIME type (default: detected from extension)

Output:
  Attached <name> to <slug>
  Hash: <sha256>
  Size: <humanized>
```

### `llmtxt detach <slug> <blobname>`

```
USAGE: llmtxt detach <slug> <blobname>

Arguments:
  slug      Document slug
  blobname  Attachment name to remove

Output:
  Detached <blobname> from <slug>
```

### `llmtxt blobs <slug>`

```
USAGE: llmtxt blobs <slug>

Arguments:
  slug  Document slug

Output (table):
  NAME          SIZE    TYPE        UPLOADED BY   UPLOADED AT
  diagram.png   42 KB   image/png   agent-1       2026-04-17T19:00:00Z
  report.pdf    1.2 MB  app/pdf     agent-2       2026-04-17T18:55:00Z
```

---

## 9. Security Model

### 9.1 Hash Verification

Implementations MUST verify the SHA-256 hash of every blob on read when bytes are
returned. Hash mismatch indicates storage corruption or tampering and MUST result in
a `BlobCorruptError`. The corrupt file SHOULD be quarantined (renamed to `<hash>.corrupt`)
and the error propagated to the caller.

### 9.2 Name Validation and Traversal Prevention

Blob names MUST be validated before any storage operation using the
`blob_name_validate` function in `crates/llmtxt-core`. This prevents path traversal
attacks (`../../etc/passwd`), null byte injection, and shell metacharacter injection.

The filesystem storage path for LocalBackend is derived solely from the content hash
(never the attachment name), eliminating path traversal in the storage layer entirely.
Name validation is still applied to prevent injection into log messages and database
queries.

### 9.3 Access Control

Blob access MUST inherit the document's access control policy:

- Agents that can READ the document MUST be able to call `listBlobs` and `getBlob`.
- Agents that can WRITE the document MUST be able to call `attachBlob` and `detachBlob`.
- The HTTP API endpoints MUST apply `requireAuth` and document-level RBAC before
  delegating to blob operations.
- `fetchBlobByHash` (sync pull path) MUST require that the caller can read at least
  one document that references the requested hash.

### 9.4 Size Limit

Implementations MUST enforce `maxBlobSizeBytes` (default `100 * 1024 * 1024`, 100MB)
before writing any bytes. The check MUST occur before storage allocation. Violations
MUST return a `BlobTooLargeError` with the configured limit in the message.

### 9.5 Content Type Sanitization

The `contentType` field is stored as-is and returned to clients. Implementations
MUST NOT execute or render content based on the stored MIME type. HTTP API responses
MUST set `Content-Disposition: attachment` to prevent browser execution of returned
blob bytes.

---

## 10. Error Types

The following error classes MUST be defined in `packages/llmtxt/src/core/errors.ts`
(new file or extension of existing):

| Error Class | Condition |
|-------------|-----------|
| `BlobTooLargeError` | `data.byteLength > maxBlobSizeBytes` |
| `BlobNameInvalidError` | Name fails `blob_name_validate` |
| `BlobCorruptError` | Hash mismatch on read |
| `BlobNotFoundError` | Hash not in store (sync pull failure) |
| `BlobAccessDeniedError` | Caller lacks read/write permission |

---

## 11. Dependency DAG

```
T428.1 (DB schema)          → (no deps)
T428.2 (core hash+validate) → (no deps)
T428.3 (LocalBackend)       → T428.1, T428.2
T428.4 (PostgresBackend)    → T428.1, T428.2
T428.5 (Backend interface)  → T428.3, T428.4
T428.6 (Changeset integ)    → T428.5
T428.7 (CLI commands)       → T428.5
T428.8 (Security layer)     → T428.5
T428.9 (Integration tests)  → T428.6, T428.8
T428.10 (Docs)              → T428.1, T428.2, T428.3, T428.4, T428.5, T428.6, T428.7, T428.8, T428.9
```

---

## 12. Child Task Acceptance Criteria

### T428.1 — DB Schema + Migration

- `blob_attachments` table exists in both `schema-pg.ts` (Drizzle PG) and local SQLite schema.
- Drizzle migration generated and applies idempotently (drizzle-kit generate + migrate).
- `blob_attachments_active_name_idx` unique index enforces single active record per (doc_slug, blob_name).
- `pg_lo_oid` column is nullable (used only in pg-lo mode).

### T428.2 — Rust Core: hash_blob + blob_name_validate

- `hash_blob(bytes: &[u8]) -> String` in `crates/llmtxt-core/src/blob.rs` — returns lowercase hex SHA-256.
- `blob_name_validate(name: &str) -> Result<(), BlobNameError>` — enforces all name rules from §3.2.
- Both functions exported via WASM (`#[wasm_bindgen]`).
- Unit tests cover: empty bytes, known SHA-256 vectors, valid names, all invalid name patterns.
- `cargo test` passes; `ferrous-forge validate` and `cargo fmt` pass.

### T428.3 — LocalBackend Blob Adapter

- `LocalBackend` implements `BlobOps`.
- `attachBlob` writes to `.llmtxt/blobs/<hash>` atomically (tmp+rename).
- `getBlob` with `includeData=true` verifies hash; returns `BlobCorruptError` on mismatch.
- `detachBlob` soft-deletes the manifest record.
- `fetchBlobByHash` returns null if hash not in store.
- Unit tests cover: attach, get with data, list, detach, hash-verify corruption, size limit.

### T428.4 — PostgresBackend Blob Adapter

- `PostgresBackend` implements `BlobOps`.
- S3 mode (`blobStorageMode: 's3'`): uses `@aws-sdk/client-s3` or `@aws-sdk/lib-storage`.
- PG-LO mode (`blobStorageMode: 'pg-lo'`): uses `pg` large object API.
- Mode is selected from `BackendConfig.blobStorageMode` (default: `'s3'`).
- Hash verified on every `getBlob(includeData=true)` call.
- Unit tests (with mock S3) cover both modes: attach, get, list, detach, size limit, hash verify.

### T428.5 — Backend Interface Extension

- `BlobOps` sub-interface added to `packages/llmtxt/src/core/backend.ts`.
- `Backend` interface extends `BlobOps`.
- All new types (`AttachBlobParams`, `BlobAttachment`, `BlobData`, `BlobRef`) exported.
- `RemoteBackend` stub methods added (proxy to HTTP API; marked TODO if HTTP routes not yet shipped).
- TypeScript compiles (`tsc --noEmit`).

### T428.6 — Changeset Integration

- `Changeset` type extended with optional `blobs?: BlobRef[]`.
- `buildChangeset` includes blob refs for all blob operations since last sync.
- `applyChangeset` applies LWW rule per §7.3 and schedules lazy fetch if hash absent.
- Unit tests: LWW correctness (newer wins, tie-break by uploadedBy), lazy-fetch scheduling.

### T428.7 — CLI Commands

- `llmtxt attach <slug> <filepath>` attaches file, prints hash and size.
- `llmtxt detach <slug> <blobname>` removes attachment, prints confirmation.
- `llmtxt blobs <slug>` lists attachments in a table.
- `--name` and `--content-type` options supported for `attach`.
- MIME type auto-detected from file extension when `--content-type` not supplied.
- All three commands covered by CLI integration tests.

### T428.8 — Security Layer

- HTTP routes for blob operations enforce `requireAuth` + document RBAC.
- `blob_name_validate` called before any storage operation in both backends.
- Hash verification enforced on every byte-returning read path.
- `Content-Disposition: attachment` set on HTTP blob download responses.
- `fetchBlobByHash` requires caller to hold read access to at least one referencing document.
- Security tests: path traversal attempt rejected (403), oversized blob rejected (413), corrupt blob returns error.

### T428.9 — Integration Test

- Test script: 5 agents attach/detach/fetch across hub-spoke topology.
- LWW resolution: two agents upload same `blobName` concurrently; verify winner is the one with later `uploadedAt`.
- Lazy sync: agent A attaches blob; agent B receives changeset ref; agent B calls `getBlob(includeData=true)` and bytes are fetched.
- Hash tampering test: corrupt a stored blob byte; verify `BlobCorruptError` is returned.
- All assertions pass without manual intervention.

### T428.10 — Documentation

- `apps/docs/content/docs/sdk/blob-attachments.mdx` covers: concept, API reference, CLI usage, backend config, security model.
- Code examples for `attachBlob`, `getBlob`, `listBlobs`, `detachBlob` in TypeScript.
- S3/R2 configuration walkthrough.
- PG large objects fallback noted.
- Frontmatter includes title, description, and relevant navigation links.

---

## 13. Size Limit Configuration

The default maximum blob size is **100 MB** (`100 * 1024 * 1024` bytes). This limit is
configurable via `BackendConfig.maxBlobSizeBytes`. Operators running resource-constrained
deployments SHOULD lower this value. The CLI respects the backend's configured limit.

---

## 14. Non-Goals and Future Work

- **Blob garbage collection**: orphaned blob bytes (no remaining manifest references) are
  not automatically cleaned up in V1. A future `llmtxt gc-blobs` command can sweep the
  store.
- **Cross-document blob dedup**: V1 deduplication is within a single backend instance.
  Cross-instance dedup requires a shared hash registry (deferred).
- **Blob streaming**: V1 buffers full blob bytes in memory for hash verification. Streaming
  with progressive hash computation is a future optimization for very large files.
- **Blob versioning**: V1 uses LWW (one canonical record per name). A history of previous
  uploads can be surfaced in a future `llmtxt blob-history` command.
