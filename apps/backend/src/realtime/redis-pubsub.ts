/**
 * Redis pub/sub adapter for CRDT update broadcast across backend instances.
 *
 * When REDIS_URL is set, every persisted CRDT update is published to a channel
 * `crdt:<slug>:<sectionId>`. All backend instances subscribe on startup and
 * fanout received messages to their local WebSocket clients.
 *
 * When REDIS_URL is NOT set, falls back to an in-process EventEmitter (single-
 * instance mode). A WARN is logged once at startup.
 *
 * Channel naming: `crdt:<documentId>:<sectionId>`
 *
 * Message format (binary-safe): Buffer with the raw Yrs update bytes.
 * The channel name carries the routing key; the payload IS the update.
 *
 * Design notes:
 * - Uses ioredis with two connections: one for publish, one for subscribe.
 *   A single ioredis connection cannot do both publish and subscribe at the
 *   same time once `subscribe()` is called (Redis protocol constraint).
 * - If the REDIS_URL env is absent, the module uses an in-process EventEmitter
 *   that is 100% compatible with the same interface — callers need not branch.
 */

import { EventEmitter } from 'node:events';

// ── Types ────────────────────────────────────────────────────────────────────

type UpdateListener = (documentId: string, sectionId: string, update: Buffer) => void;

interface CrdtPubSub {
  publish(documentId: string, sectionId: string, update: Buffer): Promise<void>;
  subscribe(documentId: string, sectionId: string, listener: UpdateListener): () => void;
}

// ── In-process EventEmitter fallback ─────────────────────────────────────────

class InProcessPubSub implements CrdtPubSub {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  async publish(documentId: string, sectionId: string, update: Buffer): Promise<void> {
    const channel = `crdt:${documentId}:${sectionId}`;
    this.emitter.emit(channel, documentId, sectionId, update);
  }

  subscribe(documentId: string, sectionId: string, listener: UpdateListener): () => void {
    const channel = `crdt:${documentId}:${sectionId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }
}

// ── Redis pub/sub ─────────────────────────────────────────────────────────────

class RedisPubSub implements CrdtPubSub {
  // Lazily resolved — set in `init()`
  private publishClient: import('ioredis').Redis | null = null;
  private subscribeClient: import('ioredis').Redis | null = null;
  private readonly listeners = new Map<string, Set<UpdateListener>>();
  private ready = false;

  async init(redisUrl: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: Redis } = await import('ioredis') as any;

    this.publishClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    }) as import('ioredis').Redis;

    this.subscribeClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    }) as import('ioredis').Redis;

    const subClient = this.subscribeClient as import('ioredis').Redis;

    // Re-subscribe on reconnect (Redis drops subscriptions on disconnect)
    subClient.on('ready', () => {
      const channels = Array.from(this.listeners.keys());
      if (channels.length > 0) {
        void subClient.subscribe(...channels);
      }
    });

    // Route inbound messages to local listeners
    subClient.on('messageBuffer', (channelBuf: Buffer, messageBuf: Buffer) => {
      const channel = channelBuf.toString('utf8');
      const listeners = this.listeners.get(channel);
      if (!listeners || listeners.size === 0) return;

      // channel = 'crdt:<documentId>:<sectionId>'
      const parts = channel.split(':');
      if (parts.length < 3) return;
      const documentId = parts[1];
      const sectionId = parts.slice(2).join(':'); // sectionId may contain colons

      for (const fn of listeners) {
        try {
          fn(documentId, sectionId, messageBuf);
        } catch {
          // Individual listener errors must not propagate
        }
      }
    });

    this.ready = true;
  }

  async publish(documentId: string, sectionId: string, update: Buffer): Promise<void> {
    if (!this.ready || !this.publishClient) return;
    const channel = `crdt:${documentId}:${sectionId}`;
    try {
      // ioredis accepts Buffer args for binary-safe publish
      await (this.publishClient as import('ioredis').Redis).publish(channel, update as unknown as string);
    } catch (err) {
      console.error('[crdt-pubsub] publish error:', err);
    }
  }

  subscribe(documentId: string, sectionId: string, listener: UpdateListener): () => void {
    const channel = `crdt:${documentId}:${sectionId}`;

    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      // Subscribe the Redis channel if this is the first listener
      if (this.ready && this.subscribeClient) {
        void this.subscribeClient.subscribe(channel);
      }
    }
    set.add(listener);

    return () => {
      const s = this.listeners.get(channel);
      if (s) {
        s.delete(listener);
        if (s.size === 0) {
          this.listeners.delete(channel);
          if (this.ready && this.subscribeClient) {
            void this.subscribeClient.unsubscribe(channel);
          }
        }
      }
    };
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

let _pubsub: CrdtPubSub | null = null;

/**
 * Initialize the CRDT pub/sub adapter.
 *
 * Must be called once at server startup (before routes are registered).
 * Idempotent — subsequent calls are no-ops.
 */
export async function initCrdtPubSub(): Promise<void> {
  if (_pubsub) return; // already initialised

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn(
      '[crdt-pubsub] WARN: REDIS_URL not configured — multi-instance broadcast disabled. ' +
        'All CRDT updates will only be delivered to clients on the same instance.',
    );
    _pubsub = new InProcessPubSub();
    return;
  }

  const redis = new RedisPubSub();
  await redis.init(redisUrl);
  _pubsub = redis;
  console.log('[crdt-pubsub] Redis pub/sub initialized');
}

/**
 * Get the initialized pub/sub adapter.
 *
 * Throws if `initCrdtPubSub()` has not been called.
 */
function getPubSub(): CrdtPubSub {
  if (!_pubsub) {
    // Lazily fall back to in-process mode if init was never called
    _pubsub = new InProcessPubSub();
  }
  return _pubsub;
}

/**
 * Publish a CRDT update to all subscribers (both local and cross-instance).
 */
export async function publishCrdtUpdate(
  documentId: string,
  sectionId: string,
  update: Buffer,
): Promise<void> {
  await getPubSub().publish(documentId, sectionId, update);
}

/**
 * Subscribe to CRDT updates for a (documentId, sectionId) pair.
 *
 * Returns an unsubscribe function — call it when the WebSocket closes.
 */
export function subscribeCrdtUpdates(
  documentId: string,
  sectionId: string,
  listener: UpdateListener,
): () => void {
  return getPubSub().subscribe(documentId, sectionId, listener);
}
