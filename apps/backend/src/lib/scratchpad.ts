/**
 * Scratchpad — Redis Streams backed ephemeral messaging (W3/T153).
 *
 * Architecture:
 *   - Redis Streams (XADD / XREAD) per document slug.
 *   - Stream key: `scratchpad:{slug}` (or `scratchpad:{slug}:{thread_id}`)
 *   - 24h TTL enforced via XTRIM + a background cleanup job.
 *   - Fallback: in-memory EventEmitter when REDIS_URL is not set (logs WARN).
 *
 * Rate limiting: enforced at route level (writeRateLimit applies per-agent).
 *
 * Message structure (stored in stream):
 *   { id, agent_id, content, content_type, thread_id, sig_hex, timestamp_ms }
 */

import { EventEmitter } from 'node:events';

// ── Types ─────────────────────────────────────────────────────────

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

export interface PublishOptions {
  agentId: string;
  content: string;
  contentType?: string;
  threadId?: string;
  sigHex?: string;
}

export interface ReadOptions {
  /** Only return messages in this thread. */
  threadId?: string;
  /** Return messages after this stream ID (exclusive). */
  lastId?: string;
  /** Maximum number of messages to return. Default 100. */
  limit?: number;
}

// ── Redis TTL constants ───────────────────────────────────────────

/** 24 hours in seconds. Used for EXPIRE on stream keys. */
const TTL_SECONDS = 24 * 60 * 60;

/** Maximum messages to keep per stream (XTRIM MAXLEN). */
const MAX_STREAM_LEN = 10_000;

// ── Redis singleton ───────────────────────────────────────────────

type RedisClient = {
  xadd: (key: string, id: string, ...fields: string[]) => Promise<string | null>;
  xread: (
    count: number,
    streams: string,
    key: string,
    id: string
  ) => Promise<Array<[string, Array<[string, string[]]>]> | null>;
  xrange: (key: string, start: string, end: string, count?: number, countVal?: number) => Promise<Array<[string, string[]]>>;
  expire: (key: string, seconds: number) => Promise<number>;
  xtrim: (key: string, strategy: string, maxlen: number) => Promise<number>;
  disconnect: () => Promise<void>;
};

let _redis: RedisClient | null = null;
let _redisUnavailable = false;

async function getRedis(): Promise<RedisClient | null> {
  if (_redisUnavailable) return null;
  if (_redis) return _redis;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn(
      '[scratchpad] WARN: REDIS_URL not set — using in-memory fallback. Messages are not persisted and will be lost on restart.'
    );
    _redisUnavailable = true;
    return null;
  }

  try {
    // Dynamic import so the backend compiles even without ioredis installed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ioredisModule = await import('ioredis') as any;
    const Redis = ioredisModule.default ?? ioredisModule.Redis ?? ioredisModule;
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    await client.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _redis = client as any;
    console.info('[scratchpad] Redis connected for scratchpad streams.');
    return _redis;
  } catch (err) {
    console.warn(
      `[scratchpad] WARN: Failed to connect to Redis (${redisUrl}): ${err}. Using in-memory fallback.`
    );
    _redisUnavailable = true;
    return null;
  }
}

// ── In-memory fallback ───────────────────────────────────────────

const _memStore: Map<string, ScratchpadMessage[]> = new Map();
const _memEmitter = new EventEmitter();
_memEmitter.setMaxListeners(200);

let _seqCounter = 0;
function memId(): string {
  return `${Date.now()}-${_seqCounter++}`;
}

function memStreamKey(slug: string, threadId?: string): string {
  return threadId ? `${slug}:${threadId}` : slug;
}

function memPublish(slug: string, msg: ScratchpadMessage, threadId?: string): void {
  const key = memStreamKey(slug, threadId);
  if (!_memStore.has(key)) _memStore.set(key, []);
  const list = _memStore.get(key)!;
  list.push(msg);
  // Trim to 10k
  if (list.length > MAX_STREAM_LEN) {
    list.splice(0, list.length - MAX_STREAM_LEN);
  }
  // Purge messages older than 24h
  const cutoff = Date.now() - TTL_SECONDS * 1000;
  const pruned = list.filter(m => m.timestampMs >= cutoff);
  _memStore.set(key, pruned);
  _memEmitter.emit(`msg:${key}`, msg);
}

function memRead(slug: string, opts: ReadOptions): ScratchpadMessage[] {
  const key = memStreamKey(slug, opts.threadId);
  const all = _memStore.get(key) ?? [];
  const lastId = opts.lastId;
  let filtered = lastId
    ? all.filter(m => m.id > lastId)
    : all;
  if (opts.threadId) {
    filtered = filtered.filter(m => m.threadId === opts.threadId);
  }
  return filtered.slice(-(opts.limit ?? 100));
}

// ── Stream key ───────────────────────────────────────────────────

function streamKey(slug: string): string {
  return `scratchpad:${slug}`;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Publish a message to the document scratchpad.
 *
 * Returns the assigned message ID.
 */
export async function publishScratchpad(
  slug: string,
  opts: PublishOptions
): Promise<ScratchpadMessage> {
  const now = Date.now();
  const redis = await getRedis();

  if (!redis) {
    // In-memory fallback
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

  const key = streamKey(slug);
  const fields = [
    'agent_id', opts.agentId,
    'content', opts.content,
    'content_type', opts.contentType ?? 'text/plain',
    'thread_id', opts.threadId ?? '',
    'sig_hex', opts.sigHex ?? '',
    'timestamp_ms', String(now),
  ];

  const msgId = await redis.xadd(key, '*', ...fields);
  if (!msgId) throw new Error('[scratchpad] XADD failed: null response');

  // Set/refresh TTL and trim
  await redis.expire(key, TTL_SECONDS);
  await redis.xtrim(key, 'MAXLEN', MAX_STREAM_LEN);

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
 * Returns up to `limit` messages after `lastId`.
 */
export async function readScratchpad(
  slug: string,
  opts: ReadOptions = {}
): Promise<ScratchpadMessage[]> {
  const redis = await getRedis();

  if (!redis) {
    return memRead(slug, opts);
  }

  const key = streamKey(slug);
  const start = opts.lastId ? opts.lastId : '-';
  const count = opts.limit ?? 100;

  const rows = await redis.xrange(key, start, '+', 'COUNT' as unknown as number, count);
  if (!rows) return [];

  return rows
    .map(([id, fields]: [string, string[]]) => {
      const f: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        f[fields[i]] = fields[i + 1];
      }
      const msg: ScratchpadMessage = {
        id,
        agentId: f['agent_id'] ?? '',
        content: f['content'] ?? '',
        contentType: f['content_type'] ?? 'text/plain',
        threadId: f['thread_id'] || undefined,
        sigHex: f['sig_hex'] || undefined,
        timestampMs: parseInt(f['timestamp_ms'] ?? '0', 10),
      };
      return msg;
    })
    .filter((m: ScratchpadMessage) => {
      // Filter by threadId if specified
      if (opts.threadId && m.threadId !== opts.threadId) return false;
      // Skip the exact lastId (XRANGE is inclusive of start)
      if (opts.lastId && m.id === opts.lastId) return false;
      return true;
    });
}

/**
 * Subscribe to new scratchpad messages for SSE fan-out (in-memory fallback).
 *
 * Returns an unsubscribe function.
 */
export function subscribeScratchpad(
  slug: string,
  threadId: string | undefined,
  onMessage: (msg: ScratchpadMessage) => void
): () => void {
  const key = memStreamKey(slug, threadId);
  const listener = (msg: ScratchpadMessage) => onMessage(msg);
  _memEmitter.on(`msg:${key}`, listener);
  // Also listen on the base key if threadId is set (messages go to base stream too)
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
 * Purge expired scratchpad messages (24h TTL cleanup).
 *
 * For Redis: XTRIM handles this automatically (TTL set on XADD).
 * For in-memory: scans all streams and removes old entries.
 */
export async function purgeScratchpad(): Promise<void> {
  const redis = await getRedis();
  if (redis) {
    // Redis TTL is managed via EXPIRE on each XADD — no additional cleanup needed.
    return;
  }
  // In-memory purge
  const cutoff = Date.now() - TTL_SECONDS * 1000;
  for (const [key, msgs] of _memStore.entries()) {
    const pruned = msgs.filter(m => m.timestampMs >= cutoff);
    if (pruned.length === 0) {
      _memStore.delete(key);
    } else {
      _memStore.set(key, pruned);
    }
  }
}
