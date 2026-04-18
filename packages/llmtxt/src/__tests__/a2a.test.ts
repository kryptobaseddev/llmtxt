/**
 * a2a.test.ts — T419: A2A over Mesh tests
 *
 * 5 tests covering:
 *  1. Direct send: signed message delivered to directly-connected peer.
 *  2. SECURITY: unsigned/invalid-sig message is rejected before delivery.
 *  3. Relay path: message forwarded via connected peer when target not direct.
 *  4. Queue: message queued locally when no relay path found.
 *  5. Payload size limit: payload >1 MB is rejected at send.
 *
 * Spec: P3-p2p-mesh.md §7, §10
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { AgentIdentity } from '../identity.js';
import { MeshMessenger, type A2AEnvelope } from '../mesh/a2a.js';
import type { PeerTransport, PeerRegistry, PeerInfo } from '../mesh/sync-engine.js';

// ── Helpers ───────────────────────────────────────────────────────

const MSG_TYPE_A2A = 0x10;

function buildA2AFrame(envelope: A2AEnvelope): Uint8Array {
  const json = JSON.stringify(envelope);
  const jsonBytes = new TextEncoder().encode(json);
  const out = new Uint8Array(1 + jsonBytes.length);
  out[0] = MSG_TYPE_A2A;
  out.set(jsonBytes, 1);
  return out;
}

class MockA2ATransport extends EventEmitter implements PeerTransport {
  readonly type = 'mock-a2a';
  sent: Array<{ peerId: string; data: Uint8Array }> = [];
  private listener: ((peerId: string, data: Uint8Array) => void) | undefined;

  constructor(private opts?: {
    onSend?: (peerId: string, data: Uint8Array) => void | Promise<void>;
    failForPeer?: string;
  }) { super(); }

  simulateInbound(peerId: string, data: Uint8Array): void {
    this.listener?.(peerId, data);
  }

  async listen(cb: (peerId: string, data: Uint8Array) => void) {
    this.listener = cb;
  }

  async sendChangeset(peerId: string, _address: string, data: Uint8Array) {
    if (this.opts?.failForPeer && peerId === this.opts.failForPeer) {
      throw new Error(`[mock] peer ${peerId} unreachable`);
    }
    this.sent.push({ peerId, data });
    await this.opts?.onSend?.(peerId, data);
  }

  async close() { /* no-op */ }
}

function mockTransport(opts?: {
  onSend?: (peerId: string, data: Uint8Array) => void | Promise<void>;
  failForPeer?: string;
}): PeerTransport & {
  sent: Array<{ peerId: string; data: Uint8Array }>;
  simulateInbound: (peerId: string, data: Uint8Array) => void;
} {
  return new MockA2ATransport(opts);
}

function mockDiscovery(peers: PeerInfo[]): PeerRegistry {
  return {
    async discover() {
      return peers;
    },
    markInactive(_id: string) {},
  };
}

async function makeIdentity(): Promise<AgentIdentity> {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  return AgentIdentity.fromSeed(seed);
}

// ── Tests ─────────────────────────────────────────────────────────

describe('MeshMessenger', () => {
  let senderIdentity: AgentIdentity;
  let recipientIdentity: AgentIdentity;

  before(async () => {
    senderIdentity = await makeIdentity();
    recipientIdentity = await makeIdentity();
  });

  it('test-1: direct send — signed message delivered to directly-connected peer', async () => {
    const transport = mockTransport();
    const peers: PeerInfo[] = [
      {
        agentId: recipientIdentity.pubkeyHex,
        address: 'unix:/tmp/recv.sock',
        pubkeyBase64: Buffer.from(recipientIdentity.pk).toString('base64'),
      },
    ];
    const discovery = mockDiscovery(peers);

    const received: A2AEnvelope[] = [];
    const messenger = new MeshMessenger({
      identity: senderIdentity,
      transport,
      discovery,
      onMessage: (env) => received.push(env),
    });

    await messenger.start();
    await messenger.send(recipientIdentity.pubkeyHex, { action: 'ping' });
    await messenger.stop();

    assert.equal(transport.sent.length, 1, 'one send call expected');
    const frame = transport.sent[0]!;
    assert.equal(frame.peerId, recipientIdentity.pubkeyHex);
    assert.equal(frame.data[0], MSG_TYPE_A2A);

    // Decode envelope.
    const json = new TextDecoder().decode(frame.data.slice(1));
    const env = JSON.parse(json) as A2AEnvelope;
    assert.equal(env.type, 'a2a');
    assert.equal(env.from, senderIdentity.pubkeyHex);
    assert.equal(env.to, recipientIdentity.pubkeyHex);
    assert.ok(typeof env.sig === 'string' && env.sig.length > 0, 'message must be signed');
    assert.deepEqual(env.payload, { action: 'ping' });
  });

  it('test-2: SECURITY — unsigned/invalid-sig inbound message is rejected', async () => {
    const transport = mockTransport();
    const discovery = mockDiscovery([]);

    const received: A2AEnvelope[] = [];
    const rejections: unknown[] = [];

    const messenger = new MeshMessenger({
      identity: recipientIdentity,
      transport,
      discovery,
      onMessage: (env) => received.push(env),
    });
    messenger.on('security-rejection', (r) => rejections.push(r));

    await messenger.start();

    // Build a message with an invalid signature.
    const badEnvelope: A2AEnvelope = {
      type: 'a2a',
      from: senderIdentity.pubkeyHex,
      to: recipientIdentity.pubkeyHex,
      payload: { action: 'malicious' },
      sig: Buffer.from('invalid-sig-bytes-xxxx').toString('base64'),
      sentAt: new Date().toISOString(),
    };
    const frame = buildA2AFrame(badEnvelope);
    transport.simulateInbound('attacker', frame);

    // Allow async verification to complete.
    await new Promise((r) => setTimeout(r, 100));
    await messenger.stop();

    assert.equal(received.length, 0, 'message with invalid sig MUST NOT be delivered');
    assert.ok(rejections.length >= 1, 'security-rejection event must be emitted');
  });

  it('test-3: relay path — message forwarded through connected peer', async () => {
    // senderIdentity → relay agent → recipientIdentity
    const relayAgentId = 'relay-agent-hex-pubkey';
    const transport = mockTransport();
    // Only relay is directly connected; recipient is NOT in peer list.
    const peers: PeerInfo[] = [
      {
        agentId: relayAgentId,
        address: 'unix:/tmp/relay.sock',
        pubkeyBase64: Buffer.alloc(32, 0x44).toString('base64'),
      },
    ];
    const discovery = mockDiscovery(peers);

    const messenger = new MeshMessenger({
      identity: senderIdentity,
      transport,
      discovery,
    });

    await messenger.start();
    // Should relay since recipient not directly connected.
    await messenger.send(recipientIdentity.pubkeyHex, { action: 'routed-task' });
    await messenger.stop();

    // Message should have been sent to relay agent.
    const relaySends = transport.sent.filter((s) => s.peerId === relayAgentId);
    assert.ok(relaySends.length >= 1, 'message must be forwarded to relay peer');

    // Verify the relay frame contains the inner envelope.
    const relayFrame = relaySends[0]!;
    assert.equal(relayFrame.data[0], MSG_TYPE_A2A);
    const json = new TextDecoder().decode(relayFrame.data.slice(1));
    const parsed = JSON.parse(json) as { type: string; inner?: A2AEnvelope };
    // The relay wraps in a relay frame.
    assert.equal(parsed.type, 'relay', 'relay frame type must be "relay"');
    assert.ok(parsed.inner, 'relay frame must contain inner envelope');
    assert.equal(parsed.inner!.to, recipientIdentity.pubkeyHex);
  });

  it('test-4: no-path — message queued locally when no relay found', async () => {
    const transport = mockTransport();
    // No peers at all — no direct or relay path.
    const discovery = mockDiscovery([]);

    const queued: unknown[] = [];
    const messenger = new MeshMessenger({
      identity: senderIdentity,
      transport,
      discovery,
    });
    messenger.on('queued', (e) => queued.push(e));

    await messenger.start();
    await messenger.send(recipientIdentity.pubkeyHex, { action: 'offline-task' });
    await messenger.stop();

    assert.equal(transport.sent.length, 0, 'nothing must be sent when no path exists');
    const status = messenger.getQueueStatus();
    const totalQueued = Object.values(status).reduce((a, b) => a + b, 0);
    assert.ok(totalQueued >= 1, 'message must be queued locally');
    assert.ok(queued.length >= 1, 'queued event must be emitted');
  });

  it('test-5: payload >1 MB is rejected at send', async () => {
    const transport = mockTransport();
    const peers: PeerInfo[] = [
      {
        agentId: recipientIdentity.pubkeyHex,
        address: 'unix:/tmp/recv.sock',
        pubkeyBase64: Buffer.from(recipientIdentity.pk).toString('base64'),
      },
    ];
    const discovery = mockDiscovery(peers);

    const messenger = new MeshMessenger({
      identity: senderIdentity,
      transport,
      discovery,
    });

    await messenger.start();

    // Build a payload just over 1 MB.
    const bigString = 'x'.repeat(1024 * 1024 + 1);
    await assert.rejects(
      () => messenger.send(recipientIdentity.pubkeyHex, { data: bigString }),
      (err: Error) => {
        assert.ok(err instanceof Error, 'must throw an Error');
        assert.ok(
          err.message.includes('1 MB'),
          `error message must mention 1 MB limit, got: ${err.message}`
        );
        return true;
      },
      'send must reject payloads over 1 MB'
    );

    assert.equal(transport.sent.length, 0, 'oversized payload must not be sent');
    await messenger.stop();
  });
});
