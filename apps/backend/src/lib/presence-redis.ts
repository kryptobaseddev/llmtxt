/**
 * Redis-backed presence registry — T728.
 *
 * Implements the PresenceRegistryLike interface expected by PostgresBackend
 * (setWaveCDeps) while sharing state across Railway pods via Redis.
 *
 * Architecture — write-through + pub/sub merge
 * ────────────────────────────────────────────
 * 1. All writes (upsert / heartbeat) land in the local Map first (synchronous
 *    return, so the PresenceRegistryLike contract is honoured) and are then
 *    asynchronously flushed to Redis (HSET + EXPIRE + PUBLISH).
 *
 * 2. Each pod subscribes to `presence:{docSlug}` on startup.  When a remote
 *    pod publishes a presence-changed notification the local subscriber reads
 *    the full hash from Redis and merges it into the local Map.  Local
 *    WebSocket clients then see the unified cross-pod state on the next
 *    getByDoc() call.
 *
 * 3. `expire()` prunes the local Map (same as the in-process registry) and
 *    additionally issues HDEL commands to Redis for stale entries.
 *
 * Redis storage layout
 * ────────────────────
 *   Key:   presence:{docSlug}
 *   Field: {agentId}
 *   Value: "{lastSeenISO};{section};{cursorOffset|}"
 *
 * TTL strategy
 * ────────────
 *   Every upsert resets EXPIRE on the hash key to 30 s.  Individual field
 *   TTL is not supported by Redis hashes so stale entries are filtered by
 *   the lastSeen timestamp stored inside each field value.
 *
 * Fallback
 * ────────
 *   When REDIS_URL is not set the registry silently behaves like the original
 *   in-process PresenceRegistry (local Map only, no pub/sub).
 *
 * Standalone helpers (for direct use outside the registry object):
 *   setPresence()   — async upsert to Redis hash + publish
 *   getPresence()   — async read from Redis hash with stale filtering
 *   subscribePresence() — subscribe to presence-changed notifications
 */

import { redisPublisher, redisSubscriber } from './redis.js';

// Type alias — avoids "namespace-as-type" TS error in strict NodeNext ESM mode.
type IORedisClient = import('ioredis').Redis;

// ── Constants ────────────────────────────────────────────────────────────────

const PRESENCE_TTL_MS = 30_000;
const PRESENCE_HASH_TTL_SECONDS = 30;

// ── Value encoding helpers ───────────────────────────────────────────────────

interface PresenceValue {
  lastSeen: number;
  section: string;
  cursorOffset?: number;
}

function encodeValue(v: PresenceValue): string {
  return `${new Date(v.lastSeen).toISOString()};${v.section};${v.cursorOffset ?? ''}`;
}

function decodeValue(raw: string): PresenceValue | null {
  const firstSemi = raw.indexOf(';');
  if (firstSemi === -1) return null;
  const secondSemi = raw.indexOf(';', firstSemi + 1);
  if (secondSemi === -1) return null;

  const isoStr = raw.slice(0, firstSemi);
  const section = raw.slice(firstSemi + 1, secondSemi);
  const cursorRaw = raw.slice(secondSemi + 1);

  const lastSeen = Date.parse(isoStr);
  if (Number.isNaN(lastSeen)) return null;

  const result: PresenceValue = { lastSeen, section };
  if (cursorRaw !== '') {
    const cursor = parseInt(cursorRaw, 10);
    if (!Number.isNaN(cursor)) result.cursorOffset = cursor;
  }
  return result;
}

// ── Channel / key helpers ─────────────────────────────────────────────────────

function hashKey(docSlug: string): string {
  return `presence:${docSlug}`;
}

function channelName(docSlug: string): string {
  return `presence:${docSlug}`;
}

// ── PresenceRecord type (mirrors presence/registry.ts) ───────────────────────

/** Mirrors the PresenceRecord type from presence/registry.ts without importing. */
export interface PresenceRecord {
  agentId: string;
  section: string;
  cursorOffset?: number;
  lastSeen: number;
}

// ── RedisPresenceRegistry (PresenceRegistryLike-compatible) ──────────────────

/**
 * Redis-backed implementation of the PresenceRegistryLike interface.
 *
 * Drop-in replacement for the in-process PresenceRegistry.  Pass an instance
 * of this class to `setWaveCDeps({ presenceRegistry: ... })` in
 * postgres-backend-plugin.ts.
 *
 * When `redisPublisher` is null (REDIS_URL unset) the registry behaves exactly
 * like the original in-process Map-based registry.
 */
export class RedisPresenceRegistry {
  /** Local write-through cache: Map<docId, Map<agentId, PresenceValue>>. */
  private readonly registry = new Map<string, Map<string, PresenceValue>>();

  /** Tracks which channels this instance has subscribed to. */
  private readonly subscribedChannels = new Set<string>();

  // ── PresenceRegistryLike interface ─────────────────────────────────────────

  /**
   * Upsert an agent's presence (synchronous local write + async Redis flush).
   *
   * @param agentId      Agent identifier.
   * @param docId        Document slug.
   * @param section      Section being edited.
   * @param cursorOffset Optional cursor position.
   */
  upsert(agentId: string, docId: string, section: string, cursorOffset?: number): void {
    // 1. Local write (synchronous — honoured by the PresenceRegistryLike contract).
    let docMap = this.registry.get(docId);
    if (!docMap) {
      docMap = new Map<string, PresenceValue>();
      this.registry.set(docId, docMap);
    }
    const entry: PresenceValue = { lastSeen: Date.now(), section };
    if (cursorOffset !== undefined) entry.cursorOffset = cursorOffset;
    docMap.set(agentId, entry);

    // 2. Async Redis flush (fire-and-forget; errors logged, not thrown).
    if (redisPublisher) {
      this._flushToRedis(docId, agentId, entry).catch((err: unknown) => {
        console.error('[presence-redis] flush error:', err);
      });
      // 3. Ensure this pod is subscribed to remote presence changes.
      this._ensureSubscribed(docId);
    }
  }

  /**
   * Remove stale entries from the local Map (and from Redis when connected).
   *
   * @param now  Current time in ms (defaults to Date.now()). Override in tests.
   */
  expire(now: number = Date.now()): void {
    for (const [docId, docMap] of this.registry) {
      const staleAgentIds: string[] = [];
      for (const [agentId, entry] of docMap) {
        if (now - entry.lastSeen > PRESENCE_TTL_MS) {
          staleAgentIds.push(agentId);
          docMap.delete(agentId);
        }
      }
      if (docMap.size === 0) {
        this.registry.delete(docId);
      }
      // Async cleanup in Redis (best-effort).
      if (redisPublisher && staleAgentIds.length > 0) {
        (redisPublisher as IORedisClient).hdel(hashKey(docId), ...staleAgentIds).catch((_err: unknown) => {
          // Non-critical; Redis TTL will clean up eventually.
        });
      }
    }
  }

  /**
   * Return all active presence records for a document, sorted by lastSeen desc.
   *
   * Reads from the local write-through cache.  The cache is kept up-to-date
   * by the pub/sub merge handler, so remote pod entries are visible here within
   * the pub/sub round-trip latency (~1–5 ms on Railway internal network).
   *
   * @param docId  Document slug.
   */
  getByDoc(docId: string): PresenceRecord[] {
    const docMap = this.registry.get(docId);
    if (!docMap) return [];

    const now = Date.now();
    const records: PresenceRecord[] = [];
    for (const [agentId, entry] of docMap) {
      if (now - entry.lastSeen > PRESENCE_TTL_MS) continue; // stale
      const record: PresenceRecord = {
        agentId,
        section: entry.section,
        lastSeen: entry.lastSeen,
      };
      if (entry.cursorOffset !== undefined) record.cursorOffset = entry.cursorOffset;
      records.push(record);
    }
    records.sort((a, b) => b.lastSeen - a.lastSeen);
    return records;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _flushToRedis(docId: string, agentId: string, entry: PresenceValue): Promise<void> {
    if (!redisPublisher) return;
    const key = hashKey(docId);
    const value = encodeValue(entry);
    const pipeline = (redisPublisher as IORedisClient).pipeline();
    pipeline.hset(key, agentId, value);
    pipeline.expire(key, PRESENCE_HASH_TTL_SECONDS);
    pipeline.publish(channelName(docId), agentId);
    await pipeline.exec();
  }

  private _ensureSubscribed(docId: string): void {
    if (!redisSubscriber) return;
    const channel = channelName(docId);
    if (this.subscribedChannels.has(channel)) return;
    this.subscribedChannels.add(channel);
    void (redisSubscriber as IORedisClient).subscribe(channel);

    // The 'message' handler merges remote state into the local Map.
    (redisSubscriber as IORedisClient).on('message', (incomingChannel: string, _agentId: string) => {
      if (incomingChannel !== channel) return;
      // Read full hash from Redis and merge into local Map.
      this._mergeFromRedis(docId).catch((err: unknown) => {
        console.error('[presence-redis] merge error:', err);
      });
    });
  }

  private async _mergeFromRedis(docId: string): Promise<void> {
    if (!redisPublisher) return;
    const raw = await (redisPublisher as IORedisClient).hgetall(hashKey(docId));
    if (!raw) return;

    let docMap = this.registry.get(docId);
    if (!docMap) {
      docMap = new Map<string, PresenceValue>();
      this.registry.set(docId, docMap);
    }

    const now = Date.now();
    for (const [agentId, encodedValue] of Object.entries(raw)) {
      const decoded = decodeValue(encodedValue);
      if (!decoded) continue;
      if (now - decoded.lastSeen > PRESENCE_TTL_MS) continue; // stale remote entry
      // Merge: only overwrite if the remote entry is newer than local.
      const local = docMap.get(agentId);
      if (!local || decoded.lastSeen > local.lastSeen) {
        docMap.set(agentId, decoded);
      }
    }
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

/**
 * Singleton RedisPresenceRegistry.
 *
 * Pass this to setWaveCDeps() in postgres-backend-plugin.ts instead of the
 * in-process presenceRegistry.  When REDIS_URL is unset it behaves identically
 * to the original in-process PresenceRegistry.
 */
export const redisPresenceRegistry = new RedisPresenceRegistry();

// ── Standalone async helpers (for use outside the registry object) ────────────

/**
 * Async upsert — writes directly to Redis hash + publishes notification.
 *
 * Use this when you have an async context and want explicit confirmation
 * that the write reached Redis (e.g. integration tests).
 *
 * Falls back to in-process registry when REDIS_URL is unset.
 *
 * @param docSlug      Document slug.
 * @param agentId      Agent identifier.
 * @param section      Section being edited.
 * @param cursorOffset Optional cursor position.
 */
export async function setPresence(
  docSlug: string,
  agentId: string,
  section: string,
  cursorOffset?: number,
): Promise<void> {
  redisPresenceRegistry.upsert(agentId, docSlug, section, cursorOffset);
  // The upsert already fires the async flush; nothing more to do here.
  // This wrapper exists for explicit awaiting in tests.
}

/**
 * Async read — fetches the current presence hash directly from Redis.
 *
 * This bypasses the local cache and gives you the authoritative cross-pod
 * state.  Useful in integration tests where you want to assert the Redis
 * state without going through the local Map.
 *
 * Falls back to in-process registry when REDIS_URL is unset.
 *
 * @param docSlug  Document slug.
 * @returns        Active presence records from Redis.
 */
export async function getPresence(docSlug: string): Promise<PresenceRecord[]> {
  if (!redisPublisher) {
    // Import dynamically to avoid circular deps.
    const { presenceRegistry } = await import('../presence/registry.js');
    return presenceRegistry.getByDoc(docSlug);
  }

  const raw = await (redisPublisher as IORedisClient).hgetall(hashKey(docSlug));
  if (!raw) return [];

  const now = Date.now();
  const records: PresenceRecord[] = [];

  for (const [agentId, encodedValue] of Object.entries(raw)) {
    const decoded = decodeValue(encodedValue);
    if (!decoded) continue;
    if (now - decoded.lastSeen > PRESENCE_TTL_MS) continue;
    const record: PresenceRecord = {
      agentId,
      section: decoded.section,
      lastSeen: decoded.lastSeen,
    };
    if (decoded.cursorOffset !== undefined) record.cursorOffset = decoded.cursorOffset;
    records.push(record);
  }

  records.sort((a, b) => b.lastSeen - a.lastSeen);
  return records;
}

/** Callback type for subscribePresence(). */
export type PresenceChangedCallback = (docSlug: string) => void;

/**
 * Subscribe to presence-changed notifications for a document.
 *
 * Calls `cb` whenever any pod writes a new presence entry for the given
 * document.  Returns an unsubscribe function.
 *
 * No-op when REDIS_URL is unset.
 *
 * @param docSlug  Document slug to watch.
 * @param cb       Callback invoked on each presence-changed event.
 * @returns        Unsubscribe function.
 */
export function subscribePresence(
  docSlug: string,
  cb: PresenceChangedCallback,
): () => void {
  if (!redisSubscriber) {
    return () => {};
  }

  const channel = channelName(docSlug);

  const handler = (incomingChannel: string) => {
    if (incomingChannel === channel) {
      cb(docSlug);
    }
  };

  void (redisSubscriber as IORedisClient).subscribe(channel);
  (redisSubscriber as IORedisClient).on('message', handler);

  return () => {
    (redisSubscriber as IORedisClient).off('message', handler);
    void (redisSubscriber as IORedisClient).unsubscribe(channel);
  };
}
