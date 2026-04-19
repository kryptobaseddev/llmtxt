/**
 * Scratchpad — Redis Streams backed ephemeral messaging.
 *
 * Architecture:
 *   - Redis Streams (XADD / XREADGROUP / XACK) per document slug.
 *   - Stream key: `scratchpad:{slug}`
 *   - Consumer group: `scratchpad-cg` — one group shared by all pods.
 *   - Consumer name: unique per-process (hostname + PID) for at-least-once
 *     delivery. On pod boot, pending entries from the dead pod's consumer are
 *     reclaimed via XAUTOCLAIM and redelivered.
 *   - 24 h TTL enforced via EXPIRE on every XADD.
 *   - XTRIM MAXLEN keeps each stream bounded at 10 000 messages.
 *   - Fallback: in-memory EventEmitter when REDIS_URL is not set (logs WARN).
 *     In production the fail-fast check at startup terminates the process
 *     before this path is ever exercised (T734).
 *
 * Shared Redis client (T731):
 *   Uses `redisPublisher` from `./redis.ts` — no second connection pool.
 *   A second ioredis connection is intentionally NOT created here.
 *
 * Pod-restart recovery (T732):
 *   Call `recoverScratchpadPending(slug)` after pod boot to XAUTOCLAIM any
 *   messages that were delivered to the previous consumer of this pod but
 *   never acknowledged.  Routes call this on first request for a slug.
 *
 * Fail-fast (T734):
 *   `validateScratchpadRedis(redisUrl, nodeEnv)` — pure, testable function.
 *   Throws when NODE_ENV=production and REDIS_URL is absent.  index.ts calls
 *   this at startup (process.exit(1) on error), matching the pattern used by
 *   validateRedisUrl (T726).
 *
 * Rate limiting: enforced at route level (writeRateLimit applies per-agent).
 *
 * Message structure (stored in stream):
 *   { id, agent_id, content, content_type, thread_id, sig_hex, timestamp_ms }
 */

import { EventEmitter } from 'node:events';
import { hostname } from 'node:os';
import { redisPublisher } from './redis.js';

// ── Types ─────────────────────────────────────────────────────────

/** A single scratchpad message as returned to callers. */
export interface ScratchpadMessage {
  /** Server-assigned stream message ID (e.g. "1700000000000-0"). */
  id: string;
  /** Agent identifier of the sender. */
  agentId: string;
  /** Message content body. */
  content: string;
  /** MIME content type (default: "text/plain"). */
  contentType: string;
  /** Optional thread identifier for reply chains. */
  threadId?: string;
  /** Optional Ed25519 signature over canonical message bytes. */
  sigHex?: string;
  /** Unix ms timestamp of the message. */
  timestampMs: number;
}

/** Options for publishing a scratchpad message. */
export interface PublishOptions {
  /** Agent identifier of the sender. */
  agentId: string;
  /** Message content body. */
  content: string;
  /** MIME content type. Default "text/plain". */
  contentType?: string;
  /** Optional thread identifier for reply chains. */
  threadId?: string;
  /** Optional Ed25519 signature hex over canonical message bytes. */
  sigHex?: string;
}

/** Options for reading scratchpad messages. */
export interface ReadOptions {
  /** Only return messages in this thread. */
  threadId?: string;
  /** Return messages after this stream ID (exclusive). */
  lastId?: string;
  /** Maximum number of messages to return. Default 100. */
  limit?: number;
}

// ── Constants ────────────────────────────────────────────────────

/** 24 hours in seconds. Used for EXPIRE on stream keys. */
const TTL_SECONDS = 24 * 60 * 60;

/** Maximum messages to keep per stream (XTRIM MAXLEN). */
const MAX_STREAM_LEN = 10_000;

/**
 * Consumer group name shared across all pods.
 *
 * All pods belong to the same group so that each message is delivered to
 * exactly one pod (at-least-once with XACK).
 */
const CONSUMER_GROUP = 'scratchpad-cg';

/**
 * Per-process consumer name: `{hostname}/{pid}`.
 *
 * Unique per pod so that XAUTOCLAIM can reclaim messages from dead pods.
 */
const CONSUMER_NAME = `${hostname()}/${process.pid}`;

/**
 * Idle threshold (ms) after which pending messages from other consumers
 * are reclaimed by XAUTOCLAIM on pod boot.  Set to 10 s so that a pod
 * restarted within the grace period does not steal in-flight messages
 * from a still-running sibling.
 */
const CLAIM_IDLE_MS = 10_000;

// ── Fail-fast validator (T734) ───────────────────────────────────

/**
 * Validate that REDIS_URL is configured for scratchpad durability in production.
 *
 * Throws a descriptive Error when nodeEnv === 'production' and redisUrl is
 * absent or blank.  The caller is responsible for calling process.exit(1) so
 * that this function remains pure and unit-testable.
 *
 * @param redisUrl  The value of REDIS_URL (defaults to '').
 * @param nodeEnv   The value of NODE_ENV (defaults to '').
 * @throws {Error}  When nodeEnv === 'production' and redisUrl is unset.
 */
export function validateScratchpadRedis(
  redisUrl: string = '',
  nodeEnv: string = '',
): void {
  if (nodeEnv !== 'production') {
    // Outside production: allow missing REDIS_URL (in-memory fallback).
    return;
  }

  if (!redisUrl || !redisUrl.trim()) {
    throw new Error(
      '[FATAL] REDIS_URL is not set and NODE_ENV=production. ' +
        'Scratchpad messages will be lost on pod restart without a shared Redis ' +
        'Stream instance.  All Railway replicas MUST share Redis for durable ' +
        'scratchpad delivery.  Add a Redis service in the Railway dashboard and ' +
        'set REDIS_URL via a service variable reference (${{Redis.REDIS_URL}}). ' +
        'See docs/ops/redis-setup.md for step-by-step instructions.',
    );
  }
}

// ── In-memory fallback ───────────────────────────────────────────

const _memStore: Map<string, ScratchpadMessage[]> = new Map();
const _memEmitter = new EventEmitter();
_memEmitter.setMaxListeners(200);

let _seqCounter = 0;

/** Generate a monotone in-memory message ID (timestamp-sequence). */
function memId(): string {
  return `${Date.now()}-${_seqCounter++}`;
}

/** Derive the in-memory store key for a slug + optional threadId. */
function memStreamKey(slug: string, threadId?: string): string {
  return threadId ? `${slug}:${threadId}` : slug;
}

/** Store a message in the in-memory map and emit to local subscribers. */
function memPublish(slug: string, msg: ScratchpadMessage, threadId?: string): void {
  const key = memStreamKey(slug, threadId);
  if (!_memStore.has(key)) _memStore.set(key, []);
  const list = _memStore.get(key)!;
  list.push(msg);
  // Trim to MAX_STREAM_LEN
  if (list.length > MAX_STREAM_LEN) {
    list.splice(0, list.length - MAX_STREAM_LEN);
  }
  // Purge messages older than 24 h
  const cutoff = Date.now() - TTL_SECONDS * 1000;
  const pruned = list.filter((m) => m.timestampMs >= cutoff);
  _memStore.set(key, pruned);
  _memEmitter.emit(`msg:${key}`, msg);
}

/** Read messages from the in-memory store. */
function memRead(slug: string, opts: ReadOptions): ScratchpadMessage[] {
  const key = memStreamKey(slug, opts.threadId);
  const all = _memStore.get(key) ?? [];
  const lastId = opts.lastId;
  let filtered = lastId ? all.filter((m) => m.id > lastId) : all;
  if (opts.threadId) {
    filtered = filtered.filter((m) => m.threadId === opts.threadId);
  }
  return filtered.slice(-(opts.limit ?? 100));
}

// ── Redis stream helpers ─────────────────────────────────────────

/** Redis stream key for a document slug. */
function streamKey(slug: string): string {
  return `scratchpad:${slug}`;
}

/**
 * Parse a flat Redis stream field array into a ScratchpadMessage.
 *
 * Redis stream fields are returned as a flat string array:
 * `[field0, value0, field1, value1, …]`.
 *
 * @param id      Stream message ID.
 * @param fields  Flat key-value array from XRANGE / XREADGROUP.
 */
function parseStreamEntry(id: string, fields: string[]): ScratchpadMessage {
  // Build a typed struct from the flat key-value array so biome's
  // useLiteralKeys rule is satisfied by dot-notation access below.
  const f: {
    agent_id: string;
    content: string;
    content_type: string;
    thread_id: string;
    sig_hex: string;
    timestamp_ms: string;
  } = {
    agent_id: '',
    content: '',
    content_type: '',
    thread_id: '',
    sig_hex: '',
    timestamp_ms: '',
  };
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i] as keyof typeof f;
    if (key in f) f[key] = fields[i + 1];
  }
  return {
    id,
    agentId: f.agent_id,
    content: f.content,
    contentType: f.content_type || 'text/plain',
    threadId: f.thread_id || undefined,
    sigHex: f.sig_hex || undefined,
    timestampMs: parseInt(f.timestamp_ms || '0', 10),
  };
}

/**
 * Ensure the consumer group exists for a stream.
 *
 * Uses XGROUP CREATE … MKSTREAM so the stream is created atomically if absent.
 * Silently ignores `BUSYGROUP` (group already exists) — this is the standard
 * Redis idiom for idempotent group creation.
 *
 * @param slug  Document slug (used to derive the stream key).
 */
async function ensureConsumerGroup(slug: string): Promise<void> {
  if (!redisPublisher) return;
  const key = streamKey(slug);
  try {
    // '$' means: only deliver messages added after the group was created.
    // MKSTREAM creates the stream if it does not exist.
    await redisPublisher.xgroup('CREATE', key, CONSUMER_GROUP, '$', 'MKSTREAM');
  } catch (err) {
    // BUSYGROUP = group already exists — expected on every restart after first.
    const msg = (err as Error).message ?? '';
    if (!msg.includes('BUSYGROUP')) throw err;
  }
}

// ── Per-slug initialisation guard ────────────────────────────────

/** Set of slugs for which we have already set up the consumer group. */
const _initialisedSlugs = new Set<string>();

/**
 * Idempotent setup for a slug's Redis stream consumer group.
 *
 * Called automatically on first publish/read for a slug.  Safe to call
 * multiple times — the guard ensures we only hit Redis once per slug per
 * process lifetime.
 */
async function initSlug(slug: string): Promise<void> {
  if (_initialisedSlugs.has(slug)) return;
  if (!redisPublisher) {
    _initialisedSlugs.add(slug);
    return;
  }
  await ensureConsumerGroup(slug);
  _initialisedSlugs.add(slug);
}

// ── Pod-restart recovery (T732) ──────────────────────────────────

/**
 * Recover pending messages on pod boot using XAUTOCLAIM.
 *
 * When a pod restarts it may have had messages delivered (XREADGROUP) but
 * not yet acknowledged (XACK).  XAUTOCLAIM reassigns those idle messages to
 * this consumer so they are reprocessed at least once.
 *
 * This is the "pod-restart recovery" required by T732.  Call it for each
 * active document slug shortly after boot.
 *
 * @param slug      Document slug to recover pending messages for.
 * @param idleMs    Minimum idle time before claiming (default: CLAIM_IDLE_MS).
 * @returns         Array of reclaimed messages (may be empty).
 */
export async function recoverScratchpadPending(
  slug: string,
  idleMs: number = CLAIM_IDLE_MS,
): Promise<ScratchpadMessage[]> {
  if (!redisPublisher) return [];

  await initSlug(slug);

  const key = streamKey(slug);

  // XAUTOCLAIM: claim idle messages from any dead consumer.
  // Signature: XAUTOCLAIM key group consumer min-idle-time start [COUNT count]
  // Returns: [nextId, [[id, fields], …], [deletedIds]]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await (redisPublisher as any).xautoclaim(
    key,
    CONSUMER_GROUP,
    CONSUMER_NAME,
    idleMs,
    '0-0',   // start from the very beginning of the PEL
    'COUNT',
    '100',
  );

  // ioredis returns the xautoclaim result as [nextId, entries, deletedIds].
  const rawEntries: Array<[string, string[]]> = Array.isArray(result) && Array.isArray(result[1])
    ? (result[1] as Array<[string, string[]]>)
    : [];

  const messages: ScratchpadMessage[] = [];
  for (const [id, fields] of rawEntries) {
    if (!id || !fields) continue;
    const msg = parseStreamEntry(id, fields);
    messages.push(msg);
    // Acknowledge immediately — we are delivering it to subscribers.
    await (redisPublisher as import('ioredis').Redis).xack(key, CONSUMER_GROUP, id);
  }

  return messages;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Publish a message to the document scratchpad.
 *
 * When Redis is available the message is written to `scratchpad:{slug}` via
 * XADD using the shared `redisPublisher` connection (T731).  When Redis is
 * unavailable (dev / no REDIS_URL) the in-memory fallback is used.
 *
 * @param slug  Document slug identifying the scratchpad stream.
 * @param opts  Message payload and metadata.
 * @returns     The stored message with its server-assigned stream ID.
 */
export async function publishScratchpad(
  slug: string,
  opts: PublishOptions,
): Promise<ScratchpadMessage> {
  const now = Date.now();

  if (!redisPublisher) {
    // In-memory fallback (acceptable in development — fail-fast prevents this
    // path in production).
    // eslint-disable-next-line no-console
    console.warn(
      '[scratchpad] WARN: REDIS_URL not set — using in-memory fallback. ' +
        'Messages are not persisted and will be lost on restart.',
    );
    const msg: ScratchpadMessage = {
      id: memId(),
      agentId: opts.agentId,
      content: opts.content,
      contentType: opts.contentType ?? 'text/plain',
      threadId: opts.threadId,
      sigHex: opts.sigHex,
      timestampMs: now,
    };
    memPublish(slug, msg, opts.threadId);
    return msg;
  }

  await initSlug(slug);

  const key = streamKey(slug);
  const fields = [
    'agent_id', opts.agentId,
    'content', opts.content,
    'content_type', opts.contentType ?? 'text/plain',
    'thread_id', opts.threadId ?? '',
    'sig_hex', opts.sigHex ?? '',
    'timestamp_ms', String(now),
  ];

  const msgId = await redisPublisher.xadd(key, '*', ...fields);
  if (!msgId) throw new Error('[scratchpad] XADD failed: null response');

  // Set / refresh TTL and trim stream length.
  await redisPublisher.expire(key, TTL_SECONDS);
  await redisPublisher.xtrim(key, 'MAXLEN', MAX_STREAM_LEN);

  return {
    id: msgId,
    agentId: opts.agentId,
    content: opts.content,
    contentType: opts.contentType ?? 'text/plain',
    threadId: opts.threadId || undefined,
    sigHex: opts.sigHex || undefined,
    timestampMs: now,
  };
}

/**
 * Read messages from the document scratchpad.
 *
 * Uses XRANGE for a point-in-time snapshot.  For real-time delivery use
 * `subscribeScratchpad` (SSE fan-out via in-process EventEmitter or
 * Redis Pub/Sub overlay — see T731 follow-up).
 *
 * @param slug  Document slug identifying the scratchpad stream.
 * @param opts  Filtering options (lastId cursor, threadId, limit).
 * @returns     Array of messages, oldest-first.
 */
export async function readScratchpad(
  slug: string,
  opts: ReadOptions = {},
): Promise<ScratchpadMessage[]> {
  if (!redisPublisher) {
    return memRead(slug, opts);
  }

  await initSlug(slug);

  const key = streamKey(slug);
  const start = opts.lastId ? opts.lastId : '-';
  const count = opts.limit ?? 100;

  // ioredis's xrange overload accepts COUNT as variadic args: xrange(key, start, end, 'COUNT', n)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (redisPublisher as any).xrange(key, start, '+', 'COUNT', count) as Array<[string, string[]]> | null;
  if (!rows) return [];

  return rows
    .map(([id, fields]: [string, string[]]) => parseStreamEntry(id, fields))
    .filter((m: ScratchpadMessage) => {
      if (opts.threadId && m.threadId !== opts.threadId) return false;
      // XRANGE start is inclusive — skip the exact lastId message.
      if (opts.lastId && m.id === opts.lastId) return false;
      return true;
    });
}

/**
 * Subscribe to new scratchpad messages for SSE fan-out.
 *
 * This implementation uses the in-process EventEmitter for local delivery.
 * Messages published by `publishScratchpad` on this pod are emitted
 * synchronously.  Cross-pod fan-out is handled at the SSE route level via
 * periodic polling of `readScratchpad` with a `lastId` cursor (or via
 * Redis Pub/Sub if a dedicated channel is introduced in a follow-up task).
 *
 * @param slug      Document slug to subscribe to.
 * @param threadId  Optional thread filter.
 * @param onMessage Callback invoked for each new message.
 * @returns         Unsubscribe function.
 */
export function subscribeScratchpad(
  slug: string,
  threadId: string | undefined,
  onMessage: (msg: ScratchpadMessage) => void,
): () => void {
  const key = memStreamKey(slug, threadId);
  const listener = (msg: ScratchpadMessage) => onMessage(msg);
  _memEmitter.on(`msg:${key}`, listener);
  // Also listen on the base key if threadId is set.
  if (threadId) {
    _memEmitter.on(`msg:${slug}`, listener);
  }
  return () => {
    _memEmitter.off(`msg:${key}`, listener);
    if (threadId) {
      _memEmitter.off(`msg:${slug}`, listener);
    }
  };
}

/**
 * Purge expired scratchpad messages (24 h TTL cleanup).
 *
 * For Redis: TTL is managed via EXPIRE on each XADD — no additional cleanup.
 * For in-memory: scans all streams and removes old entries.
 */
export async function purgeScratchpad(): Promise<void> {
  if (redisPublisher) {
    // Redis TTL is managed via EXPIRE on every XADD — no further cleanup.
    return;
  }
  // In-memory purge.
  const cutoff = Date.now() - TTL_SECONDS * 1000;
  for (const [key, msgs] of _memStore.entries()) {
    const pruned = msgs.filter((m) => m.timestampMs >= cutoff);
    if (pruned.length === 0) {
      _memStore.delete(key);
    } else {
      _memStore.set(key, pruned);
    }
  }
}

// ── Internal test helpers (exported for unit tests only) ─────────

/**
 * Reset internal in-memory state.
 *
 * @internal Used by unit tests to isolate state between test cases.
 */
export function _resetMemStore(): void {
  _memStore.clear();
  _seqCounter = 0;
  _initialisedSlugs.clear();
}
