/**
 * Scratchpad routes — W3/T153 / T353 Wave C.
 *
 * POST /api/v1/documents/:slug/scratchpad       — publish a message
 * GET  /api/v1/documents/:slug/scratchpad       — read messages (poll)
 * GET  /api/v1/documents/:slug/scratchpad/stream — SSE fan-out
 *
 * Transport: Redis Streams (XADD / XREAD) with 24h TTL.
 * Fallback: in-memory EventEmitter when REDIS_URL is not set.
 * Rate limit: writeRateLimit per agent.
 *
 * Wave C:
 *  - Document existence check via fastify.backendCore.getDocumentBySlug (zero Drizzle)
 *  - publishScratchpad/readScratchpad/subscribeScratchpad lib functions kept as-is:
 *    the Backend ScratchpadOps uses agent-inbox semantics (toAgentId/fromAgentId),
 *    while this route uses document-scoped broadcast channels — the semantics differ.
 *    The lib functions are Redis/in-memory transport, not Drizzle, so direct import is
 *    acceptable (no DB boundary violation). This is documented in the T353 manifest.
 */
import type { FastifyInstance } from 'fastify';
import { canRead } from '../middleware/rbac.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import {
  publishScratchpad,
  readScratchpad,
  subscribeScratchpad,
} from '../lib/scratchpad.js';
import type { ScratchpadMessage } from '../lib/scratchpad.js';

const SSE_HEARTBEAT_MS = 15_000;

export async function scratchpadRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /documents/:slug/scratchpad — publish a message
  fastify.post<{
    Params: { slug: string };
    Body: {
      content: string;
      content_type?: string;
      thread_id?: string;
      sig_hex?: string;
    };
  }>(
    '/documents/:slug/scratchpad',
    { preHandler: [canRead], config: writeRateLimit },
    async (request, reply) => {
      const { slug } = request.params;
      const { content, content_type, thread_id, sig_hex } = request.body;

      if (!content || typeof content !== 'string') {
        return reply.status(400).send({ error: 'Bad Request', message: 'content is required' });
      }

      // Verify document exists via backendCore (zero Drizzle)
      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found' });

      const agentId = request.user?.id ?? 'anonymous';

      const msg = await publishScratchpad(slug, {
        agentId,
        content,
        contentType: content_type,
        threadId: thread_id,
        sigHex: sig_hex,
      });

      return reply.status(201).send({
        id: msg.id,
        agent_id: msg.agentId,
        content: msg.content,
        content_type: msg.contentType,
        thread_id: msg.threadId,
        timestamp_ms: msg.timestampMs,
      });
    }
  );

  // GET /documents/:slug/scratchpad — read messages (poll)
  fastify.get<{
    Params: { slug: string };
    Querystring: { last_id?: string; limit?: string; thread_id?: string };
  }>(
    '/documents/:slug/scratchpad',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;
      const { last_id, limit, thread_id } = request.query;

      // Verify document exists via backendCore (zero Drizzle)
      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found' });

      const msgs = await readScratchpad(slug, {
        lastId: last_id,
        limit: limit ? parseInt(limit, 10) : 100,
        threadId: thread_id,
      });

      return {
        messages: msgs.map((m: ScratchpadMessage) => ({
          id: m.id,
          agent_id: m.agentId,
          content: m.content,
          content_type: m.contentType,
          thread_id: m.threadId,
          sig_hex: m.sigHex,
          timestamp_ms: m.timestampMs,
        })),
      };
    }
  );

  // GET /documents/:slug/scratchpad/stream — SSE fan-out
  fastify.get<{
    Params: { slug: string };
    Querystring: { last_id?: string; thread_id?: string };
  }>(
    '/documents/:slug/scratchpad/stream',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;
      const { last_id, thread_id } = request.query;

      // Verify document exists via backendCore (zero Drizzle)
      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found' });

      // SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const send = (data: unknown, id?: string) => {
        if (id) reply.raw.write(`id:${id}\n`);
        reply.raw.write(`data:${JSON.stringify(data)}\n\n`);
      };

      // Catch-up: replay messages since last_id
      if (last_id) {
        const catchUp = await readScratchpad(slug, {
          lastId: last_id,
          threadId: thread_id,
          limit: 500,
        });
        for (const m of catchUp) {
          send(
            {
              id: m.id,
              agent_id: m.agentId,
              content: m.content,
              content_type: m.contentType,
              thread_id: m.threadId,
              sig_hex: m.sigHex,
              timestamp_ms: m.timestampMs,
            },
            m.id
          );
        }
      }

      // Live subscription (in-memory fallback path; Redis path polls)
      const unsub = subscribeScratchpad(slug, thread_id, (m: ScratchpadMessage) => {
        send(
          {
            id: m.id,
            agent_id: m.agentId,
            content: m.content,
            content_type: m.contentType,
            thread_id: m.threadId,
            sig_hex: m.sigHex,
            timestamp_ms: m.timestampMs,
          },
          m.id
        );
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        reply.raw.write(': ping\n\n');
      }, SSE_HEARTBEAT_MS);

      request.socket.on('close', () => {
        clearInterval(heartbeat);
        unsub();
      });

      // Keep the connection open
      await new Promise<void>(() => {
        // Intentionally never resolves — connection held open until client disconnects
      });
    }
  );
}
