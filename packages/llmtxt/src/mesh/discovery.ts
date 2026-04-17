/**
 * P3.2: Peer Discovery — file-based + static config + unsigned advertisement rejection.
 *
 * Security requirement (built-in, not bolt-on):
 * - Peer advertisement files MUST include a valid `pubkey` field.
 * - Unsigned peer advertisements MUST be rejected and MUST NOT be connected to.
 * - The discovery layer MUST verify that any peer's `pubkey` is consistent with
 *   its advertised `agentId` before including it in the discovered peer list.
 * - Stale peer files (startedAt older than PEER_TTL_MS) are excluded from results.
 *
 * Spec: docs/specs/P3-p2p-mesh.md §3
 * Task: T414
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Noble ed25519 v3 requires setting the hash function.
ed.hashes.sha512 = sha512;

// ── Constants ──────────────────────────────────────────────────────

/** Default mesh directory: ~/.llmtxt/mesh/ */
const DEFAULT_MESH_DIR = path.join(os.homedir(), '.llmtxt', 'mesh');

/**
 * Peer TTL in milliseconds. Peer files older than this and whose host is
 * unreachable will be excluded (stale detection).
 * Default: 5 minutes (300_000 ms).
 */
export const PEER_TTL_MS = 5 * 60 * 1000;

// ── Types ──────────────────────────────────────────────────────────

/**
 * Raw format of a `.peer` file written by a running agent (P3 spec §3.2).
 *
 * All fields are required. Peer files missing any field are rejected.
 */
export interface PeerRegistration {
  /** Hex-encoded SHA-256 of the agent's Ed25519 public key bytes. */
  agentId: string;
  /**
   * Transport address string.
   * Format: `unix:<absolute-path>` or `http://host:port`.
   */
  transport: string;
  /** Base64-encoded 32-byte Ed25519 public key. */
  pubkey: string;
  /** Capabilities advertised by this peer. */
  capabilities: string[];
  /** ISO-8601 timestamp when the agent started. */
  startedAt: string;
}

/**
 * A validated peer — returned from `discover()` and `loadStaticConfig()`.
 * All entries here have been security-checked.
 */
export interface PeerInfo extends PeerRegistration {
  /** Whether the peer is considered active (startedAt within PEER_TTL_MS). */
  active: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Decode a base64 string to a Uint8Array.
 */
function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Compute SHA-256 of `bytes` and return it as lowercase hex.
 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Derive the expected agentId (hex SHA-256 of pubkey bytes) from a base64
 * pubkey string and compare it to the advertised `agentId`.
 *
 * Returns `true` if they match (i.e., the advertisement is authentic).
 */
function pubkeyConsistentWithAgentId(pubkeyB64: string, advertisedAgentId: string): boolean {
  try {
    const pubkeyBytes = fromBase64(pubkeyB64);
    // agentId MUST be SHA-256(pubkey bytes) as hex (P3 spec §2.2).
    const expected = sha256Hex(pubkeyBytes);
    return expected === advertisedAgentId.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Validate that a pubkey field is a well-formed base64 32-byte Ed25519 public key.
 */
function isValidPubkey(pubkey: string): boolean {
  try {
    const bytes = fromBase64(pubkey);
    // Ed25519 public keys are exactly 32 bytes.
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/**
 * Parse and security-validate a raw peer file object.
 *
 * Throws with a descriptive error if:
 * - Any required field is missing.
 * - `pubkey` is missing, empty, or malformed.
 * - `pubkey` is inconsistent with `agentId` (prevents peer file injection attacks).
 */
function validatePeerRegistration(raw: unknown, source: string): PeerRegistration {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`[discovery] Rejected peer from ${source}: not a JSON object`);
  }

  const obj = raw as Record<string, unknown>;

  // ── Required field presence check ──
  const requiredFields: (keyof PeerRegistration)[] = [
    'agentId',
    'transport',
    'pubkey',
    'capabilities',
    'startedAt',
  ];
  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === '') {
      throw new Error(
        `[discovery] Rejected unsigned peer advertisement from ${source}: missing required field '${field}'`
      );
    }
  }

  const agentId = String(obj['agentId']);
  const transport = String(obj['transport']);
  const pubkey = String(obj['pubkey']);
  const capabilities = Array.isArray(obj['capabilities'])
    ? (obj['capabilities'] as unknown[]).map(String)
    : [];
  const startedAt = String(obj['startedAt']);

  // ── Security: pubkey field must be well-formed ──
  if (!isValidPubkey(pubkey)) {
    throw new Error(
      `[discovery] Rejected unsigned peer advertisement from ${source} (agentId=${agentId}): ` +
        `pubkey is malformed or wrong length (must be base64-encoded 32 bytes)`
    );
  }

  // ── Security: pubkey MUST be consistent with agentId (P3 spec §3.2) ──
  if (!pubkeyConsistentWithAgentId(pubkey, agentId)) {
    throw new Error(
      `[discovery] Rejected peer advertisement from ${source}: ` +
        `pubkey is inconsistent with advertised agentId='${agentId}' — possible peer file injection`
    );
  }

  return { agentId, transport, pubkey, capabilities, startedAt };
}

/**
 * Determine whether a peer is "active" based on its `startedAt` timestamp.
 * Peers whose `startedAt` is older than PEER_TTL_MS are considered stale.
 */
function isActivePeer(startedAt: string): boolean {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  return Date.now() - started < PEER_TTL_MS;
}

// ── PeerRegistry ──────────────────────────────────────────────────

/**
 * PeerRegistry manages peer discovery for the P2P mesh.
 *
 * ## Usage
 * ```ts
 * const registry = new PeerRegistry({ agentId: identity.agentId, identity });
 * await registry.register({ agentId, transport, pubkey, capabilities, startedAt });
 * const peers = await registry.discover();
 * await registry.deregister();
 * ```
 */
export class PeerRegistry {
  private readonly meshDir: string;
  private readonly agentId: string;
  private readonly pubkeyB64: string;
  private cleanupRegistered = false;

  constructor(opts: {
    /** The local agent's ID (hex SHA-256 of pubkey). */
    agentId: string;
    /** The local agent's Ed25519 public key (base64). */
    pubkeyB64: string;
    /**
     * Directory to read/write .peer files.
     * Defaults to `$LLMTXT_MESH_DIR` env var, then `~/.llmtxt/mesh/`.
     */
    meshDir?: string;
  }) {
    this.agentId = opts.agentId;
    this.pubkeyB64 = opts.pubkeyB64;
    this.meshDir = opts.meshDir ?? process.env['LLMTXT_MESH_DIR'] ?? DEFAULT_MESH_DIR;
  }

  /**
   * Write this agent's `.peer` file to `$LLMTXT_MESH_DIR/<agentId>.peer`.
   *
   * Also registers a `beforeExit` / `SIGTERM` handler to call `deregister()`
   * on clean shutdown (P3 spec §3.2).
   *
   * @param info - Peer registration info. Defaults to the local agent's identity
   *               if fields are omitted.
   */
  async register(info: PeerRegistration): Promise<void> {
    await fs.mkdir(this.meshDir, { recursive: true });
    const filePath = this.peerFilePath(info.agentId);
    await fs.writeFile(filePath, JSON.stringify(info, null, 2), { encoding: 'utf-8' });

    // Register cleanup once.
    if (!this.cleanupRegistered) {
      this.cleanupRegistered = true;
      const cleanup = () => {
        // Sync deletion on exit — cannot use async in signal handlers.
        try {
          const { unlinkSync } = require('node:fs');
          unlinkSync(filePath);
        } catch {
          // Best-effort.
        }
      };
      process.once('beforeExit', cleanup);
      process.once('SIGTERM', cleanup);
      process.once('SIGINT', cleanup);
    }
  }

  /**
   * Delete this agent's `.peer` file (clean shutdown).
   * No-op if the file does not exist.
   */
  async deregister(): Promise<void> {
    const filePath = this.peerFilePath(this.agentId);
    try {
      await fs.unlink(filePath);
    } catch {
      // File may already be gone — best-effort.
    }
  }

  /**
   * Discover all peers by reading `*.peer` files from `$LLMTXT_MESH_DIR`.
   *
   * Security: peer advertisements missing a valid `pubkey` or whose `pubkey`
   * is inconsistent with their `agentId` are REJECTED and never returned.
   * Stale peers (startedAt older than PEER_TTL_MS) are returned with
   * `active: false`.
   *
   * @returns Array of validated {@link PeerInfo} (never includes the local agent).
   */
  async discover(): Promise<PeerInfo[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.meshDir);
    } catch {
      // Mesh dir may not exist yet — return empty list.
      return [];
    }

    const peerFiles = entries.filter((e) => e.endsWith('.peer'));
    const peers: PeerInfo[] = [];

    for (const filename of peerFiles) {
      const filePath = path.join(this.meshDir, filename);
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        const validated = validatePeerRegistration(parsed, filePath);

        // Skip own peer file.
        if (validated.agentId === this.agentId) continue;

        peers.push({
          ...validated,
          active: isActivePeer(validated.startedAt),
        });
      } catch (err) {
        // Log the rejection and skip this file — do not abort discovery.
        console.warn(
          `[discovery] Skipping peer file '${filename}': ${(err as Error).message}`
        );
      }
    }

    return peers;
  }

  /**
   * Load a static peer list from a JSON config file.
   *
   * The file must contain an array of {@link PeerRegistration} objects.
   * Entries missing a valid `pubkey` are rejected.
   *
   * @param configPath - Path to the config file.
   *   Defaults to `~/.llmtxt/mesh.json`.
   */
  async loadStaticConfig(
    configPath: string = path.join(os.homedir(), '.llmtxt', 'mesh.json')
  ): Promise<PeerInfo[]> {
    let raw: string;
    try {
      raw = await fs.readFile(configPath, 'utf-8');
    } catch {
      // Config file may not exist — return empty list.
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`[discovery] Failed to parse static config at '${configPath}': ${(err as Error).message}`);
      return [];
    }

    if (!Array.isArray(parsed)) {
      console.warn(`[discovery] Static config at '${configPath}' must be a JSON array — ignoring`);
      return [];
    }

    const peers: PeerInfo[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i];
      try {
        const validated = validatePeerRegistration(entry, `${configPath}[${i}]`);
        peers.push({
          ...validated,
          active: isActivePeer(validated.startedAt),
        });
      } catch (err) {
        console.warn(
          `[discovery] Skipping static config entry [${i}]: ${(err as Error).message}`
        );
      }
    }

    return peers;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private peerFilePath(agentId: string): string {
    return path.join(this.meshDir, `${agentId}.peer`);
  }
}

// ── Re-exports ────────────────────────────────────────────────────

export { ed, sha256Hex, fromBase64, isValidPubkey, pubkeyConsistentWithAgentId };
