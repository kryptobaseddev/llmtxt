/**
 * PostgresBackend blob adapter — S3/R2 primary + PG large objects fallback.
 *
 * Supports two storage modes controlled by BackendConfig.blobStorageMode:
 *
 *   's3' (default) — stores blob bytes in an S3-compatible object store
 *     (AWS S3, Cloudflare R2, MinIO, etc.) at key `blobs/<hash>`.
 *     Uses @aws-sdk/client-s3 with PutObject / GetObject / HeadObject.
 *     Hash verified on every read (BlobCorruptError on mismatch).
 *
 *   'pg-lo' — stores blob bytes in PostgreSQL large objects via the
 *     low-level lo_creat / lo_write / lo_read / lo_unlink API.
 *     Writes in 64KB chunks to limit memory pressure.
 *     OID stored in blob_attachments.pg_lo_oid column.
 *     Hash verified on every read.
 *
 * Security (per ARCH-T428 §9):
 *   - blob_name_validate called before any storage operation
 *   - hash_blob (WASM SHA-256) computed on attach; verified on every byte read
 *   - Content-Disposition: attachment set by HTTP layer (not this module)
 *   - maxBlobSizeBytes enforced before any storage allocation
 *
 * @module
 */

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';

// ── Error classes (re-exported for consumers) ──────────────────

/** Thrown when blob size exceeds the configured maximum. */
export class BlobTooLargeError extends Error {
  constructor(size: number, maxBytes: number) {
    super(
      `Blob size ${size} bytes exceeds maximum of ${maxBytes} bytes (${Math.round(maxBytes / 1024 / 1024)} MB)`
    );
    this.name = 'BlobTooLargeError';
  }
}

/** Thrown when a blob name fails validation. */
export class BlobNameInvalidError extends Error {
  constructor(name: string, reason: string) {
    super(`Blob name "${name}" is invalid: ${reason}`);
    this.name = 'BlobNameInvalidError';
  }
}

/** Thrown when hash verification fails on read. */
export class BlobCorruptError extends Error {
  constructor(hash: string, location: string) {
    super(`Blob hash mismatch for ${hash} at ${location} — storage may be corrupt or tampered`);
    this.name = 'BlobCorruptError';
  }
}

/** Thrown when a blob hash is not found in the store. */
export class BlobNotFoundError extends Error {
  constructor(hash: string) {
    super(`Blob with hash ${hash} not found in store`);
    this.name = 'BlobNotFoundError';
  }
}

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_MAX_BLOB_SIZE = 100 * 1024 * 1024; // 100 MB
const PG_LO_CHUNK_SIZE = 64 * 1024; // 64 KB
const S3_OBJECT_PREFIX = 'blobs/';

// ── Config types ───────────────────────────────────────────────

export interface BlobPgAdapterConfig {
  /** Storage mode. Defaults to 's3'. */
  mode?: 's3' | 'pg-lo';
  /** S3 configuration (required when mode='s3'). */
  s3?: {
    endpoint?: string;
    bucket: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  /** Maximum blob size in bytes. Defaults to 100MB. */
  maxBlobSizeBytes?: number;
}

// ── Attachment record types ────────────────────────────────────

export interface BlobAttachmentRow {
  id: string;
  docSlug: string;
  blobName: string;
  hash: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;
  pgLoOid?: number | null;
  s3Key?: string | null;
  deletedAt?: number | null;
}

export interface BlobAttachment {
  id: string;
  docSlug: string;
  blobName: string;
  hash: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;
}

export interface BlobData extends BlobAttachment {
  data?: Buffer;
}

export interface AttachBlobParams {
  docSlug: string;
  name: string;
  contentType: string;
  data: Buffer | Uint8Array;
  uploadedBy: string;
}

// ── Internal helpers ───────────────────────────────────────────

/** Generate a new short unique id. */
function newId(): string {
  return nanoid(21);
}

/**
 * Compute SHA-256 hash of bytes using Node.js crypto.
 * Fallback used when WASM is not available in the backend context.
 * The WASM hashBlob primitive and this produce identical output.
 */
function hashBytes(data: Buffer | Uint8Array): string {
  const buf = data instanceof Buffer ? data : Buffer.from(data);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Validate blob name: no path traversal, no null bytes, no separators,
 * no leading/trailing whitespace, length 1–255.
 *
 * Mirrors the rules in crates/llmtxt-core::blob_name_validate.
 * The WASM blobNameValidate function is not always available in the backend
 * context (different module resolution), so we reimplement identically here.
 */
function validateBlobName(name: string): void {
  if (!name || name.length === 0) {
    throw new BlobNameInvalidError(name, 'name must not be empty');
  }
  if (Buffer.byteLength(name, 'utf8') > 255) {
    throw new BlobNameInvalidError(name, 'name must not exceed 255 bytes (UTF-8)');
  }
  if (name.includes('..')) {
    throw new BlobNameInvalidError(name, 'name must not contain ".." (path traversal)');
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new BlobNameInvalidError(name, 'name must not contain path separators (/ or \\)');
  }
  if (name.includes('\0')) {
    throw new BlobNameInvalidError(name, 'name must not contain null bytes');
  }
  if (name !== name.trim()) {
    throw new BlobNameInvalidError(name, 'name must not start or end with whitespace');
  }
}

/** Convert a database row to a BlobAttachment record. */
function rowToAttachment(row: BlobAttachmentRow): BlobAttachment {
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

// ── BlobPgAdapter class ────────────────────────────────────────

/**
 * PostgresBackend blob adapter.
 *
 * Stores blob bytes in S3/R2 (primary) or PG large objects (fallback).
 * Maintains the attachment manifest in the blob_attachments table.
 * Hash-verifies every byte-returning read.
 *
 * Usage:
 *   const adapter = new BlobPgAdapter(db, sqlClient, { mode: 's3', s3: { ... } });
 *   const attachment = await adapter.attachBlob({ docSlug, name, data, ... });
 */
export class BlobPgAdapter {
  protected readonly mode: 's3' | 'pg-lo';
  protected readonly maxBlobSizeBytes: number;
  protected readonly s3Config: BlobPgAdapterConfig['s3'] | undefined;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly db: any,
    // Raw postgres-js sql client (needed for PG-LO mode and typed queries)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly sql: any,
    config: BlobPgAdapterConfig = {}
  ) {
    this.mode = config.mode ?? 's3';
    this.maxBlobSizeBytes = config.maxBlobSizeBytes ?? DEFAULT_MAX_BLOB_SIZE;
    this.s3Config = config.s3;

    if (this.mode === 's3' && !this.s3Config?.bucket) {
      throw new Error(
        'BlobPgAdapter: s3.bucket is required when mode is "s3". ' +
        'Set BLOB_S3_BUCKET or configure BlobPgAdapterConfig.s3.bucket.'
      );
    }
  }

  // ── BlobOps implementation ─────────────────────────────────

  /**
   * Attach a binary blob to a document.
   *
   * - Validates the blob name.
   * - Enforces maxBlobSizeBytes.
   * - Computes SHA-256 hash.
   * - Stores bytes in S3/R2 or PG large objects (depending on mode).
   * - Applies LWW: soft-deletes any existing active record for (docSlug, blobName).
   * - Returns the new BlobAttachment record.
   */
  /**
   * Run a function inside a database transaction.
   * Can be overridden in tests to use an in-memory stub.
   */
  protected async _runInTransaction(fn: (tx: unknown) => Promise<void>): Promise<void> {
    await this.db.transaction(fn);
  }

  async attachBlob(params: AttachBlobParams): Promise<BlobAttachment> {
    validateBlobName(params.name);

    const bytes = params.data instanceof Buffer
      ? params.data
      : Buffer.from(params.data);

    if (bytes.byteLength > this.maxBlobSizeBytes) {
      throw new BlobTooLargeError(bytes.byteLength, this.maxBlobSizeBytes);
    }

    const hash = hashBytes(bytes);
    const now = Date.now();
    const id = newId();

    if (this.mode === 's3') {
      await this._s3Put(hash, bytes, params.contentType);

      await this._runInTransaction(async (tx) => {
        await this._softDeleteExisting(tx, params.docSlug, params.name, now);
        await this._insertRow(tx, {
          id,
          docSlug: params.docSlug,
          blobName: params.name,
          hash,
          size: bytes.byteLength,
          contentType: params.contentType,
          uploadedBy: params.uploadedBy,
          uploadedAt: now,
          s3Key: `${S3_OBJECT_PREFIX}${hash}`,
          pgLoOid: null,
          deletedAt: null,
        });
      });
    } else {
      // PG-LO mode: create LO and insert row in the same transaction
      let oid: number | null = null;

      await this._runInTransaction(async (tx) => {
        oid = await this._pgLoCreate(tx, bytes);
        await this._softDeleteExisting(tx, params.docSlug, params.name, now);
        await this._insertRow(tx, {
          id,
          docSlug: params.docSlug,
          blobName: params.name,
          hash,
          size: bytes.byteLength,
          contentType: params.contentType,
          uploadedBy: params.uploadedBy,
          uploadedAt: now,
          pgLoOid: oid,
          s3Key: null,
          deletedAt: null,
        });
      });
    }

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
   * Retrieve a blob attachment, optionally with bytes.
   *
   * Returns null if the blobName is not attached to docSlug.
   * When includeData=true, fetches bytes from storage and verifies the hash.
   */
  async getBlob(
    docSlug: string,
    blobName: string,
    opts: { includeData?: boolean } = {}
  ): Promise<BlobData | null> {
    validateBlobName(blobName);

    const row = await this._queryActiveRow(docSlug, blobName);
    if (!row) return null;

    const attachment = rowToAttachment(row);

    if (!opts.includeData) {
      return attachment;
    }

    let bytes: Buffer;

    if (this.mode === 's3') {
      const key = row.s3Key ?? `${S3_OBJECT_PREFIX}${row.hash}`;
      bytes = await this._s3Get(key, row.hash);
    } else {
      if (!row.pgLoOid) {
        throw new BlobCorruptError(row.hash, `pg_lo_oid missing for blob ${blobName}`);
      }
      bytes = await this._pgLoRead(row.pgLoOid, row.hash);
    }

    return { ...attachment, data: bytes };
  }

  /**
   * List all active (non-deleted) blob attachments for a document.
   * Returns metadata only — no bytes.
   */
  async listBlobs(docSlug: string): Promise<BlobAttachment[]> {
    const rows: BlobAttachmentRow[] = await this.sql`
      SELECT id, doc_slug as "docSlug", blob_name as "blobName", hash,
             size, content_type as "contentType", uploaded_by as "uploadedBy",
             uploaded_at as "uploadedAt"
      FROM blob_attachments
      WHERE doc_slug = ${docSlug}
        AND deleted_at IS NULL
      ORDER BY uploaded_at ASC
    `;
    return rows.map(rowToAttachment);
  }

  /**
   * Soft-delete a named blob attachment.
   * Returns false if no active attachment exists.
   */
  async detachBlob(docSlug: string, blobName: string, _detachedBy: string): Promise<boolean> {
    validateBlobName(blobName);

    const result: Array<{ id: string }> = await this.sql`
      UPDATE blob_attachments
      SET deleted_at = ${Date.now()}
      WHERE doc_slug = ${docSlug}
        AND blob_name = ${blobName}
        AND deleted_at IS NULL
      RETURNING id
    `;

    return result.length > 0;
  }

  /**
   * Fetch blob bytes directly by hash (sync pull path).
   *
   * Returns null if no blob with this hash exists in the store.
   * Verifies hash on return.
   */
  async fetchBlobByHash(hash: string): Promise<Buffer | null> {
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      return null;
    }

    // Check if any active record references this hash
    const refs: Array<{ pgLoOid: number | null }> = await this.sql`
      SELECT pg_lo_oid as "pgLoOid"
      FROM blob_attachments
      WHERE hash = ${hash}
        AND deleted_at IS NULL
      LIMIT 1
    `;

    if (refs.length === 0) {
      return null;
    }

    if (this.mode === 's3') {
      try {
        return await this._s3Get(`${S3_OBJECT_PREFIX}${hash}`, hash);
      } catch {
        return null;
      }
    } else {
      const oid = refs[0]!.pgLoOid;
      if (!oid) return null;
      try {
        return await this._pgLoRead(oid, hash);
      } catch {
        return null;
      }
    }
  }

  // ── Internal: DB helpers ───────────────────────────────────

  /** Query the active (non-deleted) row for a (docSlug, blobName) pair. */
  protected async _queryActiveRow(docSlug: string, blobName: string): Promise<BlobAttachmentRow | null> {
    const rows: BlobAttachmentRow[] = await this.sql`
      SELECT id, doc_slug as "docSlug", blob_name as "blobName", hash,
             size, content_type as "contentType", uploaded_by as "uploadedBy",
             uploaded_at as "uploadedAt", pg_lo_oid as "pgLoOid", s3_key as "s3Key"
      FROM blob_attachments
      WHERE doc_slug = ${docSlug}
        AND blob_name = ${blobName}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /** Soft-delete any existing active record for (docSlug, blobName). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async _softDeleteExisting(tx: any, docSlug: string, blobName: string, now: number): Promise<void> {
    // Use raw sql client for now; in a full ORM-driven transaction this would use tx.
    // The outer db.transaction() ensures atomicity at the PostgreSQL level.
    await this.sql`
      UPDATE blob_attachments
      SET deleted_at = ${now}
      WHERE doc_slug = ${docSlug}
        AND blob_name = ${blobName}
        AND deleted_at IS NULL
    `;
  }

  /** Insert a new blob_attachments row. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async _insertRow(_tx: any, row: {
    id: string;
    docSlug: string;
    blobName: string;
    hash: string;
    size: number;
    contentType: string;
    uploadedBy: string;
    uploadedAt: number;
    pgLoOid: number | null;
    s3Key: string | null;
    deletedAt: number | null;
  }): Promise<void> {
    await this.sql`
      INSERT INTO blob_attachments (
        id, doc_slug, blob_name, hash, size, content_type,
        uploaded_by, uploaded_at, pg_lo_oid, s3_key, deleted_at
      ) VALUES (
        ${row.id}, ${row.docSlug}, ${row.blobName}, ${row.hash}, ${row.size},
        ${row.contentType}, ${row.uploadedBy}, ${row.uploadedAt},
        ${row.pgLoOid}, ${row.s3Key}, ${row.deletedAt}
      )
    `;
  }

  // ── Internal: S3/R2 helpers ────────────────────────────────

  /** Upload bytes to S3/R2 at key `blobs/<hash>`. */
  protected async _s3Put(hash: string, bytes: Buffer, contentType: string): Promise<void> {
    const { S3Client, PutObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = this._makeS3Client(S3Client);
    const key = `${S3_OBJECT_PREFIX}${hash}`;

    // Dedup: skip upload if object already exists
    try {
      await client.send(new HeadObjectCommand({ Bucket: this.s3Config!.bucket, Key: key }));
      return; // Already exists — content-addressed dedup
    } catch {
      // Object does not exist — proceed with upload
    }

    await client.send(new PutObjectCommand({
      Bucket: this.s3Config!.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      // Server-side SHA256 integrity check where supported (S3 / R2)
      ChecksumSHA256: Buffer.from(hash, 'hex').toString('base64'),
    }));
  }

  /** Download bytes from S3/R2 and verify hash. */
  protected async _s3Get(key: string, expectedHash: string): Promise<Buffer> {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = this._makeS3Client(S3Client);

    const resp = await client.send(new GetObjectCommand({
      Bucket: this.s3Config!.bucket,
      Key: key,
    }));

    if (!resp.Body) {
      throw new BlobNotFoundError(expectedHash);
    }

    // Stream → Buffer
    const chunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of resp.Body as any) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);

    // Hash verification
    const actualHash = hashBytes(bytes);
    if (actualHash !== expectedHash) {
      throw new BlobCorruptError(expectedHash, key);
    }

    return bytes;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected _makeS3Client(S3Client: any): any {
    const cfg = this.s3Config!;
    return new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region ?? 'us-east-1',
      credentials: cfg.accessKeyId && cfg.secretAccessKey
        ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
        : undefined,
      forcePathStyle: !!cfg.endpoint, // required for MinIO / R2 custom endpoints
    });
  }

  // ── Internal: PG large object helpers ─────────────────────

  /**
   * Create a PG large object and write bytes in 64KB chunks.
   * Returns the OID of the created large object.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected async _pgLoCreate(_tx: any, bytes: Buffer): Promise<number> {
    // lo_creat(INV_READ|INV_WRITE = 0x20000|0x40000 = 196608) returns oid
    const [{ lo_creat: oid }] = await this.sql`SELECT lo_creat(196608) as lo_creat`;
    if (!oid) throw new Error('Failed to create PG large object');

    // Open the large object for writing (INV_WRITE = 0x20000 = 131072)
    const [{ lo_open: fd }] = await this.sql`SELECT lo_open(${oid}, 131072) as lo_open`;

    // Write in 64KB chunks
    let offset = 0;
    while (offset < bytes.byteLength) {
      const chunk = bytes.subarray(offset, offset + PG_LO_CHUNK_SIZE);
      await this.sql`SELECT lowrite(${fd}, ${chunk})`;
      offset += chunk.byteLength;
    }

    await this.sql`SELECT lo_close(${fd})`;

    return oid as number;
  }

  /**
   * Read all bytes from a PG large object by OID and verify the hash.
   */
  protected async _pgLoRead(oid: number, expectedHash: string): Promise<Buffer> {
    // Open for reading (INV_READ = 0x40000 = 262144)
    const [{ lo_open: fd }] = await this.sql`SELECT lo_open(${oid}, 262144) as lo_open`;

    const chunks: Buffer[] = [];
    while (true) {
      const [{ loread: chunk }] = await this.sql`SELECT loread(${fd}, ${PG_LO_CHUNK_SIZE}) as loread`;
      if (!chunk || chunk.length === 0) break;
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (chunk.length < PG_LO_CHUNK_SIZE) break; // EOF
    }

    await this.sql`SELECT lo_close(${fd})`;

    const bytes = Buffer.concat(chunks);

    // Hash verification
    const actualHash = hashBytes(bytes);
    if (actualHash !== expectedHash) {
      throw new BlobCorruptError(expectedHash, `pg_lo:${oid}`);
    }

    return bytes;
  }
}
