/**
 * Document event log routes.
 *
 * GET /api/v1/documents/:slug/events
 *   Query the append-only event log with cursor-based pagination.
 *   Returns { events, has_more, next_since } with Cache-Control: no-store.
 *
 * GET /api/v1/documents/:slug/events/stream
 *   Server-Sent Events stream. Catches up from DB then switches to live
 *   event-bus fan-out. Supports Last-Event-ID and ?since= for resume.
 *   Each SSE event: id:<seq>\nevent:<type>\ndata:<json>\n\n
 *   Heartbeat: `: ping\n\n` every 15 seconds.
 *
 * Access control: public documents are unauthenticated; private documents
 * require auth (checked via canRead middleware on the parent document).
 *
 * Wave B (T353.5): Refactored to use fastify.backendCore.queryEvents and
 * fastify.backendCore.subscribeStream instead of direct Drizzle queries.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { canRead } from '../middleware/rbac.js';
import { shutdownCoordinator } from '../lib/shutdown.js';
import { db } from '../db/index.js';
import { documentEvents } from '../db/schema-pg.js';
import { eq, desc } from 'drizzle-orm';

// ── Active SSE response registry for graceful shutdown (T092) ────────────────

/**
 * Set of all currently-open ServerResponse objects for SSE streams.
 * Each entry's close() will write the retry event and end the stream.
 */
const _activeSseStreams = new Set<{
  writeRetryAndClose(): void;
}>();

/** Drain hook: send SSE retry:5000 event to all open streams and close them. */
shutdownCoordinator.registerDrainHook('sse-document-events', async () => {
  const streams = Array.from(_activeSseStreams);
  for (const stream of streams) {
    try {
      stream.writeRetryAndClose();
    } catch {
      // Already closed
    }
  }
  _activeSseStreams.clear();
});

// ── Route parameters / queries ───────────────────────────────────────────────

interface EventsQueryParams {
  since?: string;
  limit?: string;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const HEARTBEAT_INTERVAL_MS = 15_000;

// ── Route registration ───────────────────────────────────────────────────────

/** Register document event log routes under the given Fastify scope. */
export async function documentEventRoutes(fastify: FastifyInstance): Promise<void> {
  // ────────────────────────────────────────────────────────────────────────
  // GET /documents/:slug/events — paginated query
  // ────────────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { slug: string }; Querystring: EventsQueryParams }>(
    '/documents/:slug/events',
    { preHandler: [canRead] },
    async (
      request: FastifyRequest<{ Params: { slug: string }; Querystring: EventsQueryParams }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;

      // Verify the document exists
      const doc = await request.server.backendCore.getDocumentBySlug(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const sinceRaw = request.query.since;
      const limitRaw = request.query.limit;

      const limit = limitRaw
        ? Math.min(Math.max(parseInt(limitRaw, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
        : DEFAULT_LIMIT;

      const result = await request.server.backendCore.queryEvents({
        documentId: slug,
        since: sinceRaw,
        limit,
      });

      reply.header('Cache-Control', 'no-store');

      return {
        events: result.items.map((e) => ({
          id: e.id,
          // seq is not part of the Backend DocumentEvent type — we include it
          // for wire compatibility. The backendCore returns it via the raw seq
          // stored in the payload as 'seq' if present, otherwise we omit it.
          event_type: e.type,
          actor_id: e.agentId,
          payload: e.payload,
          created_at: new Date(e.createdAt).toISOString(),
        })),
        has_more: result.nextCursor !== null,
        next_since: result.nextCursor ?? sinceRaw ?? '0',
      };
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // GET /documents/:slug/events/stream — SSE stream
  // ────────────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { slug: string }; Querystring: { since?: string } }>(
    '/documents/:slug/events/stream',
    { preHandler: [canRead] },
    async (
      request: FastifyRequest<{ Params: { slug: string }; Querystring: { since?: string } }>,
      reply: FastifyReply,
    ) => {
      const { slug } = request.params;

      const doc = await request.server.backendCore.getDocumentBySlug(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Determine resume point: Last-Event-ID header takes precedence over ?since=
      const lastEventIdHeaderRaw = request.headers['last-event-id'];
      const lastEventIdHeader = Array.isArray(lastEventIdHeaderRaw)
        ? lastEventIdHeaderRaw[0]
        : lastEventIdHeaderRaw;
      const sinceParam = request.query.since;

      let sinceSeq: string | undefined;
      if (lastEventIdHeader && /^\d+$/.test(lastEventIdHeader)) {
        sinceSeq = lastEventIdHeader;
      } else if (sinceParam && /^\d+$/.test(sinceParam)) {
        sinceSeq = sinceParam;
      }

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.flushHeaders();

      /** Serialize one event as SSE. */
      function sendSseEvent(id: string, eventType: string, payload: unknown): void {
        const data = JSON.stringify(payload);
        reply.raw.write(`id: ${id}\nevent: ${eventType}\ndata: ${data}\n\n`);
      }

      /** Heartbeat comment line. */
      function sendHeartbeat(): void {
        reply.raw.write(': ping\n\n');
      }

      /** Send retry directive and end the stream (T092 AC4). */
      function writeRetryAndClose(): void {
        try {
          reply.raw.write('retry: 5000\n\n');
          reply.raw.end();
        } catch {
          // Already closed
        }
      }

      // ── Phase 1: Catch-up from DB ──────────────────────────────────────────
      // Fetch all events since sinceSeq before subscribing to live stream.
      const catchupResult = await request.server.backendCore.queryEvents({
        documentId: slug,
        since: sinceSeq,
        limit: MAX_LIMIT,
      });

      let highWatermark = sinceSeq ?? '0';

      for (const event of catchupResult.items) {
        const eventId = event.id;
        sendSseEvent(eventId, event.type, {
          id: event.id,
          event_type: event.type,
          actor_id: event.agentId,
          payload: event.payload,
          created_at: new Date(event.createdAt).toISOString(),
        });
        highWatermark = event.id;
      }

      // ── Phase 2: Live event-bus fan-out via backendCore.subscribeStream ──
      const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      let streamClosed = false;
      const seenEventIds = new Set<string>();

      // Register this stream for graceful shutdown (T092 AC4)
      const streamEntry = { writeRetryAndClose };
      _activeSseStreams.add(streamEntry);

      request.raw.on('close', () => {
        streamClosed = true;
        clearInterval(heartbeatTimer);
        _activeSseStreams.delete(streamEntry);
      });

      // Consume the async iterable from subscribeStream.
      // subscribeStream yields events with id:'' because the in-process bus
      // does not carry the DB-assigned row UUID or seq. We resolve the latest
      // DB row for the slug (by seq DESC) on each bus event to get the real
      // id and seq for the SSE id: field and for deduplication. (T722 fix)
      const stream = request.server.backendCore.subscribeStream(slug);
      try {
        for await (const event of stream) {
          if (streamClosed) break;

          // Resolve the latest DB row for this document — this is the event
          // that triggered the bus notification, since the bus is emitted
          // after the DB write (persist-then-emit pattern in versions.ts).
          let resolvedId = event.id;
          let resolvedType = event.type;
          let resolvedActorId = event.agentId;
          let resolvedPayload = event.payload;
          let resolvedCreatedAt = new Date(event.createdAt).toISOString();

          if (!resolvedId) {
            // subscribeStream does not provide a DB row id — query for it.
            try {
              const rows = await db
                .select({
                  id: documentEvents.id,
                  seq: documentEvents.seq,
                  eventType: documentEvents.eventType,
                  payloadJson: documentEvents.payloadJson,
                  actorId: documentEvents.actorId,
                  createdAt: documentEvents.createdAt,
                })
                .from(documentEvents)
                .where(eq(documentEvents.documentId, slug))
                .orderBy(desc(documentEvents.seq))
                .limit(1);

              if (rows.length > 0) {
                const row = rows[0];
                resolvedId = row.id as string;
                resolvedType = row.eventType as string;
                resolvedActorId = row.actorId as string;
                resolvedPayload = row.payloadJson as Record<string, unknown>;
                resolvedCreatedAt = (row.createdAt as Date).toISOString();
              }
            } catch {
              // Non-fatal: fall back to bus data
            }
          }

          // Deduplicate: skip if we already delivered this event in catch-up
          // or in a prior iteration of the live fan-out loop.
          if (resolvedId && seenEventIds.has(resolvedId)) continue;
          if (resolvedId && resolvedId <= highWatermark) continue;
          if (resolvedId) {
            seenEventIds.add(resolvedId);
            highWatermark = resolvedId;
          }

          sendSseEvent(resolvedId || event.agentId, resolvedType, {
            id: resolvedId,
            event_type: resolvedType,
            actor_id: resolvedActorId,
            payload: resolvedPayload,
            created_at: resolvedCreatedAt,
          });
        }
      } catch {
        // Stream was closed by client disconnect — expected, not an error
      } finally {
        clearInterval(heartbeatTimer);
        _activeSseStreams.delete(streamEntry);
      }

      // Keep handler alive until disconnect
      if (!streamClosed) {
        await new Promise<void>((resolve) => {
          request.raw.on('close', resolve);
        });
      }
    },
  );
}
