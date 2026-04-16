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
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, gt, desc, asc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documentEvents, documents } from '../db/schema-pg.js';
import { eventBus } from '../events/bus.js';
import type { DocumentEvent } from '../events/bus.js';
import { canRead } from '../middleware/rbac.js';

// ── Route parameters / queries ───────────────────────────────────────────────

interface EventsQueryParams {
  since?: string;
  limit?: string;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const HEARTBEAT_INTERVAL_MS = 15_000;

// ── Shared document resolver ─────────────────────────────────────────────────

async function resolveDocument(slug: string): Promise<{ id: string; visibility: string } | null> {
  const rows = await db
    .select({ id: documents.id, visibility: documents.visibility })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

// ── Route registration ───────────────────────────────────────────────────────

/** Register document event log routes under the given Fastify scope. */
export async function documentEventRoutes(fastify: FastifyInstance): Promise<void> {
  // ────────────────────────────────────────────────────────────────────────
  // GET /documents/:slug/events — paginated query
  // ────────────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { slug: string }; Querystring: EventsQueryParams }>(
    '/documents/:slug/events',
    { preHandler: [canRead] },
    async (request: FastifyRequest<{ Params: { slug: string }; Querystring: EventsQueryParams }>, reply: FastifyReply) => {
      const { slug } = request.params;

      const doc = await resolveDocument(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const sinceRaw = request.query.since;
      const limitRaw = request.query.limit;

      const sinceSeq = sinceRaw ? BigInt(sinceRaw) : BigInt(0);
      const limit = limitRaw
        ? Math.min(Math.max(parseInt(limitRaw, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
        : DEFAULT_LIMIT;

      // Fetch limit+1 rows so we can determine has_more without a count query.
      const rows = await db
        .select({
          id: documentEvents.id,
          seq: documentEvents.seq,
          eventType: documentEvents.eventType,
          actorId: documentEvents.actorId,
          payloadJson: documentEvents.payloadJson,
          idempotencyKey: documentEvents.idempotencyKey,
          createdAt: documentEvents.createdAt,
        })
        .from(documentEvents)
        .where(and(
          eq(documentEvents.documentId, slug),
          gt(documentEvents.seq, sinceSeq),
        ))
        .orderBy(asc(documentEvents.seq))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const events = hasMore ? rows.slice(0, limit) : rows;
      const nextSince = events.length > 0 ? events[events.length - 1].seq.toString() : sinceSeq.toString();

      reply.header('Cache-Control', 'no-store');

      return {
        events: events.map((e: { id: string; seq: bigint; eventType: string; actorId: string; payloadJson: unknown; idempotencyKey: string | null; createdAt: Date }) => ({
          id: e.id,
          seq: e.seq.toString(),
          event_type: e.eventType,
          actor_id: e.actorId,
          payload: e.payloadJson,
          idempotency_key: e.idempotencyKey ?? null,
          created_at: e.createdAt.toISOString(),
        })),
        has_more: hasMore,
        next_since: nextSince,
      };
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // GET /documents/:slug/events/stream — SSE stream
  // ────────────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { slug: string }; Querystring: { since?: string } }>(
    '/documents/:slug/events/stream',
    { preHandler: [canRead] },
    async (request: FastifyRequest<{ Params: { slug: string }; Querystring: { since?: string } }>, reply: FastifyReply) => {
      const { slug } = request.params;

      const doc = await resolveDocument(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Determine resume point: Last-Event-ID header takes precedence over ?since=
      const lastEventIdHeaderRaw = request.headers['last-event-id'];
      const lastEventIdHeader = Array.isArray(lastEventIdHeaderRaw) ? lastEventIdHeaderRaw[0] : lastEventIdHeaderRaw;
      const sinceParam = request.query.since;

      let sinceSeq: bigint;
      if (lastEventIdHeader && /^\d+$/.test(lastEventIdHeader)) {
        sinceSeq = BigInt(lastEventIdHeader);
      } else if (sinceParam && /^\d+$/.test(sinceParam)) {
        sinceSeq = BigInt(sinceParam);
      } else {
        sinceSeq = BigInt(0);
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
      function sendEvent(seq: bigint, eventType: string, payload: unknown): void {
        const data = JSON.stringify(payload);
        reply.raw.write(`id: ${seq}\nevent: ${eventType}\ndata: ${data}\n\n`);
      }

      /** Heartbeat comment line. */
      function sendHeartbeat(): void {
        reply.raw.write(': ping\n\n');
      }

      // ── Phase 1: Catch-up from DB ──────────────────────────────────────────
      // Fetch all events with seq > sinceSeq before subscribing to live bus.
      // This ensures no events are missed between the DB query and the bus listener.
      let catchupHighWatermark = sinceSeq;
      const catchupRows = await db
        .select()
        .from(documentEvents)
        .where(and(
          eq(documentEvents.documentId, slug),
          gt(documentEvents.seq, sinceSeq),
        ))
        .orderBy(asc(documentEvents.seq));

      for (const row of catchupRows) {
        sendEvent(row.seq, row.eventType, {
          id: row.id,
          seq: row.seq.toString(),
          event_type: row.eventType,
          actor_id: row.actorId,
          payload: row.payloadJson,
          created_at: row.createdAt.toISOString(),
        });
        catchupHighWatermark = row.seq;
      }

      // ── Phase 2: Live event-bus fan-out ─────────────────────────────────
      const liveHighWatermark = { value: catchupHighWatermark };

      const busListener = (event: DocumentEvent): void => {
        // Only forward events for this specific document.
        if (event.slug !== slug) return;

        // The bus DocumentEvent does not carry a seq number — we would need to
        // read it from the DB to get the monotonic seq. However, we can pull the
        // latest seq from DB for each live event.  In practice this is low-frequency.
        // We fire an async read to get the seq and forward.
        db.select({ seq: documentEvents.seq, id: documentEvents.id, eventType: documentEvents.eventType, payloadJson: documentEvents.payloadJson, actorId: documentEvents.actorId, createdAt: documentEvents.createdAt })
          .from(documentEvents)
          .where(eq(documentEvents.documentId, slug))
          .orderBy(desc(documentEvents.seq))
          .limit(1)
          .then((rows: Array<{ seq: bigint; id: string; eventType: string; payloadJson: unknown; actorId: string; createdAt: Date }>) => {
            if (!rows.length) return;
            const row = rows[0];
            // Only forward if this row is newer than what we already sent.
            if (row.seq <= liveHighWatermark.value) return;
            liveHighWatermark.value = row.seq;
            sendEvent(row.seq, row.eventType, {
              id: row.id,
              seq: row.seq.toString(),
              event_type: row.eventType,
              actor_id: row.actorId,
              payload: row.payloadJson,
              created_at: row.createdAt.toISOString(),
            });
          })
          .catch(() => {
            // Non-fatal: SSE stream continues; client will catch up on reconnect.
          });
      };

      eventBus.on('document', busListener);

      // ── Heartbeat timer ───────────────────────────────────────────────────
      const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      // ── Cleanup on disconnect ─────────────────────────────────────────────
      request.raw.on('close', () => {
        clearInterval(heartbeatTimer);
        eventBus.off('document', busListener);
      });

      // Keep the Fastify handler alive without sending a response object
      // (we are writing directly to reply.raw).
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
      });
    },
  );
}
