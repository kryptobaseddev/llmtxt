/**
 * sync-engine.ts — P3.4: Mesh Sync Engine
 *
 * Wraps cr-sqlite changesets and coordinates peer-to-peer sync.
 * Ed25519 changeset signing + SHA-256 integrity verification are MANDATORY
 * (spec §5.2, DR-P3-07). Unsigned or hash-mismatched changesets are rejected
 * before being applied.
 *
 * Spec reference: docs/specs/P3-p2p-mesh.md §5
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { AgentIdentity } from '../identity.js';
import type { Backend } from '../core/backend.js';

// ── Transport Abstraction ─────────────────────────────────────────

/**
 * Minimal transport interface required by SyncEngine.
 * Full interface spec: P3-p2p-mesh.md §4.1
 */
export interface PeerTransport {
  readonly type: string;
  listen(onMessage: (peerId: string, data: Uint8Array) => void): Promise<void>;
  sendChangeset(peerId: string, peerAddress: string, data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

// ── Peer Discovery ────────────────────────────────────────────────

export interface PeerInfo {
  /** Hex-encoded public key hash (agentId). */
  agentId: string;
  /** Transport address (e.g. "unix:/tmp/agent.sock" or "http://host:port"). */
  address: string;
  /** Base64-encoded Ed25519 public key. */
  pubkeyBase64: string;
}

export interface PeerRegistry {
  /** Returns the current set of discovered peers (excluding self). */
  discover(): Promise<PeerInfo[]>;
  /** Mark a peer as temporarily inactive after repeated failures. */
  markInactive(agentId: string): void;
}

// ── Wire envelope ─────────────────────────────────────────────────

/**
 * Changeset wire envelope (JSON, then Uint8Array serialised).
 *
 * Layout:
 *   0x00 — message type byte (0x01 = changeset)
 *   then JSON-encoded ChangesetEnvelope
 */
const MSG_TYPE_CHANGESET = 0x01;
const MAX_CHANGESET_BYTES = 10 * 1024 * 1024; // 10 MB

interface ChangesetEnvelope {
  /** Originating agent (hex pubkey hash). */
  from: string;
  /** Base64-encoded changeset bytes. */
  changesetB64: string;
  /** Hex-encoded SHA-256 of raw changeset bytes. */
  integrityHash: string;
  /** Base64-encoded Ed25519 signature over (integrityHash || from). */
  sig: string;
  /** Last db_version known by sender for THIS peer's state (bigint as string). */
  sinceVersion: string;
}

// ── Mesh State Persistence ────────────────────────────────────────

/** In-memory peer sync state. Persisted externally via llmtxt_mesh_state table. */
export interface PeerSyncState {
  lastSyncVersion: bigint;
  failureCount: number;
  lastFailureAt?: number;
}

// ── SHA-256 Helper ────────────────────────────────────────────────

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function sha256Bytes(data: Uint8Array): Uint8Array {
  return createHash('sha256').update(data).digest();
}

// ── SyncEngine ────────────────────────────────────────────────────

export interface SyncEngineOptions {
  backend: Backend;
  transport: PeerTransport;
  discovery: PeerRegistry;
  identity: AgentIdentity;
  syncIntervalMs?: number;
  /** Maximum consecutive failures before a peer is marked inactive. */
  maxPeerFailures?: number;
}

/**
 * SyncEngine — periodic + event-driven peer-to-peer changeset exchange.
 *
 * Security guarantees (per spec §5.1, §5.2, §10):
 *  - Unsigned changesets are rejected before applyChanges.
 *  - SHA-256 hash mismatch → changeset rejected + peer failure recorded.
 *  - Corrupted Loro blobs detected by applyChanges + hash mismatch on inbound.
 *  - Oversized changesets (>10 MB) rejected.
 *  - One peer failure does not block sync with other peers.
 */
export class SyncEngine extends EventEmitter {
  private readonly backend: Backend;
  private readonly transport: PeerTransport;
  private readonly discovery: PeerRegistry;
  private readonly identity: AgentIdentity;
  private readonly syncIntervalMs: number;
  private readonly maxPeerFailures: number;

  /** Per-peer sync state (agentId → PeerSyncState). */
  private readonly peerState: Map<string, PeerSyncState> = new Map();

  private syncTimer?: ReturnType<typeof setInterval>;
  private running = false;
  private inFlightSyncs: Set<Promise<void>> = new Set();

  /** Dirty flag: set when local backend is mutated; cleared after sync. */
  private dirty = false;

  constructor(opts: SyncEngineOptions) {
    super();
    this.backend = opts.backend;
    this.transport = opts.transport;
    this.discovery = opts.discovery;
    this.identity = opts.identity;
    this.syncIntervalMs = opts.syncIntervalMs ?? 5000;
    this.maxPeerFailures = opts.maxPeerFailures ?? 5;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /**
   * Start the sync engine:
   *  1. Begin listening for inbound changesets via transport.
   *  2. Start periodic sync loop.
   *  3. Load persisted peer versions from backend (if supported).
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Restore persisted peer sync versions.
    await this._loadMeshState();

    // Listen for inbound changesets from peers.
    await this.transport.listen((peerId, data) => {
      void this._handleInbound(peerId, data);
    });

    // Periodic sync loop.
    this.syncTimer = setInterval(() => {
      void this._syncAllPeers();
    }, this.syncIntervalMs);

    // Watch for local mutations (backend emits 'write' events on any mutation).
    // Cast through unknown to avoid strict overlap check — this is intentional.
    const backendAsEmitter = this.backend as unknown as EventEmitter;
    if (typeof backendAsEmitter.on === 'function') {
      backendAsEmitter.on('write', () => {
        this.dirty = true;
        void this._syncAllPeers();
      });
    }

    this.emit('started');
  }

  /**
   * Stop the sync engine gracefully:
   *  - Drain in-flight syncs.
   *  - Shut down transport.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }

    // Drain in-flight syncs.
    if (this.inFlightSyncs.size > 0) {
      await Promise.allSettled([...this.inFlightSyncs]);
    }

    await this.transport.close();

    // Persist final peer state.
    await this._saveMeshState();

    this.emit('stopped');
  }

  /**
   * Trigger an immediate sync with all peers (or a specific peer).
   */
  async syncNow(peerId?: string): Promise<void> {
    if (peerId) {
      const peers = await this.discovery.discover();
      const peer = peers.find((p) => p.agentId === peerId);
      if (peer) {
        await this._syncPeer(peer);
      }
    } else {
      await this._syncAllPeers();
    }
  }

  // ── Internal sync loop ─────────────────────────────────────────

  private async _syncAllPeers(): Promise<void> {
    if (!this.running) return;

    let peers: PeerInfo[];
    try {
      peers = await this.discovery.discover();
    } catch (err) {
      this.emit('error', new Error(`[SyncEngine] discovery.discover() failed: ${String(err)}`));
      return;
    }

    // Fan out peer syncs concurrently; isolated — one failure doesn't block others.
    const tasks = peers.map((peer) => {
      const p = this._syncPeer(peer).catch((err) => {
        this._recordPeerFailure(peer.agentId, err);
      });
      this.inFlightSyncs.add(p);
      p.finally(() => this.inFlightSyncs.delete(p));
      return p;
    });

    await Promise.allSettled(tasks);
    this.dirty = false;
  }

  private async _syncPeer(peer: PeerInfo): Promise<void> {
    const state = this._getPeerState(peer.agentId);

    try {
      // Step 1: Get local changes since last sync with this peer.
      const localChanges = await this.backend.getChangesSince(state.lastSyncVersion);

      if (localChanges.length > 0) {
        const envelope = await this._buildEnvelope(localChanges, state.lastSyncVersion);
        const envelopeBytes = this._serializeEnvelope(envelope);

        await this.transport.sendChangeset(peer.agentId, peer.address, envelopeBytes);
        this.emit('sent', { peerId: peer.agentId, bytes: envelopeBytes.length });
      }
    } catch (err) {
      this._recordPeerFailure(peer.agentId, err);
    }
  }

  // ── Inbound changeset handler ──────────────────────────────────

  private async _handleInbound(peerId: string, data: Uint8Array): Promise<void> {
    // Enforce max size.
    if (data.length > MAX_CHANGESET_BYTES) {
      console.warn(
        `[SyncEngine] SECURITY: oversized changeset from ${peerId} (${data.length} bytes) — REJECTED`
      );
      this._recordPeerFailure(peerId, new Error('oversized changeset'));
      return;
    }

    // Deserialize envelope.
    let envelope: ChangesetEnvelope;
    try {
      envelope = this._deserializeEnvelope(data);
    } catch (err) {
      console.warn(
        `[SyncEngine] SECURITY: malformed envelope from ${peerId} — REJECTED: ${String(err)}`
      );
      this._recordPeerFailure(peerId, err);
      return;
    }

    // ── SECURITY: Verify Ed25519 signature ─────────────────────
    const verified = await this._verifyEnvelopeSignature(envelope);
    if (!verified) {
      console.warn(
        `[SyncEngine] SECURITY: unsigned/invalid-sig changeset from ${peerId} — REJECTED`
      );
      this._recordPeerFailure(peerId, new Error('signature verification failed'));
      this.emit('security-rejection', { peerId, reason: 'invalid-signature' });
      return;
    }

    // Decode changeset bytes.
    const changesetBytes = Buffer.from(envelope.changesetB64, 'base64');

    // ── SECURITY: Verify SHA-256 integrity hash ─────────────────
    const actualHash = sha256Hex(changesetBytes);
    if (actualHash !== envelope.integrityHash) {
      console.warn(
        `[SyncEngine] SECURITY: changeset hash mismatch from ${peerId} ` +
          `(expected=${envelope.integrityHash} actual=${actualHash}) — REJECTED`
      );
      this._recordPeerFailure(peerId, new Error('changeset hash mismatch'));
      this.emit('security-rejection', { peerId, reason: 'hash-mismatch' });
      return;
    }

    // ── Apply changeset (backend enforces Loro blob hash internally) ──
    try {
      const newVersion = await this.backend.applyChanges(changesetBytes);
      const state = this._getPeerState(peerId);
      state.lastSyncVersion = newVersion;
      state.failureCount = 0;

      await this._saveMeshState();
      this.emit('applied', { peerId, newVersion, bytes: changesetBytes.length });
    } catch (err) {
      console.warn(
        `[SyncEngine] applyChanges failed for peer ${peerId}: ${String(err)}`
      );
      this._recordPeerFailure(peerId, err);
    }
  }

  // ── Envelope build / parse ─────────────────────────────────────

  private async _buildEnvelope(
    changesetBytes: Uint8Array,
    sinceVersion: bigint
  ): Promise<ChangesetEnvelope> {
    const integrityHash = sha256Hex(changesetBytes);
    const changesetB64 = Buffer.from(changesetBytes).toString('base64');

    // Sign over (integrityHash || agentId) to bind hash to sender identity.
    const sigPayload = new TextEncoder().encode(integrityHash + this.identity.pubkeyHex);
    const sigBytes = await this.identity.sign(sigPayload);
    const sig = Buffer.from(sigBytes).toString('base64');

    return {
      from: this.identity.pubkeyHex,
      changesetB64,
      integrityHash,
      sig,
      sinceVersion: sinceVersion.toString(),
    };
  }

  private async _verifyEnvelopeSignature(envelope: ChangesetEnvelope): Promise<boolean> {
    if (!envelope.sig || !envelope.from) return false;
    try {
      const sigPayload = new TextEncoder().encode(envelope.integrityHash + envelope.from);
      const sigBytes = Buffer.from(envelope.sig, 'base64');
      // Re-derive pubkey bytes from hex.
      const pkBytes = Buffer.from(envelope.from, 'hex');
      if (pkBytes.length !== 32) return false;

      const { verifyAsync } = await import('@noble/ed25519');
      return await verifyAsync(sigBytes, sigPayload, pkBytes);
    } catch {
      return false;
    }
  }

  private _serializeEnvelope(envelope: ChangesetEnvelope): Uint8Array {
    const json = JSON.stringify(envelope);
    const jsonBytes = new TextEncoder().encode(json);
    const out = new Uint8Array(1 + jsonBytes.length);
    out[0] = MSG_TYPE_CHANGESET;
    out.set(jsonBytes, 1);
    return out;
  }

  private _deserializeEnvelope(data: Uint8Array): ChangesetEnvelope {
    if (data.length < 2) throw new Error('envelope too short');
    if (data[0] !== MSG_TYPE_CHANGESET) {
      throw new Error(`unknown message type: 0x${data[0]?.toString(16)}`);
    }
    const json = new TextDecoder().decode(data.slice(1));
    const parsed = JSON.parse(json) as ChangesetEnvelope;
    if (
      typeof parsed.from !== 'string' ||
      typeof parsed.changesetB64 !== 'string' ||
      typeof parsed.integrityHash !== 'string' ||
      typeof parsed.sig !== 'string'
    ) {
      throw new Error('invalid envelope fields');
    }
    return parsed;
  }

  // ── Peer State ─────────────────────────────────────────────────

  private _getPeerState(agentId: string): PeerSyncState {
    let state = this.peerState.get(agentId);
    if (!state) {
      state = { lastSyncVersion: 0n, failureCount: 0 };
      this.peerState.set(agentId, state);
    }
    return state;
  }

  private _recordPeerFailure(agentId: string, err: unknown): void {
    const state = this._getPeerState(agentId);
    state.failureCount++;
    state.lastFailureAt = Date.now();
    if (state.failureCount >= this.maxPeerFailures) {
      this.discovery.markInactive(agentId);
      this.emit('peer-inactive', { agentId, failureCount: state.failureCount });
    }
    this.emit('peer-failure', { agentId, error: err, failureCount: state.failureCount });
  }

  // ── Mesh State Persistence ─────────────────────────────────────

  /**
   * Load lastSyncVersion per peer from the backend's llmtxt_mesh_state table.
   * Falls back gracefully if the table/method does not exist.
   */
  private async _loadMeshState(): Promise<void> {
    try {
      // Cast through unknown — getMeshState is an optional extension method
      // not in the Backend interface; we degrade gracefully if absent.
      const ext = this.backend as unknown as {
        getMeshState?: () => Promise<Array<{ agentId: string; lastSyncVersion: string }>>;
      };
      if (typeof ext.getMeshState === 'function') {
        const rows = await ext.getMeshState();
        for (const row of rows) {
          this._getPeerState(row.agentId).lastSyncVersion = BigInt(row.lastSyncVersion);
        }
      }
    } catch {
      // Non-fatal: start from 0 if mesh state table not available.
    }
  }

  private async _saveMeshState(): Promise<void> {
    try {
      // Cast through unknown — setMeshState is an optional extension method.
      const ext = this.backend as unknown as {
        setMeshState?: (
          entries: Array<{ agentId: string; lastSyncVersion: string }>
        ) => Promise<void>;
      };
      if (typeof ext.setMeshState === 'function') {
        const entries = [...this.peerState.entries()].map(([agentId, state]) => ({
          agentId,
          lastSyncVersion: state.lastSyncVersion.toString(),
        }));
        await ext.setMeshState(entries);
      }
    } catch {
      // Non-fatal.
    }
  }

  // ── Public accessors ───────────────────────────────────────────

  /** Return current peer sync states for monitoring. */
  getPeerStates(): ReadonlyMap<string, PeerSyncState> {
    return this.peerState;
  }

  /** SHA-256 of arbitrary bytes — exposed for testing integrity verification. */
  static sha256Hex(data: Uint8Array): string {
    return sha256Hex(data);
  }

  static sha256Bytes(data: Uint8Array): Uint8Array {
    return sha256Bytes(data);
  }
}
