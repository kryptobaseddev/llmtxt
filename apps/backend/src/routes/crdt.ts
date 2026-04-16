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
 * Wave B (T353.5): Refactored to use fastify.backendCore.getCrdtState and
 * fastify.backendCore.applyCrdtUpdate instead of direct CRDT helper calls.
 *
 * Note: publishCrdtUpdate (Redis pub/sub broadcast) is still called directly
 * here for cross-instance delivery, as it is a transport concern (like WS
 * connection management) that stays in apps/backend.
 */

import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../middleware/auth.js';
import { publishCrdtUpdate } from '../realtime/redis-pubsub.js';

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

      // Verify document exists
      const doc = await request.server.backendCore.getDocumentBySlug(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      }

      const state = await request.server.backendCore.getCrdtState(slug, sid);
      if (!state) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Section not yet initialized — connect via WS to create initial state',
        });
      }

      return reply.send({
        stateBase64: state.snapshotBase64,
        stateVectorBase64: state.stateVectorBase64,
        updatedAt: state.updatedAt,
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

      // Verify document exists and check ownership
      const doc = await request.server.backendCore.getDocumentBySlug(slug);
      if (!doc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      }

      // RBAC: editor+ required — currently owner = editor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docRaw = doc as Record<string, any>;
      const isOwner = docRaw.ownerId === request.user!.id;
      if (!isOwner) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Editor role required' });
      }

      const updateBlob = Buffer.from(updateBase64, 'base64');
      if (updateBlob.length === 0) {
        return reply.status(400).send({ error: 'Bad Request', message: 'updateBase64 decodes to empty buffer' });
      }

      // Check section exists (503 if not yet initialized)
      const existingState = await request.server.backendCore.getCrdtState(slug, sid);
      if (!existingState) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Section not yet initialized — connect via WS collab endpoint first',
        });
      }

      // Apply update via backendCore (persist + merge)
      const newState = await request.server.backendCore.applyCrdtUpdate({
        documentId: slug,
        sectionKey: sid,
        updateBase64,
        agentId: request.user!.id,
      });

      // Publish via pub/sub for cross-instance delivery (T199) — transport concern
      await publishCrdtUpdate(slug, sid, updateBlob).catch((err: unknown) => {
        app.log.error({ err }, '[crdt-http] pubsub publish failed (non-fatal)');
      });

      return reply.status(200).send({
        stateBase64: newState.snapshotBase64,
        stateVectorBase64: newState.stateVectorBase64,
        message: 'update applied',
      });
    },
  );
}
