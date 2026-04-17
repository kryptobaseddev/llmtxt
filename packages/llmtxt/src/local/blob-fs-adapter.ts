/**
 * LocalBackend blob adapter — filesystem-backed content-addressed blob storage.
 *
 * Stores blob bytes at <storagePath>/blobs/<sha256-hex> using atomic
 * write-via-tmp-rename. Verifies the SHA-256 hash on every read. Maintains an
 * attachment manifest in SQLite (blob_attachments table). Enforces LWW semantics
 * per (docSlug, blobName): the newest upload wins.
 *
 * Uses crates/llmtxt-core WASM primitives:
 *   - hashBlob(bytes: Uint8Array) → hex string (64 chars)
 *   - blobNameValidate(name: string) → void or throws
 *
 * Security guarantees (per ARCH-T428):
 *   - Hash verified on EVERY read with includeData=true — BlobCorruptError on mismatch
 *   - Blob name validated before ANY storage operation — BlobNameInvalidError on violation
 *   - Filesystem path derived from hash only (never name) — no path traversal possible
 *   - Size enforced before write — BlobTooLargeError on excess
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { eq, and, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type {
  AttachBlobParams,
  BlobAttachment,
  BlobData,
} from '../core/backend.js';

import { blobAttachments } from './schema-local.js';
import * as wasmModule from '../../wasm/llmtxt_core.js';

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_MAX_BLOB_SIZE = 100 * 1024 * 1024; // 100 MB

// ── Error classes ──────────────────────────────────────────────

/** Thrown when blob size exceeds the configured maximum. */
export class BlobTooLargeError extends Error {
  constructor(size: number, maxBytes: number) {
    super(
      `Blob size ${size} bytes exceeds maximum of ${maxBytes} bytes (${Math.round(maxBytes / 1024 / 1024)} MB)`
    );
    this.name = 'BlobTooLargeError';
  }
}

/** Thrown when a blob name fails validation (path traversal, null bytes, etc.). */
export class BlobNameInvalidError extends Error {
  constructor(name: string, reason: string) {
    super(`Blob name "${name}" is invalid: ${reason}`);
    this.name = 'BlobNameInvalidError';
  }
}

/** Thrown when hash verification fails on read — indicates storage corruption or tampering. */
export class BlobCorruptError extends Error {
  constructor(hash: string, path: string) {
    super(`Blob hash mismatch for ${hash} at ${path} — storage may be corrupt or tampered`);
    this.name = 'BlobCorruptError';
  }
}

/** Thrown when a blob hash is not found in the store (used during sync lazy pull). */
export class BlobNotFoundError extends Error {
  constructor(hash: string) {
    super(`Blob with hash ${hash} not found in store`);
    this.name = 'BlobNotFoundError';
  }
}

// ── Internal helpers ───────────────────────────────────────────

/** Generate a new short unique id. */
function newId(): string {
  return nanoid(21);
}

/** Validate a blob name using the WASM primitive. Throws BlobNameInvalidError on violation. */
function validateBlobName(name: string): void {
  try {
    wasmModule.blobNameValidate(name);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new BlobNameInvalidError(name, reason);
  }
}

/** Hash blob bytes using the WASM SHA-256 primitive. */
function hashBlobBytes(bytes: Uint8Array): string {
  return wasmModule.hashBlob(bytes);
}

/** Convert a row from blob_attachments to a BlobAttachment record. */
function rowToAttachment(row: typeof blobAttachments.$inferSelect): BlobAttachment {
  return {
    id: row.id,
    docSlug: row.docSlug,
    blobName: row.blobName,
    hash: row.hash,
    size: row.size,
    contentType: row.contentType,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt,
  };
}

// ── BlobFsAdapter class ────────────────────────────────────────

/**
 * Filesystem blob adapter for LocalBackend.
 *
 * Stores bytes at `<storagePath>/blobs/<hash>`.
 * Uses atomic writes (tmp → rename) to prevent partial writes.
 * Verifies SHA-256 hash on every `getBlob(includeData=true)` call.
 *
 * This class is used directly by LocalBackend — do not instantiate it
 * independently in application code.
 */
export class BlobFsAdapter {
  private readonly blobsDir: string;
  private readonly maxBlobSizeBytes: number;

  constructor(
    private readonly db: BetterSQLite3Database<Record<string, never>>,
    storagePath: string,
    maxBlobSizeBytes = DEFAULT_MAX_BLOB_SIZE
  ) {
    this.blobsDir = path.join(storagePath, 'blobs');
    this.maxBlobSizeBytes = maxBlobSizeBytes;
  }

  /** Ensure the blobs directory exists. Called lazily on first use. */
  private ensureBlobsDir(): void {
    fs.mkdirSync(this.blobsDir, { recursive: true });
  }

  /** Full path to a blob file given its hash. */
  private blobPath(hash: string): string {
    return path.join(this.blobsDir, hash);
  }

  // ── BlobOps implementation ─────────────────────────────────

  /**
   * Attach a binary blob to a document.
   *
   * - Validates the blob name via WASM blobNameValidate.
   * - Enforces maxBlobSizeBytes.
   * - Computes SHA-256 hash via WASM hashBlob.
   * - Writes bytes atomically to <blobsDir>/<hash> if not already present.
   * - Applies LWW: soft-deletes any existing active record for (docSlug, blobName)
   *   if it exists, then inserts the new record.
   * - Returns the new BlobAttachment record.
   */
  attachBlob(params: AttachBlobParams): BlobAttachment {
    // 1. Validate name
    validateBlobName(params.name);

    // 2. Enforce size limit
    const bytes = params.data instanceof Buffer
      ? new Uint8Array(params.data.buffer, params.data.byteOffset, params.data.byteLength)
      : new Uint8Array(params.data);

    if (bytes.byteLength > this.maxBlobSizeBytes) {
      throw new BlobTooLargeError(bytes.byteLength, this.maxBlobSizeBytes);
    }

    // 3. Compute hash
    const hash = hashBlobBytes(bytes);

    // 4. Ensure blobs directory exists
    this.ensureBlobsDir();

    // 5. Write bytes atomically (tmp → rename) — skip if hash already on disk
    const destPath = this.blobPath(hash);
    if (!fs.existsSync(destPath)) {
      const tmpPath = `${destPath}.tmp`;
      try {
        fs.writeFileSync(tmpPath, bytes);
        fs.renameSync(tmpPath, destPath);
      } catch (err) {
        // Clean up tmp on error
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw err;
      }
    }

    // 6. Apply LWW in a transaction: soft-delete existing active record, insert new
    const now = Date.now();
    const id = newId();

    this.db.transaction(() => {
      // Soft-delete any existing active record for this (docSlug, blobName)
      const existing = this.db
        .select({ id: blobAttachments.id })
        .from(blobAttachments)
        .where(
          and(
            eq(blobAttachments.docSlug, params.docSlug),
            eq(blobAttachments.blobName, params.name),
            isNull(blobAttachments.deletedAt)
          )
        )
        .get();

      if (existing) {
        this.db
          .update(blobAttachments)
          .set({ deletedAt: now })
          .where(eq(blobAttachments.id, existing.id))
          .run();
      }

      // Insert new active record
      this.db.insert(blobAttachments).values({
        id,
        docSlug: params.docSlug,
        blobName: params.name,
        hash,
        size: bytes.byteLength,
        contentType: params.contentType,
        uploadedBy: params.uploadedBy,
        uploadedAt: now,
        deletedAt: null,
      }).run();
    });

    return {
      id,
      docSlug: params.docSlug,
      blobName: params.name,
      hash,
      size: bytes.byteLength,
      contentType: params.contentType,
      uploadedBy: params.uploadedBy,
      uploadedAt: now,
    };
  }

  /**
   * Retrieve a blob attachment record, optionally with bytes.
   *
   * Returns null if the blobName is not attached to docSlug.
   * When includeData=true, reads bytes from disk and verifies the SHA-256 hash.
   * Returns BlobCorruptError if hash mismatch detected.
   */
  getBlob(
    docSlug: string,
    blobName: string,
    opts: { includeData?: boolean } = {}
  ): BlobData | null {
    // Validate name before any query
    validateBlobName(blobName);

    // Query active record
    const row = this.db
      .select()
      .from(blobAttachments)
      .where(
        and(
          eq(blobAttachments.docSlug, docSlug),
          eq(blobAttachments.blobName, blobName),
          isNull(blobAttachments.deletedAt)
        )
      )
      .get();

    if (!row) return null;

    const attachment = rowToAttachment(row);

    if (!opts.includeData) {
      return attachment;
    }

    // Read bytes and verify hash
    const filePath = this.blobPath(row.hash);
    let rawBytes: Buffer;
    try {
      rawBytes = fs.readFileSync(filePath);
    } catch {
      throw new BlobCorruptError(row.hash, filePath);
    }

    // Verify hash
    const actualHash = hashBlobBytes(new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength));
    if (actualHash !== row.hash) {
      // Quarantine the corrupt file
      const corruptPath = `${filePath}.corrupt`;
      try { fs.renameSync(filePath, corruptPath); } catch { /* ignore */ }
      throw new BlobCorruptError(row.hash, filePath);
    }

    return { ...attachment, data: rawBytes };
  }

  /**
   * List all active (non-deleted) blob attachments for a document.
   * Returns metadata only — no bytes.
   */
  listBlobs(docSlug: string): BlobAttachment[] {
    const rows = this.db
      .select()
      .from(blobAttachments)
      .where(
        and(
          eq(blobAttachments.docSlug, docSlug),
          isNull(blobAttachments.deletedAt)
        )
      )
      .all();

    return rows.map(rowToAttachment);
  }

  /**
   * Soft-delete a named blob attachment from a document.
   *
   * Sets deleted_at = now(). Does NOT delete the bytes from disk
   * (orphan GC is a deferred concern).
   * Returns false if no active attachment exists.
   */
  detachBlob(docSlug: string, blobName: string, _detachedBy: string): boolean {
    // Validate name before any query
    validateBlobName(blobName);

    const row = this.db
      .select({ id: blobAttachments.id })
      .from(blobAttachments)
      .where(
        and(
          eq(blobAttachments.docSlug, docSlug),
          eq(blobAttachments.blobName, blobName),
          isNull(blobAttachments.deletedAt)
        )
      )
      .get();

    if (!row) return false;

    this.db
      .update(blobAttachments)
      .set({ deletedAt: Date.now() })
      .where(eq(blobAttachments.id, row.id))
      .run();

    return true;
  }

  /**
   * Fetch blob bytes directly by hash (used by the lazy sync pull path).
   *
   * Returns null if no file exists for this hash.
   * Verifies hash on return.
   */
  fetchBlobByHash(hash: string): Buffer | null {
    // Hash must be a 64-char hex string
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return null;
    }

    const filePath = this.blobPath(hash);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    let rawBytes: Buffer;
    try {
      rawBytes = fs.readFileSync(filePath);
    } catch {
      return null;
    }

    // Verify hash
    const actualHash = hashBlobBytes(new Uint8Array(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength));
    if (actualHash !== hash) {
      // Quarantine the corrupt file
      const corruptPath = `${filePath}.corrupt`;
      try { fs.renameSync(filePath, corruptPath); } catch { /* ignore */ }
      throw new BlobCorruptError(hash, filePath);
    }

    return rawBytes;
  }
}
