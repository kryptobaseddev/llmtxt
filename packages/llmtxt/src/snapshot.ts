/**
 * Session Snapshot Compression Service.
 * Compresses/decompresses CLEO session.serialize() JSON snapshots
 * for efficient storage and cross-session handoff.
 *
 * Phase 3: Session continuity infrastructure.
 */

import { compress, decompress } from './wasm.js';

// ── Types ───────────────────────────────────────────────────────

export interface SnapshotMeta {
  sessionId: string;
  agentId: string;
  createdAt: string;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  tokens: number;
  contentHash: string;
}

export interface CompressedSnapshot {
  meta: SnapshotMeta;
  data: Buffer;
}

export interface SnapshotOptions {
  /** Include full decision log (default: true) */
  includeDecisions?: boolean;
  /** Include brain observations (default: true) */
  includeObservations?: boolean;
  /** Max content size before compression in bytes (default: 5MB) */
  maxSize?: number;
}

// ── Compression ─────────────────────────────────────────────────

/**
 * Compress a session snapshot JSON string.
 * Returns compressed data + metadata for storage/retrieval.
 */
export async function compressSnapshot(
  jsonStr: string,
  sessionId: string,
  agentId: string,
): Promise<CompressedSnapshot> {
  const originalSize = Buffer.byteLength(jsonStr, 'utf-8');
  const tokens = Math.ceil(originalSize / 4);

  const data = await compress(jsonStr);
  const compressedSize = data.length;
  const compressionRatio = compressedSize > 0 ? originalSize / compressedSize : 1;

  // Hash for integrity verification
  const { createHash } = await import('node:crypto');
  const contentHash = createHash('sha256').update(jsonStr).digest('hex');

  return {
    meta: {
      sessionId,
      agentId,
      createdAt: new Date().toISOString(),
      originalSize,
      compressedSize,
      compressionRatio,
      tokens,
      contentHash,
    },
    data,
  };
}

/**
 * Decompress a snapshot back to JSON string.
 * Verifies integrity via content hash if provided.
 */
export async function decompressSnapshot(
  data: Buffer,
  expectedHash?: string,
): Promise<string> {
  const jsonStr = await decompress(data);

  if (expectedHash) {
    const { createHash } = await import('node:crypto');
    const actualHash = createHash('sha256').update(jsonStr).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(
        `Snapshot integrity check failed: expected ${expectedHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}...`,
      );
    }
  }

  return jsonStr;
}

/**
 * Compress a session snapshot object directly.
 * Serializes to JSON, then compresses.
 */
export async function compressSessionData(
  sessionData: Record<string, unknown>,
  sessionId: string,
  agentId: string,
  options: SnapshotOptions = {},
): Promise<CompressedSnapshot> {
  const { includeDecisions = true, includeObservations = true, maxSize = 5 * 1024 * 1024 } = options;

  // Optionally strip large fields before compression
  const filtered = { ...sessionData };
  if (!includeDecisions && 'decisions' in filtered) {
    delete filtered.decisions;
  }
  if (!includeObservations && 'observations' in filtered) {
    delete filtered.observations;
  }

  const jsonStr = JSON.stringify(filtered);

  if (Buffer.byteLength(jsonStr, 'utf-8') > maxSize) {
    throw new Error(`Snapshot exceeds max size: ${Buffer.byteLength(jsonStr, 'utf-8')} > ${maxSize}`);
  }

  return compressSnapshot(jsonStr, sessionId, agentId);
}

/**
 * Decompress and parse a snapshot back to an object.
 */
export async function decompressSessionData<T = Record<string, unknown>>(
  data: Buffer,
  expectedHash?: string,
): Promise<T> {
  const jsonStr = await decompressSnapshot(data, expectedHash);
  return JSON.parse(jsonStr) as T;
}

// ── Summary ─────────────────────────────────────────────────────

/**
 * Generate a human-readable summary of a snapshot for handoff messages.
 * Useful for agents posting session summaries to ClawMsgr.
 */
export function snapshotSummary(meta: SnapshotMeta): string {
  return [
    `Session: ${meta.sessionId}`,
    `Agent: ${meta.agentId}`,
    `Size: ${meta.originalSize} → ${meta.compressedSize} bytes (${meta.compressionRatio.toFixed(1)}x)`,
    `Tokens: ~${meta.tokens}`,
    `Hash: ${meta.contentHash.slice(0, 16)}...`,
    `Created: ${meta.createdAt}`,
  ].join('\n');
}
