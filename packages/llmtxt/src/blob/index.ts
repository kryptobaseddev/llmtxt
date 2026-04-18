/**
 * llmtxt/blob — standalone content-addressed blob subpath.
 *
 * Provides portable blob primitives extracted from the /local backend so
 * any consumer can `import { hashBlob, validateBlobName, BlobFsAdapter } from 'llmtxt/blob'`
 * without pulling in the full LocalBackend.
 *
 * Public API surface:
 *   - Canonical error classes (BlobTooLargeError, etc.)
 *   - Blob type interfaces (AttachBlobParams, BlobAttachment, BlobData, BlobRef, BlobOps)
 *   - WASM-backed primitives: hashBlob, validateBlobName
 *   - Filesystem adapter: BlobFsAdapter
 *   - Sync-layer changeset utilities: BlobChangeset, buildBlobChangeset, applyBlobChangeset
 *
 * @module
 */

// ── Error classes ──────────────────────────────────────────────────
export {
  BlobTooLargeError,
  BlobNameInvalidError,
  BlobCorruptError,
  BlobNotFoundError,
  BlobAccessDeniedError,
} from '../core/errors.js';

// ── Types ──────────────────────────────────────────────────────────
export type {
  AttachBlobParams,
  BlobAttachment,
  BlobData,
  BlobRef,
  BlobOps,
} from '../core/backend.js';

// ── WASM primitives ────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of raw binary data.
 *
 * Returns a lowercase hex string (64 characters).
 * Delegates to crates/llmtxt-core::hash_blob via WASM.
 * Use for content-addressing blobs — mirrors the Rust primitive exactly.
 *
 * @param data - Raw bytes to hash
 * @returns Lowercase hex SHA-256 digest (64 chars)
 */
export { hashBlob } from '../wasm.js';

/**
 * Validate a blob attachment name.
 *
 * Throws {@link BlobNameInvalidError} when any of the following are true:
 *   - name is empty or exceeds 255 bytes (UTF-8)
 *   - name contains path traversal sequences (`..`)
 *   - name contains path separators (`/` or `\`)
 *   - name contains null bytes (`\0`)
 *   - name has leading or trailing whitespace
 *
 * Delegates to crates/llmtxt-core::blob_name_validate via WASM.
 *
 * @param name - The attachment name to validate (e.g. "diagram.png")
 * @throws {@link BlobNameInvalidError} on violation
 */
export { validateBlobName } from './primitives.js';

// ── Filesystem adapter ─────────────────────────────────────────────
export { BlobFsAdapter } from './fs-adapter.js';

// ── Changeset utilities ────────────────────────────────────────────
export {
  buildBlobChangeset,
  applyBlobChangeset,
  incomingWinsLWW,
} from './changeset.js';

export type {
  BlobChangeset,
  ApplyBlobChangesetResult,
  BlobRefWithDocSlug,
} from './changeset.js';
