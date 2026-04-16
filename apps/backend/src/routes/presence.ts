/**
 * Presence REST endpoint — T266.
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
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema-pg.js';
import { canRead } from '../middleware/rbac.js';
import { presenceRegistry } from '../presence/registry.js';

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

      // Verify document exists
      const docRows = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, slug))
        .limit(1);

      if (docRows.length === 0) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Retrieve presence entries from the in-memory registry
      const records = presenceRegistry.getByDoc(slug);

      // Serialize lastSeen as ISO8601 string
      const body = records.map((r) => ({
        agentId: r.agentId,
        section: r.section,
        ...(r.cursorOffset !== undefined ? { cursorOffset: r.cursorOffset } : {}),
        lastSeen: new Date(r.lastSeen).toISOString(),
      }));

      reply.header('Cache-Control', 'no-store');
      return reply.status(200).send(body);
    },
  );
}
