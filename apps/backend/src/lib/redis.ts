/**
 * Shared Redis client factory — T727.
 *
 * Exports two ioredis instances that are safe to share across the
 * entire backend process:
 *
 *   redisPublisher   — for HSET / EXPIRE / PUBLISH commands.
 *   redisSubscriber  — dedicated connection for SUBSCRIBE / PSUBSCRIBE.
 *                      A connection in subscribe mode cannot issue regular
 *                      commands (Redis protocol constraint), so two clients
 *                      are always required.
 *
 * Both clients use exponential-backoff reconnection via ioredis's built-in
 * retryStrategy. The readiness state is exposed via isRedisReady() which is
 * consumed by the /api/ready endpoint.
 *
 * When REDIS_URL is absent the module exports null clients and emits a single
 * WARN. In non-production environments this is acceptable (CRDT pub/sub and
 * presence registry fall back to in-process mode). In production the fail-fast
 * check in index.ts will have already terminated the process before this module
 * is evaluated.
 *
 * Usage:
 *   import { redisPublisher, redisSubscriber, isRedisReady } from './redis.js';
 */

import { createRequire } from 'node:module';

// ── Type aliases (avoids "namespace-as-type" TS error in strict NodeNext mode) ─

type IORedisClient = import('ioredis').Redis;
type IORedisOptions = import('ioredis').RedisOptions;

// ── Connection options ────────────────────────────────────────────────────────

/** Maximum reconnect delay in milliseconds (caps exponential back-off). */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Base multiplier used for exponential reconnect delay calculation. */
const RECONNECT_BASE_DELAY_MS = 200;

/**
 * Build ioredis retry strategy: exponential back-off capped at 30 s.
 *
 * @param attempt  Number of consecutive failed connection attempts (1-based).
 * @returns        Delay in milliseconds before the next reconnect attempt.
 */
function retryStrategy(attempt: number): number {
  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
}

// ── Client factory ────────────────────────────────────────────────────────────

/**
 * Synchronously create an ioredis client using createRequire (CJS interop).
 *
 * We use createRequire instead of dynamic import so that the two shared clients
 * are available synchronously at module load time. The existing redis-pubsub.ts
 * uses `await import('ioredis') as any` inside an async init() — we cannot do
 * that here because this module initialises synchronously as a side effect.
 */
function createRedisClient(url: string): IORedisClient {
  const _require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ioredis = _require('ioredis') as any;
  const RedisConstructor = ioredis.default ?? ioredis.Redis ?? ioredis;

  const options: IORedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy,
    reconnectOnError: (err: Error) => err.message.startsWith('READONLY'),
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return
  return new RedisConstructor(url, options) as IORedisClient;
}

// ── Shared client creation ────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL;

let _publisher: IORedisClient | null = null;
let _subscriber: IORedisClient | null = null;

/** Whether at least one successful Redis connection has been established. */
let _publisherReady = false;
let _subscriberReady = false;

if (REDIS_URL) {
  _publisher = createRedisClient(REDIS_URL);
  _subscriber = createRedisClient(REDIS_URL);

  _publisher.on('ready', () => {
    _publisherReady = true;
    // eslint-disable-next-line no-console
    console.log('[redis] publisher connected');
  });

  _publisher.on('error', (err: Error) => {
    _publisherReady = false;
    // eslint-disable-next-line no-console
    console.error('[redis] publisher error:', err.message);
  });

  _publisher.on('close', () => {
    _publisherReady = false;
  });

  _subscriber.on('ready', () => {
    _subscriberReady = true;
    // eslint-disable-next-line no-console
    console.log('[redis] subscriber connected');
  });

  _subscriber.on('error', (err: Error) => {
    _subscriberReady = false;
    // eslint-disable-next-line no-console
    console.error('[redis] subscriber error:', err.message);
  });

  _subscriber.on('close', () => {
    _subscriberReady = false;
  });
} else {
  // eslint-disable-next-line no-console
  console.warn(
    '[redis] WARN: REDIS_URL not set — Redis clients are null. ' +
      'Presence registry and CRDT pub/sub will use in-process fallbacks. ' +
      'This is acceptable in development but MUST NOT occur in production.',
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * ioredis client for PUBLISH, HSET, EXPIRE, and all regular commands.
 *
 * Null when REDIS_URL is not configured (non-production in-process mode).
 * Production startup fails before this module is evaluated when REDIS_URL
 * is absent (see validateRedisUrl in lib/redis-config-validator.ts).
 */
export const redisPublisher: IORedisClient | null = _publisher;

/**
 * ioredis client dedicated to SUBSCRIBE / PSUBSCRIBE.
 *
 * A separate connection is required because once `subscribe()` is called
 * ioredis enters subscribe mode and regular commands are rejected.
 *
 * Null when REDIS_URL is not configured.
 */
export const redisSubscriber: IORedisClient | null = _subscriber;

/**
 * Return true when both Redis clients are connected and ready.
 *
 * Used by /api/ready to include Redis health in the readiness response.
 * Returns true trivially when REDIS_URL is absent (non-production fallback).
 */
export function isRedisReady(): boolean {
  if (!REDIS_URL) return true; // no Redis configured → not a dependency
  return _publisherReady && _subscriberReady;
}

/**
 * Gracefully disconnect both Redis clients.
 *
 * Called by the SIGTERM handler in index.ts during graceful shutdown so that
 * ioredis does not leave TCP connections dangling after the process exits.
 */
export async function disconnectRedis(): Promise<void> {
  const disconnects: Promise<void>[] = [];
  if (_publisher) disconnects.push(_publisher.quit().then(() => undefined));
  if (_subscriber) disconnects.push(_subscriber.quit().then(() => undefined));
  await Promise.allSettled(disconnects);
}
