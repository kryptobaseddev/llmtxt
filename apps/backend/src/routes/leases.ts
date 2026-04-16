/**
 * Section lease REST endpoints — T279.
 *
 * All routes are scoped to: /documents/:slug/sections/:sid/lease
 *
 * POST   → acquire (or re-acquire for same holder)
 * GET    → get active lease status
 * DELETE → release (holder only)
 * PATCH  → renew (holder only)
 *
 * Leases are ADVISORY — CRDT writes from non-holders are not blocked.
 * 409 is a cooperative signal only.
 */

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema-pg.js';
import { canRead } from '../middleware/rbac.js';
import { acquireLease, renewLease, releaseLease, getActiveLease } from '../leases/lease-service.js';

// ── Auth helper ──────────────────────────────────────────────────────────────

/** Extract the requesting agent ID from auth context. Falls back to userId. */
async function resolveAgentId(request: { headers: Record<string, string | string[] | undefined>; query: Record<string, string | string[] | undefined>; user?: { id?: string } }): Promise<string | null> {
  // Try to get from already-resolved auth on request (set by canRead preHandler)
  const user = (request as { user?: { id?: string } }).user;
  if (user?.id) return user.id;
  return null;
}

// ── Route registration ────────────────────────────────────────────────────────

export async function leaseRoutes(app: FastifyInstance): Promise<void> {
  // Resolve document by slug — shared helper
  async function resolveDoc(slug: string): Promise<{ id: string; slug: string } | null> {
    const rows = await db
      .select({ id: documents.id, slug: documents.slug })
      .from(documents)
      .where(eq(documents.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * POST /documents/:slug/sections/:sid/lease
   *
   * Body: { leaseDurationSeconds: number, reason?: string }
   * Returns: { leaseId, holder, expiresAt } on 200
   *          { error: 'SECTION_LEASED', holder, expiresAt } on 409
   */
  app.post<{
    Params: { slug: string; sid: string };
    Body: { leaseDurationSeconds: number; reason?: string };
  }>(
    '/documents/:slug/sections/:sid/lease',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug, sid } = request.params;
      const { leaseDurationSeconds, reason } = request.body ?? {};

      // Validate duration
      if (!leaseDurationSeconds || leaseDurationSeconds < 1 || leaseDurationSeconds > 300) {
        return reply.status(400).send({ error: 'leaseDurationSeconds must be between 1 and 300' });
      }

      const doc = await resolveDoc(slug);
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      // Resolve requesting agent
      const agentId = (request as unknown as { user?: { id?: string } }).user?.id ?? 'anonymous';

      const lease = await acquireLease(
        db,
        slug,
        sid,
        agentId,
        leaseDurationSeconds * 1000,
        reason,
      );

      if (lease === null) {
        // Conflict — another agent holds the lease
        const active = await getActiveLease(db, slug, sid);
        if (active) {
          return reply.status(409).send({
            error: 'SECTION_LEASED',
            holder: active.holderAgentId,
            expiresAt: active.expiresAt.toISOString(),
          });
        }
        // Edge case: race condition cleared the lease; try again
        return reply.status(409).send({ error: 'SECTION_LEASED', holder: 'unknown', expiresAt: new Date().toISOString() });
      }

      return reply.status(200).send({
        leaseId: lease.id,
        holder: lease.holderAgentId,
        expiresAt: lease.expiresAt.toISOString(),
      });
    },
  );

  /**
   * GET /documents/:slug/sections/:sid/lease
   *
   * Returns: { leaseId, holder, expiresAt } on 200
   *          { error: 'NO_ACTIVE_LEASE' } on 404
   */
  app.get<{ Params: { slug: string; sid: string } }>(
    '/documents/:slug/sections/:sid/lease',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug, sid } = request.params;

      const doc = await resolveDoc(slug);
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      const lease = await getActiveLease(db, slug, sid);
      if (!lease) {
        return reply.status(404).send({ error: 'NO_ACTIVE_LEASE' });
      }

      return reply.status(200).send({
        leaseId: lease.id,
        holder: lease.holderAgentId,
        expiresAt: lease.expiresAt.toISOString(),
      });
    },
  );

  /**
   * DELETE /documents/:slug/sections/:sid/lease
   *
   * Releases the lease. Only the holder can release.
   * Returns 200 on success, 403 if not holder, 404 if no active lease.
   */
  app.delete<{ Params: { slug: string; sid: string } }>(
    '/documents/:slug/sections/:sid/lease',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug, sid } = request.params;

      const doc = await resolveDoc(slug);
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      const agentId = (request as unknown as { user?: { id?: string } }).user?.id ?? 'anonymous';

      // Check if there's an active lease and if this agent holds it
      const active = await getActiveLease(db, slug, sid);
      if (!active) {
        return reply.status(404).send({ error: 'NO_ACTIVE_LEASE' });
      }
      if (active.holderAgentId !== agentId) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Only the lease holder can release it' });
      }

      const released = await releaseLease(db, active.id, agentId);
      if (!released) {
        return reply.status(404).send({ error: 'NO_ACTIVE_LEASE' });
      }

      return reply.status(200).send({ released: true });
    },
  );

  /**
   * PATCH /documents/:slug/sections/:sid/lease
   *
   * Body: { leaseDurationSeconds: number }
   * Renews the lease. Only the holder can renew.
   * Returns 200 with updated expiresAt, 403 if not holder.
   */
  app.patch<{
    Params: { slug: string; sid: string };
    Body: { leaseDurationSeconds: number };
  }>(
    '/documents/:slug/sections/:sid/lease',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug, sid } = request.params;
      const { leaseDurationSeconds } = request.body ?? {};

      if (!leaseDurationSeconds || leaseDurationSeconds < 1 || leaseDurationSeconds > 300) {
        return reply.status(400).send({ error: 'leaseDurationSeconds must be between 1 and 300' });
      }

      const doc = await resolveDoc(slug);
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      // Get active lease first to get its id
      const active = await getActiveLease(db, slug, sid);
      if (!active) {
        return reply.status(404).send({ error: 'NO_ACTIVE_LEASE' });
      }

      const agentId = (request as unknown as { user?: { id?: string } }).user?.id ?? 'anonymous';

      const updated = await renewLease(db, active.id, agentId, leaseDurationSeconds * 1000);
      if (!updated) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Only the lease holder can renew it' });
      }

      return reply.status(200).send({
        leaseId: updated.id,
        holder: updated.holderAgentId,
        expiresAt: updated.expiresAt.toISOString(),
      });
    },
  );
}
