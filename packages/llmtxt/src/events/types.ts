/**
 * llmtxt/events — shared event streaming types.
 *
 * These interfaces are implemented by EventBus (in-process) and any
 * adapter that wraps an external bus (Redis, BullMQ, etc.).
 */

// ── Core event types re-exported for consumer convenience ────────────────────

export type { DocumentEvent, CrdtUpdate } from '../core/backend.js';

// ── Publisher ─────────────────────────────────────────────────────────────────

/**
 * An object that can publish typed events onto a named channel.
 *
 * Implementations MUST be synchronous-safe — callers do not await publish().
 */
export interface EventPublisher<T> {
  /**
   * Emit `event` on `channel`.
   *
   * All active subscribers on `channel` MUST receive the event in FIFO order.
   * Delivery to a slow subscriber MUST NOT block other subscribers.
   */
  publish(channel: string, event: T): void;
}

// ── Subscriber ────────────────────────────────────────────────────────────────

/**
 * An object that can return an async iterable of typed events from a channel.
 *
 * The iterable MUST yield events in the order they were published.
 * Calling `return()` on the iterator MUST unsubscribe from the channel.
 */
export interface EventSubscriber<T> {
  /**
   * Return an `AsyncIterable<T>` that yields every event published on
   * `channel` after the subscription is opened.
   *
   * Past events (before the subscription was opened) MUST NOT be replayed
   * unless the implementation explicitly supports seek/cursor semantics.
   */
  subscribe(channel: string): AsyncIterable<T>;
}

// ── Combined stream interface ─────────────────────────────────────────────────

/**
 * A bidirectional event stream that can both publish and subscribe.
 */
export interface EventStream<T> extends EventPublisher<T>, EventSubscriber<T> {}
