/**
 * Contract tests for llmtxt/events subpath.
 *
 * Verifies:
 *   1. EventBus publisher/subscriber round-trip
 *   2. Ordered delivery (FIFO)
 *   3. Channel isolation (no cross-channel leakage)
 *   4. Subscription cleanup on return()
 *   5. makeEventStream directly
 *   6. Multiple concurrent subscribers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventBus, makeEventStream } from '../events/index.js';
import type { DocumentEvent, CrdtUpdate } from '../events/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDocumentEvent(overrides?: Partial<DocumentEvent>): DocumentEvent {
  return {
    id: 'evt-1',
    documentId: 'doc-1',
    type: 'version.created',
    agentId: 'agent-1',
    payload: {},
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeCrdtUpdate(overrides?: Partial<CrdtUpdate>): CrdtUpdate {
  return {
    documentId: 'doc-1',
    sectionKey: 'intro',
    updateBase64: 'AAAA',
    agentId: 'agent-1',
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Collect `n` items from an async iterable with a timeout. */
async function collect<T>(
  iterable: AsyncIterable<T>,
  n: number,
  timeoutMs = 1000
): Promise<T[]> {
  const results: T[] = [];
  const iter = iterable[Symbol.asyncIterator]();
  for (let i = 0; i < n; i++) {
    const p = iter.next();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`collect timeout after ${timeoutMs}ms`)), timeoutMs)
    );
    const result = await Promise.race([p, timeout]);
    results.push(result.value);
  }
  await iter.return?.();
  return results;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EventBus', () => {
  it('delivers a single event to a subscriber (round-trip)', async () => {
    const bus = new EventBus();
    const event = makeDocumentEvent();

    const stream = bus.subscribeTyped<DocumentEvent>('events:doc-1');
    const pCollect = collect(stream, 1);

    bus.publishTyped<DocumentEvent>('events:doc-1', event);

    const [received] = await pCollect;
    assert.deepEqual(received, event);
  });

  it('delivers events in FIFO order', async () => {
    const bus = new EventBus();
    const events = [
      makeDocumentEvent({ id: '1', createdAt: 1000 }),
      makeDocumentEvent({ id: '2', createdAt: 2000 }),
      makeDocumentEvent({ id: '3', createdAt: 3000 }),
    ];

    const stream = bus.subscribeTyped<DocumentEvent>('events:doc-1');
    const pCollect = collect(stream, 3);

    for (const e of events) bus.publishTyped('events:doc-1', e);

    const received = await pCollect;
    assert.deepEqual(
      received.map((e) => e.id),
      ['1', '2', '3'],
      'events must arrive in publish order'
    );
  });

  it('isolates channels — subscriber on channel A does not receive channel B events', async () => {
    const bus = new EventBus();
    const evtA = makeDocumentEvent({ id: 'A', documentId: 'doc-A' });
    const evtB = makeDocumentEvent({ id: 'B', documentId: 'doc-B' });

    const streamA = bus.subscribeTyped<DocumentEvent>('events:doc-A');
    const pCollect = collect(streamA, 1);

    // Publish to both channels
    bus.publishTyped('events:doc-B', evtB);
    bus.publishTyped('events:doc-A', evtA);

    const [received] = await pCollect;
    assert.equal(received.id, 'A', 'only channel-A event must arrive');
  });

  it('multiple subscribers on the same channel all receive the event', async () => {
    const bus = new EventBus();
    const event = makeDocumentEvent();

    const stream1 = bus.subscribeTyped<DocumentEvent>('events:doc-1');
    const stream2 = bus.subscribeTyped<DocumentEvent>('events:doc-1');
    const p1 = collect(stream1, 1);
    const p2 = collect(stream2, 1);

    bus.publishTyped('events:doc-1', event);

    const [r1] = await p1;
    const [r2] = await p2;
    assert.deepEqual(r1, event);
    assert.deepEqual(r2, event);
  });

  it('unsubscribes cleanly on return() — no events after close', async () => {
    const bus = new EventBus();

    const iter = bus.subscribeTyped<DocumentEvent>('events:doc-1')[Symbol.asyncIterator]();

    // Close the iterator before any events
    await iter.return?.();

    // Verify the emitter has no listeners left on this channel
    assert.equal(
      bus.emitter.listenerCount('events:doc-1'),
      0,
      'listener must be removed after return()'
    );
  });

  it('handles CRDT update round-trip', async () => {
    const bus = new EventBus();
    const update = makeCrdtUpdate();

    const stream = bus.subscribeTyped<CrdtUpdate>('crdt:doc-1:intro');
    const pCollect = collect(stream, 1);

    bus.publishTyped('crdt:doc-1:intro', update);

    const [received] = await pCollect;
    assert.deepEqual(received, update);
  });

  it('buffers events published before the consumer calls next()', async () => {
    const bus = new EventBus();
    const events = [
      makeDocumentEvent({ id: '1' }),
      makeDocumentEvent({ id: '2' }),
    ];

    const stream = bus.subscribeTyped<DocumentEvent>('events:doc-1');
    // Open the iterator FIRST so the listener is registered, then publish
    // before the consumer has called next().
    const iter = stream[Symbol.asyncIterator]();

    // Publish while no one is awaiting next() — events go into the queue
    for (const e of events) bus.publishTyped('events:doc-1', e);

    // Now drain — queued items must arrive in order
    const r1 = await iter.next();
    const r2 = await iter.next();
    await iter.return?.();

    assert.deepEqual(
      [r1.value.id, r2.value.id],
      ['1', '2'],
      'buffered events must be delivered in order'
    );
  });
});

describe('makeEventStream', () => {
  it('wraps a raw EventEmitter into an AsyncIterable', async () => {
    const emitter = new EventEmitter();
    const event = makeDocumentEvent();

    const stream = makeEventStream<DocumentEvent>(emitter, 'test:channel');
    const pCollect = collect(stream, 1);

    emitter.emit('test:channel', event);

    const [received] = await pCollect;
    assert.deepEqual(received, event);
  });

  it('removes listener from emitter when iterator is returned', async () => {
    const emitter = new EventEmitter();
    const stream = makeEventStream<DocumentEvent>(emitter, 'test:channel');
    const iter = stream[Symbol.asyncIterator]();

    assert.equal(emitter.listenerCount('test:channel'), 1);

    await iter.return?.();

    assert.equal(
      emitter.listenerCount('test:channel'),
      0,
      'listener must be removed after return()'
    );
  });

  it('ordered delivery with multiple events', async () => {
    const emitter = new EventEmitter();
    const events = [1, 2, 3, 4, 5].map((n) =>
      makeDocumentEvent({ id: String(n), createdAt: n })
    );

    const stream = makeEventStream<DocumentEvent>(emitter, 'ordered');
    const pCollect = collect(stream, 5);

    for (const e of events) emitter.emit('ordered', e);

    const received = await pCollect;
    assert.deepEqual(
      received.map((e) => e.id),
      ['1', '2', '3', '4', '5']
    );
  });
});
