/**
 * presence.ts — P3.6: Conflict-free Presence over Mesh
 *
 * In-memory broadcast of agent presence state to mesh peers via transport.
 * TTL-based expiry (30s default). Rate limiting: max 1 inbound per peer per 5s.
 *
 * Spec reference: docs/specs/P3-p2p-mesh.md §6
 */

import { EventEmitter } from 'node:events';

import type { PeerTransport, PeerRegistry } from './sync-engine.js';

// ── Message type byte ─────────────────────────────────────────────

const MSG_TYPE_PRESENCE = 0x02;

// ── Types ─────────────────────────────────────────────────────────

/**
 * Presence state broadcast by an agent to all connected peers.
 * Matches the JSON structure in spec §6.1.
 */
export interface PresenceEntry {
  /** Hex-encoded public key hash. */
  agentId: string;
  /** Document the agent is currently editing (null if idle). */
  documentId: string | null;
  /** Section within the document (null if not section-level). */
  sectionId: string | null;
  /** ISO-8601 timestamp of last update. */
  updatedAt: string;
  /** Time-to-live in seconds. Entries expire after this many seconds. */
  ttl: number;
  /** Wall-clock epoch ms when this entry was received/created locally. */
  receivedAt: number;
}

export interface PresenceManagerOptions {
  agentId: string;
  transport: PeerTransport;
  discovery: PeerRegistry;
  /** Default TTL in seconds (spec default: 30). */
  ttlSeconds?: number;
  /** Broadcast interval in ms (spec: 10 s). */
  broadcastIntervalMs?: number;
  /** Rate limit window in ms — max 1 message per peer per window (spec: 5 s). */
  rateLimitWindowMs?: number;
  /** Current document/section the agent is editing (updated via setPresence). */
  initialDocumentId?: string | null;
  initialSectionId?: string | null;
}

// ── PresenceManager ───────────────────────────────────────────────

/**
 * PresenceManager — in-memory, TTL-based presence state across mesh peers.
 *
 * Thread-safety: Node.js is single-threaded; no locks required.
 *
 * Security: Rate-limits inbound presence to max 1/peer/5s (spec §10, presence flood).
 */
export class PresenceManager extends EventEmitter {
  private readonly agentId: string;
  private readonly transport: PeerTransport;
  private readonly discovery: PeerRegistry;
  private readonly ttlSeconds: number;
  private readonly broadcastIntervalMs: number;
  private readonly rateLimitWindowMs: number;

  /** Registry: agentId → PresenceEntry (includes self). */
  private readonly registry: Map<string, PresenceEntry> = new Map();

  /** Rate-limit tracker: agentId → last-received epoch ms. */
  private readonly lastReceived: Map<string, number> = new Map();

  /** Own editable presence fields. */
  private currentDocumentId: string | null;
  private currentSectionId: string | null;

  private broadcastTimer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(opts: PresenceManagerOptions) {
    super();
    this.agentId = opts.agentId;
    this.transport = opts.transport;
    this.discovery = opts.discovery;
    this.ttlSeconds = opts.ttlSeconds ?? 30;
    this.broadcastIntervalMs = opts.broadcastIntervalMs ?? 10_000;
    this.rateLimitWindowMs = opts.rateLimitWindowMs ?? 5_000;
    this.currentDocumentId = opts.initialDocumentId ?? null;
    this.currentSectionId = opts.initialSectionId ?? null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Register inbound handler on transport.
    // Note: transport.listen() is idempotent in multi-component setups;
    // presence piggybacks on the same socket using message type byte 0x02.
    // Production: share one transport listener via a multiplexer. Here we
    // register a secondary handler by passing our own callback. The SyncEngine
    // and PresenceManager SHOULD share one transport dispatcher in production.
    await this.transport.listen((peerId, data) => {
      this._handleInbound(peerId, data);
    });

    // Start periodic broadcast.
    this.broadcastTimer = setInterval(() => {
      void this._broadcastPresence();
    }, this.broadcastIntervalMs);

    // Seed own presence immediately.
    void this._broadcastPresence();
    this.emit('started');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = undefined;
    }

    this.emit('stopped');
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Update own presence state (document/section being edited).
   * Triggers an immediate broadcast.
   */
  setPresence(documentId: string | null, sectionId?: string | null): void {
    this.currentDocumentId = documentId;
    this.currentSectionId = sectionId ?? null;
    void this._broadcastPresence();
  }

  /**
   * Returns all active (non-expired) agents currently in a document.
   *
   * @param documentId Filter by document (or omit to get all active agents).
   */
  getPresence(documentId?: string): PresenceEntry[] {
    this._evictExpired();
    const now = Date.now();
    const entries: PresenceEntry[] = [];
    for (const entry of this.registry.values()) {
      if (this._isExpired(entry, now)) continue;
      if (documentId !== undefined && entry.documentId !== documentId) continue;
      entries.push({ ...entry });
    }
    return entries;
  }

  /**
   * Returns ALL active presence entries across all documents.
   */
  getAll(): PresenceEntry[] {
    return this.getPresence(undefined);
  }

  // ── Inbound handler ────────────────────────────────────────────

  /**
   * Called by the transport listener for every incoming byte frame.
   * Only processes messages with type byte 0x02 (presence).
   */
  private _handleInbound(peerId: string, data: Uint8Array): void {
    if (data.length < 2 || data[0] !== MSG_TYPE_PRESENCE) return;

    // Rate limiting: max 1 presence message per peer per rateLimitWindowMs.
    const now = Date.now();
    const last = this.lastReceived.get(peerId) ?? 0;
    if (now - last < this.rateLimitWindowMs) {
      console.warn(
        `[PresenceManager] rate-limited presence from ${peerId} (window=${this.rateLimitWindowMs}ms)`
      );
      this.emit('rate-limited', { peerId });
      return;
    }
    this.lastReceived.set(peerId, now);

    // Decode presence entry.
    try {
      const json = new TextDecoder().decode(data.slice(1));
      const parsed = JSON.parse(json) as Partial<PresenceEntry>;

      if (
        typeof parsed.agentId !== 'string' ||
        typeof parsed.updatedAt !== 'string' ||
        typeof parsed.ttl !== 'number'
      ) {
        console.warn(`[PresenceManager] invalid presence payload from ${peerId} — ignored`);
        return;
      }

      const entry: PresenceEntry = {
        agentId: parsed.agentId,
        documentId: parsed.documentId ?? null,
        sectionId: parsed.sectionId ?? null,
        updatedAt: parsed.updatedAt,
        ttl: Math.max(1, parsed.ttl),
        receivedAt: now,
      };

      this.registry.set(entry.agentId, entry);
      this.emit('presence-updated', entry);
    } catch (err) {
      console.warn(`[PresenceManager] failed to parse presence from ${peerId}: ${String(err)}`);
    }
  }

  // ── Broadcast ─────────────────────────────────────────────────

  private async _broadcastPresence(): Promise<void> {
    if (!this.running) return;

    // Evict stale entries first.
    this._evictExpired();

    // Build own presence.
    const entry: Omit<PresenceEntry, 'receivedAt'> = {
      agentId: this.agentId,
      documentId: this.currentDocumentId,
      sectionId: this.currentSectionId,
      updatedAt: new Date().toISOString(),
      ttl: this.ttlSeconds,
    };

    // Upsert own presence into local registry.
    this.registry.set(this.agentId, { ...entry, receivedAt: Date.now() });

    // Serialize.
    const payload = this._serializePresence(entry);

    // Discover current peers and send.
    let peers: Awaited<ReturnType<PeerRegistry['discover']>>;
    try {
      peers = await this.discovery.discover();
    } catch {
      return;
    }

    for (const peer of peers) {
      if (peer.agentId === this.agentId) continue;
      try {
        await this.transport.sendChangeset(peer.agentId, peer.address, payload);
      } catch {
        // Non-fatal: presence is best-effort.
      }
    }

    this.emit('broadcasted', entry);
  }

  // ── Serialisation ──────────────────────────────────────────────

  private _serializePresence(entry: Omit<PresenceEntry, 'receivedAt'>): Uint8Array {
    const json = JSON.stringify(entry);
    const jsonBytes = new TextEncoder().encode(json);
    const out = new Uint8Array(1 + jsonBytes.length);
    out[0] = MSG_TYPE_PRESENCE;
    out.set(jsonBytes, 1);
    return out;
  }

  // ── TTL / Eviction ─────────────────────────────────────────────

  private _isExpired(entry: PresenceEntry, nowMs: number): boolean {
    const expiresAt = entry.receivedAt + entry.ttl * 1000;
    return nowMs > expiresAt;
  }

  private _evictExpired(): void {
    const now = Date.now();
    for (const [agentId, entry] of this.registry) {
      if (agentId === this.agentId) continue; // Never evict self.
      if (this._isExpired(entry, now)) {
        this.registry.delete(agentId);
        this.emit('presence-expired', { agentId });
      }
    }
  }
}
