/**
 * T428.9 (T465): Integration test — 5-agent hub-spoke with LWW resolution + lazy sync
 *
 * Topology:
 *   Hub: one LocalBackend instance (single SQLite DB + blobsDir)
 *   Spoke agents: 5 direct LocalBackend references to the same hub storage path.
 *     Each agent writes concurrently via the shared backend.
 *
 * Why direct LocalBackend references instead of RemoteBackend + HTTP server?
 *   - The packages/llmtxt unit-test context has no running API server process.
 *   - Direct references to the same hub storagePath simulate hub-spoke semantics
 *     exactly (all reads/writes are serialized by better-sqlite3 synchronous I/O).
 *   - RemoteBackend integration (actual HTTP) is covered in apps/backend tests.
 *
 * Test cases (matching T465 acceptance criteria):
 *   1. All 5 agents attach different blobs — all 5 present in listBlobs.
 *   2. Two agents attach same blobName — LWW winner has later uploadedAt.
 *   3. Tie-break: same uploadedAt, different uploadedBy — higher lex string wins.
 *   4. Lazy sync: agent A attaches; applyBlobChangeset on agent B's perspective
 *      brings the ref into B's manifest; getBlob(includeData=true) fetches bytes.
 *   5. Hash tampering: corrupt stored blob file; BlobCorruptError returned on read.
 *
 * @see docs/specs/ARCH-T428-binary-blob-attachments.md §7, §9
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { LocalBackend } from '../local/local-backend.js';
import {
  applyBlobChangeset,
  buildBlobChangeset,
} from '../local/blob-changeset.js';
import { BlobCorruptError } from '../core/errors.js';

// ── Helpers ────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-blob-5agent-'));
}

function makeBytes(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

/** Open a LocalBackend referencing the same hub storagePath. */
async function openHubSpoke(storagePath: string): Promise<LocalBackend> {
  const b = new LocalBackend({ storagePath });
  await b.open();
  return b;
}

// ── Test suite ─────────────────────────────────────────────────────

describe('T428.9: 5-agent hub-spoke blob integration', () => {
  let hubDir: string;
  /** Primary hub backend */
  let hub: LocalBackend;
  /** 5 agent instances — all references to same hub storagePath. */
  const agents: LocalBackend[] = [];
  const AGENT_IDS = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];
  const DOC_SLUG = 'hub-spoke-blob-doc';

  before(async () => {
    hubDir = makeTempDir();
    hub = await openHubSpoke(hubDir);

    // Each "spoke" agent uses a separate LocalBackend referencing the hub.
    // In production this would be RemoteBackend → HTTP → hub; here we use
    // direct LocalBackend references for the same serialization semantics.
    for (let i = 0; i < 5; i++) {
      agents.push(await openHubSpoke(hubDir));
    }
  });

  after(async () => {
    await hub.close();
    for (const a of agents) {
      try { await a.close(); } catch { /* ignore */ }
    }
    try { fs.rmSync(hubDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── Test 1: All 5 agents attach different blobs ──────────────────

  it('T465.1: all 5 agents attach distinct blobs — all 5 listed', async () => {
    for (let i = 0; i < 5; i++) {
      await agents[i]!.attachBlob({
        docSlug: DOC_SLUG,
        name: `agent-${i + 1}-unique.txt`,
        contentType: 'text/plain',
        data: makeBytes(`content from agent-${i + 1} unique blob payload`),
        uploadedBy: AGENT_IDS[i]!,
      });
    }

    const allBlobs = await hub.listBlobs(DOC_SLUG);
    const names = allBlobs.map((b) => b.blobName).sort();

    for (let i = 0; i < 5; i++) {
      assert.ok(
        names.includes(`agent-${i + 1}-unique.txt`),
        `agent-${i + 1}-unique.txt must be in hub listBlobs`
      );
    }

    assert.ok(allBlobs.length >= 5, 'at least 5 distinct blobs must be listed');
  });

  // ── Test 2: LWW — two agents attach same blobName ───────────────

  it('T465.2: two agents attach same blobName — newer uploadedAt wins', async () => {
    const sharedName = 'contested-lww.bin';
    const docSlug = 'lww-test-doc';

    // agent-1 attaches first
    const a1 = await agents[0]!.attachBlob({
      docSlug,
      name: sharedName,
      contentType: 'application/octet-stream',
      data: makeBytes('agent-1 content for lww test'),
      uploadedBy: AGENT_IDS[0]!,
    });

    // Wait 2ms to ensure a different timestamp
    await new Promise((r) => setTimeout(r, 2));

    // agent-2 attaches second — must win due to later uploadedAt
    const a2 = await agents[1]!.attachBlob({
      docSlug,
      name: sharedName,
      contentType: 'application/octet-stream',
      data: makeBytes('agent-2 content for lww test newer'),
      uploadedBy: AGENT_IDS[1]!,
    });

    assert.ok(a2.uploadedAt > a1.uploadedAt, 'agent-2 must have later uploadedAt');

    // Hub manifest should show agent-2's record
    const winner = await hub.getBlob(docSlug, sharedName);
    assert.ok(winner, 'must have a manifest entry');
    assert.equal(
      winner.hash,
      a2.hash,
      'agent-2 (later uploadedAt) must be the winner'
    );
    assert.equal(winner.uploadedBy, AGENT_IDS[1], 'uploadedBy must be agent-2');
  });

  // ── Test 3: Tie-break by uploadedBy lex descending ──────────────

  it('T465.3: tie-break — same uploadedAt, higher lex uploadedBy wins', async () => {
    const docSlug = 'tiebreak-test-doc';
    const blobName = 'tiebreak.bin';
    const sameTs = Date.now();

    // Manually apply via applyBlobChangeset to control exact timestamps.
    // This tests the changeset integration LWW path directly.

    const db = (hub as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const blobAdapter = (hub as unknown as { blobAdapter: Parameters<typeof applyBlobChangeset>[1] }).blobAdapter;

    const lowRef = {
      blobName,
      hash: '1'.repeat(64),
      size: 10,
      contentType: 'application/octet-stream',
      uploadedBy: 'agent-alpha',   // lower lex
      uploadedAt: sameTs,
      docSlug,
    };

    const highRef = {
      blobName,
      hash: '2'.repeat(64),
      size: 20,
      contentType: 'application/octet-stream',
      uploadedBy: 'agent-zeta',    // higher lex — should win
      uploadedAt: sameTs,
      docSlug,
    };

    const pending = new Set<string>();

    // Apply low first
    applyBlobChangeset(db, blobAdapter, [lowRef], pending);

    // Apply high — should win despite same timestamp
    applyBlobChangeset(db, blobAdapter, [highRef], pending);

    const winner = await hub.getBlob(docSlug, blobName);
    assert.ok(winner, 'must have a manifest entry after tie-break');
    assert.equal(
      winner.uploadedBy,
      'agent-zeta',
      'agent-zeta (higher lex uploadedBy) must win tie-break'
    );
    assert.equal(winner.hash, highRef.hash, 'winning hash must match agent-zeta ref');
  });

  // ── Test 4: Lazy sync — agent B receives changeset ref ───────────

  it('T465.4: lazy sync — agent A attaches; agent B resolves via changeset + getBlob', async () => {
    const docSlug = 'lazy-sync-test-doc';
    const blobName = 'lazy-blob.bin';
    const blobContent = 'lazy sync test content unique 42';

    // Agent A attaches a blob (writes bytes to hub blobsDir)
    const attachment = await agents[0]!.attachBlob({
      docSlug,
      name: blobName,
      contentType: 'text/plain',
      data: makeBytes(blobContent),
      uploadedBy: AGENT_IDS[0]!,
    });

    // Build a changeset from the hub's perspective
    const db = (hub as unknown as { db: Parameters<typeof buildBlobChangeset>[0] }).db;
    const changeset = buildBlobChangeset(db, new Uint8Array(0), docSlug, 0);

    assert.ok(changeset.blobs.length >= 1, 'changeset must carry at least one blob ref');
    const ref = changeset.blobs.find((b) => b.blobName === blobName);
    assert.ok(ref, 'changeset must contain the lazy-blob.bin ref');
    assert.equal(ref!.hash, attachment.hash, 'ref hash must match attachment hash');

    // Simulate agent B receiving the changeset ref.
    // In a real scenario, agent B would be on a separate machine and not yet
    // have the bytes. Here both share the same blobsDir (hub), so bytes are
    // already present — we verify the ref resolves correctly via getBlob.
    const b2Blob = await agents[1]!.getBlob(docSlug, blobName, { includeData: true });
    assert.ok(b2Blob, 'agent B must be able to fetch the blob via getBlob');
    assert.ok(b2Blob.data, 'data must be present when includeData=true');
    assert.equal(
      b2Blob.data!.toString('utf8'),
      blobContent,
      'fetched bytes must match original content'
    );
  });

  // ── Test 5: Hash tampering — BlobCorruptError on read ────────────

  it('T465.5: hash tampering — corrupt stored file returns BlobCorruptError', async () => {
    const docSlug = 'tamper-test-doc';
    const blobName = 'tamper.bin';

    const attachment = await hub.attachBlob({
      docSlug,
      name: blobName,
      contentType: 'application/octet-stream',
      data: makeBytes('original content for tampering test unique xyz'),
      uploadedBy: AGENT_IDS[0]!,
    });

    // Corrupt the stored file
    const blobPath = path.join(hubDir, 'blobs', attachment.hash);
    assert.ok(fs.existsSync(blobPath), 'blob file must exist on disk');
    fs.writeFileSync(blobPath, Buffer.from('CORRUPTED BYTES'));

    // getBlob with includeData=true must detect the tamper and throw BlobCorruptError.
    await assert.rejects(
      () => hub.getBlob(docSlug, blobName, { includeData: true }),
      (err: unknown) => err instanceof BlobCorruptError,
      'must throw BlobCorruptError on hash mismatch'
    );

    // After the first rejection, the corrupt file is quarantined to <hash>.corrupt.
    // fetchBlobByHash therefore sees the original path as absent (returns null),
    // OR if the quarantine rename raced, it still throws BlobCorruptError.
    // Both outcomes are acceptable: the key invariant is that corrupt bytes are
    // NEVER returned to the caller.
    //
    // Spec §9.1: "The corrupt file SHOULD be quarantined (renamed to <hash>.corrupt)
    // and the error propagated to the caller."  Quarantine is best-effort.
    //
    // Verify: corrupt bytes are not returned (null or throws — never the corrupt Buffer)
    let fetchResult: Buffer | null = null;
    let fetchThrew = false;
    try {
      fetchResult = await hub.fetchBlobByHash(attachment.hash);
    } catch (err) {
      fetchThrew = true;
      assert.ok(
        err instanceof BlobCorruptError,
        `expected BlobCorruptError but got: ${String(err)}`
      );
    }

    if (!fetchThrew) {
      // File was quarantined — null return is correct
      assert.equal(
        fetchResult,
        null,
        'after quarantine, fetchBlobByHash must return null (file moved to .corrupt)'
      );
    }

    // Either way, the corrupt bytes must not be returned
    if (fetchResult !== null) {
      const fetchedContent = fetchResult.toString('utf8');
      assert.notEqual(
        fetchedContent,
        'CORRUPTED BYTES',
        'corrupt bytes must never be returned to the caller'
      );
    }
  });

  // ── Test 6: Concurrent attach — all complete without deadlock ────

  it('T465.6: concurrent attach from 5 agents does not deadlock or error', async () => {
    const docSlug = 'concurrent-attach-doc';

    // Fire all 5 attaches concurrently
    const results = await Promise.all(
      agents.map((agent, i) =>
        agent.attachBlob({
          docSlug,
          name: `concurrent-agent-${i + 1}.bin`,
          contentType: 'application/octet-stream',
          data: makeBytes(`concurrent content from agent ${i + 1} payload unique`),
          uploadedBy: AGENT_IDS[i]!,
        })
      )
    );

    // All must succeed
    assert.equal(results.length, 5, 'all 5 attaches must complete');
    for (const r of results) {
      assert.ok(r.id, 'each result must have an id');
      assert.ok(r.hash.length === 64, 'each result must have a valid SHA-256 hash');
    }

    // All 5 blobs must appear in hub
    const hubList = await hub.listBlobs(docSlug);
    const concNames = hubList.map((b) => b.blobName);
    for (let i = 0; i < 5; i++) {
      assert.ok(
        concNames.includes(`concurrent-agent-${i + 1}.bin`),
        `concurrent-agent-${i + 1}.bin must be in hub listBlobs`
      );
    }
  });
});
