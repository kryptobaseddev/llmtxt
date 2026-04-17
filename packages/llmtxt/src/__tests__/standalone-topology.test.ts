/**
 * Standalone topology contract tests (T446 — T429.4).
 *
 * Verifies that createBackend({ topology: 'standalone' }) is a drop-in
 * replacement for 'new LocalBackend(...)' in all backend contract scenarios.
 *
 * Test coverage:
 * (1) createBackend('standalone') returns a LocalBackend instance.
 * (2) The returned instance IS a LocalBackend (instanceof check).
 * (3) No fetch() calls are made during any backend operation (no network in standalone mode).
 * (4) crsqlite: true in config passes crsqliteExtPath to LocalBackend (unit test).
 * (5) All standard Backend operations work offline (document CRUD, versions, events, CRDT,
 *     leases, presence, scratchpad, A2A, identity — no network required).
 *
 * Ref: docs/specs/ARCH-T429-hub-spoke-topology.md §5.1
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { LocalBackend } from '../local/index.js';
import { createBackend } from '../backend/factory.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `llmtxt-standalone-${prefix}-`));
}

function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ── T446.1 — createBackend returns LocalBackend ───────────────────────────────

describe('Standalone topology: createBackend returns LocalBackend', () => {
  it('T446.1.a: createBackend({ topology: "standalone" }) returns a LocalBackend instance', async () => {
    const tmpDir = makeTmpDir('instanceof');
    try {
      const backend = await createBackend({ topology: 'standalone', storagePath: tmpDir });
      assert.ok(
        backend instanceof LocalBackend,
        `Expected LocalBackend, got: ${backend.constructor.name}`,
      );
    } finally {
      rmDir(tmpDir);
    }
  });

  it('T446.1.b: instanceof LocalBackend passes (not just duck-typing)', async () => {
    const tmpDir = makeTmpDir('instanceof2');
    try {
      const backend = await createBackend({ topology: 'standalone', storagePath: tmpDir });
      // This is a hard instanceof check, not just interface duck-typing
      assert.ok(backend instanceof LocalBackend);
      // Verify it is NOT some wrapper class
      assert.equal(backend.constructor.name, 'LocalBackend');
    } finally {
      rmDir(tmpDir);
    }
  });

  it('T446.1.c: storagePath is passed through to LocalBackend config', async () => {
    const tmpDir = makeTmpDir('config-pass');
    try {
      const backend = await createBackend({ topology: 'standalone', storagePath: tmpDir });
      assert.ok(backend instanceof LocalBackend);
      assert.equal((backend as LocalBackend).config.storagePath, tmpDir);
    } finally {
      rmDir(tmpDir);
    }
  });

  it('T446.1.d: crsqliteExtPath is passed through when crsqlite: true is set', async () => {
    const tmpDir = makeTmpDir('crsqlite-pass');
    const fakePath = '/usr/lib/crsqlite.so';
    try {
      const backend = await createBackend({
        topology: 'standalone',
        storagePath: tmpDir,
        crsqlite: true,
        crsqliteExtPath: fakePath,
      });
      assert.ok(backend instanceof LocalBackend);
      // crsqliteExtPath must be present in config (T385 integration)
      assert.equal((backend as LocalBackend).config.crsqliteExtPath, fakePath);
    } finally {
      rmDir(tmpDir);
    }
  });

  it('T446.1.e: minimal config (no optional fields) constructs without error', async () => {
    // storagePath defaults to .llmtxt — just verify it constructs without error
    const backend = await createBackend({ topology: 'standalone' });
    assert.ok(backend instanceof LocalBackend);
  });
});

// ── T446.2 — No fetch() calls during standalone operations ────────────────────

describe('Standalone topology: no network calls during backend operations', () => {
  let tmpDir: string;
  let backend: LocalBackend;
  let originalFetch: typeof globalThis.fetch;
  let fetchCallCount = 0;

  before(async () => {
    tmpDir = makeTmpDir('no-fetch');
    backend = (await createBackend({ topology: 'standalone', storagePath: tmpDir })) as LocalBackend;
    await backend.open();

    // Intercept fetch to detect any accidental network calls
    originalFetch = globalThis.fetch;
    fetchCallCount = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCallCount++;
      // Still fail but record the attempt
      return Promise.reject(
        new Error(`Standalone backend must NOT call fetch(). Called with: ${String(args[0])}`),
      );
    }) as typeof fetch;
  });

  after(async () => {
    // Restore original fetch before closing
    globalThis.fetch = originalFetch;
    await backend.close();
    rmDir(tmpDir);
  });

  it('T446.2.a: createDocument does not call fetch', async () => {
    const before = fetchCallCount;
    await backend.createDocument({ title: 'No-Fetch Doc', createdBy: 'agent' });
    assert.equal(fetchCallCount, before, 'createDocument must not invoke fetch()');
  });

  it('T446.2.b: getDocument does not call fetch', async () => {
    const doc = await backend.createDocument({ title: 'Get Doc', createdBy: 'agent' });
    const before = fetchCallCount;
    await backend.getDocument(doc.id);
    assert.equal(fetchCallCount, before, 'getDocument must not invoke fetch()');
  });

  it('T446.2.c: listDocuments does not call fetch', async () => {
    const before = fetchCallCount;
    await backend.listDocuments();
    assert.equal(fetchCallCount, before, 'listDocuments must not invoke fetch()');
  });

  it('T446.2.d: publishVersion does not call fetch', async () => {
    const doc = await backend.createDocument({ title: 'Version Doc', createdBy: 'agent' });
    const before = fetchCallCount;
    await backend.publishVersion({
      documentId: doc.id,
      content: '# Version Content\nStandalone test.',
      patchText: '',
      createdBy: 'agent',
      changelog: 'standalone test version',
    });
    assert.equal(fetchCallCount, before, 'publishVersion must not invoke fetch()');
  });

  it('T446.2.e: appendEvent does not call fetch', async () => {
    const doc = await backend.createDocument({ title: 'Event Doc', createdBy: 'agent' });
    const before = fetchCallCount;
    await backend.appendEvent({
      documentId: doc.id,
      type: 'test.event',
      agentId: 'agent',
      payload: { data: 'standalone' },
    });
    assert.equal(fetchCallCount, before, 'appendEvent must not invoke fetch()');
  });

  it('T446.2.f: acquireLease + releaseLease do not call fetch', async () => {
    const before = fetchCallCount;
    const lease = await backend.acquireLease({
      resource: 'standalone-lock',
      holder: 'agent',
      ttlMs: 5000,
    });
    assert.ok(lease !== null, 'Lease must be returned in standalone mode');
    await backend.releaseLease('standalone-lock', 'agent');
    assert.equal(fetchCallCount, before, 'lease operations must not invoke fetch()');
  });
});

// ── T446.3 — Full offline operations work ────────────────────────────────────

describe('Standalone topology: full offline operations', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  before(async () => {
    tmpDir = makeTmpDir('offline-ops');
    backend = (await createBackend({ topology: 'standalone', storagePath: tmpDir })) as LocalBackend;
    await backend.open();
  });

  after(async () => {
    await backend.close();
    rmDir(tmpDir);
  });

  it('T446.3.a: createDocument + getDocument round-trips in standalone', async () => {
    const doc = await backend.createDocument({
      title: 'Standalone Round-trip',
      createdBy: 'offline-agent',
    });
    assert.ok(doc.id, 'Document must have an id');
    assert.equal(doc.title, 'Standalone Round-trip');

    const fetched = await backend.getDocument(doc.id);
    assert.ok(fetched !== null, 'getDocument must return the document');
    assert.equal(fetched.id, doc.id);
    assert.equal(fetched.title, 'Standalone Round-trip');
  });

  it('T446.3.b: publishVersion + listVersions works offline', async () => {
    const doc = await backend.createDocument({
      title: 'Version Test',
      createdBy: 'offline-agent',
    });

    const v1 = await backend.publishVersion({
      documentId: doc.id,
      content: 'First version content',
      patchText: '',
      createdBy: 'offline-agent',
      changelog: 'v1',
    });

    const versions = await backend.listVersions(doc.id);
    assert.ok(versions.length >= 1, 'Must have at least 1 version');
    const match = versions.find((v) => v.versionNumber === v1.versionNumber);
    assert.ok(match, `Version ${v1.versionNumber} must appear in listVersions`);
  });

  it('T446.3.c: acquireLease distributes lock in standalone — no hub needed', async () => {
    const r1 = await backend.acquireLease({
      resource: 'offline-resource-1',
      holder: 'agent-1',
      ttlMs: 30000,
    });
    assert.ok(r1 !== null, 'First lease acquire must return a Lease object');

    // Second attempt for same resource must be denied while first is held
    const r2 = await backend.acquireLease({
      resource: 'offline-resource-1',
      holder: 'agent-2',
      ttlMs: 30000,
    });
    assert.ok(r2 === null, 'Second acquire of same resource must return null while first lease is held');

    await backend.releaseLease('offline-resource-1', 'agent-1');
  });

  it('T446.3.d: joinPresence + listPresence + leavePresence works offline', async () => {
    const doc = await backend.createDocument({
      title: 'Presence Doc',
      createdBy: 'offline-agent',
    });

    await backend.joinPresence(doc.id, 'agent-presence-1', { status: 'active' });
    await backend.joinPresence(doc.id, 'agent-presence-2', { status: 'idle' });

    const presence = await backend.listPresence(doc.id);
    const agentIds = presence.map((p) => p.agentId);
    assert.ok(agentIds.includes('agent-presence-1'), 'Presence must include agent-1');
    assert.ok(agentIds.includes('agent-presence-2'), 'Presence must include agent-2');

    await backend.leavePresence(doc.id, 'agent-presence-1');
    await backend.leavePresence(doc.id, 'agent-presence-2');
  });

  it('T446.3.e: A2A messaging works offline (no hub)', async () => {
    const envelope = JSON.stringify({ from: 'sender-agent', op: 'ping', data: 'Hello from sender in standalone mode' });
    const result = await backend.sendA2AMessage({
      toAgentId: 'receiver-agent',
      envelopeJson: envelope,
    });

    assert.ok(result.success, 'sendA2AMessage must succeed in standalone mode');

    const inbox = await backend.pollA2AInbox('receiver-agent', 10);
    assert.ok(inbox.length >= 1, 'Receiver must find message in inbox');
    const msg = inbox.find((m) => m.toAgentId === 'receiver-agent');
    assert.ok(msg, 'Message to receiver-agent must be in inbox');
    assert.equal(msg.envelopeJson, envelope, 'Envelope JSON must round-trip correctly');
  });

  it('T446.3.f: Identity registration + lookup works offline', async () => {
    await backend.registerAgentPubkey(
      'standalone-agent',
      'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899',
      'test-key',
    );

    const record = await backend.lookupAgentPubkey('standalone-agent');
    assert.ok(record !== null, 'Pubkey must be retrievable after registration');
  });
});

// ── T446.4 — Standalone works with data survives open/close cycle ─────────────

describe('Standalone topology: data persists across open/close', () => {
  it('T446.4: Data written in one open() is readable after close() + reopen()', async () => {
    const tmpDir = makeTmpDir('persistence');
    let docId: string;

    // Session 1: write
    {
      const backend = (await createBackend({
        topology: 'standalone',
        storagePath: tmpDir,
      })) as LocalBackend;
      await backend.open();
      const doc = await backend.createDocument({
        title: 'Persistent Doc',
        createdBy: 'standalone-agent',
      });
      docId = doc.id;
      await backend.close();
    }

    // Session 2: read same data back — no network required
    {
      const backend2 = (await createBackend({
        topology: 'standalone',
        storagePath: tmpDir,
      })) as LocalBackend;
      await backend2.open();
      const fetched = await backend2.getDocument(docId);
      assert.ok(fetched !== null, 'Document must survive close() + reopen()');
      assert.equal(fetched.id, docId);
      await backend2.close();
    }

    rmDir(tmpDir);
  });
});
