/**
 * Redis-backed presence registry — T728.
 *
 * Replaces the in-process Map<docSlug, Map<agentId, entry>> with a Redis hash
 * per document so that all Railway pods share a single unified presence view.
 *
 * Storage layout
 * ──────────────
 *   Key:   presence:{docSlug}
 *   Field: {agentId}
 *   Value: "<lastSeen ISO>;<section>;<cursorOffset|>"
 *     • lastSeen:     ISO-8601 timestamp of last heartbeat.
 *     • section:      Section identifier string (may contain spaces).
 *     • cursorOffset: Optional integer cursor position (empty string if absent).
 *
 * TTL strategy
 * ────────────
 *   Every setPresence() call resets the EXPIRE on the hash key to
 *   PRESENCE_HASH_TTL_SECONDS.  Individual field-level expiry is not
 *   supported in Redis hashes, so we also store the lastSeen timestamp in
 *   the value and filter expired entries in getPresence().  The hash key
 *   itself auto-expires after 30 s of total inactivity (all agents gone or
 *   no one has heartbeated), keeping Redis clean.
 *
 * Pub/sub fan-out
 * ───────────────
 *   After every setPresence() the pod publishes a lightweight notification
 *   message to `presence:{docSlug}`.  Every pod subscribed to that channel
 *   can immediately read the fresh hash and forward the delta to its local
 *   WebSocket clients.
 *
 *   Callback signature: (docSlug: string) => void
 *   (Subscribers read the authoritative state from Redis rather than trusting
 *    the message payload to avoid partial/race conditions.)
 *
 * Fallback
 * ────────
 *   When REDIS_URL is not set (development / test) the functions gracefully
 *   fall back to the in-process PresenceRegistry, emitting a single WARN.
 *   Production startup aborts before this module is evaluated when REDIS_URL
 *   is absent (see validateRedisUrl).
 */

import type Redis from 'ioredis';
import { redisPublisher, redisSubscriber } from './redis.js';
import { presenceRegistry as inProcessRegistry } from '../presence/registry.js';
import type { PresenceRecord } from '../presence/registry.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Seconds after which the whole presence hash key expires (no heartbeat). */
const PRESENCE_HASH_TTL_SECONDS = 30;

/** TTL for individual entries — entries older than this are filtered out. */
const PRESENCE_ENTRY_TTL_MS = 30_000;

// ── Value encoding helpers ───────────────────────────────────────────────────

interface PresenceValue {
  lastSeen: number;
  section: string;
  cursorOffset?: number;
}

/**
 * Encode a presence entry to a compact Redis hash field value.
 * Format: "<lastSeenISO>;<section>;<cursorOffset|empty>"
 */
function encodeValue(v: PresenceValue): string {
  return `${new Date(v.lastSeen).toISOString()};${v.section};${v.cursorOffset ?? ''}`;
}

/**
 * Decode a Redis hash field value back to a PresenceValue.
 * Returns null when the value is malformed.
 */
function decodeValue(raw: string): PresenceValue | null {
  // Split on the FIRST two semicolons only; section may contain semicolons.
  const firstSemi = raw.indexOf(';');
  if (firstSemi === -1) return null;
  const secondSemi = raw.indexOf(';', firstSemi + 1);
  if (secondSemi === -1) return null;

  const isoStr = raw.slice(0, firstSemi);
  const section = raw.slice(firstSemi + 1, secondSemi);
  const cursorRaw = raw.slice(secondSemi + 1);

  const lastSeen = Date.parse(isoStr);
  if (isNaN(lastSeen)) return null;

  const result: PresenceValue = { lastSeen, section };
  if (cursorRaw !== '') {
    const cursor = parseInt(cursorRaw, 10);
    if (!isNaN(cursor)) result.cursorOffset = cursor;
  }
  return result;
}

// ── Redis channel helpers ────────────────────────────────────────────────────

function hashKey(docSlug: string): string {
  return `presence:${docSlug}`;
}

function channelName(docSlug: string): string {
  return `presence:${docSlug}`;
}

// ── Core presence operations ─────────────────────────────────────────────────

/**
 * Upsert an agent's presence entry for a document.
 *
 * Writes to Redis hash + refreshes TTL + publishes a presence-changed
 * notification to all pods subscribed to the doc's presence channel.
 *
 * Falls back to in-process registry when Redis is unavailable.
 *
 * @param docSlug      Document slug (URL-safe identifier).
 * @param agentId      Unique agent identifier.
 * @param section      Section the agent is currently editing.
 * @param cursorOffset Optional cursor position within the section.
 */
export async function setPresence(
  docSlug: string,
  agentId: string,
  section: string,
  cursorOffset?: number,
): Promise<void> {
  if (!redisPublisher) {
    // Fallback: in-process registry (development / test without Redis).
    inProcessRegistry.upsert(agentId, docSlug, section, cursorOffset);
    return;
  }

  const key = hashKey(docSlug);
  const value = encodeValue({ lastSeen: Date.now(), section, cursorOffset });

  const pipeline = (redisPublisher as Redis).pipeline();
  pipeline.hset(key, agentId, value);
  pipeline.expire(key, PRESENCE_HASH_TTL_SECONDS);
  // Publish a lightweight "presence changed" notification to other pods.
  pipeline.publish(channelName(docSlug), agentId);
  await pipeline.exec();
}

/**
 * Retrieve all active presence records for a document.
 *
 * Reads the Redis hash, filters out entries older than 30 s, and returns
 * PresenceRecord[] sorted by lastSeen descending (most recent first).
 *
 * Falls back to in-process registry when Redis is unavailable.
 *
 * @param docSlug  Document slug.
 * @returns        Active presence records across all pods.
 */
export async function getPresence(docSlug: string): Promise<PresenceRecord[]> {
  if (!redisPublisher) {
    // Fallback: in-process registry.
    return inProcessRegistry.getByDoc(docSlug);
  }

  const key = hashKey(docSlug);
  const raw = await (redisPublisher as Redis).hgetall(key);
  if (!raw) return [];

  const now = Date.now();
  const records: PresenceRecord[] = [];

  for (const [agentId, encodedValue] of Object.entries(raw)) {
    const decoded = decodeValue(encodedValue);
    if (!decoded) continue;
    if (now - decoded.lastSeen > PRESENCE_ENTRY_TTL_MS) {
      // Lazy-delete stale entry (best-effort, non-blocking).
      void (redisPublisher as Redis).hdel(key, agentId);
      continue;
    }
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

// ── Subscription helpers ──────────────────────────────────────────────────────

/** Callback invoked when any agent in a document updates its presence. */
export type PresenceChangedCallback = (docSlug: string) => void;

/**
 * Subscribe to presence-changed notifications for a document.
 *
 * Calls `cb` whenever any pod writes a new presence entry for the given
 * document. The callback receives only the docSlug — callers should call
 * getPresence() to read the authoritative state from Redis.
 *
 * Returns an unsubscribe function. Call it when the WebSocket closes or
 * when the subscription is no longer needed to avoid listener leaks.
 *
 * Falls back to a no-op when Redis is unavailable (development mode).
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
    // No-op unsubscribe in non-Redis mode.
    return () => {};
  }

  const channel = channelName(docSlug);

  const handler = (incomingChannel: string) => {
    if (incomingChannel === channel) {
      cb(docSlug);
    }
  };

  void (redisSubscriber as Redis).subscribe(channel);
  (redisSubscriber as Redis).on('message', handler);

  return () => {
    (redisSubscriber as Redis).off('message', handler);
    void (redisSubscriber as Redis).unsubscribe(channel);
  };
}
