/**
 * HTTP fallback routes for CRDT state — T201.
 *
 * Routes:
 *   GET  /api/v1/documents/:slug/sections/:sid/crdt-state
 *     Returns JSON: { stateBase64, stateVectorBase64, clock, updatedAt }
 *     Requires: viewer+ role (any authenticated user can read)
 *     503 if section not yet initialized.
 *
 *   POST /api/v1/documents/:slug/sections/:sid/crdt-update
 *     Body: { updateBase64: string }
 *     Applies, persists, and broadcasts the update.
 *     Requires: editor+ role (document owner).
 *     503 if section not yet initialized.
 *     Idempotent: replaying the same update produces the same state (Yrs guarantee).
 *
 * These endpoints reuse T203 persistence helpers and T199 pub/sub.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { crdt_state_vector } from '../crdt/primitives.js';
import { persistCrdtUpdate, loadSectionState } from '../crdt/persistence.js';
import { publishCrdtUpdate } from '../realtime/redis-pubsub.js';

// ── Shared auth+RBAC check ────────────────────────────────────────────────────

async function resolveDocAndAccess(
  slug: string,
  userId: string,
): Promise<{ exists: boolean; canWrite: boolean }> {
  const docRows = await db
    .select({ ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);

  if (docRows.length === 0) return { exists: false, canWrite: false };
  const isOwner = docRows[0].ownerId === userId;
  // For now owner = editor; future T076 RBAC will refine
  return { exists: true, canWrite: isOwner };
}

// ── Route registration ────────────────────────────────────────────────────────

export async function crdtRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/documents/:slug/sections/:sid/crdt-state
   *
   * Returns the current consolidated CRDT state for a section.
   * Requires: viewer+ (any authenticated user).
   */
  app.get<{ Params: { slug: string; sid: string } }>(
    '/documents/:slug/sections/:sid/crdt-state',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { slug, sid } = request.params;

      const { exists } = await resolveDocAndAccess(slug, request.user!.id);
      if (!exists) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      }

      const stateRow = await loadSectionState(slug, sid);
      if (!stateRow) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Section not yet initialized — connect via WS to create initial state',
        });
      }

      const stateVec = crdt_state_vector(stateRow.yrsState);

      return reply.send({
        stateBase64: stateRow.yrsState.toString('base64'),
        stateVectorBase64: stateVec.toString('base64'),
        clock: stateRow.clock,
        updatedAt: stateRow.updatedAt ?? null,
      });
    },
  );

  /**
   * POST /api/v1/documents/:slug/sections/:sid/crdt-update
   *
   * Apply and persist a CRDT update via HTTP (fallback for agents without WS).
   * Requires: editor+ role (document owner).
   */
  app.post<{
    Params: { slug: string; sid: string };
    Body: { updateBase64: string };
  }>(
    '/documents/:slug/sections/:sid/crdt-update',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { slug, sid } = request.params;
      const { updateBase64 } = request.body;

      if (!updateBase64 || typeof updateBase64 !== 'string') {
        return reply.status(400).send({ error: 'Bad Request', message: 'updateBase64 is required' });
      }

      const { exists, canWrite } = await resolveDocAndAccess(slug, request.user!.id);
      if (!exists) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      }
      if (!canWrite) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Editor role required' });
      }

      const updateBlob = Buffer.from(updateBase64, 'base64');
      if (updateBlob.length === 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'updateBase64 decodes to empty buffer' });
      }

      // Check section exists (503 if not)
      const stateRow = await loadSectionState(slug, sid);
      if (!stateRow) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Section not yet initialized — connect via WS collab endpoint first',
        });
      }

      // Persist and broadcast (reuses T203 helper)
      const persistResult = await persistCrdtUpdate(slug, sid, updateBlob, request.user!.id);

      // Publish via pub/sub for cross-instance delivery (T199)
      await publishCrdtUpdate(slug, sid, updateBlob).catch((err: unknown) => {
        app.log.error({ err }, '[crdt-http] pubsub publish failed (non-fatal)');
      });

      const stateVec = crdt_state_vector(persistResult.newState);

      return reply.status(200).send({
        seq: persistResult.seq.toString(),
        stateBase64: persistResult.newState.toString('base64'),
        stateVectorBase64: stateVec.toString('base64'),
        message: 'update applied',
      });
    },
  );
}
