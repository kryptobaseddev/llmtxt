/**
 * Differential SSE subscription endpoint — T295.
 *
 * GET /api/v1/subscribe?path=<pattern>[&since=<seq>]
 *
 * Opens an SSE stream. Events are filtered by the path pattern against
 * each event's canonical path (/docs/:slug or /docs/:slug/sections/:sid).
 * Supports Last-Event-ID for resume. Supports diff mode via Accept header.
 *
 * Accept: application/vnd.llmtxt.diff+json  → includes computed content diffs
 * Accept: application/json (default)         → raw event payloads
 *
 * Wave B (T353.5): Refactored to use fastify.backendCore where applicable.
 * The cross-document catch-up phase uses a raw Drizzle query because
 * backendCore.queryEvents is scoped to a single document. Live phase uses
 * the in-process eventBus (same bus that backendCore.subscribeStream wraps).
 * Path pattern matching and diff-mode logic are unchanged.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { documentEvents } from '../db/schema-pg.js';
import { gt, asc, eq } from 'drizzle-orm';
import { eventBus } from '../events/bus.js';
import type { DocumentEvent as BusDocumentEvent } from '../events/bus.js';
import { matchPath } from '../subscriptions/path-matcher.js';
import { computeSectionDelta } from '../subscriptions/diff-helper.js';
import { shutdownCoordinator } from '../lib/shutdown.js';

// ── Active SSE subscribe stream registry for graceful shutdown (T092) ─────────

const _activeSubscribeStreams = new Set<{
  writeRetryAndClose(): void;
}>();

shutdownCoordinator.registerDrainHook('sse-subscribe', async () => {
  const streams = Array.from(_activeSubscribeStreams);
  for (const stream of streams) {
    try {
      stream.writeRetryAndClose();
    } catch {
      // Already closed
    }
  }
  _activeSubscribeStreams.clear();
});

const HEARTBEAT_INTERVAL_MS = 15_000;
const DIFF_ACCEPT = 'application/vnd.llmtxt.diff+json';
const MAX_CATCHUP_LIMIT = 1000;

// ── Canonical path builder ────────────────────────────────────────────────────

/**
 * Convert a document event to a canonical path string for pattern matching.
 * E.g.:  slug='abc', sectionId='intro' → '/docs/abc/sections/intro'
 *        slug='abc', sectionId=null     → '/docs/abc'
 */
function eventToPath(slug: string, sectionId?: string | null): string {
  if (sectionId) return `/docs/${slug}/sections/${sectionId}`;
  return `/docs/${slug}`;
}

// ── Route registration ────────────────────────────────────────────────────────

export async function subscribeRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /subscribe?path=<pattern>[&since=<seq>]
   *
   * Opens an SSE stream delivering events matching the path pattern.
   * Backfills from DB before switching to live bus fan-out.
   */
  app.get<{
    Querystring: { path?: string; since?: string };
  }>(
    '/subscribe',
    async (request: FastifyRequest<{ Querystring: { path?: string; since?: string } }>, reply: FastifyReply) => {
      const pathPattern = request.query.path;
      if (!pathPattern) {
        return reply.status(400).send({ error: 'path query parameter is required' });
      }

      // Determine resume point
      const lastEventIdHeaderRaw = request.headers['last-event-id'];
      const lastEventIdHeader = Array.isArray(lastEventIdHeaderRaw) ? lastEventIdHeaderRaw[0] : lastEventIdHeaderRaw;
      const sinceParam = request.query.since;

      let sinceSeq = BigInt(0);
      if (lastEventIdHeader && /^\d+$/.test(lastEventIdHeader)) {
        sinceSeq = BigInt(lastEventIdHeader);
      } else if (sinceParam && /^\d+$/.test(sinceParam)) {
        sinceSeq = BigInt(sinceParam);
      }

      // Determine diff mode
      const acceptHeader = (request.headers.accept ?? '') as string;
      const diffMode = acceptHeader.includes(DIFF_ACCEPT);

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.flushHeaders();

      function sendSseEvent(id: string, eventType: string, payload: unknown): void {
        const data = JSON.stringify(payload);
        reply.raw.write(`id: ${id}\nevent: ${eventType}\ndata: ${data}\n\n`);
      }

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

      let streamClosed = false;
      const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      // Register for graceful shutdown (T092 AC4)
      const streamEntry = { writeRetryAndClose };
      _activeSubscribeStreams.add(streamEntry);

      request.raw.on('close', () => {
        streamClosed = true;
        clearInterval(heartbeatTimer);
        _activeSubscribeStreams.delete(streamEntry);
      });

      // ── Phase 1: Catch-up from DB ─────────────────────────────────────────
      // Cross-document query — uses raw Drizzle because backendCore.queryEvents
      // is scoped to a single document. Per coverage map, a future
      // ContentOps.queryAllEvents will replace this.
      let catchupHighWatermark = sinceSeq;

      try {
        const rows = await db
          .select()
          .from(documentEvents)
          .where(gt(documentEvents.seq, sinceSeq))
          .orderBy(asc(documentEvents.seq))
          .limit(MAX_CATCHUP_LIMIT);

        for (const row of rows) {
          if (streamClosed) break;

          const slug = row.documentId as string;
          const payload = row.payloadJson as Record<string, unknown>;
          const sectionId = (payload?.sectionId as string | undefined) ?? (payload?.section as string | undefined) ?? null;
          const canonicalPath = eventToPath(slug, sectionId);

          if (!matchPath(pathPattern, canonicalPath)) continue;

          const seqBigint = row.seq as bigint;
          const seqStr = seqBigint.toString();

          let eventPayload: Record<string, unknown> = {
            id: row.id,
            seq: seqStr,
            event_type: row.eventType,
            actor_id: row.actorId,
            payload: row.payloadJson,
            path: canonicalPath,
            created_at: row.createdAt.toISOString(),
          };

          if (diffMode && sectionId) {
            try {
              const delta = await computeSectionDelta(db, slug, sectionId, Number(seqBigint) - 1);
              if (delta) {
                eventPayload = { ...eventPayload, delta };
              }
            } catch {
              // Non-fatal: send without delta
            }
          }

          sendSseEvent(row.id, row.eventType, eventPayload);
          catchupHighWatermark = seqBigint;
        }
      } catch (err) {
        app.log.warn({ err }, '[subscribe] catch-up query failed (continuing with live stream)');
      }

      // ── Phase 2: Live event-bus fan-out ───────────────────────────────────
      // The eventBus is the same in-process bus that backendCore.subscribeStream
      // wraps. We subscribe directly here because we need cross-document filtering
      // via path pattern matching.
      const liveHighWatermark = { value: catchupHighWatermark };
      const seenIds = new Set<string>();

      const liveListener = (event: BusDocumentEvent): void => {
        const slug = event.slug;
        const sectionId = (event.data?.sectionId as string | undefined) ?? null;
        const canonicalPath = eventToPath(slug, sectionId);

        if (!matchPath(pathPattern, canonicalPath)) return;

        // Fetch the latest event row from DB to get seq for SSE id field
        db.select({
          seq: documentEvents.seq,
          id: documentEvents.id,
          eventType: documentEvents.eventType,
          payloadJson: documentEvents.payloadJson,
          actorId: documentEvents.actorId,
          createdAt: documentEvents.createdAt,
        })
          .from(documentEvents)
          .where(eq(documentEvents.documentId, slug))
          .orderBy(documentEvents.seq)
          .limit(1)
          .then(async (rows: Array<{
            seq: bigint;
            id: string;
            eventType: string;
            payloadJson: unknown;
            actorId: string;
            createdAt: Date;
          }>) => {
            if (!rows.length || streamClosed) return;
            const row = rows[0];

            // Skip if older than high watermark or already sent
            if (row.seq <= liveHighWatermark.value) return;
            if (seenIds.has(row.id)) return;
            seenIds.add(row.id);
            liveHighWatermark.value = row.seq;

            const seqStr = row.seq.toString();
            let eventPayload: Record<string, unknown> = {
              id: row.id,
              seq: seqStr,
              event_type: row.eventType,
              actor_id: row.actorId,
              payload: row.payloadJson,
              path: canonicalPath,
              created_at: row.createdAt.toISOString(),
            };

            if (diffMode && sectionId) {
              try {
                const delta = await computeSectionDelta(db, slug, sectionId, Number(row.seq) - 1);
                if (delta) {
                  eventPayload = { ...eventPayload, delta };
                }
              } catch {
                // Non-fatal
              }
            }

            sendSseEvent(row.id, row.eventType, eventPayload);
          })
          .catch(() => {
            // Non-fatal: client will catch up on reconnect
          });
      };

      eventBus.on('document', liveListener);

      // ── Cleanup on disconnect ──────────────────────────────────────────────
      request.raw.on('close', () => {
        clearInterval(heartbeatTimer);
        eventBus.off('document', liveListener);
        _activeSubscribeStreams.delete(streamEntry);
      });

      // Keep handler alive until disconnect
      if (!streamClosed) {
        await new Promise<void>((resolve) => {
          request.raw.on('close', resolve);
        });
      }
    },
  );
}
