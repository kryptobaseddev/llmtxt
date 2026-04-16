/**
 * Presence REST endpoint — T266 / T353 Wave C.
 *
 * GET /api/v1/documents/:slug/presence
 *   Returns the list of agents currently active (within last 30s) in the
 *   specified document. Auth required (same bearer-token middleware as other
 *   document routes).
 *
 * Response shape:
 *   [ { agentId, section, cursorOffset?, lastSeen } ]
 *
 * lastSeen is serialized as an ISO8601 string for interoperability.
 *
 * Wave C: Delegated to fastify.backendCore.listPresence (in-memory registry).
 * presenceRegistry import retained since listPresence is a thin delegate to it.
 * Zero direct Drizzle for presence read operation.
 * Document existence check still uses backendCore.getDocumentBySlug.
 */

import type { FastifyInstance } from 'fastify';
import { canRead } from '../middleware/rbac.js';

// ── Route registration ────────────────────────────────────────────────────────

export async function presenceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /documents/:slug/presence
   *
   * Returns all agents active in the document within the last 30 seconds.
   * Returns an empty array when no agents are present (not 404).
   */
  app.get<{ Params: { slug: string } }>(
    '/documents/:slug/presence',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;

      // Verify document exists via backendCore
      const doc = await app.backendCore.getDocumentBySlug(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Retrieve presence entries via backendCore (delegates to presenceRegistry)
      const entries = await app.backendCore.listPresence(slug);

      // Serialize lastSeen as ISO8601 string; extract section/cursorOffset from meta
      const body = entries.map((e) => ({
        agentId: e.agentId,
        section: (e.meta?.section as string | undefined) ?? '',
        ...(e.meta?.cursorOffset !== undefined
          ? { cursorOffset: e.meta.cursorOffset as number }
          : {}),
        lastSeen: new Date(e.lastSeen).toISOString(),
      }));

      reply.header('Cache-Control', 'no-store');
      return reply.status(200).send(body);
    },
  );
}
