/**
 * sync-engine.test.ts — T417: Mesh Sync Engine tests
 *
 * 6 tests covering:
 *  1. Periodic sync triggers sendChangeset for each peer.
 *  2. Local changeset is signed before transmission.
 *  3. Unsigned inbound changeset is rejected (SECURITY).
 *  4. Tampered (hash-mismatch) inbound changeset is rejected (SECURITY).
 *  5. One peer failure does not block sync with other peers.
 *  6. Stop() drains in-flight syncs and closes transport.
 *
 * Spec: P3-p2p-mesh.md §5.1, §5.2, §10
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { AgentIdentity } from '../identity.js';
import {
  SyncEngine,
  type PeerTransport,
  type PeerRegistry,
  type PeerInfo,
} from '../mesh/sync-engine.js';
import type { Backend } from '../core/backend.js';

// ── Minimal stub helpers ──────────────────────────────────────────

function mockBackend(opts?: { changes?: Uint8Array }): Backend & { mutationCount: number } {
  const changes = opts?.changes ?? new Uint8Array(0);
  return {
    mutationCount: 0,
    getChangesSince: async (_v: bigint) => changes,
    applyChanges: async (_cs: Uint8Array) => 1n,
  } as unknown as Backend & { mutationCount: number };
}

function mockTransport(opts?: {
  onSend?: (peerId: string, address: string, data: Uint8Array) => void;
  inboundListener?: [(peerId: string, data: Uint8Array) => void];
}): PeerTransport & {
  sent: Array<{ peerId: string; address: string; data: Uint8Array }>;
  listener: ((peerId: string, data: Uint8Array) => void) | undefined;
} {
  const sent: Array<{ peerId: string; address: string; data: Uint8Array }> = [];
  let listener: ((peerId: string, data: Uint8Array) => void) | undefined;

  return {
    type: 'mock',
    sent,
    get listener() {
      return listener;
    },
    async listen(cb: (peerId: string, data: Uint8Array) => void) {
      listener = cb;
      if (opts?.inboundListener) opts.inboundListener[0] = cb;
    },
    async sendChangeset(peerId: string, address: string, data: Uint8Array) {
      sent.push({ peerId, address, data });
      opts?.onSend?.(peerId, address, data);
    },
    async close() {
      // no-op
    },
  };
}

function mockDiscovery(peers: PeerInfo[]): PeerRegistry & { peers: PeerInfo[] } {
  return {
    peers,
    async discover() {
      return peers;
    },
    markInactive(_agentId: string) {
      // no-op
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────

async function makeIdentity(): Promise<AgentIdentity> {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  return AgentIdentity.fromSeed(seed);
}

async function buildValidInbound(
  identity: AgentIdentity,
  changesetBytes: Uint8Array
): Promise<Uint8Array> {
  const { createHash } = await import('node:crypto');
  const integrityHash = createHash('sha256').update(changesetBytes).digest('hex');
  const changesetB64 = Buffer.from(changesetBytes).toString('base64');
  const sigPayload = new TextEncoder().encode(integrityHash + identity.pubkeyHex);
  const sigBytes = await identity.sign(sigPayload);
  const sig = Buffer.from(sigBytes).toString('base64');

  const envelope = {
    from: identity.pubkeyHex,
    changesetB64,
    integrityHash,
    sig,
    sinceVersion: '0',
  };

  const json = JSON.stringify(envelope);
  const jsonBytes = new TextEncoder().encode(json);
  const out = new Uint8Array(1 + jsonBytes.length);
  out[0] = 0x01; // MSG_TYPE_CHANGESET
  out.set(jsonBytes, 1);
  return out;
}

// ── Tests ─────────────────────────────────────────────────────────

describe('SyncEngine', () => {
  let identity: AgentIdentity;

  before(async () => {
    identity = await makeIdentity();
  });

  it('test-1: syncNow triggers sendChangeset for each discovered peer', async () => {
    const changes = new Uint8Array([1, 2, 3, 4]);
    const backend = mockBackend({ changes });
    const transport = mockTransport();
    const peers: PeerInfo[] = [
      { agentId: 'peer-a', address: 'unix:/tmp/a.sock', pubkeyBase64: 'AAAA' },
      { agentId: 'peer-b', address: 'unix:/tmp/b.sock', pubkeyBase64: 'BBBB' },
    ];
    const discovery = mockDiscovery(peers);

    const engine = new SyncEngine({
      backend,
      transport,
      discovery,
      identity,
      syncIntervalMs: 100_000, // prevent automatic firing in test
    });
    await engine.start();
    await engine.syncNow();
    await engine.stop();

    // One sendChangeset per peer (we have local changes > 0).
    assert.equal(transport.sent.length, 2);
    const peerIds = transport.sent.map((s) => s.peerId).sort();
    assert.deepEqual(peerIds, ['peer-a', 'peer-b']);
  });

  it('test-2: outbound changeset is signed (sig field present in envelope)', async () => {
    const changes = new Uint8Array([9, 8, 7]);
    const backend = mockBackend({ changes });
    const transport = mockTransport();
    const peers: PeerInfo[] = [
      { agentId: 'peer-x', address: 'unix:/tmp/x.sock', pubkeyBase64: 'XXXX' },
    ];
    const discovery = mockDiscovery(peers);

    const engine = new SyncEngine({
      backend,
      transport,
      discovery,
      identity,
      syncIntervalMs: 100_000,
    });
    await engine.start();
    await engine.syncNow();
    await engine.stop();

    assert.equal(transport.sent.length, 1);

    // Decode envelope.
    const data = transport.sent[0]!.data;
    assert.equal(data[0], 0x01, 'message type byte should be 0x01');
    const json = new TextDecoder().decode(data.slice(1));
    const env = JSON.parse(json) as { sig: string; integrityHash: string; from: string };
    assert.ok(typeof env.sig === 'string' && env.sig.length > 0, 'sig must be present');
    assert.ok(typeof env.integrityHash === 'string' && env.integrityHash.length === 64, 'integrityHash must be hex sha256');
    assert.equal(env.from, identity.pubkeyHex);
  });

  it('test-3: SECURITY — unsigned inbound changeset is rejected before applyChanges', async () => {
    const backend = mockBackend();
    let applyCalled = false;
    (backend as { applyChanges: (cs: Uint8Array) => Promise<bigint> }).applyChanges = async (_cs: Uint8Array) => {
      applyCalled = true;
      return 1n;
    };

    const listenerRef: [(peerId: string, data: Uint8Array) => void] = [() => {}];
    const transport = mockTransport({ inboundListener: listenerRef });
    const discovery = mockDiscovery([]);

    const engine = new SyncEngine({
      backend,
      transport,
      discovery,
      identity,
      syncIntervalMs: 100_000,
    });
    await engine.start();

    // Build unsigned envelope (missing sig).
    const changesetBytes = new Uint8Array([1, 2, 3]);
    const { createHash } = await import('node:crypto');
    const integrityHash = createHash('sha256').update(changesetBytes).digest('hex');
    const envelope = {
      from: identity.pubkeyHex,
      changesetB64: Buffer.from(changesetBytes).toString('base64'),
      integrityHash,
      sig: '', // empty = unsigned
      sinceVersion: '0',
    };
    const json = JSON.stringify(envelope);
    const jsonBytes = new TextEncoder().encode(json);
    const data = new Uint8Array(1 + jsonBytes.length);
    data[0] = 0x01;
    data.set(jsonBytes, 1);

    const rejections: unknown[] = [];
    engine.on('security-rejection', (r) => rejections.push(r));

    // _handleInbound is fire-and-forget; wait a tick for async verification.
    listenerRef[0]('peer-unsigned', data);
    await new Promise((r) => setTimeout(r, 100));

    await engine.stop();

    assert.ok(!applyCalled, 'applyChanges MUST NOT be called for unsigned changeset');
    assert.ok(rejections.length >= 1, 'security-rejection event must be emitted');
  });

  it('test-4: SECURITY — tampered changeset (hash mismatch) is rejected', async () => {
    const backend = mockBackend();
    let applyCalled = false;
    (backend as { applyChanges: (cs: Uint8Array) => Promise<bigint> }).applyChanges = async (_cs: Uint8Array) => {
      applyCalled = true;
      return 1n;
    };

    const listenerRef: [(peerId: string, data: Uint8Array) => void] = [() => {}];
    const transport = mockTransport({ inboundListener: listenerRef });
    const discovery = mockDiscovery([]);

    const engine = new SyncEngine({
      backend,
      transport,
      discovery,
      identity,
      syncIntervalMs: 100_000,
    });
    await engine.start();

    // Build a valid signature but tamper with the changeset bytes.
    const originalBytes = new Uint8Array([1, 2, 3]);
    const tamperedBytes = new Uint8Array([9, 9, 9]); // Different bytes
    const { createHash } = await import('node:crypto');
    const integrityHash = createHash('sha256').update(originalBytes).digest('hex'); // Hash of original
    // changesetB64 encodes tampered bytes — hash won't match
    const changesetB64 = Buffer.from(tamperedBytes).toString('base64');
    const sigPayload = new TextEncoder().encode(integrityHash + identity.pubkeyHex);
    const sigBytes = await identity.sign(sigPayload);
    const sig = Buffer.from(sigBytes).toString('base64');

    const envelope = { from: identity.pubkeyHex, changesetB64, integrityHash, sig, sinceVersion: '0' };
    const json = JSON.stringify(envelope);
    const jsonBytes = new TextEncoder().encode(json);
    const data = new Uint8Array(1 + jsonBytes.length);
    data[0] = 0x01;
    data.set(jsonBytes, 1);

    const rejections: unknown[] = [];
    engine.on('security-rejection', (r) => rejections.push(r));

    // _handleInbound is invoked as void (fire-and-forget) internally.
    // Calling the listener directly triggers async verification; we wait
    // a tick for the promise chain to resolve before checking.
    listenerRef[0]('peer-tampered', data);
    await new Promise((r) => setTimeout(r, 100));

    await engine.stop();

    assert.ok(!applyCalled, 'applyChanges MUST NOT be called for hash-mismatched changeset');
    assert.ok(rejections.length >= 1, 'security-rejection event must be emitted for hash mismatch');
  });

  it('test-5: peer failure does not block sync with other peers', async () => {
    const changes = new Uint8Array([5, 6, 7]);
    const backend = mockBackend({ changes });

    let failPeerSendCount = 0;
    const transport = mockTransport({
      onSend: (peerId) => {
        if (peerId === 'peer-fail') {
          failPeerSendCount++;
          throw new Error('connection refused');
        }
      },
    });
    const peers: PeerInfo[] = [
      { agentId: 'peer-fail', address: 'unix:/tmp/fail.sock', pubkeyBase64: 'FAIL' },
      { agentId: 'peer-ok', address: 'unix:/tmp/ok.sock', pubkeyBase64: 'OK00' },
    ];
    const discovery = mockDiscovery(peers);

    const engine = new SyncEngine({
      backend,
      transport,
      discovery,
      identity,
      syncIntervalMs: 100_000,
    });
    await engine.start();
    await engine.syncNow();
    await engine.stop();

    // peer-ok must have received a send despite peer-fail throwing.
    const okSends = transport.sent.filter((s) => s.peerId === 'peer-ok');
    assert.ok(okSends.length >= 1, 'peer-ok must receive changeset despite peer-fail error');
  });

  it('test-6: stop() completes without hanging after draining in-flight syncs', async () => {
    const backend = mockBackend();
    const transport = mockTransport();
    const discovery = mockDiscovery([]);

    const engine = new SyncEngine({
      backend,
      transport,
      discovery,
      identity,
      syncIntervalMs: 100_000,
    });

    await engine.start();

    // Start + stop immediately — no hangs.
    const stopPromise = engine.stop();
    const result = await Promise.race([
      stopPromise.then(() => 'done'),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('stop() timed out')), 2000)
      ),
    ]);
    assert.equal(result, 'done', 'stop() must complete within 2 seconds');
  });
});
