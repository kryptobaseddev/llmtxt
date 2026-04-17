/**
 * Unit tests for BlobFsAdapter (T459 — LocalBackend filesystem blob storage).
 *
 * Tests:
 *   - attachBlob: happy path, atomic write, content-addressed dedup
 *   - getBlob: metadata-only and with bytes, hash verification
 *   - listBlobs: active records only
 *   - detachBlob: soft-delete, returns false on missing
 *   - fetchBlobByHash: direct hash lookup, null on missing
 *   - LWW re-upload: replace existing active record
 *   - Hash verification: BlobCorruptError on tampered file
 *   - Size limit: BlobTooLargeError on oversized upload
 *   - Name validation: BlobNameInvalidError on invalid names
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';

import {
  BlobFsAdapter,
  BlobTooLargeError,
  BlobNameInvalidError,
  BlobCorruptError,
} from '../local/blob-fs-adapter.js';

// ── Helpers ────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_PATH = path.join(__dirname, '../local/migrations');

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-blob-test-'));
}

function sha256hex(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function makeTestBytes(content: string = 'hello blob world'): Buffer {
  return Buffer.from(content, 'utf8');
}

// ── Test suite ─────────────────────────────────────────────────

describe('BlobFsAdapter', () => {
  let tmpDir: string;
  let storagePath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  let rawDb: Database.Database;
  let adapter: BlobFsAdapter;

  before(() => {
    tmpDir = makeTempDir();
    storagePath = tmpDir;

    rawDb = new Database(path.join(tmpDir, 'test.db'));
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');

    db = drizzle({ client: rawDb });

    // Run migrations to create blob_attachments table
    try {
      migrate(db, { migrationsFolder: MIGRATIONS_PATH });
    } catch (err) {
      // cr-sqlite CRR migrations may fail if extension not loaded — that is fine.
      const msg = (err as Error).message ?? '';
      if (!msg.includes('crsql_as_crr') && !msg.includes('no such function')) {
        throw err;
      }
    }

    adapter = new BlobFsAdapter(db, storagePath);
  });

  after(() => {
    rawDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── attachBlob ─────────────────────────────────────────────

  describe('attachBlob', () => {
    it('writes bytes atomically and returns a BlobAttachment record', () => {
      const bytes = makeTestBytes('attach test content');
      const expectedHash = sha256hex(bytes);

      const result = adapter.attachBlob({
        docSlug: 'test-doc',
        name: 'file.txt',
        contentType: 'text/plain',
        data: bytes,
        uploadedBy: 'agent-1',
      });

      assert.ok(result.id, 'result must have an id');
      assert.equal(result.docSlug, 'test-doc');
      assert.equal(result.blobName, 'file.txt');
      assert.equal(result.hash, expectedHash);
      assert.equal(result.size, bytes.byteLength);
      assert.equal(result.contentType, 'text/plain');
      assert.equal(result.uploadedBy, 'agent-1');
      assert.ok(result.uploadedAt > 0, 'uploadedAt must be set');

      // Verify file exists on disk
      const blobPath = path.join(storagePath, 'blobs', expectedHash);
      assert.ok(fs.existsSync(blobPath), 'blob file must exist on disk');

      // Verify file content
      const diskBytes = fs.readFileSync(blobPath);
      assert.deepEqual(diskBytes, bytes);
    });

    it('deduplicates bytes by hash (same file not written twice)', () => {
      const bytes = makeTestBytes('dedup content same bytes');
      const expectedHash = sha256hex(bytes);

      adapter.attachBlob({
        docSlug: 'dedup-doc-1',
        name: 'file.bin',
        contentType: 'application/octet-stream',
        data: bytes,
        uploadedBy: 'agent-1',
      });

      // Corrupt the file to test that second attach uses the existing file
      const blobPath = path.join(storagePath, 'blobs', expectedHash);
      const mtimeBefore = fs.statSync(blobPath).mtimeMs;

      adapter.attachBlob({
        docSlug: 'dedup-doc-2',
        name: 'file.bin',
        contentType: 'application/octet-stream',
        data: bytes,
        uploadedBy: 'agent-2',
      });

      // File should not have been rewritten
      const mtimeAfter = fs.statSync(blobPath).mtimeMs;
      assert.equal(mtimeBefore, mtimeAfter, 'existing blob file must not be rewritten (content dedup)');
    });

    it('throws BlobTooLargeError when data exceeds maxBlobSizeBytes', () => {
      const smallMaxAdapter = new BlobFsAdapter(db, storagePath, 10);
      const bytes = Buffer.alloc(11, 0x42);

      assert.throws(
        () => smallMaxAdapter.attachBlob({
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

    it('throws BlobNameInvalidError for names with path traversal', () => {
      const bytes = makeTestBytes();
      assert.throws(
        () => adapter.attachBlob({
          docSlug: 'sec-doc',
          name: '../etc/passwd',
          contentType: 'text/plain',
          data: bytes,
          uploadedBy: 'agent-1',
        }),
        (err: unknown) => err instanceof BlobNameInvalidError,
        'must throw BlobNameInvalidError for path traversal'
      );
    });

    it('throws BlobNameInvalidError for names with slashes', () => {
      const bytes = makeTestBytes();
      assert.throws(
        () => adapter.attachBlob({
          docSlug: 'sec-doc',
          name: 'subdir/file.txt',
          contentType: 'text/plain',
          data: bytes,
          uploadedBy: 'agent-1',
        }),
        (err: unknown) => err instanceof BlobNameInvalidError,
        'must throw BlobNameInvalidError for slash in name'
      );
    });

    it('throws BlobNameInvalidError for names with null bytes', () => {
      const bytes = makeTestBytes();
      assert.throws(
        () => adapter.attachBlob({
          docSlug: 'sec-doc',
          name: 'file\0.txt',
          contentType: 'text/plain',
          data: bytes,
          uploadedBy: 'agent-1',
        }),
        (err: unknown) => err instanceof BlobNameInvalidError,
        'must throw BlobNameInvalidError for null byte in name'
      );
    });
  });

  // ── getBlob ────────────────────────────────────────────────

  describe('getBlob', () => {
    beforeEach(() => {
      // Attach a fresh blob for each test
      adapter.attachBlob({
        docSlug: 'get-doc',
        name: 'test-get.txt',
        contentType: 'text/plain',
        data: makeTestBytes('getBlob test content'),
        uploadedBy: 'agent-1',
      });
    });

    it('returns metadata only when includeData is false (default)', () => {
      const result = adapter.getBlob('get-doc', 'test-get.txt');
      assert.ok(result, 'result must not be null');
      assert.equal(result.blobName, 'test-get.txt');
      assert.equal(result.data, undefined, 'data must be undefined when includeData=false');
    });

    it('returns bytes and metadata when includeData=true', () => {
      const expected = makeTestBytes('getBlob test content');
      const result = adapter.getBlob('get-doc', 'test-get.txt', { includeData: true });
      assert.ok(result, 'result must not be null');
      assert.ok(result.data, 'data must be present');
      assert.deepEqual(result.data, expected);
    });

    it('returns null for non-existent blobName', () => {
      const result = adapter.getBlob('get-doc', 'does-not-exist.txt');
      assert.equal(result, null, 'must return null for missing blob');
    });

    it('returns null for non-existent docSlug', () => {
      const result = adapter.getBlob('no-such-doc', 'test-get.txt');
      assert.equal(result, null, 'must return null for missing doc');
    });

    it('throws BlobCorruptError when blob file is tampered', () => {
      const bytes = makeTestBytes('tamper test content unique-12345');
      const attachment = adapter.attachBlob({
        docSlug: 'tamper-doc',
        name: 'tamper.bin',
        contentType: 'application/octet-stream',
        data: bytes,
        uploadedBy: 'agent-1',
      });

      // Tamper with the stored file
      const blobPath = path.join(storagePath, 'blobs', attachment.hash);
      fs.writeFileSync(blobPath, Buffer.from('corrupted!'));

      assert.throws(
        () => adapter.getBlob('tamper-doc', 'tamper.bin', { includeData: true }),
        (err: unknown) => err instanceof BlobCorruptError,
        'must throw BlobCorruptError on hash mismatch'
      );
    });
  });

  // ── listBlobs ──────────────────────────────────────────────

  describe('listBlobs', () => {
    it('returns empty array when no blobs are attached', () => {
      const result = adapter.listBlobs('empty-list-doc');
      assert.deepEqual(result, [], 'must return empty array for doc with no blobs');
    });

    it('returns only active blobs for the document', () => {
      const doc = 'list-test-doc';

      adapter.attachBlob({
        docSlug: doc,
        name: 'a.txt',
        contentType: 'text/plain',
        data: makeTestBytes('a content'),
        uploadedBy: 'agent-1',
      });

      adapter.attachBlob({
        docSlug: doc,
        name: 'b.txt',
        contentType: 'text/plain',
        data: makeTestBytes('b content'),
        uploadedBy: 'agent-1',
      });

      const result = adapter.listBlobs(doc);
      const names = result.map((r) => r.blobName).sort();
      assert.deepEqual(names, ['a.txt', 'b.txt']);
    });

    it('does not include blobs from other documents', () => {
      adapter.attachBlob({
        docSlug: 'other-doc-x',
        name: 'secret.txt',
        contentType: 'text/plain',
        data: makeTestBytes('other doc blob'),
        uploadedBy: 'agent-1',
      });

      const result = adapter.listBlobs('list-test-doc-empty');
      assert.deepEqual(result, [], 'blobs from other docs must not appear');
    });

    it('does not include soft-deleted blobs', () => {
      const doc = 'list-soft-delete-doc';

      adapter.attachBlob({
        docSlug: doc,
        name: 'deleted.txt',
        contentType: 'text/plain',
        data: makeTestBytes('will be deleted'),
        uploadedBy: 'agent-1',
      });

      adapter.detachBlob(doc, 'deleted.txt', 'agent-1');

      const result = adapter.listBlobs(doc);
      assert.deepEqual(result, [], 'soft-deleted blobs must not appear in list');
    });
  });

  // ── detachBlob ─────────────────────────────────────────────

  describe('detachBlob', () => {
    it('soft-deletes an active attachment and returns true', () => {
      const doc = 'detach-doc';
      adapter.attachBlob({
        docSlug: doc,
        name: 'to-detach.txt',
        contentType: 'text/plain',
        data: makeTestBytes('detach me'),
        uploadedBy: 'agent-1',
      });

      const result = adapter.detachBlob(doc, 'to-detach.txt', 'agent-1');
      assert.equal(result, true, 'detachBlob must return true on success');

      // Verify soft-deleted: getBlob should return null
      const row = adapter.getBlob(doc, 'to-detach.txt');
      assert.equal(row, null, 'blob must be inaccessible after detach');
    });

    it('returns false when blobName is not attached', () => {
      const result = adapter.detachBlob('no-blob-doc', 'ghost.txt', 'agent-1');
      assert.equal(result, false, 'detachBlob must return false for missing blob');
    });

    it('does not delete blob bytes from disk (soft-delete only)', () => {
      const bytes = makeTestBytes('keep bytes on disk after detach 99999');
      const doc = 'keep-bytes-doc';
      const attachment = adapter.attachBlob({
        docSlug: doc,
        name: 'keep.bin',
        contentType: 'application/octet-stream',
        data: bytes,
        uploadedBy: 'agent-1',
      });

      adapter.detachBlob(doc, 'keep.bin', 'agent-1');

      const blobPath = path.join(storagePath, 'blobs', attachment.hash);
      assert.ok(fs.existsSync(blobPath), 'blob bytes must remain on disk after soft-delete');
    });
  });

  // ── fetchBlobByHash ────────────────────────────────────────

  describe('fetchBlobByHash', () => {
    it('returns bytes for a known hash', () => {
      const bytes = makeTestBytes('fetch by hash content unique-xyz');
      const attachment = adapter.attachBlob({
        docSlug: 'fetch-hash-doc',
        name: 'fetchable.bin',
        contentType: 'application/octet-stream',
        data: bytes,
        uploadedBy: 'agent-1',
      });

      const result = adapter.fetchBlobByHash(attachment.hash);
      assert.ok(result, 'result must not be null');
      assert.deepEqual(result, bytes);
    });

    it('returns null for an unknown hash', () => {
      const unknownHash = 'a'.repeat(64);
      const result = adapter.fetchBlobByHash(unknownHash);
      assert.equal(result, null, 'must return null for unknown hash');
    });

    it('returns null for an invalid hash format', () => {
      const result = adapter.fetchBlobByHash('not-a-hash');
      assert.equal(result, null, 'must return null for invalid hash format');
    });
  });

  // ── LWW re-upload ──────────────────────────────────────────

  describe('LWW re-upload', () => {
    it('replaces existing active record on re-upload with same name', () => {
      const doc = 'lww-doc';
      const name = 'overwrite.txt';

      const v1 = adapter.attachBlob({
        docSlug: doc,
        name,
        contentType: 'text/plain',
        data: makeTestBytes('version 1 content aaa'),
        uploadedBy: 'agent-1',
      });

      const v2 = adapter.attachBlob({
        docSlug: doc,
        name,
        contentType: 'text/plain',
        data: makeTestBytes('version 2 content bbb'),
        uploadedBy: 'agent-2',
      });

      // Only v2 should be active
      const result = adapter.getBlob(doc, name, { includeData: true });
      assert.ok(result, 'must return a blob');
      assert.equal(result.hash, v2.hash, 'active record must be v2');
      assert.notEqual(result.hash, v1.hash, 'v1 must no longer be active');
      assert.ok(result.data, 'data must be present');
      assert.deepEqual(result.data, makeTestBytes('version 2 content bbb'));
    });

    it('only one active record per (docSlug, blobName) after multiple uploads', () => {
      const doc = 'lww-count-doc';
      const name = 'one-at-a-time.bin';

      for (let i = 0; i < 5; i++) {
        adapter.attachBlob({
          docSlug: doc,
          name,
          contentType: 'application/octet-stream',
          data: makeTestBytes(`iteration ${i} content unique-iter-${i}`),
          uploadedBy: `agent-${i}`,
        });
      }

      const list = adapter.listBlobs(doc);
      const matching = list.filter((b) => b.blobName === name);
      assert.equal(matching.length, 1, 'exactly one active record must remain after 5 uploads');
    });
  });

  // ── Accepts Uint8Array input ───────────────────────────────

  describe('Uint8Array input', () => {
    it('accepts Uint8Array as data input', () => {
      const bytes = new TextEncoder().encode('uint8array input test');
      const uint8 = new Uint8Array(bytes);

      const result = adapter.attachBlob({
        docSlug: 'uint8-doc',
        name: 'typed.bin',
        contentType: 'application/octet-stream',
        data: uint8,
        uploadedBy: 'agent-1',
      });

      assert.ok(result.id, 'must return a valid attachment');
      assert.equal(result.size, uint8.byteLength);
    });
  });
});
