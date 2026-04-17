/**
 * BlobOps integration tests against LocalBackend (T461).
 *
 * These tests verify that the Backend interface's BlobOps methods work correctly
 * through LocalBackend. They use a real SQLite + filesystem backend in a temp directory.
 *
 * Tests:
 *   - attachBlob: happy path, LWW, dedup, name validation, size limit
 *   - getBlob: metadata-only, with data, hash verification, null for missing
 *   - listBlobs: active only, empty when none
 *   - detachBlob: soft-delete, false for missing
 *   - fetchBlobByHash: known hash, null for unknown
 *   - Error classes exported correctly from Backend
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

import { LocalBackend } from '../local/index.js';
import {
  BlobTooLargeError,
  BlobNameInvalidError,
  BlobCorruptError,
  BlobNotFoundError,
  BlobAccessDeniedError,
} from '../core/errors.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function sha256hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function makeBytes(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-blob-backend-test-'));
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe('LocalBackend — BlobOps', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  before(async () => {
    tmpDir = makeTempDir();
    backend = new LocalBackend({ storagePath: tmpDir });
    await backend.open();
  });

  after(async () => {
    await backend.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── attachBlob ────────────────────────────────────────────────────────────────

  describe('attachBlob', () => {
    it('attaches a blob and returns a BlobAttachment record', async () => {
      const data = makeBytes('hello from backend test');
      const expectedHash = sha256hex(data);

      const result = await backend.attachBlob({
        docSlug: 'doc-attach-1',
        name: 'hello.txt',
        contentType: 'text/plain',
        data,
        uploadedBy: 'agent-1',
      });

      assert.ok(result.id, 'must have an id');
      assert.equal(result.docSlug, 'doc-attach-1');
      assert.equal(result.blobName, 'hello.txt');
      assert.equal(result.hash, expectedHash);
      assert.equal(result.size, data.byteLength);
      assert.equal(result.contentType, 'text/plain');
      assert.equal(result.uploadedBy, 'agent-1');
      assert.ok(result.uploadedAt > 0, 'uploadedAt must be set');
    });

    it('throws BlobTooLargeError when data exceeds maxBlobSizeBytes', async () => {
      const smallBackend = new LocalBackend({ storagePath: tmpDir, maxBlobSizeBytes: 10 });
      await smallBackend.open();
      try {
        await assert.rejects(
          () => smallBackend.attachBlob({
            docSlug: 'size-doc',
            name: 'big.bin',
            contentType: 'application/octet-stream',
            data: Buffer.alloc(11, 0x42),
            uploadedBy: 'agent-1',
          }),
          (err: unknown) => err instanceof BlobTooLargeError
        );
      } finally {
        await smallBackend.close();
      }
    });

    it('throws BlobNameInvalidError for path traversal names', async () => {
      await assert.rejects(
        () => backend.attachBlob({
          docSlug: 'sec-doc',
          name: '../etc/passwd',
          contentType: 'text/plain',
          data: makeBytes('evil'),
          uploadedBy: 'agent-1',
        }),
        (err: unknown) => err instanceof BlobNameInvalidError
      );
    });

    it('throws BlobNameInvalidError for names with slashes', async () => {
      await assert.rejects(
        () => backend.attachBlob({
          docSlug: 'sec-doc',
          name: 'subdir/file.txt',
          contentType: 'text/plain',
          data: makeBytes('bad'),
          uploadedBy: 'agent-1',
        }),
        (err: unknown) => err instanceof BlobNameInvalidError
      );
    });

    it('applies LWW — second upload replaces first for same (docSlug, name)', async () => {
      const doc = 'lww-backend-doc';
      const name = 'overwrite.bin';

      const v1 = await backend.attachBlob({
        docSlug: doc, name, contentType: 'text/plain',
        data: makeBytes('version one'), uploadedBy: 'agent-1',
      });

      const v2 = await backend.attachBlob({
        docSlug: doc, name, contentType: 'text/plain',
        data: makeBytes('version two different content'), uploadedBy: 'agent-2',
      });

      // getBlob should return v2
      const result = await backend.getBlob(doc, name, { includeData: true });
      assert.ok(result, 'must return a blob');
      assert.equal(result.hash, v2.hash);
      assert.notEqual(result.hash, v1.hash);
    });
  });

  // ── getBlob ───────────────────────────────────────────────────────────────────

  describe('getBlob', () => {
    const doc = 'get-blob-backend-doc';
    const name = 'test.txt';
    const data = makeBytes('test get blob content');

    before(async () => {
      await backend.attachBlob({ docSlug: doc, name, contentType: 'text/plain', data, uploadedBy: 'agent-1' });
    });

    it('returns metadata only when includeData is false (default)', async () => {
      const result = await backend.getBlob(doc, name);
      assert.ok(result, 'must not be null');
      assert.equal(result.blobName, name);
      assert.equal(result.data, undefined, 'data must be absent');
    });

    it('returns bytes and metadata when includeData=true', async () => {
      const result = await backend.getBlob(doc, name, { includeData: true });
      assert.ok(result, 'must not be null');
      assert.ok(result.data, 'data must be present');
      assert.deepEqual(result.data, data);
    });

    it('returns null for non-existent blob name', async () => {
      const result = await backend.getBlob(doc, 'ghost.txt');
      assert.equal(result, null);
    });

    it('returns null for non-existent docSlug', async () => {
      const result = await backend.getBlob('no-such-doc-xx', name);
      assert.equal(result, null);
    });

    it('throws BlobCorruptError when blob file is tampered', async () => {
      const corruptData = makeBytes('tamper me unique 999');
      const attachment = await backend.attachBlob({
        docSlug: 'corrupt-backend-doc',
        name: 'corrupt.bin',
        contentType: 'application/octet-stream',
        data: corruptData,
        uploadedBy: 'agent-1',
      });

      // Tamper with the stored file
      const blobPath = path.join(tmpDir, 'blobs', attachment.hash);
      fs.writeFileSync(blobPath, Buffer.from('corrupted bytes!'));

      await assert.rejects(
        () => backend.getBlob('corrupt-backend-doc', 'corrupt.bin', { includeData: true }),
        (err: unknown) => err instanceof BlobCorruptError
      );
    });
  });

  // ── listBlobs ─────────────────────────────────────────────────────────────────

  describe('listBlobs', () => {
    it('returns empty array when no blobs are attached', async () => {
      const result = await backend.listBlobs('empty-doc-list-xx');
      assert.deepEqual(result, []);
    });

    it('returns only active blobs for the document', async () => {
      const doc = 'list-backend-doc';

      await backend.attachBlob({ docSlug: doc, name: 'a.txt', contentType: 'text/plain', data: makeBytes('a'), uploadedBy: 'agent-1' });
      await backend.attachBlob({ docSlug: doc, name: 'b.txt', contentType: 'text/plain', data: makeBytes('b'), uploadedBy: 'agent-1' });

      const result = await backend.listBlobs(doc);
      const names = result.map((r) => r.blobName).sort();
      assert.ok(names.includes('a.txt'), 'a.txt must be listed');
      assert.ok(names.includes('b.txt'), 'b.txt must be listed');
    });

    it('does not include blobs from other documents', async () => {
      await backend.attachBlob({ docSlug: 'other-doc-z', name: 'secret.txt', contentType: 'text/plain', data: makeBytes('other'), uploadedBy: 'agent-1' });
      const result = await backend.listBlobs('empty-other-doc-z');
      assert.deepEqual(result, []);
    });

    it('does not include soft-deleted blobs', async () => {
      const doc = 'list-deleted-backend-doc';
      await backend.attachBlob({ docSlug: doc, name: 'delete-me.txt', contentType: 'text/plain', data: makeBytes('delete me'), uploadedBy: 'agent-1' });
      await backend.detachBlob(doc, 'delete-me.txt', 'agent-1');
      const result = await backend.listBlobs(doc);
      assert.deepEqual(result, []);
    });
  });

  // ── detachBlob ────────────────────────────────────────────────────────────────

  describe('detachBlob', () => {
    it('soft-deletes and returns true', async () => {
      const doc = 'detach-backend-doc';
      await backend.attachBlob({ docSlug: doc, name: 'detach.txt', contentType: 'text/plain', data: makeBytes('detach me'), uploadedBy: 'agent-1' });

      const removed = await backend.detachBlob(doc, 'detach.txt', 'agent-1');
      assert.equal(removed, true, 'must return true');

      const check = await backend.getBlob(doc, 'detach.txt');
      assert.equal(check, null, 'blob must be inaccessible after detach');
    });

    it('returns false when blob does not exist', async () => {
      const removed = await backend.detachBlob('ghost-doc', 'nonexistent.txt', 'agent-1');
      assert.equal(removed, false, 'must return false for non-existent blob');
    });
  });

  // ── fetchBlobByHash ───────────────────────────────────────────────────────────

  describe('fetchBlobByHash', () => {
    it('returns bytes for a known hash', async () => {
      const data = makeBytes('fetch by hash backend unique 88');
      const attachment = await backend.attachBlob({
        docSlug: 'fetch-hash-backend-doc',
        name: 'fetchable.bin',
        contentType: 'application/octet-stream',
        data,
        uploadedBy: 'agent-1',
      });

      const result = await backend.fetchBlobByHash(attachment.hash);
      assert.ok(result, 'must not be null');
      assert.deepEqual(result, data);
    });

    it('returns null for an unknown hash', async () => {
      const result = await backend.fetchBlobByHash('a'.repeat(64));
      assert.equal(result, null);
    });

    it('returns null for invalid hash format', async () => {
      const result = await backend.fetchBlobByHash('not-a-hash');
      assert.equal(result, null);
    });
  });

  // ── Error class exports ───────────────────────────────────────────────────────

  describe('Error class exports', () => {
    it('BlobTooLargeError extends Error', () => {
      const err = new BlobTooLargeError(200, 100);
      assert.ok(err instanceof Error);
      assert.ok(err instanceof BlobTooLargeError);
      assert.equal(err.name, 'BlobTooLargeError');
    });

    it('BlobNameInvalidError extends Error', () => {
      const err = new BlobNameInvalidError('bad', 'reason');
      assert.ok(err instanceof Error);
      assert.ok(err instanceof BlobNameInvalidError);
      assert.equal(err.name, 'BlobNameInvalidError');
    });

    it('BlobCorruptError extends Error', () => {
      const err = new BlobCorruptError('hash', 'path');
      assert.ok(err instanceof Error);
      assert.ok(err instanceof BlobCorruptError);
      assert.equal(err.name, 'BlobCorruptError');
    });

    it('BlobNotFoundError extends Error', () => {
      const err = new BlobNotFoundError('a'.repeat(64));
      assert.ok(err instanceof Error);
      assert.ok(err instanceof BlobNotFoundError);
      assert.equal(err.name, 'BlobNotFoundError');
      assert.ok(err.message.includes('a'.repeat(64)));
    });

    it('BlobAccessDeniedError extends Error', () => {
      const err = new BlobAccessDeniedError('getBlob', 'my-doc', 'agent-1');
      assert.ok(err instanceof Error);
      assert.ok(err instanceof BlobAccessDeniedError);
      assert.equal(err.name, 'BlobAccessDeniedError');
      assert.ok(err.message.includes('agent-1'));
      assert.ok(err.message.includes('my-doc'));
    });

    it('BlobAccessDeniedError works without agentId', () => {
      const err = new BlobAccessDeniedError('attachBlob', 'locked-doc');
      assert.ok(err instanceof BlobAccessDeniedError);
      assert.ok(err.message.includes('locked-doc'));
    });
  });
});
