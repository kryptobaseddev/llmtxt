/**
 * makeEventStream — factory that converts an EventEmitter channel into an
 * `AsyncIterable<T>` with proper back-pressure queue semantics.
 *
 * This is the shared implementation used by both LocalBackend and any
 * in-process EventEmitter adapter.  It MUST NOT be called with null/undefined
 * bus or channel.
 *
 * Back-pressure contract:
 *   - Events are buffered in an unbounded in-memory queue when the consumer
 *     is not yet awaiting the next value.
 *   - Calling `return()` on the iterator flushes the queue and removes the
 *     listener from the bus.
 */

/** Minimal EventEmitter surface required by makeEventStream. */
export interface EmitterLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * Create an `AsyncIterable<T>` backed by `emitter` channel `channel`.
 *
 * @param emitter  Any object implementing `on` / `off`.
 * @param channel  The event channel name to subscribe on.
 * @returns        An `AsyncIterable<T>` that yields every event emitted on
 *                 `channel` after the iterable is opened.
 */
export function makeEventStream<T>(
  emitter: EmitterLike,
  channel: string
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const queue: T[] = [];
      let resolve: ((value: IteratorResult<T>) => void) | null = null;
      let done = false;

      const handler = (...args: unknown[]) => {
        const event = args[0] as T;
        if (done) return;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: event, done: false });
        } else {
          queue.push(event);
        }
      };

      emitter.on(channel, handler);

      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (done) {
            return Promise.resolve({
              value: undefined as unknown as T,
              done: true,
            });
          }
          return new Promise<IteratorResult<T>>((res) => {
            resolve = res;
          });
        },
        return(): Promise<IteratorResult<T>> {
          done = true;
          emitter.off(channel, handler);
          // Drain any pending resolve to unblock awaiting callers.
          const r = resolve;
          resolve = null;
          if (r) r({ value: undefined as unknown as T, done: true });
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        },
      };
    },
  };
}
