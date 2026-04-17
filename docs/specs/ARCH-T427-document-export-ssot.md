# ARCH-T427: Document Export + SSoT Canonical Output

**Status**: SPECIFICATION  
**Epic**: T427  
**Date**: 2026-04-17  
**Author**: RCASD Team Lead (orchestrator-spawned)  
**RFC level**: RFC 2119 (MUST / SHOULD / MAY)

---

## 1. Motivation

Documents live exclusively inside the LLMtxt database (SQLite or Postgres). No first-class
mechanism exists to produce a file on disk from a document's current state. This creates
friction for:

- CI pipelines that need to version-control specification files
- Human reviewers who want to open a canonical `.md` in an editor
- Agent-to-agent handoffs that exchange files rather than API calls
- Audit trails that require a signed, deterministic snapshot of a document at approval time

The converged CRDT state in the database IS the single source of truth (SSoT per D001).
Export is a **read-only projection** of that truth onto disk. It MUST NOT alter DB state.
Import is the inverse: a file on disk becomes the seed for a new document or a new version
of an existing document in the DB.

---

## 2. Scope

This specification covers:

1. **4 export formats**: `markdown` (YAML frontmatter + body), `json` (full structured),
   `txt` (plain body only), `llmtxt` (native round-trippable with hash chain reference).
2. **Frontmatter schema** (canonical, byte-stable, ordered YAML keys).
3. **Canonical frontmatter serializer** in `crates/llmtxt-core` (Rust SSoT).
4. **`backend.exportDocument()`** on the `Backend` interface in `packages/llmtxt`.
5. **CLI commands**: `llmtxt export`, `llmtxt export-all`, `llmtxt import`.
6. **`backend.importDocument()`** on the `Backend` interface.
7. **Determinism invariants**: same document state → identical file bytes.
8. **Round-trip guarantee**: export then import → logically equivalent document.
9. **Signed export option**: Ed25519-signed export manifest for audit trail.

Out of scope for this epic:
- Live watch-mode export (streaming)
- Export of CRDT state vectors (raw Yjs bytes)
- Multi-document bundle archives

---

## 3. Architecture Principles (Owner Pre-Decided)

| Principle | Decision |
|-----------|----------|
| SSoT location | Canonicalization primitives (frontmatter serializer, key ordering) live ONLY in `crates/llmtxt-core` |
| SDK layer | `exportDocument()` and `importDocument()` live in `packages/llmtxt` on the `Backend` interface |
| Backend implementations | `LocalBackend`, `RemoteBackend`, and `PostgresBackend` ALL implement the interface |
| CLI ownership | `packages/llmtxt/src/cli/llmtxt.ts` — no new binaries |
| Loro/CRDT | Export reads the latest converged CRDT snapshot from DB; depends on T384 for stability guarantee |
| No DB mutation on export | Export is pure read + file write; MUST NOT mutate any DB row |
| No phase-2 deferrals | All 4 formats, CLI, and import MUST ship together in this epic |

---

## 4. Export Format Contracts

### 4.1 Canonical Frontmatter Schema

The YAML frontmatter block MUST use the following ordered keys exactly. The
`canonical_frontmatter` function in `crates/llmtxt-core` is the sole implementation.
Key order is fixed; no additional keys are permitted in the canonical block.

```yaml
---
title: "My Document Title"
slug: "my-document-title"
version: 3
state: "APPROVED"
contributors:
  - "agent-alice"
  - "agent-bob"
content_hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
exported_at: "2026-04-17T19:00:00.000Z"
---
```

Rules (RFC 2119):

- `title` MUST be the document title, double-quoted, UTF-8 safe.
- `slug` MUST be the URL-safe slug.
- `version` MUST be the integer version number of the exported state.
- `state` MUST be the lifecycle state string (DRAFT / REVIEW / APPROVED / etc.).
- `contributors` MUST be a YAML sequence of agent IDs, sorted lexicographically.
- `content_hash` MUST be the SHA-256 hex of the body content (after frontmatter, not including frontmatter).
- `exported_at` MUST be an ISO 8601 UTC timestamp, millisecond precision.
- The `---` fence MUST appear on its own line with no trailing spaces.
- All string values MUST be double-quoted.
- The serializer MUST produce `\n` line endings (LF, not CRLF).

### 4.2 Markdown Format (`.md`)

Structure:

```
---
<canonical frontmatter>
---

<document body content>
```

- The frontmatter block comes first, bounded by `---` fences.
- Exactly one blank line separates the closing `---` fence from the body.
- The body is the raw content string of the latest version, unchanged.
- File MUST be encoded UTF-8 with LF line endings.
- File MUST end with exactly one trailing newline (`\n`).

### 4.3 JSON Format (`.json`)

Full structured object — no binary, arrays only where naturally ordered:

```json
{
  "schema": "llmtxt-export/1",
  "title": "My Document Title",
  "slug": "my-document-title",
  "version": 3,
  "state": "APPROVED",
  "contributors": ["agent-alice", "agent-bob"],
  "content_hash": "2cf24dba...",
  "exported_at": "2026-04-17T19:00:00.000Z",
  "content": "# My Document Title\n\nFull body here.",
  "labels": ["sdk", "spec"],
  "created_by": "agent-alice",
  "created_at": 1745000000000,
  "updated_at": 1745010000000,
  "version_count": 3
}
```

- `schema` MUST be `"llmtxt-export/1"`.
- All numeric timestamps MUST be Unix milliseconds (integer).
- `contributors` MUST be sorted lexicographically (same as frontmatter).
- Object keys MUST be serialized in the order shown above (deterministic).
- No `undefined` values; absent optional fields MUST be omitted or set to `null`.
- No trailing whitespace; `JSON.stringify` with 2-space indent.

### 4.4 Plain Text Format (`.txt`)

- Body content only, no frontmatter, no metadata.
- UTF-8, LF line endings.
- One trailing newline.
- Used for quick diffing, clipboard pasting, or piping into other tools.

### 4.5 Native LLMtxt Format (`.llmtxt`)

The native format is a superset of markdown that is explicitly round-trippable:

```
---
title: "My Document Title"
slug: "my-document-title"
version: 3
state: "APPROVED"
contributors:
  - "agent-alice"
  - "agent-bob"
content_hash: "2cf24dba..."
exported_at: "2026-04-17T19:00:00.000Z"
chain_ref: "bft:abc123def456"
format: "llmtxt/1"
---

<document body content>
```

- MUST include all standard frontmatter fields.
- MUST add `chain_ref`: the BFT approval chain hash (from `getApprovalChain`), or `null` if no approvals exist.
- MUST add `format: "llmtxt/1"` as the last frontmatter key.
- The import path MUST parse this format and restore all metadata.

---

## 5. API Contract

### 5.1 ExportDocumentParams

```typescript
export interface ExportDocumentParams {
  /** URL-safe document slug. */
  slug: string;
  /** Export format. */
  format: 'markdown' | 'json' | 'txt' | 'llmtxt';
  /** Absolute or relative path to write the output file. */
  outputPath: string;
  /** Whether to include metadata (frontmatter/structured fields). Default true. */
  includeMetadata?: boolean;
  /** If true, sign the export manifest with the local Ed25519 identity. Default false. */
  sign?: boolean;
}
```

### 5.2 ExportDocumentResult

```typescript
export interface ExportDocumentResult {
  /** Absolute path of the written file. */
  filePath: string;
  /** Slug of the exported document. */
  slug: string;
  /** Version number exported. */
  version: number;
  /** SHA-256 hex of the written file bytes. */
  fileHash: string;
  /** Number of bytes written. */
  byteCount: number;
  /** ISO 8601 UTC timestamp of export. */
  exportedAt: string;
  /** Ed25519 signature hex over fileHash, if sign=true. Null otherwise. */
  signatureHex: string | null;
}
```

### 5.3 Backend.exportDocument()

```typescript
exportDocument(params: ExportDocumentParams): Promise<ExportDocumentResult>;
```

RFC 2119 constraints:

- MUST resolve `params.slug` to a document; MUST throw `ExportError('DOC_NOT_FOUND')` if absent.
- MUST fetch the latest version content from the backend (blob or inline storage).
- MUST call the canonical frontmatter serializer from llmtxt-core WASM for frontmatter generation.
- MUST NOT mutate any document, version, or event row in the database.
- MUST write the file atomically (write to `.tmp` then rename).
- MUST return the SHA-256 hash of the written bytes (not the content hash).
- MUST create intermediate directories via `fs.mkdirSync(dir, { recursive: true })`.
- SHOULD resolve `outputPath` to an absolute path before writing.

### 5.4 ExportAllParams

```typescript
export interface ExportAllParams {
  format: 'markdown' | 'json' | 'txt' | 'llmtxt';
  /** Directory to write files into. One file per document, named `<slug>.<ext>`. */
  outputDir: string;
  /** Filter by lifecycle state. If absent, exports all documents. */
  state?: string;
  includeMetadata?: boolean;
  sign?: boolean;
}

export interface ExportAllResult {
  exported: ExportDocumentResult[];
  skipped: Array<{ slug: string; reason: string }>;
  totalCount: number;
  failedCount: number;
}
```

### 5.5 Backend.exportAll()

```typescript
exportAll(params: ExportAllParams): Promise<ExportAllResult>;
```

- MUST iterate all documents (paginating via `listDocuments`).
- MUST call `exportDocument` for each; individual failures MUST be collected in `skipped`, not thrown.
- MUST write each file as `<slug>.<ext>` inside `outputDir`.

### 5.6 ImportDocumentParams

```typescript
export interface ImportDocumentParams {
  /** Path to the file to import. */
  filePath: string;
  /** Agent performing the import. */
  importedBy: string;
  /**
   * Conflict strategy when a document with the same slug already exists.
   * 'new_version': publish the imported content as a new version (default).
   * 'create': fail if a document with the slug already exists.
   * 'overwrite': not supported in v1 — reserved for future.
   */
  onConflict?: 'new_version' | 'create';
}
```

### 5.7 ImportDocumentResult

```typescript
export interface ImportDocumentResult {
  /** Whether a new document was created or a version was appended. */
  action: 'created' | 'version_appended';
  slug: string;
  documentId: string;
  versionNumber: number;
  contentHash: string;
}
```

### 5.8 Backend.importDocument()

```typescript
importDocument(params: ImportDocumentParams): Promise<ImportDocumentResult>;
```

RFC 2119 constraints:

- MUST parse frontmatter from `.md` and `.llmtxt` files; MUST parse `content` field from `.json`.
- MUST extract raw body from `.txt` files (no frontmatter).
- MUST NOT silently ignore a file whose content_hash (in frontmatter) does not match the actual body SHA-256.
- SHOULD derive the document title from frontmatter `title` field; MUST fall back to the filename stem.
- MUST create a new document if no document with the slug exists.
- MUST publish a new version if the document already exists and `onConflict='new_version'`.
- MUST return `ExportError('SLUG_EXISTS')` if document exists and `onConflict='create'`.

---

## 6. Determinism Invariants

A deterministic export guarantees: given the same document state in the DB,
repeated calls to `exportDocument` produce byte-identical files.

Requirements:

1. **Frontmatter key order**: Fixed by the canonical serializer in `crates/llmtxt-core`. No runtime key sorting permitted in TypeScript.
2. **Contributor list**: Sorted lexicographically before serialization. The sort MUST be performed inside the Rust serializer, not the TypeScript caller.
3. **Timestamp**: `exported_at` MUST be injected by the caller as a parameter (not computed inside the serializer). Callers that need determinism across calls MUST pass the same timestamp.
4. **JSON key order**: The JSON formatter MUST serialize keys in the exact order specified in section 4.3. `JSON.stringify` with a replacer array is used to enforce this.
5. **Line endings**: All formats MUST use LF (`\n`). The serializer MUST normalize line endings before writing.
6. **Trailing newline**: All formats MUST end with exactly one `\n`. The writer MUST strip trailing blank lines from body content and append exactly one `\n`.
7. **File write**: Files MUST be written as UTF-8 without BOM.

### 6.1 Hash-stability Guarantee

`ExportDocumentResult.fileHash` = SHA-256(file bytes).  
For the same `(slug, versionNumber, format, exportedAt)`, `fileHash` MUST be identical across:
- Calls on the same machine
- Calls on different machines
- Calls using LocalBackend vs PostgresBackend

### 6.2 Signed Export

When `sign: true`:

- The local Ed25519 identity from `.llmtxt/identity.json` MUST be loaded.
- The signature is over `fileHash` (32 bytes, raw SHA-256, not hex).
- `signatureHex` in the result is the 64-byte Ed25519 signature as lowercase hex.
- The signature is NOT embedded in the file; it is returned in `ExportDocumentResult` only.
- Callers MAY write the signature to a companion `.sig` file alongside the export.

---

## 7. Round-Trip Guarantee

Export then import MUST produce a logically equivalent document. "Logically equivalent" means:

- Same title
- Same body content (same SHA-256)
- Same slug

"Logically equivalent" does NOT mean:

- Same `documentId` (nanoid; generated fresh on create)
- Same `createdAt` / `updatedAt` timestamps (set at import time)
- Same `versionCount` (reset to 1 for new documents)
- Same approval chain (approvals are not portable)
- Byte-identical DB rows

The round-trip guarantee is specifically:

```
importDocument({ filePath: exported_file }) →
  backend.getDocumentBySlug(slug) →
  backend.listVersions(doc.id) →
  latest_version.content === original_content   // MUST hold
```

---

## 8. Dependency DAG

```
T427.1  Canonical frontmatter serializer (crates/llmtxt-core)
  └── no dependencies

T427.2  Markdown formatter (packages/llmtxt)
  └── T427.1

T427.3  JSON formatter (packages/llmtxt)
  └── T427.1

T427.4  Plain txt formatter (packages/llmtxt)
  └── (no formatter deps — body only)

T427.5  Native llmtxt formatter (packages/llmtxt)
  └── T427.1

T427.6  backend.exportDocument() + exportAll() (Backend interface + all backends)
  └── T427.2, T427.3, T427.4, T427.5

T427.7  CLI llmtxt export + llmtxt export-all
  └── T427.6

T427.8  backend.importDocument() + CLI llmtxt import
  └── T427.6 (uses same Backend interface; import is independent of format implementations but needs interface)

T427.9  Determinism test suite
  └── T427.6

T427.10 Docs (apps/docs/content/docs/sdk/export-import.mdx)
  └── T427.6, T427.7, T427.8
```

Epic dependency: T427 depends on T384 (Loro stable CRDT state) for the `chain_ref` field in `.llmtxt` format and for deterministic CRDT snapshot hashing. If T384 is not yet merged, T427.5 MAY stub `chain_ref: null` with a TODO comment.

---

## 9. Production Constraints

- **Greenfield**: No migrations required. Export/import is purely additive SDK surface.
- **No phase-2 deferrals**: All 4 formats, CLI, import, and determinism tests MUST ship.
- **pnpm only**: `pnpm` for all package operations. No `npm` or `npx`.
- **Package boundaries**: Canonicalization in `crates/llmtxt-core`; SDK surface in `packages/llmtxt`; CLI in `packages/llmtxt/src/cli/llmtxt.ts`.
- **Security**: Signed export uses the existing `@noble/ed25519` + identity keypair pattern already present in the CLI. No new crypto dependencies.
- **Atomic writes**: File write via `.tmp` + rename to prevent partial files visible to other processes.
- **Content retrieval**: `LocalBackend` reads from `blobs/<contentHash>` or inline storage. `RemoteBackend` fetches via the `/v1/documents/:slug/versions/:n` API. `PostgresBackend` reads from the `versions` table inline or object storage.

---

## 10. Child Task Acceptance Criteria

### T427.1 — Canonical Frontmatter Serializer (crates/llmtxt-core)

- Implement `canonical_frontmatter(title, slug, version, state, contributors, content_hash, exported_at) -> String` in Rust.
- Export as WASM binding `canonicalFrontmatter(...)` for TypeScript use.
- Contributors MUST be sorted lexicographically inside the function.
- Output MUST match the schema in section 4.1 byte-for-byte.
- Unit tests: at least 5 fixtures with known expected output.
- `cargo fmt` + `ferrous-forge validate` MUST pass.

### T427.2 — Markdown Formatter (packages/llmtxt)

- Implement `formatMarkdown(doc: Document, content: string, versionNumber: number, exportedAt: string): string`.
- Calls `canonicalFrontmatter` from WASM.
- Produces exact structure from section 4.2.
- Unit tests: at least 3 fixtures; assert byte-exact output on known input.

### T427.3 — JSON Formatter (packages/llmtxt)

- Implement `formatJson(doc: Document, content: string, ...) : string`.
- Object keys in fixed order from section 4.3.
- Unit tests: assert `JSON.parse(output)` roundtrips; assert key order is preserved.

### T427.4 — Plain Txt Formatter (packages/llmtxt)

- Implement `formatTxt(content: string): string`.
- Strips leading/trailing blank lines; appends exactly one trailing `\n`.
- Unit tests: edge cases (empty content, content with existing trailing newlines).

### T427.5 — Native LLMtxt Formatter (packages/llmtxt)

- Implement `formatLlmtxt(doc: Document, content: string, chainRef: string | null, ...) : string`.
- Includes `chain_ref` and `format: "llmtxt/1"` fields.
- Unit tests: assert `chain_ref: null` is serialized correctly; assert round-trip parse recovers all fields.

### T427.6 — backend.exportDocument() + exportAll() (packages/llmtxt)

- Add `ExportDocumentParams`, `ExportDocumentResult`, `ExportAllParams`, `ExportAllResult` types to `core/backend.ts`.
- Add `exportDocument()` and `exportAll()` to the `Backend` interface in `core/backend.ts`.
- Implement in `LocalBackend`, `RemoteBackend`, `PostgresBackend` (or `pg-backend.ts`).
- Atomic write via `.tmp` + rename.
- Content retrieval from blob store (LocalBackend) or API (RemoteBackend).
- Integration tests: create doc, publish version, export in all 4 formats, assert file exists and hash matches.

### T427.7 — CLI export + export-all (packages/llmtxt)

- Add `export` command: `llmtxt export <slug> --format md --output ./specs/`
- Add `export-all` command: `llmtxt export-all --format md --output ./docs/`
- Both support `--sign` flag for signed export.
- Print `ExportDocumentResult` as JSON to stdout on success.
- Unit tests: mock backend, assert correct flags are passed.

### T427.8 — backend.importDocument() + CLI import (packages/llmtxt)

- Add `ImportDocumentParams`, `ImportDocumentResult` to `core/backend.ts`.
- Add `importDocument()` to `Backend` interface.
- Implement in `LocalBackend`, `RemoteBackend`, `PostgresBackend`.
- Support all 4 formats for import (parse frontmatter or JSON).
- Add `import` command: `llmtxt import <file>`
- Integration tests: export → import → verify content matches.

### T427.9 — Determinism Test Suite (packages/llmtxt)

- Test: export the same document 100 times with the same `exportedAt` parameter; assert all 100 `fileHash` values are identical.
- Test: export on LocalBackend and PostgresBackend (if available in CI) → assert same `fileHash`.
- Test: all 4 formats.
- Located in `packages/llmtxt/src/__tests__/export-determinism.test.ts`.

### T427.10 — Docs (apps/docs)

- Create `apps/docs/content/docs/sdk/export-import.mdx`.
- Document all 4 formats with example output.
- Document CLI usage with copy-pasteable examples.
- Document round-trip guarantee and its limits (section 7 of this spec).
- Document signed export.

---

## 11. Implementation Notes

### Content Retrieval in LocalBackend

The `publishVersion` method writes content to `blobs/<contentHash>` when
`contentBytes.length > INLINE_THRESHOLD`, or stores it inline in the `versions` table.
The `exportDocument` implementation in `LocalBackend` MUST:

1. Call `listVersions(doc.id)` to get the latest version entry.
2. Check if a blob file exists at `blobs/<contentHash>`; if yes, read from disk.
3. Otherwise, read the inline content from the version row directly.

### RemoteBackend

`RemoteBackend` MUST fetch content by calling the existing
`GET /v1/documents/:slug/versions/:n` endpoint and using the `content` field from the
response. If the endpoint does not return full content, a `GET /v1/documents/:slug/pull`
fallback MAY be used.

### Frontmatter Parsing (Import Path)

For import, a simple line-by-line YAML frontmatter parser (not a full YAML library) is
sufficient, since the frontmatter schema is tightly constrained. The parser MUST:

- Detect `---` as the opening fence on line 1.
- Read key-value pairs until the closing `---` fence.
- Treat everything after the closing fence as the body.
- Handle `contributors:` as a YAML sequence (lines starting with `  - `).

A full YAML parser (e.g. `js-yaml`) MAY be used as an alternative if already present
in the dependency tree.

---

## 12. Error Types

```typescript
export type ExportErrorCode =
  | 'DOC_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'WRITE_FAILED'
  | 'UNSUPPORTED_FORMAT'
  | 'SIGN_FAILED'
  | 'SLUG_EXISTS'
  | 'PARSE_FAILED'
  | 'HASH_MISMATCH';

export class ExportError extends Error {
  constructor(
    public readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}
```

---

## 13. File Extension Mapping

| Format | Extension |
|--------|-----------|
| markdown | `.md` |
| json | `.json` |
| txt | `.txt` |
| llmtxt | `.llmtxt` |

For `export-all`, the file is named `<slug>.<ext>` inside the output directory.

---

*End of specification. All child tasks MUST reference this document in their implementation.*
