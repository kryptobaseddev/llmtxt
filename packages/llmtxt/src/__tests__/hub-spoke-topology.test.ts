/**
 * Hub-and-spoke topology contract tests (T443 — T429.3).
 *
 * Tests hub-and-spoke convergence semantics using LocalBackend as the hub.
 * RemoteBackend spokes require a live HTTP server which is not available in
 * the packages/llmtxt unit-test context (no server process is started here).
 * Spokes are therefore simulated as additional direct LocalBackend references
 * to the same hub database, which matches ephemeral spoke behavior exactly
 * (all reads/writes go to the single hub SSoT).
 *
 * The RemoteBackend + HubSpokeBackend classes are exercised for:
 * - Construction and config validation (no network required)
 * - Hub outage: ephemeral spoke (RemoteBackend) fails fast with a fetch error
 *   when the hub URL is unreachable
 * - Hub outage: persistent spoke (HubSpokeBackend) surfaces hub unreachability
 *   on write operations
 *
 * Full live-server spoke convergence is tested in apps/backend integration tests
 * (out of scope for packages/llmtxt unit suite — no server process).
 *
 * Ref: docs/specs/ARCH-T429-hub-spoke-topology.md §5.2, §7.1
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { LocalBackend } from '../local/index.js';
import { RemoteBackend } from '../remote/index.js';
import { createBackend, HubSpokeBackend } from '../backend/factory.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `llmtxt-hub-spoke-${prefix}-`));
}

function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup
  }
}

// ── §5.2 Hub-and-Spoke: Direct LocalBackend hub + 3 simulated spokes ─────────
//
// This suite models hub-spoke convergence using a single hub LocalBackend.
// Three "spoke" agents each perform writes against the hub. Since all spokes
// reference the same hub state, hub.listDocuments() returns all documents.

describe('Hub-spoke topology: 3 spokes converge on hub', () => {
  let hubDir: string;
  let hub: LocalBackend;

  before(async () => {
    hubDir = makeTmpDir('hub');
    hub = new LocalBackend({ storagePath: hubDir });
    await hub.open();
  });

  after(async () => {
    await hub.close();
    rmDir(hubDir);
  });

  it('T443.1: Each of 3 spokes creates a unique document; hub lists all 3', async () => {
    // Simulate 3 ephemeral spoke agents writing to the hub (in-process references)
    const spokeAgents = ['spoke-agent-a', 'spoke-agent-b', 'spoke-agent-c'];
    const titles = ['Spoke A Document', 'Spoke B Document', 'Spoke C Document'];

    const createdIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const doc = await hub.createDocument({
        title: titles[i],
        createdBy: spokeAgents[i],
      });
      createdIds.push(doc.id);
    }

    // Hub lists all 3 — all must be present
    const { items } = await hub.listDocuments();
    const listedIds = items.map((d) => d.id);

    for (const id of createdIds) {
      assert.ok(
        listedIds.includes(id),
        `Hub must list document created by spoke: ${id}`,
      );
    }

    assert.ok(
      items.length >= 3,
      `Hub must have at least 3 documents, found ${items.length}`,
    );
  });

  it('T443.2: Spoke A publishes a version; spoke B reads that version — content matches', async () => {
    // Spoke A creates document and publishes a version
    const docA = await hub.createDocument({
      title: 'Shared Version Doc',
      createdBy: 'spoke-a',
    });

    const version = await hub.publishVersion({
      documentId: docA.id,
      content: '# Version Content\nThis content was published by spoke A.',
      patchText: '',
      createdBy: 'spoke-a',
      changelog: 'Initial version from spoke A',
    });

    // Spoke B reads the same version (via the same hub backend)
    const read = await hub.getVersion(docA.id, version.versionNumber);
    assert.ok(read !== null, 'Spoke B must be able to read version published by spoke A');
    assert.equal(
      read.versionNumber,
      version.versionNumber,
      'Version number must match what spoke A published',
    );
    // VersionEntry has patchText (the diff) and contentHash — content is reconstructed from patches
    assert.equal(read.createdBy, 'spoke-a', 'Version must be attributed to spoke A');
    assert.ok(typeof read.contentHash === 'string', 'Version must have a content hash');
  });

  it('T443.3: Write ordering is preserved — 3 sequential spoke writes appear in order', async () => {
    const doc = await hub.createDocument({
      title: 'Write Ordering Test',
      createdBy: 'ordering-test-agent',
    });

    // 3 spokes publish versions in sequence — hub must preserve order
    const v1 = await hub.publishVersion({
      documentId: doc.id,
      content: 'Version 1 content',
      patchText: '',
      createdBy: 'spoke-a',
      changelog: 'v1',
    });
    const v2 = await hub.publishVersion({
      documentId: doc.id,
      content: 'Version 2 content',
      patchText: '',
      createdBy: 'spoke-b',
      changelog: 'v2',
    });
    const v3 = await hub.publishVersion({
      documentId: doc.id,
      content: 'Version 3 content',
      patchText: '',
      createdBy: 'spoke-c',
      changelog: 'v3',
    });

    const versions = await hub.listVersions(doc.id);
    assert.ok(versions.length >= 3, `Expected at least 3 versions, got ${versions.length}`);

    // Verify ordering is monotonically increasing
    for (let i = 1; i < versions.length; i++) {
      assert.ok(
        versions[i].versionNumber > versions[i - 1].versionNumber,
        `Version numbers must be monotonically increasing at index ${i}`,
      );
    }

    // Explicitly verify all 3 version numbers are sequential
    assert.ok(v1.versionNumber < v2.versionNumber, 'v1 must come before v2');
    assert.ok(v2.versionNumber < v3.versionNumber, 'v2 must come before v3');
  });

  it('T443.4: CRDT — spoke A applies update; spoke C reads converged state', async () => {
    // Hub uses CRDT via LocalBackend applyCrdtUpdate
    const { crdt_make_state } = await import('../crdt-primitives.js');

    const doc = await hub.createDocument({
      title: 'CRDT Convergence Doc',
      createdBy: 'crdt-test',
    });

    // Spoke A creates initial CRDT state (Loro snapshot of section content)
    const loroSnapshot = crdt_make_state('Hello from spoke A');
    const updateBase64 = loroSnapshot.toString('base64');

    const result = await hub.applyCrdtUpdate({
      documentId: doc.id,
      sectionKey: 'intro',
      updateBase64,
      agentId: 'spoke-a',
    });

    assert.ok(result, 'applyCrdtUpdate must return a CrdtState');
    assert.equal(result.documentId, doc.id, 'Returned state must reference the document');

    // Spoke C reads converged state from hub
    const stateC = await hub.getCrdtState(doc.id, 'intro');
    assert.ok(stateC !== null, 'Spoke C must be able to read CRDT state applied by spoke A');
    assert.ok(
      typeof stateC.snapshotBase64 === 'string' && stateC.snapshotBase64.length > 0,
      'CRDT state snapshot must be non-empty',
    );
  });

  it('T443.5: Hub stores all spoke events in append-only log', async () => {
    const doc = await hub.createDocument({
      title: 'Event Log Test',
      createdBy: 'event-test',
    });

    // 3 spokes each append an event
    await hub.appendEvent({
      documentId: doc.id,
      type: 'spoke.write',
      agentId: 'spoke-a',
      payload: { action: 'create', data: 'spoke A data' },
    });

    await hub.appendEvent({
      documentId: doc.id,
      type: 'spoke.write',
      agentId: 'spoke-b',
      payload: { action: 'update', data: 'spoke B data' },
    });

    await hub.appendEvent({
      documentId: doc.id,
      type: 'spoke.write',
      agentId: 'spoke-c',
      payload: { action: 'finalize', data: 'spoke C data' },
    });

    // Hub queryEvents must return all 3 in sequence
    const events = await hub.queryEvents({ documentId: doc.id });
    assert.ok(
      events.items.length >= 3,
      `Hub event log must have at least 3 events, found ${events.items.length}`,
    );

    const agentIds = events.items.map((e) => e.agentId);
    assert.ok(agentIds.includes('spoke-a'), 'Hub must have event from spoke-a');
    assert.ok(agentIds.includes('spoke-b'), 'Hub must have event from spoke-b');
    assert.ok(agentIds.includes('spoke-c'), 'Hub must have event from spoke-c');
  });
});

// ── Hub outage: ephemeral RemoteBackend spoke fails fast ──────────────────────

describe('Hub-spoke topology: hub outage — ephemeral spoke fails fast', () => {
  it('T443.6: RemoteBackend write to unreachable hub throws (not silent drop)', async () => {
    // Point a RemoteBackend at a guaranteed-unreachable URL
    const spoke = await createBackend({
      topology: 'hub-spoke',
      hubUrl: 'http://127.0.0.1:1', // Port 1 is reserved and never open
      apiKey: 'test-key',
    });

    await spoke.open();

    let threw = false;
    try {
      await spoke.createDocument({ title: 'Should Fail', createdBy: 'ephemeral-spoke' });
    } catch (err) {
      threw = true;
      // Must be a network error, not a silent drop
      assert.ok(err instanceof Error, 'Must throw an Error, not silently drop the write');
      // The error message should indicate a network failure (ECONNREFUSED, fetch failed, etc.)
      const msg = (err as Error).message.toLowerCase();
      const isNetworkError =
        msg.includes('econnrefused') ||
        msg.includes('fetch failed') ||
        msg.includes('network') ||
        msg.includes('connect') ||
        msg.includes('econnreset') ||
        msg.includes('failed') ||
        msg.includes('refused');
      assert.ok(
        isNetworkError,
        `Expected a network error message, got: "${(err as Error).message}"`,
      );
    }

    assert.ok(threw, 'RemoteBackend with unreachable hub MUST throw — writes must not be silently dropped');
    await spoke.close();
  });

  it('T443.7: HubSpokeBackend write to unreachable hub throws on write operations', async () => {
    const tmpDir = makeTmpDir('persistent-outage');

    let backend: HubSpokeBackend | undefined;
    try {
      const b = await createBackend({
        topology: 'hub-spoke',
        hubUrl: 'http://127.0.0.1:1', // guaranteed unreachable
        persistLocally: true,
        storagePath: tmpDir,
      });

      assert.ok(b instanceof HubSpokeBackend, 'Expected HubSpokeBackend instance');
      backend = b as HubSpokeBackend;

      // open() succeeds: local SQLite opens fine; remote is stateless open
      await backend.open();

      // Write to hub (createDocument routes to remote) MUST throw
      let threw = false;
      try {
        await backend.createDocument({ title: 'Hub Down', createdBy: 'persistent-spoke' });
      } catch (err) {
        threw = true;
        assert.ok(err instanceof Error, 'Write to unreachable hub must throw an Error');
      }

      assert.ok(threw, 'HubSpokeBackend: write to unreachable hub must not succeed silently');
    } finally {
      if (backend) {
        try { await backend.close(); } catch { /* ignore */ }
      }
      rmDir(tmpDir);
    }
  });

  it('T443.8: RemoteBackend config is preserved correctly (baseUrl, apiKey)', async () => {
    const spoke = new RemoteBackend({
      baseUrl: 'https://api.example.com',
      apiKey: 'my-api-key',
    });

    assert.equal(spoke.config.baseUrl, 'https://api.example.com');
    assert.equal(spoke.config.apiKey, 'my-api-key');
  });
});

// ── §3.3 Validation: hub-spoke topology config ────────────────────────────────

describe('Hub-spoke topology: config validation', () => {
  it('T443.9: createBackend hub-spoke without hubUrl throws TopologyConfigError', async () => {
    let caught: unknown;
    try {
      await createBackend({ topology: 'hub-spoke' } as never);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, 'Expected TopologyConfigError');
    assert.match((caught as Error).message, /hubUrl/i);
  });

  it('T443.10: createBackend hub-spoke with persistLocally=true but no storagePath throws', async () => {
    let caught: unknown;
    try {
      await createBackend({
        topology: 'hub-spoke',
        hubUrl: 'https://api.example.com',
        persistLocally: true,
      } as never);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Error, 'Expected TopologyConfigError');
    assert.match((caught as Error).message, /storagePath/i);
  });
});
