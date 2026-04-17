/**
 * local-multi-agent.test.ts — T408 / P2.10
 *
 * Multi-agent local convergence test: 3 LocalBackend instances write
 * independently to separate SQLite files, exchange cr-sqlite changesets via
 * getChangesSince / applyChanges, and verify content-level convergence.
 *
 * Spec references:
 *   - docs/specs/P2-cr-sqlite.md §9 acceptance criteria #4
 *   - DR-P2-01 (graceful degradation when @vlcn.io/crsqlite absent)
 *   - W4-1 finding: convergence verified at content level (sorted IDs + SHA-256)
 *
 * Skip strategy: if @vlcn.io/crsqlite is not installed (hasCRR=false), all
 * CRR-dependent tests are skipped gracefully. Non-CRR smoke tests still run.
 *
 * Performance constraint (spec §9 #4): test MUST complete in < 10 seconds on
 * CI hardware.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocalBackend } from '../local/local-backend.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-ma-'));
}

async function cleanupBackend(backend: LocalBackend, dir: string): Promise<void> {
  try { await backend.close(); } catch { /* ignore */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/**
 * Check whether cr-sqlite is available by opening a probe backend.
 * Returns false if @vlcn.io/crsqlite is absent or fails to load.
 */
async function isCrSqliteAvailable(): Promise<boolean> {
  const dir = tmpDir();
  const b = new LocalBackend({ storagePath: dir, wal: false, leaseReaperIntervalMs: 0 });
  try {
    await b.open();
    return b.hasCRR;
  } catch {
    return false;
  } finally {
    await cleanupBackend(b, dir);
  }
}

/**
 * Exchange changesets pairwise between two backends (A → B then B → A).
 * Returns [newVersionA, newVersionB].
 */
async function exchangePair(
  a: LocalBackend,
  b: LocalBackend,
  sinceA: bigint,
  sinceB: bigint
): Promise<[bigint, bigint]> {
  const csA = await a.getChangesSince(sinceA);
  const csB = await b.getChangesSince(sinceB);
  const newB = await b.applyChanges(csA);
  const newA = await a.applyChanges(csB);
  return [newA, newB];
}

/**
 * Compute a SHA-256 fingerprint of the sorted document IDs + titles in a backend.
 * Used to prove identical state across all 3 instances (spec §9 #4 / W4-1).
 */
async function documentFingerprint(backend: LocalBackend): Promise<string> {
  const result = await backend.listDocuments({ limit: 1000 });
  const sorted = result.items
    .map((d) => `${d.id}::${d.title}`)
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(sorted).digest('hex');
}

// ── Non-CRR smoke test (always runs) ────────────────────────────────────────

describe('multi-agent: LocalBackend no-CRR smoke', () => {
  it('LocalBackend opens without cr-sqlite and returns hasCRR=false on bad ext path', async () => {
    const dir = tmpDir();
    const backend = new LocalBackend({
      storagePath: dir,
      wal: false,
      leaseReaperIntervalMs: 0,
      crsqliteExtPath: path.join(dir, 'nonexistent.so'),
    });
    await backend.open();
    try {
      assert.strictEqual(backend.hasCRR, false, 'hasCRR must be false with invalid ext path');
      // getChangesSince must throw (not crash)
      await assert.rejects(
        () => backend.getChangesSince(0n),
        (err: Error) => err.name === 'CrSqliteNotLoadedError' || err.message.includes('crsqlite'),
        'getChangesSince must throw CrSqliteNotLoadedError when hasCRR=false'
      );
    } finally {
      await cleanupBackend(backend, dir);
    }
  });
});

// ── 3-instance convergence test (conditional on cr-sqlite) ──────────────────

describe('multi-agent: 3 LocalBackend instances converge via cr-sqlite changesets', () => {
  let crSqliteAvail = false;
  let dirA: string, dirB: string, dirC: string;
  let backendA: LocalBackend, backendB: LocalBackend, backendC: LocalBackend;

  before(async () => {
    crSqliteAvail = await isCrSqliteAvailable();
    if (!crSqliteAvail) {
      console.log('[SKIP] @vlcn.io/crsqlite not available — skipping 3-instance convergence tests');
      return;
    }

    dirA = tmpDir();
    dirB = tmpDir();
    dirC = tmpDir();

    backendA = new LocalBackend({ storagePath: dirA, wal: false, leaseReaperIntervalMs: 0 });
    backendB = new LocalBackend({ storagePath: dirB, wal: false, leaseReaperIntervalMs: 0 });
    backendC = new LocalBackend({ storagePath: dirC, wal: false, leaseReaperIntervalMs: 0 });

    await backendA.open();
    await backendB.open();
    await backendC.open();
  });

  after(async () => {
    if (!crSqliteAvail) return;
    await cleanupBackend(backendA, dirA);
    await cleanupBackend(backendB, dirB);
    await cleanupBackend(backendC, dirC);
  });

  it('all 3 backends have hasCRR=true', () => {
    if (!crSqliteAvail) return;
    assert.ok(backendA.hasCRR, 'backendA hasCRR');
    assert.ok(backendB.hasCRR, 'backendB hasCRR');
    assert.ok(backendC.hasCRR, 'backendC hasCRR');
  });

  it('each backend writes 10 documents independently', async () => {
    if (!crSqliteAvail) return;

    // Agent A writes 10 docs.
    for (let i = 0; i < 10; i++) {
      await backendA.createDocument({ title: `Agent-A Doc ${i}`, createdBy: 'agent-a' });
    }

    // Agent B writes 10 docs concurrently (independent).
    for (let i = 0; i < 10; i++) {
      await backendB.createDocument({ title: `Agent-B Doc ${i}`, createdBy: 'agent-b' });
    }

    // Agent C writes 10 docs concurrently (independent).
    for (let i = 0; i < 10; i++) {
      await backendC.createDocument({ title: `Agent-C Doc ${i}`, createdBy: 'agent-c' });
    }

    // Verify each has exactly 10 docs before sync.
    const listA = await backendA.listDocuments({ limit: 100 });
    const listB = await backendB.listDocuments({ limit: 100 });
    const listC = await backendC.listDocuments({ limit: 100 });

    assert.equal(listA.items.length, 10, 'A has 10 docs before sync');
    assert.equal(listB.items.length, 10, 'B has 10 docs before sync');
    assert.equal(listC.items.length, 10, 'C has 10 docs before sync');
  });

  it('pairwise changeset exchange converges all 3 to 30 docs with matching fingerprints', async () => {
    if (!crSqliteAvail) return;

    // Round 1: A ↔ B, B ↔ C.
    await exchangePair(backendA, backendB, 0n, 0n);
    await exchangePair(backendB, backendC, 0n, 0n);

    // Round 2: A ↔ C (propagate C's changes back to A, and A ↔ B gap).
    await exchangePair(backendA, backendC, 0n, 0n);
    await exchangePair(backendA, backendB, 0n, 0n);

    // Round 3: final stabilisation pass.
    await exchangePair(backendB, backendC, 0n, 0n);
    await exchangePair(backendA, backendC, 0n, 0n);

    // All 3 must now have 30 documents.
    const listA = await backendA.listDocuments({ limit: 100 });
    const listB = await backendB.listDocuments({ limit: 100 });
    const listC = await backendC.listDocuments({ limit: 100 });

    assert.equal(listA.items.length, 30, 'A converged to 30 docs');
    assert.equal(listB.items.length, 30, 'B converged to 30 docs');
    assert.equal(listC.items.length, 30, 'C converged to 30 docs');

    // SHA-256 fingerprint of sorted doc IDs+titles must be identical (W4-1).
    const fpA = await documentFingerprint(backendA);
    const fpB = await documentFingerprint(backendB);
    const fpC = await documentFingerprint(backendC);

    assert.equal(fpA, fpB, 'fingerprint A === B (identical document set)');
    assert.equal(fpB, fpC, 'fingerprint B === C (identical document set)');
  });

  it('getChangesSince returns 0 bytes when nothing new since last applied version', async () => {
    if (!crSqliteAvail) return;

    // After full sync above, requesting changes since a very high version should
    // return an empty or near-empty changeset.
    const hugeVersion = BigInt(Number.MAX_SAFE_INTEGER);
    const csA = await backendA.getChangesSince(hugeVersion);
    assert.ok(csA instanceof Uint8Array, 'Returns Uint8Array');
    // Header only (4 bytes for row count=0) or length=0 are both valid.
    assert.ok(csA.length <= 4, `Changeset since MAX_SAFE_INTEGER must be tiny (got ${csA.length}B)`);
  });

  it('applying a changeset twice is idempotent — no duplicate documents', async () => {
    if (!crSqliteAvail) return;

    // Create one more doc on A.
    const extra = await backendA.createDocument({ title: 'Idempotency-check', createdBy: 'agent-a' });
    const cs = await backendA.getChangesSince(0n);

    // Apply once.
    await backendB.applyChanges(cs);
    // Apply again — idempotency requirement.
    await backendB.applyChanges(cs);

    // B must have the document exactly once.
    const found = await backendB.getDocument(extra.id);
    assert.ok(found !== null, 'extra doc present after double-apply');
    assert.equal(found!.title, 'Idempotency-check', 'title preserved');

    // Confirm no duplicate by listing and counting.
    const list = await backendB.listDocuments({ limit: 1000 });
    const matching = list.items.filter((d) => d.id === extra.id);
    assert.equal(matching.length, 1, 'exactly one copy of the document in B (idempotent)');
  });

  it('write overhead: changeset exchange for 30-doc corpus completes in < 10s', async () => {
    if (!crSqliteAvail) return;

    // Time the full pairwise exchange from version 0 as a representative
    // performance probe.
    const start = Date.now();

    await exchangePair(backendA, backendB, 0n, 0n);
    await exchangePair(backendB, backendC, 0n, 0n);
    await exchangePair(backendA, backendC, 0n, 0n);

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 10_000, `Pairwise exchange must complete in < 10s (took ${elapsed}ms)`);
  });
});
