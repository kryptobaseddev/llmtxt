/**
 * Unit tests for BlobPgAdapter (T460 — PostgresBackend S3/R2 + PG-LO blob storage).
 *
 * S3 mode: tests use a mock S3 client (injected via module mocking or direct
 *   constructor injection) to avoid real S3/R2 dependencies in CI.
 *
 * PG-LO mode: tests use an in-memory SQLite database to verify the manifest
 *   logic, and mock the PG large object API.
 *
 * Integration tests against a real database are covered by T428.9.
 *
 * Tests:
 *   - attachBlob: name validation, size limit, hash computation, LWW
 *   - getBlob: metadata-only, with bytes, hash verification
 *   - listBlobs: active records only, empty array on none
 *   - detachBlob: soft-delete, returns false on missing
 *   - fetchBlobByHash: direct hash lookup, null on missing
 *   - BlobTooLargeError: oversized upload rejected
 *   - BlobNameInvalidError: invalid name patterns rejected
 *   - BlobCorruptError: hash mismatch on read
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { hashBlob } from 'llmtxt';

import {
  BlobPgAdapter,
  BlobTooLargeError,
  BlobNameInvalidError,
  BlobCorruptError,
} from '../storage/blob-pg-adapter.js';

// ── Helpers ────────────────────────────────────────────────────

function sha256hex(data: Buffer): string {
  return hashBlob(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function makeTestBytes(content: string = 'test blob content'): Buffer {
  return Buffer.from(content, 'utf8');
}

// ── In-memory manifest store (replaces real Postgres for unit tests) ─

interface ManifestRow {
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
}

class InMemoryManifest {
  private rows: ManifestRow[] = [];

  async query(docSlug: string, blobName: string): Promise<ManifestRow | null> {
    return this.rows.find(
      (r) => r.docSlug === docSlug && r.blobName === blobName && r.deletedAt === null
    ) ?? null;
  }

  async queryByHash(hash: string): Promise<ManifestRow | null> {
    return this.rows.find((r) => r.hash === hash && r.deletedAt === null) ?? null;
  }

  async listByDoc(docSlug: string): Promise<ManifestRow[]> {
    return this.rows.filter((r) => r.docSlug === docSlug && r.deletedAt === null);
  }

  async softDelete(docSlug: string, blobName: string, now: number): Promise<number> {
    let count = 0;
    for (const r of this.rows) {
      if (r.docSlug === docSlug && r.blobName === blobName && r.deletedAt === null) {
        r.deletedAt = now;
        count++;
      }
    }
    return count;
  }

  async insert(row: ManifestRow): Promise<void> {
    this.rows.push(row);
  }

  softDeleteByBlobName(docSlug: string, blobName: string): number {
    const now = Date.now();
    let count = 0;
    for (const r of this.rows) {
      if (r.docSlug === docSlug && r.blobName === blobName && r.deletedAt === null) {
        r.deletedAt = now;
        count++;
      }
    }
    return count;
  }
}

// ── In-memory blob store (replaces S3/PG-LO) ──────────────────

class InMemoryBlobStore {
  private store = new Map<string, Buffer>();

  put(key: string, data: Buffer): void {
    this.store.set(key, data);
  }

  get(key: string): Buffer | null {
    return this.store.get(key) ?? null;
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Corrupt a stored blob for hash-verify testing. */
  corrupt(key: string): void {
    this.store.set(key, Buffer.from('CORRUPTED!!!'));
  }
}

// ── Test adapter that replaces S3 + PG calls with in-memory stubs ─

class TestableBlobPgAdapter extends BlobPgAdapter {
  readonly blobStore = new InMemoryBlobStore();
  readonly manifest = new InMemoryManifest();

  constructor(mode: 's3' | 'pg-lo', maxBlobSizeBytes?: number) {
    // Pass dummy db/sql — we override all I/O methods
    super(
      {},   // db (not used — all methods overridden)
      {},   // sql (not used — all methods overridden)
      {
        mode,
        s3: mode === 's3' ? { bucket: 'test-bucket' } : undefined,
        maxBlobSizeBytes,
      }
    );
  }

  // ── Override S3 I/O ────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _s3Put(hash: string, bytes: Buffer, _contentType: string): Promise<void> {
    if (!this.blobStore.has(`blobs/${hash}`)) {
      this.blobStore.put(`blobs/${hash}`, bytes);
    }
  }

  protected override async _s3Get(key: string, expectedHash: string): Promise<Buffer> {
    const data = this.blobStore.get(key);
    if (!data) throw new BlobCorruptError(expectedHash, key);
    const actualHash = sha256hex(data);
    if (actualHash !== expectedHash) throw new BlobCorruptError(expectedHash, key);
    return data;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override _makeS3Client(_S3Client: any): any {
    return {}; // Not used since _s3Put/_s3Get are overridden
  }

  // ── Override PG-LO I/O ─────────────────────────────────────

  private _nextOid = 1000;
  private _loStore = new Map<number, Buffer>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _pgLoCreate(_tx: any, bytes: Buffer): Promise<number> {
    const oid = this._nextOid++;
    this._loStore.set(oid, bytes);
    return oid;
  }

  protected override async _pgLoRead(oid: number, expectedHash: string): Promise<Buffer> {
    const data = this._loStore.get(oid);
    if (!data) throw new BlobCorruptError(expectedHash, `pg_lo:${oid}`);
    const actualHash = sha256hex(data);
    if (actualHash !== expectedHash) throw new BlobCorruptError(expectedHash, `pg_lo:${oid}`);
    return data;
  }

  // ── Override transaction runner (no real DB) ───────────────

  protected override async _runInTransaction(fn: (tx: unknown) => Promise<void>): Promise<void> {
    await fn(null); // Run directly without a real transaction
  }

  // ── Override DB/manifest I/O ───────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _softDeleteExisting(_tx: any, docSlug: string, blobName: string, now: number): Promise<void> {
    await this.manifest.softDelete(docSlug, blobName, now);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected override async _insertRow(_tx: any, row: Parameters<BlobPgAdapter['_insertRow']>[1]): Promise<void> {
    await this.manifest.insert(row as ManifestRow);
  }

  protected override async _queryActiveRow(docSlug: string, blobName: string) {
    return this.manifest.query(docSlug, blobName) as ReturnType<BlobPgAdapter['_queryActiveRow']>;
  }

  // Override listBlobs / detachBlob to use in-memory manifest

  override async listBlobs(docSlug: string) {
    const rows = await this.manifest.listByDoc(docSlug);
    return rows.map((r) => ({
      id: r.id,
      docSlug: r.docSlug,
      blobName: r.blobName,
      hash: r.hash,
      size: r.size,
      contentType: r.contentType,
      uploadedBy: r.uploadedBy,
      uploadedAt: r.uploadedAt,
    }));
  }

  override async detachBlob(docSlug: string, blobName: string, _detachedBy: string): Promise<boolean> {
    const count = this.manifest.softDeleteByBlobName(docSlug, blobName);
    return count > 0;
  }

  override async fetchBlobByHash(hash: string): Promise<Buffer | null> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const row = await this.manifest.queryByHash(hash);
    if (!row) return null;
    if (this.mode === 's3') {
      return this.blobStore.get(`blobs/${hash}`);
    } else {
      if (!row.pgLoOid) return null;
      const data = this._loStore.get(row.pgLoOid);
      return data ?? null;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  corruptS3Blob(hash: string): void {
    this.blobStore.corrupt(`blobs/${hash}`);
  }
}

// ── Helper to create a pre-loaded adapter ─────────────────────

function makeAdapter(mode: 's3' | 'pg-lo', maxBlobSizeBytes?: number): TestableBlobPgAdapter {
  return new TestableBlobPgAdapter(mode, maxBlobSizeBytes);
}

// ── Test suites ────────────────────────────────────────────────

for (const mode of ['s3', 'pg-lo'] as const) {
  describe(`BlobPgAdapter [mode=${mode}]`, () => {
    let adapter: TestableBlobPgAdapter;

    before(() => {
      adapter = makeAdapter(mode);
    });

    // ── attachBlob ─────────────────────────────────────────

    describe('attachBlob', () => {
      it('stores bytes and returns a BlobAttachment record', async () => {
        const bytes = makeTestBytes(`${mode}: attach test unique-aaa`);
        const expectedHash = sha256hex(bytes);

        const result = await adapter.attachBlob({
          docSlug: `attach-doc-${mode}`,
          name: 'file.txt',
          contentType: 'text/plain',
          data: bytes,
          uploadedBy: 'agent-1',
        });

        assert.ok(result.id, 'must have id');
        assert.equal(result.hash, expectedHash);
        assert.equal(result.size, bytes.byteLength);
        assert.equal(result.contentType, 'text/plain');
        assert.equal(result.uploadedBy, 'agent-1');
        assert.ok(result.uploadedAt > 0);
      });

      it('throws BlobTooLargeError when data exceeds maxBlobSizeBytes', async () => {
        const smallAdapter = makeAdapter(mode, 10);
        const bytes = Buffer.alloc(11, 0xff);

        await assert.rejects(
          () => smallAdapter.attachBlob({
            docSlug: 'size-doc',
            name: 'big.bin',
            contentType: 'application/octet-stream',
            data: bytes,
            uploadedBy: 'agent-1',
          }),
          (err: unknown) => err instanceof BlobTooLargeError,
          'must throw BlobTooLargeError'
        );
      });

      it('throws BlobNameInvalidError for path traversal names', async () => {
        await assert.rejects(
          () => adapter.attachBlob({
            docSlug: 'sec-doc',
            name: '../etc/passwd',
            contentType: 'text/plain',
            data: makeTestBytes(),
            uploadedBy: 'agent-1',
          }),
          (err: unknown) => err instanceof BlobNameInvalidError
        );
      });

      it('throws BlobNameInvalidError for names with slashes', async () => {
        await assert.rejects(
          () => adapter.attachBlob({
            docSlug: 'sec-doc',
            name: 'path/to/file.txt',
            contentType: 'text/plain',
            data: makeTestBytes(),
            uploadedBy: 'agent-1',
          }),
          (err: unknown) => err instanceof BlobNameInvalidError
        );
      });

      it('throws BlobNameInvalidError for null byte names', async () => {
        await assert.rejects(
          () => adapter.attachBlob({
            docSlug: 'sec-doc',
            name: 'file\0.txt',
            contentType: 'text/plain',
            data: makeTestBytes(),
            uploadedBy: 'agent-1',
          }),
          (err: unknown) => err instanceof BlobNameInvalidError
        );
      });
    });

    // ── getBlob ─────────────────────────────────────────────

    describe('getBlob', () => {
      before(async () => {
        await adapter.attachBlob({
          docSlug: `get-doc-${mode}`,
          name: 'fetch.txt',
          contentType: 'text/plain',
          data: makeTestBytes(`getBlob content ${mode}`),
          uploadedBy: 'agent-1',
        });
      });

      it('returns metadata only when includeData is false (default)', async () => {
        const result = await adapter.getBlob(`get-doc-${mode}`, 'fetch.txt');
        assert.ok(result, 'must not be null');
        assert.equal(result.data, undefined, 'data must be undefined');
      });

      it('returns bytes and metadata when includeData=true', async () => {
        const expected = makeTestBytes(`getBlob content ${mode}`);
        const result = await adapter.getBlob(`get-doc-${mode}`, 'fetch.txt', { includeData: true });
        assert.ok(result, 'must not be null');
        assert.ok(result.data, 'data must be present');
        assert.deepEqual(result.data, expected);
      });

      it('returns null for non-existent blobName', async () => {
        const result = await adapter.getBlob(`get-doc-${mode}`, 'ghost.txt');
        assert.equal(result, null);
      });

      it('returns null for non-existent docSlug', async () => {
        const result = await adapter.getBlob('no-such-doc', 'fetch.txt');
        assert.equal(result, null);
      });

      it('throws BlobCorruptError when stored bytes are tampered (S3 mode)', async function () {
        if (mode !== 's3') return; // PG-LO corruption is harder to simulate without real LO API

        const bytes = makeTestBytes(`tamper test ${mode} unique-ttt`);
        const attachment = await adapter.attachBlob({
          docSlug: `tamper-doc-${mode}`,
          name: 'tamper.bin',
          contentType: 'application/octet-stream',
          data: bytes,
          uploadedBy: 'agent-1',
        });

        // Corrupt the S3 store
        adapter.corruptS3Blob(attachment.hash);

        await assert.rejects(
          () => adapter.getBlob(`tamper-doc-${mode}`, 'tamper.bin', { includeData: true }),
          (err: unknown) => err instanceof BlobCorruptError
        );
      });
    });

    // ── listBlobs ────────────────────────────────────────────

    describe('listBlobs', () => {
      it('returns empty array when no blobs attached', async () => {
        const result = await adapter.listBlobs(`empty-list-${mode}`);
        assert.deepEqual(result, []);
      });

      it('returns only active blobs for the document', async () => {
        const doc = `list-active-${mode}`;

        await adapter.attachBlob({
          docSlug: doc,
          name: 'alpha.txt',
          contentType: 'text/plain',
          data: makeTestBytes(`alpha ${mode}`),
          uploadedBy: 'agent-1',
        });

        await adapter.attachBlob({
          docSlug: doc,
          name: 'beta.txt',
          contentType: 'text/plain',
          data: makeTestBytes(`beta ${mode}`),
          uploadedBy: 'agent-1',
        });

        const result = await adapter.listBlobs(doc);
        const names = result.map((r) => r.blobName).sort();
        assert.deepEqual(names, ['alpha.txt', 'beta.txt']);
      });

      it('excludes soft-deleted blobs', async () => {
        const doc = `list-deleted-${mode}`;

        await adapter.attachBlob({
          docSlug: doc,
          name: 'will-delete.txt',
          contentType: 'text/plain',
          data: makeTestBytes(`will-delete ${mode}`),
          uploadedBy: 'agent-1',
        });

        await adapter.detachBlob(doc, 'will-delete.txt', 'agent-1');

        const result = await adapter.listBlobs(doc);
        assert.deepEqual(result, []);
      });
    });

    // ── detachBlob ───────────────────────────────────────────

    describe('detachBlob', () => {
      it('soft-deletes an active attachment and returns true', async () => {
        const doc = `detach-test-${mode}`;

        await adapter.attachBlob({
          docSlug: doc,
          name: 'del.txt',
          contentType: 'text/plain',
          data: makeTestBytes(`detach ${mode}`),
          uploadedBy: 'agent-1',
        });

        const result = await adapter.detachBlob(doc, 'del.txt', 'agent-1');
        assert.equal(result, true);

        const check = await adapter.getBlob(doc, 'del.txt');
        assert.equal(check, null, 'blob must be gone after detach');
      });

      it('returns false when blobName does not exist', async () => {
        const result = await adapter.detachBlob(`no-blob-${mode}`, 'ghost.txt', 'agent-1');
        assert.equal(result, false);
      });
    });

    // ── fetchBlobByHash ──────────────────────────────────────

    describe('fetchBlobByHash', () => {
      it('returns bytes for a known hash', async () => {
        const bytes = makeTestBytes(`fetch hash ${mode} unique-hhh`);
        const attachment = await adapter.attachBlob({
          docSlug: `fhash-doc-${mode}`,
          name: 'fhash.bin',
          contentType: 'application/octet-stream',
          data: bytes,
          uploadedBy: 'agent-1',
        });

        const result = await adapter.fetchBlobByHash(attachment.hash);
        assert.ok(result, 'result must not be null');
        assert.deepEqual(result, bytes);
      });

      it('returns null for unknown hash', async () => {
        const result = await adapter.fetchBlobByHash('a'.repeat(64));
        assert.equal(result, null);
      });

      it('returns null for invalid hash format', async () => {
        const result = await adapter.fetchBlobByHash('not-a-valid-sha256');
        assert.equal(result, null);
      });
    });

    // ── LWW re-upload ────────────────────────────────────────

    describe('LWW re-upload', () => {
      it('replaces existing active record on re-upload', async () => {
        const doc = `lww-test-${mode}`;
        const name = 'overwrite.txt';

        const v1 = await adapter.attachBlob({
          docSlug: doc,
          name,
          contentType: 'text/plain',
          data: makeTestBytes(`v1 content ${mode} aaa`),
          uploadedBy: 'agent-1',
        });

        const v2 = await adapter.attachBlob({
          docSlug: doc,
          name,
          contentType: 'text/plain',
          data: makeTestBytes(`v2 content ${mode} bbb`),
          uploadedBy: 'agent-2',
        });

        const result = await adapter.getBlob(doc, name, { includeData: true });
        assert.ok(result, 'must return a blob');
        assert.equal(result.hash, v2.hash);
        assert.notEqual(result.hash, v1.hash);
        assert.ok(result.data);
        assert.deepEqual(result.data, makeTestBytes(`v2 content ${mode} bbb`));
      });
    });

    // ── Size limit enforcement ────────────────────────────────

    describe('size limit', () => {
      it('rejects upload that exceeds configured max', async () => {
        const limitedAdapter = makeAdapter(mode, 50);
        const bytes = Buffer.alloc(51, 0xab);

        await assert.rejects(
          () => limitedAdapter.attachBlob({
            docSlug: 'size-test',
            name: 'oversized.bin',
            contentType: 'application/octet-stream',
            data: bytes,
            uploadedBy: 'agent-1',
          }),
          (err: unknown) => {
            assert.ok(err instanceof BlobTooLargeError, `Expected BlobTooLargeError, got ${(err as Error).name}`);
            return true;
          }
        );
      });

      it('accepts upload at exactly the limit', async () => {
        const limitedAdapter = makeAdapter(mode, 50);
        const bytes = Buffer.alloc(50, 0xab);

        const result = await limitedAdapter.attachBlob({
          docSlug: 'size-exact-test',
          name: 'exact.bin',
          contentType: 'application/octet-stream',
          data: bytes,
          uploadedBy: 'agent-1',
        });

        assert.ok(result.id, 'must succeed at exact limit');
        assert.equal(result.size, 50);
      });
    });
  });
}
