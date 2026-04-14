/**
 * Server-Sent Events (SSE) fallback for real-time document event streaming.
 *
 * SSE is read-only and unidirectional (server → client). It is appropriate
 * for environments that cannot maintain a WebSocket connection (e.g. some
 * HTTP/2 proxies, serverless environments, CLI tools using curl).
 *
 * Routes (registered under /api prefix):
 *   GET /documents/:slug/events  — Stream events for one document
 *
 * Query parameters:
 *   ?events=version.created,state.changed  — Comma-separated filter (optional)
 *   ?token=<bearer>                         — Auth token (optional, for future gating)
 *
 * SSE format:
 *   event: <DocumentEventType>\n
 *   data: <JSON-serialized DocumentEvent>\n
 *   \n
 *
 * Keep-alive:
 *   A comment line (`: ping`) is sent every 30 seconds to prevent proxy
 *   timeout disconnections.
 *
 * Proxy buffering:
 *   X-Accel-Buffering: no disables nginx/Railway response buffering so
 *   events are delivered immediately rather than batched.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eventBus, type DocumentEvent } from '../events/bus.js';

// ── Route registration ────────────────────────────────────────────────────────

/** Register SSE streaming routes under the provided prefix (e.g. /api). */
export async function sseRoutes(app: FastifyInstance) {
  /**
   * GET /documents/:slug/events
   *
   * Opens an SSE stream scoped to a single document. All events whose slug
   * matches are forwarded to the client.
   *
   * This route bypasses Fastify's JSON serialization — it manages the raw
   * Node.js response stream directly via `reply.raw`.
   */
  app.get<{
    Params: { slug: string };
    Querystring: { events?: string; token?: string };
  }>(
    '/documents/:slug/events',
    async (request: FastifyRequest<{
      Params: { slug: string };
      Querystring: { events?: string; token?: string };
    }>, reply) => {
      const { slug } = request.params;

      // Build an optional event-type filter from ?events= query param.
      const eventsParam = request.query.events;
      const activeFilter: Set<string> | null = eventsParam
        ? new Set(eventsParam.split(',').map(s => s.trim()).filter(Boolean))
        : null;

      // ── Open SSE stream ─────────────────────────────────────────────────

      // writeHead must be called before any write. Fastify's reply is
      // bypassed here — we write directly to reply.raw.
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': reply.getHeader('Access-Control-Allow-Origin') ?? '*',
      });

      // Send the initial connection event so the client knows the stream is live.
      reply.raw.write(`data: ${JSON.stringify({ type: 'connected', slug, timestamp: Date.now() })}\n\n`);

      // ── Keep-alive ping ─────────────────────────────────────────────────
      // SSE comment lines (starting with ':') are ignored by clients but
      // prevent idle-connection termination by intermediate proxies.
      const pingInterval = setInterval(() => {
        if (!reply.raw.writable) {
          clearInterval(pingInterval);
          return;
        }
        reply.raw.write(': ping\n\n');
      }, 30_000);

      // ── Event listener ──────────────────────────────────────────────────
      const listener = (event: DocumentEvent) => {
        if (event.slug !== slug) return;
        if (activeFilter && !activeFilter.has(event.type)) return;
        if (!reply.raw.writable) return;
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      eventBus.on('document', listener);

      // ── Cleanup on client disconnect ────────────────────────────────────
      request.raw.on('close', () => {
        clearInterval(pingInterval);
        eventBus.off('document', listener);
      });

      // Return a resolved promise so Fastify does not attempt to serialize
      // a return value. The stream stays open until the client disconnects.
      return reply;
    },
  );
}
