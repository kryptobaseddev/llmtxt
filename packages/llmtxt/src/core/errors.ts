/**
 * Canonical blob error classes for the LLMtxt Backend interface.
 *
 * These classes are the single source of truth for blob-related errors.
 * All backend implementations (LocalBackend, PostgresBackend, RemoteBackend)
 * MUST use these classes rather than defining their own.
 *
 * @see docs/specs/ARCH-T428-binary-blob-attachments.md §10
 * @module
 */

/**
 * Thrown when blob size exceeds the configured maximum (default 100 MB).
 *
 * MUST be thrown before any storage allocation occurs.
 * The error message MUST include the configured limit in human-readable form.
 */
export class BlobTooLargeError extends Error {
  constructor(size: number, maxBytes: number) {
    super(
      `Blob size ${size} bytes exceeds maximum of ${maxBytes} bytes (${Math.round(maxBytes / 1024 / 1024)} MB)`
    );
    this.name = 'BlobTooLargeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a blob attachment name fails validation.
 *
 * Triggered by any of: path traversal sequences (".."), path separators
 * ("/" or "\\"), null bytes ("\0"), leading/trailing whitespace, empty name,
 * or name exceeding 255 bytes (UTF-8).
 */
export class BlobNameInvalidError extends Error {
  constructor(name: string, reason: string) {
    super(`Blob name "${name}" is invalid: ${reason}`);
    this.name = 'BlobNameInvalidError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when SHA-256 hash verification fails on a read.
 *
 * Indicates storage corruption or tampering. The implementation MUST NOT
 * return the corrupt bytes to the caller. The corrupt file SHOULD be
 * quarantined (renamed to "<hash>.corrupt") before throwing.
 */
export class BlobCorruptError extends Error {
  constructor(hash: string, location: string) {
    super(`Blob hash mismatch for ${hash} at ${location} — storage may be corrupt or tampered`);
    this.name = 'BlobCorruptError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a blob hash is not found in the store.
 *
 * Used by the lazy sync pull path when fetchBlobByHash cannot resolve
 * the requested hash from any known peer.
 */
export class BlobNotFoundError extends Error {
  constructor(hash: string) {
    super(`Blob with hash ${hash} not found in store`);
    this.name = 'BlobNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the caller lacks the required access to perform a blob operation.
 *
 * Blob access inherits the document's access control policy:
 *   - READ permission required for getBlob, listBlobs, fetchBlobByHash
 *   - WRITE permission required for attachBlob, detachBlob
 */
export class BlobAccessDeniedError extends Error {
  constructor(operation: string, docSlug: string, agentId?: string) {
    super(
      agentId
        ? `Agent "${agentId}" does not have permission to "${operation}" on document "${docSlug}"`
        : `Permission denied for "${operation}" on document "${docSlug}"`
    );
    this.name = 'BlobAccessDeniedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
