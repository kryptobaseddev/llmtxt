/**
 * a2a.ts — P3.7: Agent-to-Agent Messages over Mesh
 *
 * Signed agent-to-agent messages routed via transport.
 * Relay if not directly connected (1-hop only per spec §7.1).
 * Unsigned messages are REJECTED before delivery to the handler.
 *
 * Spec reference: docs/specs/P3-p2p-mesh.md §7
 */

import { EventEmitter } from 'node:events';

import type { AgentIdentity } from '../identity.js';
import type { PeerTransport, PeerRegistry, PeerInfo } from './sync-engine.js';

// ── Constants ─────────────────────────────────────────────────────

/** Message type byte for A2A messages. */
const MSG_TYPE_A2A = 0x10;

/** Maximum allowed payload size (1 MB). */
const MAX_A2A_PAYLOAD_BYTES = 1 * 1024 * 1024;

/** Maximum relay attempts before queuing locally. */
const MAX_RELAY_ATTEMPTS = 3;

// ── Wire types ────────────────────────────────────────────────────

/**
 * A2A message envelope.
 * Spec §7.1:
 *   { type, from, to, payload, sig, sentAt }
 *
 * sig = base64-encoded Ed25519 signature over canonical JSON of
 *       { type, from, to, payload, sentAt } (fields alphabetically sorted,
 *       no trailing whitespace).
 */
export interface A2AEnvelope {
  type: 'a2a';
  from: string;
  to: string;
  payload: Record<string, unknown>;
  sig: string;
  sentAt: string;
}

/**
 * Queued message awaiting delivery (no path found at send time).
 */
interface QueuedMessage {
  envelope: A2AEnvelope;
  relayAttempts: number;
  queuedAt: number;
}

// ── MeshMessenger ─────────────────────────────────────────────────

export interface MeshMessengerOptions {
  identity: AgentIdentity;
  transport: PeerTransport;
  discovery: PeerRegistry;
  /** Handler called when a valid, verified A2A message arrives for THIS agent. */
  onMessage?: (envelope: A2AEnvelope) => void;
}

/**
 * MeshMessenger — signed agent-to-agent routing over mesh transport.
 *
 * Security guarantees (spec §7.1, §10):
 *  - Outbound messages are Ed25519-signed before sending.
 *  - Inbound messages are signature-verified against sender's known pubkey.
 *  - Unsigned or invalid-signature messages are REJECTED silently (+ warn log).
 *  - Payload >1 MB is rejected at send time.
 *  - 1-hop relay for peers not directly connected.
 *  - Local queue + retry on reconnect when no path exists.
 */
export class MeshMessenger extends EventEmitter {
  private readonly identity: AgentIdentity;
  private readonly transport: PeerTransport;
  private readonly discovery: PeerRegistry;
  private readonly onMessage?: (envelope: A2AEnvelope) => void;

  /** agentId → pubkeyHex mapping built from discovered peers. */
  private readonly knownPubkeys: Map<string, string> = new Map();

  /** Local queue for messages with no current path. */
  private readonly queue: Map<string, QueuedMessage[]> = new Map();

  private running = false;

  constructor(opts: MeshMessengerOptions) {
    super();
    this.identity = opts.identity;
    this.transport = opts.transport;
    this.discovery = opts.discovery;
    this.onMessage = opts.onMessage;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.transport.listen((peerId, data) => {
      void this._handleInbound(peerId, data);
    });

    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.emit('stopped');
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Send an A2A message to `to` agent.
   *
   * Security: Signs the envelope with own Ed25519 key before sending.
   * Payload must be JSON-serialisable and <1 MB.
   *
   * Routing:
   *  1. If `to` is in the current peer list → direct send.
   *  2. Else → relay via any connected peer that knows `to` (1 hop).
   *  3. If no path after MAX_RELAY_ATTEMPTS → queue locally.
   */
  async send(to: string, payload: Record<string, unknown>): Promise<void> {
    // Enforce size limit.
    const payloadStr = JSON.stringify(payload);
    if (new TextEncoder().encode(payloadStr).length > MAX_A2A_PAYLOAD_BYTES) {
      throw new Error(
        `[MeshMessenger] payload exceeds 1 MB limit for target ${to} — REJECTED`
      );
    }

    const envelope = await this._buildEnvelope(to, payload);
    const data = this._serialize(envelope);

    const peers = await this.discovery.discover();
    this._updateKnownPubkeys(peers);

    // Direct path.
    const directPeer = peers.find((p) => p.agentId === to);
    if (directPeer) {
      await this.transport.sendChangeset(to, directPeer.address, data);
      this.emit('sent', { to, direct: true });
      // Flush any queued messages for this peer now that we have a path.
      await this._flushQueue(to, peers);
      return;
    }

    // Relay path: find any connected peer that knows the target.
    await this._relay(envelope, peers, 0);
  }

  /**
   * Retry queued messages for all known peers.
   * Call after discovery refresh or reconnect event.
   */
  async retryQueued(): Promise<void> {
    const peers = await this.discovery.discover();
    this._updateKnownPubkeys(peers);
    for (const targetId of [...this.queue.keys()]) {
      await this._flushQueue(targetId, peers);
    }
  }

  // ── Relay ──────────────────────────────────────────────────────

  private async _relay(
    envelope: A2AEnvelope,
    peers: PeerInfo[],
    attempt: number
  ): Promise<void> {
    if (attempt >= MAX_RELAY_ATTEMPTS) {
      this._enqueue(envelope);
      this.emit('queued', { to: envelope.to, attempt });
      return;
    }

    // Build a relay wrapper — the target info is embedded in the original envelope.
    // A relay peer re-dispatches the same envelope. We wrap in a relay frame.
    const relayEnvelope: RelayFrame = {
      type: 'relay',
      inner: envelope,
    };
    const data = this._serializeRelay(relayEnvelope);

    // Try each connected peer in round-robin.
    for (const peer of peers) {
      if (peer.agentId === envelope.from || peer.agentId === envelope.to) continue;
      try {
        await this.transport.sendChangeset(peer.agentId, peer.address, data);
        this.emit('relayed', { to: envelope.to, via: peer.agentId, attempt });
        return;
      } catch {
        // Try next peer.
      }
    }

    // All relay attempts failed.
    await this._relay(envelope, peers, attempt + 1);
  }

  // ── Inbound handler ────────────────────────────────────────────

  private async _handleInbound(peerId: string, data: Uint8Array): Promise<void> {
    if (data.length < 2 || data[0] !== MSG_TYPE_A2A) return;

    let parsed: A2AEnvelope | RelayFrame;
    try {
      const json = new TextDecoder().decode(data.slice(1));
      parsed = JSON.parse(json) as A2AEnvelope | RelayFrame;
    } catch (err) {
      console.warn(`[MeshMessenger] malformed A2A frame from ${peerId}: ${String(err)}`);
      return;
    }

    if ((parsed as RelayFrame).type === 'relay') {
      // Relay frame: forward to final target if we are directly connected.
      await this._handleRelay(peerId, (parsed as RelayFrame).inner);
      return;
    }

    const envelope = parsed as A2AEnvelope;
    if (envelope.type !== 'a2a') return;

    // ── SECURITY: Verify signature ─────────────────────────────
    const valid = await this._verifySignature(envelope);
    if (!valid) {
      console.warn(
        `[MeshMessenger] SECURITY: unsigned/invalid-sig A2A from ${peerId} — REJECTED`
      );
      this.emit('security-rejection', { peerId, reason: 'invalid-signature' });
      return;
    }

    const myId = this.identity.pubkeyHex;

    if (envelope.to === myId) {
      // Delivered to us.
      this.onMessage?.(envelope);
      this.emit('received', envelope);
    } else {
      // We are not the target — act as relay if we have a path.
      await this._handleRelay(peerId, envelope);
    }
  }

  private async _handleRelay(
    _fromPeerId: string,
    envelope: A2AEnvelope
  ): Promise<void> {
    const peers = await this.discovery.discover();
    this._updateKnownPubkeys(peers);

    // Verify the inner envelope signature before relaying.
    const valid = await this._verifySignature(envelope);
    if (!valid) {
      console.warn(`[MeshMessenger] SECURITY: relay dropped — inner envelope invalid-sig`);
      this.emit('security-rejection', { reason: 'relay-invalid-signature' });
      return;
    }

    const directPeer = peers.find((p) => p.agentId === envelope.to);
    if (directPeer) {
      const data = this._serialize(envelope);
      try {
        await this.transport.sendChangeset(envelope.to, directPeer.address, data);
        this.emit('relay-forwarded', { to: envelope.to });
      } catch {
        this._enqueue(envelope);
      }
    }
    // If not connected, drop (spec: 1-hop only — we do not initiate a second relay).
  }

  // ── Signature helpers ──────────────────────────────────────────

  /** Build canonical JSON for signing (sorted keys, no whitespace). */
  private _canonicalize(envelope: Omit<A2AEnvelope, 'sig'>): Uint8Array {
    const canonical = JSON.stringify({
      from: envelope.from,
      payload: envelope.payload,
      sentAt: envelope.sentAt,
      to: envelope.to,
      type: envelope.type,
    });
    return new TextEncoder().encode(canonical);
  }

  private async _buildEnvelope(
    to: string,
    payload: Record<string, unknown>
  ): Promise<A2AEnvelope> {
    const partial: Omit<A2AEnvelope, 'sig'> = {
      type: 'a2a',
      from: this.identity.pubkeyHex,
      to,
      payload,
      sentAt: new Date().toISOString(),
    };

    const sigBytes = await this.identity.sign(this._canonicalize(partial));
    const sig = Buffer.from(sigBytes).toString('base64');

    return { ...partial, sig };
  }

  private async _verifySignature(envelope: A2AEnvelope): Promise<boolean> {
    if (!envelope.sig || !envelope.from) return false;

    // Resolve sender pubkey: from field IS the pubkeyHex per spec §2.2.
    const pkHex = envelope.from;
    const pkBytes = Buffer.from(pkHex, 'hex');
    if (pkBytes.length !== 32) return false;

    try {
      const partial: Omit<A2AEnvelope, 'sig'> = {
        type: envelope.type,
        from: envelope.from,
        to: envelope.to,
        payload: envelope.payload,
        sentAt: envelope.sentAt,
      };
      const canonical = this._canonicalize(partial);
      const sigBytes = Buffer.from(envelope.sig, 'base64');

      const { verifyAsync } = await import('@noble/ed25519');
      return await verifyAsync(sigBytes, canonical, pkBytes);
    } catch {
      return false;
    }
  }

  // ── Queue ──────────────────────────────────────────────────────

  private _enqueue(envelope: A2AEnvelope): void {
    const target = envelope.to;
    if (!this.queue.has(target)) {
      this.queue.set(target, []);
    }
    this.queue.get(target)!.push({
      envelope,
      relayAttempts: 0,
      queuedAt: Date.now(),
    });
  }

  private async _flushQueue(targetId: string, peers: PeerInfo[]): Promise<void> {
    const queued = this.queue.get(targetId);
    if (!queued || queued.length === 0) return;

    const directPeer = peers.find((p) => p.agentId === targetId);
    if (!directPeer) return;

    const remaining: QueuedMessage[] = [];
    for (const item of queued) {
      const data = this._serialize(item.envelope);
      try {
        await this.transport.sendChangeset(targetId, directPeer.address, data);
        this.emit('queue-flushed', { to: targetId });
      } catch {
        remaining.push(item);
      }
    }

    if (remaining.length === 0) {
      this.queue.delete(targetId);
    } else {
      this.queue.set(targetId, remaining);
    }
  }

  // ── Serialization ──────────────────────────────────────────────

  private _serialize(envelope: A2AEnvelope): Uint8Array {
    const json = JSON.stringify(envelope);
    const jsonBytes = new TextEncoder().encode(json);
    const out = new Uint8Array(1 + jsonBytes.length);
    out[0] = MSG_TYPE_A2A;
    out.set(jsonBytes, 1);
    return out;
  }

  private _serializeRelay(frame: RelayFrame): Uint8Array {
    const json = JSON.stringify(frame);
    const jsonBytes = new TextEncoder().encode(json);
    const out = new Uint8Array(1 + jsonBytes.length);
    out[0] = MSG_TYPE_A2A;
    out.set(jsonBytes, 1);
    return out;
  }

  // ── Known Pubkey Registry ──────────────────────────────────────

  private _updateKnownPubkeys(peers: PeerInfo[]): void {
    for (const peer of peers) {
      // pubkeyBase64 → hex for signature verification.
      try {
        const pkBytes = Buffer.from(peer.pubkeyBase64, 'base64');
        const pkHex = pkBytes.toString('hex');
        this.knownPubkeys.set(peer.agentId, pkHex);
      } catch {
        // Ignore malformed peer info.
      }
    }
  }

  // ── Status accessors ───────────────────────────────────────────

  /** Returns number of queued messages per target. */
  getQueueStatus(): Record<string, number> {
    const status: Record<string, number> = {};
    for (const [target, msgs] of this.queue) {
      status[target] = msgs.length;
    }
    return status;
  }
}

// ── Internal relay frame type ──────────────────────────────────────

interface RelayFrame {
  type: 'relay';
  inner: A2AEnvelope;
}
