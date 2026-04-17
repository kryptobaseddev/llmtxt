/**
 * T414: P3.2 Peer Discovery tests
 *
 * Tests:
 * 1. register() writes a .peer file to the mesh directory
 * 2. discover() returns validated peers from .peer files
 * 3. discover() rejects peer files missing pubkey (unsigned advertisement rejection)
 * 4. discover() rejects peer files with pubkey inconsistent with agentId
 * 5. loadStaticConfig() reads and validates a static peer list JSON file
 *
 * Runner: node:test (native, no vitest dependency)
 * Spec: docs/specs/P3-p2p-mesh.md §3
 */

import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, before, after } from 'node:test';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';

ed.hashes.sha512 = sha512;

import {
  PeerRegistry,
  type PeerRegistration,
} from '../mesh/discovery.js';

// ── Test helpers ──────────────────────────────────────────────────

/**
 * Generate a test Ed25519 keypair and return agentId + base64 pubkey.
 * agentId = SHA-256(pubkey bytes) hex — matching the spec §2.2.
 */
async function makeTestPeer(): Promise<{
  agentId: string;
  pubkeyB64: string;
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const sk = ed.utils.randomSecretKey();
  const pk = await ed.getPublicKeyAsync(sk);
  const agentId = crypto.createHash('sha256').update(pk).digest('hex');
  const pubkeyB64 = Buffer.from(pk).toString('base64');
  return { agentId, pubkeyB64, privateKey: sk, publicKey: pk };
}

function makePeerRegistration(
  agentId: string,
  pubkeyB64: string,
  overrides: Partial<PeerRegistration> = {}
): PeerRegistration {
  return {
    agentId,
    transport: `unix:/tmp/llmtxt-${agentId.slice(0, 8)}.sock`,
    pubkey: pubkeyB64,
    capabilities: ['sync', 'presence'],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('PeerRegistry — P3.2 peer discovery', () => {
  let tmpDir: string;
  let localPeer: Awaited<ReturnType<typeof makeTestPeer>>;
  let remotePeer: Awaited<ReturnType<typeof makeTestPeer>>;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llmtxt-discovery-'));
    localPeer = await makeTestPeer();
    remotePeer = await makeTestPeer();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Test 1: register() writes a .peer file ────────────────────

  it('register() writes a .peer JSON file to meshDir', async () => {
    const registry = new PeerRegistry({
      agentId: localPeer.agentId,
      pubkeyB64: localPeer.pubkeyB64,
      meshDir: tmpDir,
    });

    const registration = makePeerRegistration(localPeer.agentId, localPeer.pubkeyB64);
    await registry.register(registration);

    const expectedFile = path.join(tmpDir, `${localPeer.agentId}.peer`);
    const raw = await fs.readFile(expectedFile, 'utf-8');
    const parsed = JSON.parse(raw) as PeerRegistration;

    assert.equal(parsed.agentId, localPeer.agentId);
    assert.equal(parsed.pubkey, localPeer.pubkeyB64);
    assert.deepEqual(parsed.capabilities, ['sync', 'presence']);
  });

  // ── Test 2: discover() returns validated peers ────────────────

  it('discover() reads .peer files and returns validated PeerInfo[]', async () => {
    const registry = new PeerRegistry({
      agentId: localPeer.agentId,
      pubkeyB64: localPeer.pubkeyB64,
      meshDir: tmpDir,
    });

    // Write a valid peer file for the remote peer.
    const remoteReg = makePeerRegistration(remotePeer.agentId, remotePeer.pubkeyB64);
    const remotePeerFile = path.join(tmpDir, `${remotePeer.agentId}.peer`);
    await fs.writeFile(remotePeerFile, JSON.stringify(remoteReg), 'utf-8');

    const peers = await registry.discover();

    // Should find the remote peer but NOT itself.
    const found = peers.find((p) => p.agentId === remotePeer.agentId);
    assert.ok(found, 'remote peer should be discoverable');
    assert.equal(found.transport, remoteReg.transport);
    assert.equal(found.active, true, 'fresh peer should be active');

    // Own peer should never appear.
    const self = peers.find((p) => p.agentId === localPeer.agentId);
    assert.equal(self, undefined, 'own peer file must be excluded from discover()');
  });

  // ── Test 3: reject peer files missing pubkey ──────────────────

  it('discover() rejects unsigned peer advertisements (missing pubkey)', async () => {
    const registry = new PeerRegistry({
      agentId: localPeer.agentId,
      pubkeyB64: localPeer.pubkeyB64,
      meshDir: tmpDir,
    });

    // Create a fake agentId without a real keypair.
    const fakeAgentId = crypto.randomBytes(32).toString('hex');

    // Write a peer file with missing pubkey.
    const maliciousReg = {
      agentId: fakeAgentId,
      transport: 'unix:/tmp/evil.sock',
      // pubkey intentionally omitted
      capabilities: ['sync'],
      startedAt: new Date().toISOString(),
    };
    const maliciousFile = path.join(tmpDir, `${fakeAgentId}.peer`);
    await fs.writeFile(maliciousFile, JSON.stringify(maliciousReg), 'utf-8');

    const peers = await registry.discover();

    // The malicious peer MUST NOT appear in the result.
    const evil = peers.find((p) => p.agentId === fakeAgentId);
    assert.equal(evil, undefined, 'peer with missing pubkey MUST be rejected');
  });

  // ── Test 4: reject peers with inconsistent pubkey/agentId ────

  it('discover() rejects peers whose pubkey is inconsistent with agentId', async () => {
    const registry = new PeerRegistry({
      agentId: localPeer.agentId,
      pubkeyB64: localPeer.pubkeyB64,
      meshDir: tmpDir,
    });

    // Use localPeer's pubkey but claim a different agentId (injection attack).
    const spoofedAgentId = crypto.randomBytes(32).toString('hex');

    const injectionReg: PeerRegistration = {
      agentId: spoofedAgentId,
      transport: 'unix:/tmp/spoofed.sock',
      pubkey: localPeer.pubkeyB64, // wrong pubkey for this agentId
      capabilities: ['sync'],
      startedAt: new Date().toISOString(),
    };
    const injectionFile = path.join(tmpDir, `${spoofedAgentId}.peer`);
    await fs.writeFile(injectionFile, JSON.stringify(injectionReg), 'utf-8');

    const peers = await registry.discover();

    // The injection attempt MUST NOT appear.
    const spoofed = peers.find((p) => p.agentId === spoofedAgentId);
    assert.equal(spoofed, undefined, 'peer with pubkey inconsistent with agentId MUST be rejected');
  });

  // ── Test 5: loadStaticConfig() reads a JSON peer list ─────────

  it('loadStaticConfig() reads and validates a static peer list JSON file', async () => {
    const configPath = path.join(tmpDir, 'mesh.json');

    const thirdPeer = await makeTestPeer();
    const staticEntries: PeerRegistration[] = [
      makePeerRegistration(remotePeer.agentId, remotePeer.pubkeyB64),
      makePeerRegistration(thirdPeer.agentId, thirdPeer.pubkeyB64),
      // One entry with missing pubkey — MUST be rejected.
      {
        agentId: 'bad-peer-no-pubkey',
        transport: 'unix:/tmp/bad.sock',
        pubkey: '', // empty pubkey
        capabilities: [],
        startedAt: new Date().toISOString(),
      },
    ];

    await fs.writeFile(configPath, JSON.stringify(staticEntries), 'utf-8');

    const registry = new PeerRegistry({
      agentId: localPeer.agentId,
      pubkeyB64: localPeer.pubkeyB64,
      meshDir: tmpDir,
    });

    const peers = await registry.loadStaticConfig(configPath);

    // Should have exactly 2 valid peers; the bad one is rejected.
    assert.equal(peers.length, 2, 'loadStaticConfig() should return only valid peers');

    const ids = peers.map((p) => p.agentId);
    assert.ok(ids.includes(remotePeer.agentId), 'remotePeer should be in static config');
    assert.ok(ids.includes(thirdPeer.agentId), 'thirdPeer should be in static config');
    assert.ok(!ids.includes('bad-peer-no-pubkey'), 'peer with empty pubkey MUST be rejected');
  });
});
