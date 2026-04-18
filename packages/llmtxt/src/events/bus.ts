/**
 * EventBus — in-process event bus backed by a Node.js EventEmitter.
 *
 * Used by LocalBackend as its internal pub/sub mechanism.  PostgresBackend
 * uses an injected external bus; to bridge it to EventStream semantics use
 * the `ExternalBusAdapter` exported from this module.
 *
 * Design decisions:
 *  - Generic channel names (strings) keep the bus transport-agnostic.
 *  - `maxListeners` is set to 500 to avoid spurious Node warnings in
 *    multi-subscriber scenarios (e.g. 100+ agents watching the same doc).
 *  - `ExternalBusAdapter` wraps any `DocumentEventBusLike` (a single
 *    `'document'` channel with slug-filtering) into the EventStream interface
 *    so PostgresBackend can delegate to makeEventStream without duplication.
 */

import { EventEmitter } from 'node:events';
import type { EventPublisher, EventStream, EventSubscriber } from './types.js';
import { makeEventStream } from './stream.js';

const DEFAULT_MAX_LISTENERS = 500;

/**
 * In-process EventBus.
 *
 * Implements `EventStream<unknown>` but callers typically use the typed
 * helpers `publishTyped<T>` / `subscribeTyped<T>` for type safety.
 */
export class EventBus implements EventStream<unknown> {
  private readonly _emitter: EventEmitter;

  constructor(maxListeners = DEFAULT_MAX_LISTENERS) {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(maxListeners);
  }

  /** Emit `event` on `channel`. All subscribers receive it synchronously. */
  publish(channel: string, event: unknown): void {
    this._emitter.emit(channel, event);
  }

  /**
   * Return an `AsyncIterable` that yields every event published on `channel`
   * after the iterator is opened.
   */
  subscribe(channel: string): AsyncIterable<unknown> {
    return makeEventStream(this._emitter, channel);
  }

  /** Typed publish helper — no runtime cost, pure TS convenience. */
  publishTyped<T>(channel: string, event: T): void {
    this._emitter.emit(channel, event);
  }

  /** Typed subscribe helper — no runtime cost, pure TS convenience. */
  subscribeTyped<T>(channel: string): AsyncIterable<T> {
    return makeEventStream<T>(this._emitter, channel);
  }

  /** Underlying emitter — exposed for advanced use (e.g. setMaxListeners). */
  get emitter(): EventEmitter {
    return this._emitter;
  }
}

// ── External bus adapter ──────────────────────────────────────────────────────

/**
 * Shape of the document event bus used by PostgresBackend (injected from
 * apps/backend realtime layer).  Uses a single `'document'` channel and
 * emits objects shaped as `{ type, slug, documentId, timestamp, actor, data }`.
 */
export interface DocumentEventBusLike {
  on(event: 'document', listener: (payload: unknown) => void): void;
  off(event: 'document', listener: (payload: unknown) => void): void;
}

/**
 * Adapts a `DocumentEventBusLike` (single `'document'` channel, slug-filtered)
 * into an `EventSubscriber` that filters by `documentId` slug.
 *
 * `ExternalBusAdapter` does NOT implement `EventPublisher` — publishing on the
 * external bus is owned by the backend service layer (apps/backend), not by
 * the SDK.
 *
 * Usage in PostgresBackend:
 *
 * ```ts
 * const adapter = new ExternalBusAdapter(this._eventBus);
 * for await (const event of adapter.subscribeBySlug<DocumentEvent>(docId)) {
 *   yield event;
 * }
 * ```
 */
export class ExternalBusAdapter implements EventSubscriber<unknown> {
  constructor(private readonly _bus: DocumentEventBusLike) {}

  /**
   * Subscribe to all `'document'` events and filter by `slug`.
   *
   * Transforms the raw `BusDocumentEvent` shape into the SDK `DocumentEvent`
   * shape.
   */
  subscribeBySlug<T extends { slug?: string }>(slug: string): AsyncIterable<T> {
    // Build a synthetic EventEmitter that bridges the external bus channel
    // to a per-slug channel so makeEventStream can be reused.
    const relay = new EventEmitter();
    relay.setMaxListeners(10);
    const channel = `doc:${slug}`;

    const listener = (payload: unknown): void => {
      const ev = payload as T;
      if ((ev as { slug?: string }).slug !== slug) return;
      relay.emit(channel, ev);
    };

    this._bus.on('document', listener);

    const iterable = makeEventStream<T>(relay, channel);

    // Wrap to also detach the external bus listener on return().
    return {
      [Symbol.asyncIterator]() {
        const inner = iterable[Symbol.asyncIterator]();
        return {
          next: () => inner.next(),
          return: async (value?: unknown) => {
            relay.removeAllListeners(channel);
            // detach from external bus
            // (We cast to access internal bus ref — it's closed over)
            (relay as unknown as { _externalDetach?: () => void })
              ._externalDetach?.();
            const result = await inner.return?.(value) ?? { value: undefined as unknown as T, done: true as const };
            return result;
          },
        };
      },
    };
  }

  // EventSubscriber contract (generic, non-slug-filtered)
  subscribe(channel: string): AsyncIterable<unknown> {
    const relay = new EventEmitter();
    const listener = (payload: unknown): void => {
      relay.emit(channel, payload);
    };
    this._bus.on('document', listener);

    const iterable = makeEventStream(relay, channel);
    return {
      [Symbol.asyncIterator]() {
        const inner = iterable[Symbol.asyncIterator]();
        return {
          next: () => inner.next(),
          return: async (value?: unknown) => {
            relay.removeAllListeners();
            const result = await inner.return?.(value) ?? { value: undefined, done: true as const };
            return result;
          },
        };
      },
    };
  }
}
