/**
 * presence.test.ts — T418: Presence over Mesh tests
 *
 * 4 tests covering:
 *  1. Broadcast: own presence is sent to all discovered peers every interval.
 *  2. Receive: inbound presence entry is stored in registry.
 *  3. TTL expiry: entries are evicted after TTL seconds.
 *  4. Rate limiting: max 1 message per peer per 5s window.
 *
 * Spec: P3-p2p-mesh.md §6
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { PresenceManager, type PresenceEntry } from '../mesh/presence.js';
import type { PeerTransport, PeerRegistry, PeerInfo } from '../mesh/sync-engine.js';

// ── Stub helpers ──────────────────────────────────────────────────

const MSG_TYPE_PRESENCE = 0x02;

function buildPresenceFrame(entry: Omit<PresenceEntry, 'receivedAt'>): Uint8Array {
  const json = JSON.stringify(entry);
  const jsonBytes = new TextEncoder().encode(json);
  const out = new Uint8Array(1 + jsonBytes.length);
  out[0] = MSG_TYPE_PRESENCE;
  out.set(jsonBytes, 1);
  return out;
}

function mockTransport(): PeerTransport & {
  sent: Array<{ peerId: string; data: Uint8Array }>;
  listener: ((peerId: string, data: Uint8Array) => void) | undefined;
  simulateInbound: (peerId: string, data: Uint8Array) => void;
} {
  const sent: Array<{ peerId: string; data: Uint8Array }> = [];
  let listener: ((peerId: string, data: Uint8Array) => void) | undefined;

  return {
    type: 'mock-presence',
    sent,
    get listener() {
      return listener;
    },
    simulateInbound(peerId: string, data: Uint8Array) {
      listener?.(peerId, data);
    },
    async listen(cb: (peerId: string, data: Uint8Array) => void) {
      listener = cb;
    },
    async sendChangeset(peerId: string, _address: string, data: Uint8Array) {
      sent.push({ peerId, data });
    },
    async close() {
      // no-op
    },
  };
}

function mockDiscovery(peers: PeerInfo[]): PeerRegistry {
  return {
    async discover() {
      return peers;
    },
    markInactive(_id: string) {
      // no-op
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('PresenceManager', () => {
  it('test-1: broadcasts own presence to all discovered peers', async () => {
    const transport = mockTransport();
    const peers: PeerInfo[] = [
      { agentId: 'agent-b', address: 'unix:/tmp/b.sock', pubkeyBase64: 'BBBB' },
      { agentId: 'agent-c', address: 'unix:/tmp/c.sock', pubkeyBase64: 'CCCC' },
    ];
    const discovery = mockDiscovery(peers);

    const pm = new PresenceManager({
      agentId: 'agent-a',
      transport,
      discovery,
      broadcastIntervalMs: 100_000, // disable periodic; rely on start() seed
      ttlSeconds: 30,
    });

    await pm.start();
    // Give the async broadcast a tick to complete.
    await new Promise((r) => setTimeout(r, 50));
    await pm.stop();

    // Should have sent to both peers (excluding self).
    const sentPeerIds = transport.sent.map((s) => s.peerId).sort();
    assert.ok(sentPeerIds.includes('agent-b'), 'must broadcast to agent-b');
    assert.ok(sentPeerIds.includes('agent-c'), 'must broadcast to agent-c');

    // Payload must be a valid presence frame.
    const frame = transport.sent.find((s) => s.peerId === 'agent-b');
    assert.ok(frame, 'frame must exist');
    assert.equal(frame!.data[0], MSG_TYPE_PRESENCE, 'type byte must be 0x02');
    const json = new TextDecoder().decode(frame!.data.slice(1));
    const parsed = JSON.parse(json) as Partial<PresenceEntry>;
    assert.equal(parsed.agentId, 'agent-a');
    assert.equal(typeof parsed.ttl, 'number');
  });

  it('test-2: received presence entries are stored in memory registry', async () => {
    const transport = mockTransport();
    const discovery = mockDiscovery([]);

    const pm = new PresenceManager({
      agentId: 'agent-a',
      transport,
      discovery,
      broadcastIntervalMs: 100_000,
      ttlSeconds: 30,
    });

    await pm.start();

    // Simulate inbound presence from agent-b.
    const inbound: Omit<PresenceEntry, 'receivedAt'> = {
      agentId: 'agent-b',
      documentId: 'doc-1',
      sectionId: 'sec-intro',
      updatedAt: new Date().toISOString(),
      ttl: 30,
    };
    const frame = buildPresenceFrame(inbound);
    transport.simulateInbound('agent-b', frame);

    // Allow synchronous handler to process.
    await new Promise((r) => setImmediate(r));

    const entries = pm.getPresence('doc-1');
    assert.ok(entries.length >= 1, 'presence entry must be stored');
    const entry = entries.find((e) => e.agentId === 'agent-b');
    assert.ok(entry, 'agent-b presence must be in registry');
    assert.equal(entry!.documentId, 'doc-1');
    assert.equal(entry!.sectionId, 'sec-intro');

    await pm.stop();
  });

  it('test-3: entries older than ttl are evicted on getPresence', async () => {
    const transport = mockTransport();
    const discovery = mockDiscovery([]);

    const pm = new PresenceManager({
      agentId: 'agent-a',
      transport,
      discovery,
      broadcastIntervalMs: 100_000,
      ttlSeconds: 30, // real TTL doesn't matter; we backdate receivedAt manually
    });

    await pm.start();

    // Inject a presence entry directly into the manager's registry by
    // simulating an inbound message, then backdating it.
    const inbound: Omit<PresenceEntry, 'receivedAt'> = {
      agentId: 'agent-stale',
      documentId: 'doc-stale',
      sectionId: null,
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
      ttl: 1, // 1 second TTL
    };
    const frame = buildPresenceFrame(inbound);
    transport.simulateInbound('agent-stale', frame);
    await new Promise((r) => setImmediate(r));

    // Backdate receivedAt to simulate expiry.
    // We wait 1.1s so the 1s TTL has passed.
    // In tests we fake time by modifying the internal registry via event.
    // Here we simply wait enough real time for TTL=1s to expire.
    await new Promise((r) => setTimeout(r, 1100));

    const entries = pm.getPresence('doc-stale');
    const stale = entries.find((e) => e.agentId === 'agent-stale');
    assert.equal(stale, undefined, 'expired entry must be evicted from getPresence');

    await pm.stop();
  });

  it('test-4: rate limiter drops excess presence messages from same peer', async () => {
    const transport = mockTransport();
    const discovery = mockDiscovery([]);

    const pm = new PresenceManager({
      agentId: 'agent-a',
      transport,
      discovery,
      broadcastIntervalMs: 100_000,
      ttlSeconds: 30,
      rateLimitWindowMs: 5_000,
    });

    await pm.start();

    const rateLimited: unknown[] = [];
    pm.on('rate-limited', (e) => rateLimited.push(e));

    // First message — should be accepted.
    const frame1: Omit<PresenceEntry, 'receivedAt'> = {
      agentId: 'agent-spammer',
      documentId: 'doc-1',
      sectionId: null,
      updatedAt: new Date().toISOString(),
      ttl: 30,
    };
    transport.simulateInbound('agent-spammer', buildPresenceFrame(frame1));
    await new Promise((r) => setImmediate(r));

    // Second message immediately — should be rate-limited.
    const frame2: Omit<PresenceEntry, 'receivedAt'> = {
      agentId: 'agent-spammer',
      documentId: 'doc-2',
      sectionId: null,
      updatedAt: new Date().toISOString(),
      ttl: 30,
    };
    transport.simulateInbound('agent-spammer', buildPresenceFrame(frame2));
    await new Promise((r) => setImmediate(r));

    assert.ok(rateLimited.length >= 1, 'second message must be rate-limited');

    // Registry must still show doc-1 (first message), not doc-2.
    const entries = pm.getAll();
    const spammerEntry = entries.find((e) => e.agentId === 'agent-spammer');
    assert.ok(spammerEntry, 'entry from first message must be in registry');
    assert.equal(spammerEntry!.documentId, 'doc-1', 'rate-limited update must not overwrite registry');

    await pm.stop();
  });
});
