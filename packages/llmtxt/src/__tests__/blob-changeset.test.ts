/**
 * Unit tests for blob-changeset.ts — T428.6 (T462)
 *
 * Tests:
 *   - buildBlobChangeset: returns correct BlobRef entries
 *   - incomingWinsLWW: all 3 LWW scenarios
 *   - applyBlobChangeset: winner inserted, loser discarded, lazy-fetch scheduled
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { LocalBackend } from '../local/index.js';
import {
  buildBlobChangeset,
  applyBlobChangeset,
  incomingWinsLWW,
} from '../local/blob-changeset.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-blob-changeset-test-'));
}

function makeBytes(s: string): Buffer {
  return Buffer.from(s, 'utf8');
}

// ── Test suite ─────────────────────────────────────────────────────

describe('blob-changeset — incomingWinsLWW', () => {
  it('newer uploadedAt wins', () => {
    assert.equal(
      incomingWinsLWW(
        { blobName: 'a.txt', hash: 'x', size: 1, contentType: 'text/plain', uploadedBy: 'agent-1', uploadedAt: 2000 },
        { uploadedAt: 1000, uploadedBy: 'agent-2' }
      ),
      true
    );
  });

  it('older uploadedAt loses', () => {
    assert.equal(
      incomingWinsLWW(
        { blobName: 'a.txt', hash: 'x', size: 1, contentType: 'text/plain', uploadedBy: 'agent-1', uploadedAt: 500 },
        { uploadedAt: 1000, uploadedBy: 'agent-2' }
      ),
      false
    );
  });

  it('same uploadedAt — higher lex uploadedBy wins', () => {
    // 'agent-z' > 'agent-a' lexicographically
    assert.equal(
      incomingWinsLWW(
        { blobName: 'a.txt', hash: 'x', size: 1, contentType: 'text/plain', uploadedBy: 'agent-z', uploadedAt: 1000 },
        { uploadedAt: 1000, uploadedBy: 'agent-a' }
      ),
      true
    );
  });

  it('same uploadedAt — lower lex uploadedBy loses', () => {
    assert.equal(
      incomingWinsLWW(
        { blobName: 'a.txt', hash: 'x', size: 1, contentType: 'text/plain', uploadedBy: 'agent-a', uploadedAt: 1000 },
        { uploadedAt: 1000, uploadedBy: 'agent-z' }
      ),
      false
    );
  });

  it('same uploadedAt and same uploadedBy — returns false (no-op)', () => {
    assert.equal(
      incomingWinsLWW(
        { blobName: 'a.txt', hash: 'x', size: 1, contentType: 'text/plain', uploadedBy: 'agent-1', uploadedAt: 1000 },
        { uploadedAt: 1000, uploadedBy: 'agent-1' }
      ),
      false
    );
  });
});

describe('blob-changeset — buildBlobChangeset', () => {
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

  it('returns empty blobs array when no blobs are attached', async () => {
    // Access internal db via the test-only accessor path
    // We use backend's public API to attach blobs, then test the changeset builder
    // by importing and calling it with the same db instance.
    // Since we cannot easily access the private db, we test via LocalBackend's
    // overall output by verifying the returned refs include attached blobs.
    const { blobs } = buildBlobChangeset(
      (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db,
      new Uint8Array(0),
      'empty-doc-changeset-x',
      0
    );
    assert.deepEqual(blobs, []);
  });

  it('includes BlobRef entries for attached blobs on a document', async () => {
    const doc = 'changeset-build-doc-1';
    const attachment = await backend.attachBlob({
      docSlug: doc,
      name: 'report.pdf',
      contentType: 'application/pdf',
      data: makeBytes('pdf content here'),
      uploadedBy: 'agent-build-1',
    });

    const { blobs } = buildBlobChangeset(
      (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db,
      new Uint8Array(0),
      doc,
      0
    );

    assert.equal(blobs.length, 1);
    const ref = blobs[0]!;
    assert.equal(ref.blobName, 'report.pdf');
    assert.equal(ref.hash, attachment.hash);
    assert.equal(ref.contentType, 'application/pdf');
    assert.equal(ref.uploadedBy, 'agent-build-1');
  });

  it('excludes blobs with uploadedAt <= sinceMs', async () => {
    const doc = 'changeset-build-doc-2';
    await backend.attachBlob({
      docSlug: doc,
      name: 'old.txt',
      contentType: 'text/plain',
      data: makeBytes('old content'),
      uploadedBy: 'agent-1',
    });

    const futureMs = Date.now() + 60_000;
    const { blobs } = buildBlobChangeset(
      (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db,
      new Uint8Array(0),
      doc,
      futureMs // filter excludes everything uploaded before futureMs
    );

    // All current blobs should be filtered out (they were uploaded before futureMs)
    const docBlobs = blobs.filter((b) => (b as typeof b & { docSlug?: string }).docSlug === doc);
    assert.equal(docBlobs.length, 0);
  });

  it('does not include soft-deleted blob refs', async () => {
    const doc = 'changeset-build-doc-3';
    await backend.attachBlob({
      docSlug: doc,
      name: 'to-delete.txt',
      contentType: 'text/plain',
      data: makeBytes('will be deleted'),
      uploadedBy: 'agent-1',
    });
    await backend.detachBlob(doc, 'to-delete.txt', 'agent-1');

    const { blobs } = buildBlobChangeset(
      (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db,
      new Uint8Array(0),
      doc,
      0
    );
    const docBlobs = blobs.filter((b) => (b as typeof b & { docSlug?: string }).docSlug === doc);
    assert.equal(docBlobs.length, 0);
  });
});

describe('blob-changeset — applyBlobChangeset', () => {
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

  it('inserts a new manifest record when no existing record conflicts', async () => {
    const docSlug = 'apply-test-doc-1';
    const db = (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const blobFs = (backend as unknown as { blobAdapter: Parameters<typeof applyBlobChangeset>[1] }).blobAdapter;

    const ref = {
      blobName: 'new.txt',
      hash: 'a'.repeat(64),
      size: 100,
      contentType: 'text/plain',
      uploadedBy: 'agent-remote',
      uploadedAt: Date.now(),
      docSlug,
    };

    const pending = new Set<string>();
    const fetches: string[] = [];

    const result = applyBlobChangeset(db, blobFs, [ref], pending, (_slug, hash) => {
      fetches.push(hash);
    });

    assert.equal(result.applied, 1);
    assert.equal(result.discarded, 0);

    // The hash is not on disk so a lazy fetch should be scheduled
    assert.ok(pending.has(ref.hash), 'hash must be in pendingFetches set');
    assert.ok(fetches.includes(ref.hash), 'scheduleFetch callback must be invoked');

    // The manifest record should now exist
    const fromDb = await backend.getBlob(docSlug, 'new.txt');
    assert.ok(fromDb, 'manifest record must exist');
    assert.equal(fromDb.hash, ref.hash);
  });

  it('newer uploadedAt wins and displaces existing record', async () => {
    const docSlug = 'apply-lww-doc-1';
    const db = (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const blobFs = (backend as unknown as { blobAdapter: Parameters<typeof applyBlobChangeset>[1] }).blobAdapter;

    // First attach locally — sets a baseline
    const local = await backend.attachBlob({
      docSlug,
      name: 'contested.bin',
      contentType: 'application/octet-stream',
      data: makeBytes('local version'),
      uploadedBy: 'agent-local',
    });

    // Incoming ref has newer uploadedAt — should win
    const incomingRef = {
      blobName: 'contested.bin',
      hash: 'b'.repeat(64),
      size: 200,
      contentType: 'application/octet-stream',
      uploadedBy: 'agent-remote',
      uploadedAt: local.uploadedAt + 5000,
      docSlug,
    };

    const pending = new Set<string>();
    const result = applyBlobChangeset(db, blobFs, [incomingRef], pending);

    assert.equal(result.applied, 1);

    // Manifest should show the incoming (winning) hash
    const fromDb = await backend.getBlob(docSlug, 'contested.bin');
    assert.ok(fromDb, 'must have manifest entry');
    assert.equal(fromDb.hash, incomingRef.hash, 'winning ref hash must be in manifest');
  });

  it('older uploadedAt loses — existing record unchanged', async () => {
    const docSlug = 'apply-lww-doc-2';
    const db = (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const blobFs = (backend as unknown as { blobAdapter: Parameters<typeof applyBlobChangeset>[1] }).blobAdapter;

    // Attach locally — has a recent uploadedAt
    const local = await backend.attachBlob({
      docSlug,
      name: 'winner.bin',
      contentType: 'application/octet-stream',
      data: makeBytes('local is newer'),
      uploadedBy: 'agent-local',
    });

    // Incoming ref has older uploadedAt — should lose
    const staleRef = {
      blobName: 'winner.bin',
      hash: 'c'.repeat(64),
      size: 50,
      contentType: 'application/octet-stream',
      uploadedBy: 'agent-remote',
      uploadedAt: local.uploadedAt - 5000,
      docSlug,
    };

    const pending = new Set<string>();
    const result = applyBlobChangeset(db, blobFs, [staleRef], pending);

    assert.equal(result.applied, 0);
    assert.equal(result.discarded, 1);

    // Local hash must still be in manifest
    const fromDb = await backend.getBlob(docSlug, 'winner.bin');
    assert.ok(fromDb, 'must have manifest entry');
    assert.equal(fromDb.hash, local.hash, 'local (winner) hash must remain');
  });

  it('tie-break by uploadedBy lex descending — higher wins', async () => {
    const docSlug = 'apply-tiebreak-doc-1';
    const db = (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const blobFs = (backend as unknown as { blobAdapter: Parameters<typeof applyBlobChangeset>[1] }).blobAdapter;

    const sameTimestamp = 1_000_000;

    // First apply a ref from 'agent-low'
    const lowRef = {
      blobName: 'tie.bin',
      hash: 'd'.repeat(64),
      size: 10,
      contentType: 'application/octet-stream',
      uploadedBy: 'agent-low',
      uploadedAt: sameTimestamp,
      docSlug,
    };

    const pending1 = new Set<string>();
    applyBlobChangeset(db, blobFs, [lowRef], pending1);

    // Now apply a ref from 'agent-zzz' with same timestamp — should win
    const highRef = {
      blobName: 'tie.bin',
      hash: 'e'.repeat(64),
      size: 20,
      contentType: 'application/octet-stream',
      uploadedBy: 'agent-zzz',
      uploadedAt: sameTimestamp,
      docSlug,
    };

    const pending2 = new Set<string>();
    const result = applyBlobChangeset(db, blobFs, [highRef], pending2);

    assert.equal(result.applied, 1, 'higher lex uploadedBy should win');

    const fromDb = await backend.getBlob(docSlug, 'tie.bin');
    assert.ok(fromDb);
    assert.equal(fromDb.uploadedBy, 'agent-zzz', 'agent-zzz should be in manifest');
    assert.equal(fromDb.hash, highRef.hash);
  });

  it('does not schedule duplicate lazy fetch for already-pending hash', async () => {
    const docSlug = 'apply-dedup-fetch-doc';
    const db = (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const blobFs = (backend as unknown as { blobAdapter: Parameters<typeof applyBlobChangeset>[1] }).blobAdapter;

    const hash = 'f'.repeat(64);
    const ref = {
      blobName: 'dedup.bin',
      hash,
      size: 5,
      contentType: 'application/octet-stream',
      uploadedBy: 'agent-1',
      uploadedAt: Date.now(),
      docSlug,
    };

    const pending = new Set<string>([hash]); // pre-populate as if already scheduled
    let callCount = 0;

    applyBlobChangeset(db, blobFs, [ref], pending, () => { callCount++; });

    // scheduleFetch must NOT be called again
    assert.equal(callCount, 0, 'scheduleFetch must not be called for already-pending hash');
  });

  it('skips refs missing docSlug', async () => {
    const db = (backend as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const blobFs = (backend as unknown as { blobAdapter: Parameters<typeof applyBlobChangeset>[1] }).blobAdapter;

    // BlobRef without docSlug — internal guard must discard it
    const badRef = {
      blobName: 'no-slug.bin',
      hash: '0'.repeat(64),
      size: 1,
      contentType: 'text/plain',
      uploadedBy: 'agent-x',
      uploadedAt: Date.now(),
      // docSlug intentionally absent
    };

    const pending = new Set<string>();
    const result = applyBlobChangeset(db, blobFs, [badRef as Parameters<typeof applyBlobChangeset>[2][0]], pending);

    assert.equal(result.applied, 0);
    assert.equal(result.discarded, 1);
  });
});
