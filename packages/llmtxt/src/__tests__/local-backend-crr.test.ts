/**
 * local-backend-crr.test.ts
 *
 * T403 (P2.5): Verifies LocalBackend cr-sqlite extension loading and hasCRR
 * property behaviour.
 *
 * Test strategy:
 *  1. When @vlcn.io/crsqlite is absent (expected in CI without the peer dep):
 *     - LocalBackend.open() MUST succeed without throwing.
 *     - hasCRR MUST be false.
 *     - Basic CRUD operations MUST continue to function.
 *  2. When @vlcn.io/crsqlite IS installed (conditional — skip if absent):
 *     - hasCRR MUST be true after open().
 *     - The cr-sqlite extension is loaded.
 *  3. When an invalid crsqliteExtPath is supplied:
 *     - LocalBackend.open() MUST succeed without throwing.
 *     - hasCRR MUST be false (graceful degradation).
 *  4. DR-P2-04 guard: crdt_state column MUST NOT be processed via LWW.
 *     (Full integration test for DR-P2-04 is in P2.11. This test verifies the
 *     property is correctly exposed and the backend does not crash.)
 *
 * Spec references: P2-cr-sqlite.md §3.1, §5.1, §5.2; DR-P2-01, DR-P2-04.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LocalBackend } from '../local/local-backend.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llmtxt-crr-test-'));
}

async function cleanupBackend(backend: LocalBackend, dir: string): Promise<void> {
  try {
    await backend.close();
  } catch {
    // ignore close errors in cleanup
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// 1. Graceful degradation when @vlcn.io/crsqlite is absent / no extPath
// ---------------------------------------------------------------------------

describe('LocalBackend.hasCRR — package absent or no extPath', () => {
  let backend: LocalBackend;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    // No crsqliteExtPath supplied; if @vlcn.io/crsqlite is absent, hasCRR = false.
    backend = new LocalBackend({ storagePath: dir, wal: false, leaseReaperIntervalMs: 0 });
    await backend.open();
  });

  after(async () => {
    await cleanupBackend(backend, dir);
  });

  it('open() does not throw when cr-sqlite is unavailable', () => {
    // If we reached here, open() succeeded — test passes by virtue of no throw.
    assert.ok(true);
  });

  it('hasCRR is a boolean', () => {
    assert.strictEqual(typeof backend.hasCRR, 'boolean');
  });

  it('basic CRUD works regardless of hasCRR value', async () => {
    // DR-P2-01: LocalBackend MUST function normally without cr-sqlite.
    const doc = await backend.createDocument({ title: 'CRR test doc', createdBy: 'test-agent' });
    assert.ok(doc.id, 'Document created successfully');
    assert.strictEqual(doc.title, 'CRR test doc');

    const fetched = await backend.getDocument(doc.id);
    assert.ok(fetched !== null, 'Document is retrievable');
    assert.strictEqual(fetched!.id, doc.id);
  });
});

// ---------------------------------------------------------------------------
// 2. Invalid crsqliteExtPath — graceful degradation
// ---------------------------------------------------------------------------

describe('LocalBackend.hasCRR — invalid crsqliteExtPath', () => {
  let backend: LocalBackend;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    backend = new LocalBackend({
      storagePath: dir,
      wal: false,
      leaseReaperIntervalMs: 0,
      // Supply a path that doesn't exist — loadExtension will fail.
      crsqliteExtPath: path.join(dir, 'non-existent.so'),
    });
    await backend.open();
  });

  after(async () => {
    await cleanupBackend(backend, dir);
  });

  it('open() does not throw on invalid ext path', () => {
    assert.ok(true, 'open() completed without throwing');
  });

  it('hasCRR is false when extension load fails', () => {
    // The extension path is invalid — loadExtension throws — graceful fallback.
    assert.strictEqual(backend.hasCRR, false);
  });

  it('CRUD operations still work after failed ext load', async () => {
    const doc = await backend.createDocument({
      title: 'Post-fail CRUD',
      createdBy: 'test-agent',
    });
    assert.ok(doc.id);
    const fetched = await backend.getDocument(doc.id);
    assert.ok(fetched !== null);
  });
});

// ---------------------------------------------------------------------------
// 3. When @vlcn.io/crsqlite IS installed (conditional)
// ---------------------------------------------------------------------------

describe('LocalBackend.hasCRR — package present (conditional)', () => {
  it('hasCRR is true when @vlcn.io/crsqlite is installed and ext loads', async () => {
    // Attempt to check if the real package is available.
    let packageAvailable = false;
    try {
      await import('@vlcn.io/crsqlite');
      packageAvailable = true;
    } catch {
      // package not installed — skip
    }

    if (!packageAvailable) {
      console.log(
        '[SKIP] @vlcn.io/crsqlite not installed — skipping hasCRR=true assertion'
      );
      return;
    }

    const dir = tmpDir();
    const backend = new LocalBackend({ storagePath: dir, wal: false, leaseReaperIntervalMs: 0 });
    try {
      await backend.open();
      assert.strictEqual(backend.hasCRR, true, 'hasCRR should be true when extension loads');

      // Verify basic operation still works with CRR enabled
      const doc = await backend.createDocument({ title: 'CRR enabled doc', createdBy: 'agent-crr' });
      assert.ok(doc.id);
    } finally {
      await cleanupBackend(backend, dir);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. DR-P2-04: crdt_state is not subject to LWW via cr-sqlite
//    (architectural guard — full integration in P2.11)
// ---------------------------------------------------------------------------

describe('LocalBackend — DR-P2-04 crdt_state merge guard', () => {
  let backend: LocalBackend;
  let dir: string;

  before(async () => {
    dir = tmpDir();
    backend = new LocalBackend({ storagePath: dir, wal: false, leaseReaperIntervalMs: 0 });
    await backend.open();
  });

  after(async () => {
    await cleanupBackend(backend, dir);
  });

  it('applyCrdtUpdate persists state without throwing', async () => {
    // Verify the CRDT update path functions correctly (basic smoke test).
    // DR-P2-04 full proof (LWW disabled for crdt_state) is in P2.11.
    const doc = await backend.createDocument({ title: 'CRDT doc', createdBy: 'agent-a' });

    const updateBytes = Buffer.from([1, 2, 3, 4]); // minimal fake update blob
    const state = await backend.applyCrdtUpdate({
      documentId: doc.id,
      sectionKey: 'intro',
      updateBase64: updateBytes.toString('base64'),
      agentId: 'agent-a',
    });

    assert.strictEqual(state.documentId, doc.id);
    assert.strictEqual(state.sectionKey, 'intro');
    assert.ok(state.snapshotBase64.length > 0);
  });

  it('getCrdtState returns null for unknown section', async () => {
    const doc = await backend.createDocument({ title: 'State fetch doc', createdBy: 'agent-b' });
    const state = await backend.getCrdtState(doc.id, 'nonexistent-section');
    assert.strictEqual(state, null);
  });
});
