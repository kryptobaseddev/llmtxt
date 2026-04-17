/**
 * Unit tests for topology config schema and validation (T436 + T457).
 *
 * Covers:
 * - Valid standalone, hub-spoke, and mesh configs parse correctly.
 * - Missing hubUrl for hub-spoke → MISSING_HUB_URL error.
 * - Invalid topology mode → INVALID_TOPOLOGY_MODE error.
 * - Empty / missing peers for mesh (peers is optional per spec).
 * - mesh missing storagePath → MISSING_STORAGE_PATH_MESH error.
 * - Malformed / non-string hub-spoke hubUrl → validation error.
 * - hub-spoke persistLocally=true without storagePath → MISSING_STORAGE_PATH_PERSIST error.
 * - TypeScript discriminated union narrows type in each branch (compile-time assertion).
 *
 * Uses Node.js built-in test runner (same harness as backend-contract.test.ts).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateTopologyConfig,
  TopologyConfigError,
  standaloneConfigSchema,
  hubSpokeConfigSchema,
  meshConfigSchema,
  topologyConfigSchema,
} from '../topology.js';

import type {
  TopologyConfig,
  StandaloneConfig,
  HubSpokeConfig,
  MeshConfig,
  TopologyMode,
} from '../topology.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertTopologyError(
  fn: () => unknown,
  expectedCode: string,
  expectedMessage: string,
): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof TopologyConfigError, `Expected TopologyConfigError, got: ${String(caught)}`);
  const err = caught as TopologyConfigError;
  assert.equal(err.code, expectedCode);
  assert.equal(err.message, expectedMessage);
}

// ── Standalone ───────────────────────────────────────────────────────────────

describe('validateTopologyConfig — standalone', () => {
  it('parses minimal standalone config', () => {
    const config = validateTopologyConfig({ topology: 'standalone' });
    assert.equal(config.topology, 'standalone');
  });

  it('parses full standalone config', () => {
    const input = {
      topology: 'standalone',
      storagePath: '/tmp/agent.db',
      identityPath: '/tmp/identity.json',
      crsqlite: true,
      crsqliteExtPath: '/usr/lib/crsqlite.so',
    };
    const config = validateTopologyConfig(input);
    assert.equal(config.topology, 'standalone');

    // TypeScript discriminated union narrowing (compile-time check validated here at runtime)
    if (config.topology === 'standalone') {
      const c: StandaloneConfig = config;
      assert.equal(c.storagePath, '/tmp/agent.db');
      assert.equal(c.crsqlite, true);
      assert.equal(c.crsqliteExtPath, '/usr/lib/crsqlite.so');
    } else {
      assert.fail('expected standalone branch');
    }
  });

  it('standalone accepts no optional fields — defaults are applied downstream', () => {
    const config = validateTopologyConfig({ topology: 'standalone' }) as StandaloneConfig;
    assert.equal(config.storagePath, undefined);
    assert.equal(config.crsqlite, undefined);
  });
});

// ── Hub-spoke ────────────────────────────────────────────────────────────────

describe('validateTopologyConfig — hub-spoke', () => {
  it('parses minimal hub-spoke config with hubUrl', () => {
    const config = validateTopologyConfig({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
    });
    assert.equal(config.topology, 'hub-spoke');

    if (config.topology === 'hub-spoke') {
      const c: HubSpokeConfig = config;
      assert.equal(c.hubUrl, 'https://api.llmtxt.my');
    } else {
      assert.fail('expected hub-spoke branch');
    }
  });

  it('parses full hub-spoke config (ephemeral worker)', () => {
    const input = {
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
      apiKey: 'secret-key',
      persistLocally: false,
    };
    const config = validateTopologyConfig(input) as HubSpokeConfig;
    assert.equal(config.hubUrl, 'https://api.llmtxt.my');
    assert.equal(config.apiKey, 'secret-key');
    assert.equal(config.persistLocally, false);
  });

  it('parses hub-spoke with persistLocally=true and storagePath', () => {
    const input = {
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
      persistLocally: true,
      storagePath: '/var/agent/local.db',
    };
    const config = validateTopologyConfig(input) as HubSpokeConfig;
    assert.equal(config.persistLocally, true);
    assert.equal(config.storagePath, '/var/agent/local.db');
  });

  it('throws MISSING_HUB_URL when hubUrl is absent', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: 'hub-spoke' }),
      'MISSING_HUB_URL',
      'hub-spoke topology requires hubUrl',
    );
  });

  it('throws MISSING_HUB_URL when hubUrl is null', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: 'hub-spoke', hubUrl: null }),
      'MISSING_HUB_URL',
      'hub-spoke topology requires hubUrl',
    );
  });

  it('throws MISSING_HUB_URL when hubUrl is empty string', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: 'hub-spoke', hubUrl: '' }),
      'MISSING_HUB_URL',
      'hub-spoke topology requires hubUrl',
    );
  });

  it('throws MISSING_STORAGE_PATH_PERSIST when persistLocally=true and storagePath absent', () => {
    assertTopologyError(
      () =>
        validateTopologyConfig({
          topology: 'hub-spoke',
          hubUrl: 'https://api.llmtxt.my',
          persistLocally: true,
        }),
      'MISSING_STORAGE_PATH_PERSIST',
      'hub-spoke with persistLocally=true requires storagePath',
    );
  });

  it('TopologyConfigError has field property set for MISSING_HUB_URL', () => {
    let err: TopologyConfigError | null = null;
    try {
      validateTopologyConfig({ topology: 'hub-spoke' });
    } catch (e) {
      if (e instanceof TopologyConfigError) err = e;
    }
    assert.ok(err !== null);
    assert.equal(err!.field, 'hubUrl');
  });

  it('TopologyConfigError has field property set for MISSING_STORAGE_PATH_PERSIST', () => {
    let err: TopologyConfigError | null = null;
    try {
      validateTopologyConfig({
        topology: 'hub-spoke',
        hubUrl: 'https://api.llmtxt.my',
        persistLocally: true,
      });
    } catch (e) {
      if (e instanceof TopologyConfigError) err = e;
    }
    assert.ok(err !== null);
    assert.equal(err!.field, 'storagePath');
  });
});

// ── Mesh ─────────────────────────────────────────────────────────────────────

describe('validateTopologyConfig — mesh', () => {
  it('parses minimal mesh config with storagePath', () => {
    const config = validateTopologyConfig({
      topology: 'mesh',
      storagePath: '/var/agent/mesh.db',
    });
    assert.equal(config.topology, 'mesh');

    if (config.topology === 'mesh') {
      const c: MeshConfig = config;
      assert.equal(c.storagePath, '/var/agent/mesh.db');
    } else {
      assert.fail('expected mesh branch');
    }
  });

  it('parses mesh config with all optional fields', () => {
    const input = {
      topology: 'mesh',
      storagePath: '/var/agent/mesh.db',
      identityPath: '/var/agent/identity.json',
      peers: ['unix:/tmp/agent-b.sock', 'http://localhost:7643'],
      meshDir: '/tmp/llmtxt-mesh',
      transport: 'unix' as const,
      port: 7642,
    };
    const config = validateTopologyConfig(input) as MeshConfig;
    assert.deepEqual(config.peers, ['unix:/tmp/agent-b.sock', 'http://localhost:7643']);
    assert.equal(config.transport, 'unix');
    assert.equal(config.port, 7642);
  });

  it('peers field is optional — empty peers list is valid', () => {
    const config = validateTopologyConfig({
      topology: 'mesh',
      storagePath: '/var/agent/mesh.db',
      peers: [],
    }) as MeshConfig;
    assert.deepEqual(config.peers, []);
  });

  it('throws MISSING_STORAGE_PATH_MESH when storagePath is absent', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: 'mesh' }),
      'MISSING_STORAGE_PATH_MESH',
      'mesh topology requires storagePath (cr-sqlite)',
    );
  });

  it('throws MISSING_STORAGE_PATH_MESH when storagePath is empty string', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: 'mesh', storagePath: '' }),
      'MISSING_STORAGE_PATH_MESH',
      'mesh topology requires storagePath (cr-sqlite)',
    );
  });

  it('TopologyConfigError has field property set for MISSING_STORAGE_PATH_MESH', () => {
    let err: TopologyConfigError | null = null;
    try {
      validateTopologyConfig({ topology: 'mesh' });
    } catch (e) {
      if (e instanceof TopologyConfigError) err = e;
    }
    assert.ok(err !== null);
    assert.equal(err!.field, 'storagePath');
  });
});

// ── Invalid topology mode ─────────────────────────────────────────────────────

describe('validateTopologyConfig — unknown topology mode', () => {
  it('throws INVALID_TOPOLOGY_MODE for unknown string value', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: 'peer-to-peer' }),
      'INVALID_TOPOLOGY_MODE',
      'unknown topology: peer-to-peer',
    );
  });

  it('throws INVALID_TOPOLOGY_MODE for numeric topology value', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: 42 }),
      'INVALID_TOPOLOGY_MODE',
      'unknown topology: 42',
    );
  });

  it('throws INVALID_TOPOLOGY_MODE for empty string topology', () => {
    assertTopologyError(
      () => validateTopologyConfig({ topology: '' }),
      'INVALID_TOPOLOGY_MODE',
      'unknown topology: ',
    );
  });

  it('error name is TopologyConfigError', () => {
    let err: Error | null = null;
    try {
      validateTopologyConfig({ topology: 'bad' });
    } catch (e) {
      if (e instanceof Error) err = e;
    }
    assert.ok(err !== null);
    assert.equal(err!.name, 'TopologyConfigError');
  });
});

// ── TopologyConfigError class ─────────────────────────────────────────────────

describe('TopologyConfigError', () => {
  it('is instanceof Error', () => {
    const err = new TopologyConfigError('test message', 'TEST_CODE');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof TopologyConfigError);
  });

  it('exposes code property', () => {
    const err = new TopologyConfigError('test message', 'MY_CODE');
    assert.equal(err.code, 'MY_CODE');
  });

  it('exposes optional field property when provided', () => {
    const err = new TopologyConfigError('test message', 'MY_CODE', 'myField');
    assert.equal(err.field, 'myField');
  });

  it('field is undefined when not provided', () => {
    const err = new TopologyConfigError('test message', 'MY_CODE');
    assert.equal(err.field, undefined);
  });
});

// ── Zod schema direct tests ───────────────────────────────────────────────────

describe('Zod schemas — direct parse', () => {
  it('standaloneConfigSchema parses standalone config', () => {
    const result = standaloneConfigSchema.safeParse({ topology: 'standalone' });
    assert.ok(result.success);
  });

  it('hubSpokeConfigSchema rejects missing hubUrl', () => {
    const result = hubSpokeConfigSchema.safeParse({ topology: 'hub-spoke' });
    assert.ok(!result.success);
  });

  it('hubSpokeConfigSchema accepts valid config', () => {
    const result = hubSpokeConfigSchema.safeParse({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
    });
    assert.ok(result.success);
  });

  it('meshConfigSchema rejects missing storagePath', () => {
    const result = meshConfigSchema.safeParse({ topology: 'mesh' });
    assert.ok(!result.success);
  });

  it('meshConfigSchema accepts valid config', () => {
    const result = meshConfigSchema.safeParse({
      topology: 'mesh',
      storagePath: '/tmp/mesh.db',
    });
    assert.ok(result.success);
  });

  it('topologyConfigSchema discriminates on topology field', () => {
    const standalone = topologyConfigSchema.safeParse({ topology: 'standalone' });
    assert.ok(standalone.success);
    assert.equal(standalone.data?.topology, 'standalone');

    const hubSpoke = topologyConfigSchema.safeParse({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
    });
    assert.ok(hubSpoke.success);
    assert.equal(hubSpoke.data?.topology, 'hub-spoke');

    const mesh = topologyConfigSchema.safeParse({
      topology: 'mesh',
      storagePath: '/tmp/mesh.db',
    });
    assert.ok(mesh.success);
    assert.equal(mesh.data?.topology, 'mesh');
  });

  it('topologyConfigSchema rejects unknown topology discriminant', () => {
    const result = topologyConfigSchema.safeParse({ topology: 'unknown' });
    assert.ok(!result.success);
  });
});

// ── TypeScript discriminated union narrowing (runtime verification) ───────────

describe('discriminated union — TypeScript type narrowing at runtime', () => {
  it('correctly narrows to StandaloneConfig in standalone branch', () => {
    const config: TopologyConfig = validateTopologyConfig({ topology: 'standalone' });
    if (config.topology === 'standalone') {
      // TypeScript knows this is StandaloneConfig here
      const _typed: StandaloneConfig = config;
      assert.equal(_typed.topology, 'standalone');
    } else {
      assert.fail('Should have been standalone');
    }
  });

  it('correctly narrows to HubSpokeConfig in hub-spoke branch', () => {
    const config: TopologyConfig = validateTopologyConfig({
      topology: 'hub-spoke',
      hubUrl: 'https://api.llmtxt.my',
    });
    if (config.topology === 'hub-spoke') {
      const _typed: HubSpokeConfig = config;
      assert.equal(_typed.hubUrl, 'https://api.llmtxt.my');
    } else {
      assert.fail('Should have been hub-spoke');
    }
  });

  it('correctly narrows to MeshConfig in mesh branch', () => {
    const config: TopologyConfig = validateTopologyConfig({
      topology: 'mesh',
      storagePath: '/tmp/mesh.db',
    });
    if (config.topology === 'mesh') {
      const _typed: MeshConfig = config;
      assert.equal(_typed.storagePath, '/tmp/mesh.db');
    } else {
      assert.fail('Should have been mesh');
    }
  });

  it('TopologyMode type covers all three values', () => {
    const modes: TopologyMode[] = ['standalone', 'hub-spoke', 'mesh'];
    assert.equal(modes.length, 3);
  });
});
