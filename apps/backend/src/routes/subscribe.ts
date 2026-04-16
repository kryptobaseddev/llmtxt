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
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { documentEvents, documents } from '../db/schema-pg.js';
import { eq, gt, asc, and } from 'drizzle-orm';
import { eventBus } from '../events/bus.js';
import type { DocumentEvent } from '../events/bus.js';
import { matchPath } from '../subscriptions/path-matcher.js';
import { computeSectionDelta } from '../subscriptions/diff-helper.js';

const HEARTBEAT_INTERVAL_MS = 15_000;
const DIFF_ACCEPT = 'application/vnd.llmtxt.diff+json';

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

// ── Auth helper ───────────────────────────────────────────────────────────────

async function resolveUser(request: FastifyRequest): Promise<{ id: string } | null> {
  // Check Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    // Try token param (also accepted as ?token= query param for EventSource compat)
    if (token) return { id: token }; // simplified — real auth goes through middleware
  }
  const tokenParam = (request.query as Record<string, string>).token;
  if (tokenParam) return { id: tokenParam };
  return null;
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

      let sinceSeq: bigint;
      if (lastEventIdHeader && /^\d+$/.test(lastEventIdHeader)) {
        sinceSeq = BigInt(lastEventIdHeader);
      } else if (sinceParam && /^\d+$/.test(sinceParam)) {
        sinceSeq = BigInt(sinceParam);
      } else {
        sinceSeq = BigInt(0);
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

      function sendEvent(seq: bigint, eventType: string, payload: unknown): void {
        const data = JSON.stringify(payload);
        reply.raw.write(`id: ${seq}\nevent: ${eventType}\ndata: ${data}\n\n`);
      }

      function sendHeartbeat(): void {
        reply.raw.write(': ping\n\n');
      }

      // ── Phase 1: Catch-up from DB ─────────────────────────────────────────
      // Fetch all events since sinceSeq, filter by path pattern, send.
      const allDocRows = await db
        .select({ id: documents.id, slug: documents.slug })
        .from(documents);

      const slugSet = new Set(allDocRows.map((r: { slug: string }) => r.slug));

      // Build filtered list of (slug, [matching section patterns]) for the path
      // We send all events and filter server-side by pattern matching.
      let catchupHighWatermark = sinceSeq;

      const catchupRows = await db
        .select()
        .from(documentEvents)
        .where(gt(documentEvents.seq, sinceSeq))
        .orderBy(asc(documentEvents.seq));

      for (const row of catchupRows) {
        const slug = row.documentId as string;
        const payload = row.payloadJson as Record<string, unknown>;
        const sectionId = (payload?.sectionId as string | undefined) ?? (payload?.section as string | undefined) ?? null;
        const canonicalPath = eventToPath(slug, sectionId);

        if (!matchPath(pathPattern, canonicalPath)) continue;

        let eventPayload: unknown = {
          id: row.id,
          seq: row.seq.toString(),
          event_type: row.eventType,
          actor_id: row.actorId,
          payload: row.payloadJson,
          path: canonicalPath,
          created_at: row.createdAt.toISOString(),
        };

        // Add diff if in diff mode and section is identifiable
        if (diffMode && sectionId) {
          try {
            const delta = await computeSectionDelta(db, slug, sectionId, Number(row.seq) - 1);
            if (delta) {
              (eventPayload as Record<string, unknown>).delta = delta;
            }
          } catch {
            // Non-fatal: send without delta
          }
        }

        sendEvent(row.seq, row.eventType, eventPayload);
        catchupHighWatermark = row.seq;
      }

      // ── Phase 2: Live event bus fan-out ───────────────────────────────────
      const liveHighWatermark = { value: catchupHighWatermark };

      const busListener = (event: DocumentEvent): void => {
        const slug = event.slug;
        const sectionId = (event.data?.sectionId as string | undefined) ?? null;
        const canonicalPath = eventToPath(slug, sectionId);

        if (!matchPath(pathPattern, canonicalPath)) return;

        // Get the seq from DB for this live event
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
          .orderBy(documentEvents.seq as Parameters<typeof asc>[0])
          .limit(1)
          .then(async (rows: Array<{ seq: bigint; id: string; eventType: string; payloadJson: unknown; actorId: string; createdAt: Date }>) => {
            if (!rows.length) return;
            const row = rows[0];
            if (row.seq <= liveHighWatermark.value) return;
            liveHighWatermark.value = row.seq;

            let eventPayload: unknown = {
              id: row.id,
              seq: row.seq.toString(),
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
                  (eventPayload as Record<string, unknown>).delta = delta;
                }
              } catch {
                // Non-fatal
              }
            }

            sendEvent(row.seq, row.eventType, eventPayload);
          })
          .catch(() => {
            // Non-fatal: client will catch up on reconnect
          });
      };

      eventBus.on('document', busListener);

      const heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      request.raw.on('close', () => {
        clearInterval(heartbeatTimer);
        eventBus.off('document', busListener);
      });

      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
      });
    },
  );
}
