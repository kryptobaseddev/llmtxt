/**
 * Tests for createBackend factory (T439).
 *
 * Covers:
 * - standalone config returns LocalBackend instance
 * - hub-spoke ephemeral config returns RemoteBackend instance
 * - hub-spoke persistent config returns HubSpokeBackend instance
 * - mesh config returns MeshBackend instance
 * - MeshBackend delegates all Backend interface methods to its internal LocalBackend
 * - Invalid config (missing hubUrl) throws TopologyConfigError before construction
 * - Invalid config (unknown topology) throws TopologyConfigError
 * - hub-spoke persistLocally=true without storagePath throws TopologyConfigError
 * - mesh without storagePath throws TopologyConfigError
 *
 * Uses the same Node.js built-in test runner as the rest of the package.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { LocalBackend } from '../local/index.js';
import { RemoteBackend } from '../remote/index.js';

import {
  createBackend,
  HubSpokeBackend,
  MeshBackend,
  MeshNotImplementedError,
  TopologyConfigError,
} from '../backend/factory.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Make a unique temp dir for each test that needs a real .db file. */
function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `llmtxt-factory-${prefix}-`));
}

/** Expect a promise to reject with a specific error type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertRejects<E extends Error>(
  fn: () => Promise<unknown>,
  ErrorClass: abstract new (...args: any[]) => E,
  messagePattern?: string,
): Promise<E> {
  let caught: unknown;
  try {
    await fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof ErrorClass,
    `Expected ${ErrorClass.name} to be thrown, got: ${String(caught)}`,
  );
  const err = caught as E;
  if (messagePattern !== undefined) {
    assert.match(err.message, new RegExp(messagePattern));
  }
  return err;
}

// ── standalone ────────────────────────────────────────────────────────────────

describe('createBackend — standalone', () => {
  it('returns a LocalBackend instance for minimal standalone config', async () => {
    const tmpDir = makeTmpDir('standalone');
    const backend = await createBackend({ topology: 'standalone', storagePath: tmpDir });
    assert.ok(
      backend instanceof LocalBackend,
      `Expected LocalBackend, got: ${backend.constructor.name}`,
    );
    // Clean up (don't open, just verify type)
  });

  it('passes storagePath through to LocalBackend config', async () => {
    const tmpDir = makeTmpDir('standalone-cfg');
    const backend = await createBackend({ topology: 'standalone', storagePath: tmpDir });
    assert.ok(backend instanceof LocalBackend);
    assert.equal((backend as LocalBackend).config.storagePath, tmpDir);
  });

  it('accepts standalone config with no optional fields', async () => {
    // storagePath defaults to .llmtxt — just verify it constructs without error
    const backend = await createBackend({ topology: 'standalone' });
    assert.ok(backend instanceof LocalBackend);
  });

  it('standalone LocalBackend is functional: open + createDocument + close', async () => {
    const tmpDir = makeTmpDir('standalone-func');
    const backend = await createBackend({ topology: 'standalone', storagePath: tmpDir });
    assert.ok(backend instanceof LocalBackend);
    await backend.open();
    const doc = await backend.createDocument({ title: 'Test Doc', createdBy: 'agent-factory-test' });
    assert.equal(doc.title, 'Test Doc');
    assert.ok(typeof doc.id === 'string' && doc.id.length > 0);
    await backend.close();
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── hub-spoke ephemeral ───────────────────────────────────────────────────────

describe('createBackend — hub-spoke ephemeral', () => {
  it('returns a RemoteBackend instance for minimal hub-spoke config', async () => {
    const backend = await createBackend({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
    });
    assert.ok(
      backend instanceof RemoteBackend,
      `Expected RemoteBackend, got: ${backend.constructor.name}`,
    );
  });

  it('passes hubUrl to RemoteBackend as baseUrl', async () => {
    const backend = await createBackend({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
      apiKey: 'test-key',
    });
    assert.ok(backend instanceof RemoteBackend);
    assert.equal((backend as RemoteBackend).config.baseUrl, 'https://api.llmtxt.my');
    assert.equal((backend as RemoteBackend).config.apiKey, 'test-key');
  });

  it('returns RemoteBackend (not HubSpokeBackend) when persistLocally is false', async () => {
    const backend = await createBackend({
      topology: 'hub-spoke',
      hubUrl: 'https://hub.example.com',
      persistLocally: false,
    });
    assert.ok(backend instanceof RemoteBackend);
    assert.ok(!(backend instanceof HubSpokeBackend));
  });
});

// ── hub-spoke persistent ─────────────────────────────────────────────────────

describe('createBackend — hub-spoke persistent', () => {
  it('returns a HubSpokeBackend instance when persistLocally=true', async () => {
    const tmpDir = makeTmpDir('persistent');
    const backend = await createBackend({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
      persistLocally: true,
      storagePath: tmpDir,
    });
    assert.ok(
      backend instanceof HubSpokeBackend,
      `Expected HubSpokeBackend, got: ${backend.constructor.name}`,
    );
  });

  it('HubSpokeBackend config reflects both local and remote settings', async () => {
    const tmpDir = makeTmpDir('persistent-cfg');
    const backend = await createBackend({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
      apiKey: 'spoke-key',
      persistLocally: true,
      storagePath: tmpDir,
    });
    assert.ok(backend instanceof HubSpokeBackend);
    // config should have both storagePath and baseUrl
    const cfg = (backend as HubSpokeBackend).config;
    assert.equal(cfg.storagePath, tmpDir);
    assert.equal(cfg.baseUrl, 'https://api.llmtxt.my');
    assert.equal(cfg.apiKey, 'spoke-key');
  });
});

// ── mesh ─────────────────────────────────────────────────────────────────────

describe('createBackend — mesh', () => {
  it('returns a MeshBackend instance', async () => {
    const tmpDir = makeTmpDir('mesh');
    const backend = await createBackend({
      topology: 'mesh',
      storagePath: tmpDir,
    });
    assert.ok(
      backend instanceof MeshBackend,
      `Expected MeshBackend, got: ${backend.constructor.name}`,
    );
  });

  it('MeshBackend.open() succeeds (emits warning but does not throw)', async () => {
    const tmpDir = makeTmpDir('mesh-open');
    const backend = await createBackend({ topology: 'mesh', storagePath: tmpDir });
    assert.ok(backend instanceof MeshBackend);

    // Capture the mesh:sync-engine-not-started warning using a Promise that
    // resolves when the first matching warning fires. The warning is emitted
    // asynchronously by process.emitWarning, so we race it against a timeout.
    let warningReceived = false;
    const warningPromise = new Promise<void>((resolve) => {
      const handler = (w: NodeJS.ErrnoException) => {
        if (w.code === 'mesh:sync-engine-not-started') {
          warningReceived = true;
          process.removeListener('warning', handler);
          resolve();
        }
      };
      process.on('warning', handler);
    });
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for mesh:sync-engine-not-started warning')), 2000),
    );

    try {
      await backend.open();
      // Race: warning must arrive within 2s of open()
      await Promise.race([warningPromise, timeoutPromise]);
      assert.ok(warningReceived, 'Expected mesh:sync-engine-not-started warning to fire');
      await backend.close();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('MeshBackend delegates standard Backend ops to LocalBackend (createDocument smoke test)', async () => {
    const tmpDir = makeTmpDir('mesh-delegate');
    const backend = await createBackend({ topology: 'mesh', storagePath: tmpDir });
    assert.ok(backend instanceof MeshBackend);

    // Suppress the expected warning
    process.on('warning', () => {});
    await backend.open();
    const doc = await backend.createDocument({ title: 'Mesh Doc', createdBy: 'mesh-agent' });
    assert.equal(doc.title, 'Mesh Doc');
    await backend.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── MeshNotImplementedError ──────────────────────────────────────────────────

describe('MeshNotImplementedError', () => {
  it('is instanceof Error', () => {
    const err = new MeshNotImplementedError('syncPeers');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof MeshNotImplementedError);
  });

  it('has code MESH_NOT_IMPLEMENTED', () => {
    const err = new MeshNotImplementedError('testMethod');
    assert.equal(err.code, 'MESH_NOT_IMPLEMENTED');
  });

  it('message includes the method name', () => {
    const err = new MeshNotImplementedError('exchangeChangesets');
    assert.match(err.message, /exchangeChangesets/);
  });

  it('message references T386', () => {
    const err = new MeshNotImplementedError('anyMethod');
    assert.match(err.message, /T386/);
  });

  it('name is MeshNotImplementedError', () => {
    const err = new MeshNotImplementedError('foo');
    assert.equal(err.name, 'MeshNotImplementedError');
  });
});

// ── TopologyConfigError validation before construction ───────────────────────

describe('createBackend — validation errors (TopologyConfigError)', () => {
  it('throws TopologyConfigError for hub-spoke without hubUrl', async () => {
    const err = await assertRejects(
      () => createBackend({ topology: 'hub-spoke' } as never),
      TopologyConfigError,
    );
    assert.equal(err.code, 'MISSING_HUB_URL');
    assert.equal(err.message, 'hub-spoke topology requires hubUrl');
  });

  it('throws TopologyConfigError for hub-spoke persistLocally=true without storagePath', async () => {
    const err = await assertRejects(
      () =>
        createBackend({
          topology: 'hub-spoke',
          hubUrl: 'https://api.llmtxt.my',
          persistLocally: true,
        } as never),
      TopologyConfigError,
    );
    assert.equal(err.code, 'MISSING_STORAGE_PATH_PERSIST');
    assert.equal(err.message, 'hub-spoke with persistLocally=true requires storagePath');
  });

  it('throws TopologyConfigError for mesh without storagePath', async () => {
    const err = await assertRejects(
      () => createBackend({ topology: 'mesh' } as never),
      TopologyConfigError,
    );
    assert.equal(err.code, 'MISSING_STORAGE_PATH_MESH');
    assert.equal(err.message, 'mesh topology requires storagePath (cr-sqlite)');
  });

  it('throws TopologyConfigError for unknown topology value', async () => {
    const err = await assertRejects(
      () => createBackend({ topology: 'peer-to-peer' } as never),
      TopologyConfigError,
    );
    assert.equal(err.code, 'INVALID_TOPOLOGY_MODE');
    assert.match(err.message, /unknown topology/);
  });

  it('validation fires before any backend is constructed (no side effects)', async () => {
    // Verify that TopologyConfigError is thrown synchronously-wrapped, not after
    // any backend construction begins
    let threw = false;
    try {
      await createBackend({ topology: 'hub-spoke' } as never);
    } catch (e) {
      threw = true;
      assert.ok(e instanceof TopologyConfigError);
    }
    assert.ok(threw, 'Expected TopologyConfigError to be thrown');
  });
});
