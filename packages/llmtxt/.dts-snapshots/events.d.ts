/**
 * llmtxt/events — shared event streaming primitives.
 *
 * This subpath provides the infrastructure for document event streaming and
 * CRDT section update streaming across both LocalBackend and PostgresBackend.
 *
 * Public surface:
 *
 *   Types:
 *     EventPublisher<T>       — publish events onto a named channel
 *     EventSubscriber<T>      — subscribe to events from a named channel
 *     EventStream<T>          — publish + subscribe
 *     DocumentEvent           — re-export from core/backend
 *     CrdtUpdate              — re-export from core/backend
 *
 *   Classes:
 *     EventBus                — in-process bus (used by LocalBackend)
 *     ExternalBusAdapter      — bridges injected external bus (used by PG)
 *     DocumentEventBusLike    — interface type for the PG injected bus
 *
 *   Functions:
 *     makeEventStream<T>      — low-level: AsyncIterable from EmitterLike
 *
 * Usage:
 *
 *   ```ts
 *   import { EventBus } from 'llmtxt/events';
 *
 *   const bus = new EventBus();
 *   const stream = bus.subscribeTyped<DocumentEvent>('events:my-doc');
 *   bus.publishTyped('events:my-doc', { id: '...', ...event });
 *   ```
 */
export type { EventPublisher, EventSubscriber, EventStream } from './types.js';
export type { DocumentEvent, CrdtUpdate } from './types.js';
export { EventBus, ExternalBusAdapter } from './bus.js';
export type { DocumentEventBusLike } from './bus.js';
export { makeEventStream } from './stream.js';
export type { EmitterLike } from './stream.js';
//# sourceMappingURL=index.d.ts.map