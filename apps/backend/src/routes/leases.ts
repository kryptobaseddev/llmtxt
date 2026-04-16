/**
 * Section lease REST endpoints — T279 / T353 Wave C.
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
 *
 * Wave C: All persistence delegated to fastify.backendCore (PostgresBackend).
 * Resource format: "<slug>:<sectionId>" matches LeaseOps contract.
 * Zero direct Drizzle calls in this file.
 */

import type { FastifyInstance } from 'fastify';
import { canRead } from '../middleware/rbac.js';

// ── Route registration ────────────────────────────────────────────────────────

export async function leaseRoutes(app: FastifyInstance): Promise<void> {
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
      const { leaseDurationSeconds } = request.body ?? {};

      // Validate duration
      if (!leaseDurationSeconds || leaseDurationSeconds < 1 || leaseDurationSeconds > 300) {
        return reply.status(400).send({ error: 'leaseDurationSeconds must be between 1 and 300' });
      }

      const agentId = (request as unknown as { user?: { id?: string } }).user?.id ?? 'anonymous';
      const resource = `${slug}:${sid}`;
      const ttlMs = leaseDurationSeconds * 1000;

      const lease = await app.backendCore.acquireLease({ resource, holder: agentId, ttlMs });

      if (lease === null) {
        // Conflict — another agent holds the lease
        const active = await app.backendCore.getLease(resource);
        if (active) {
          return reply.status(409).send({
            error: 'SECTION_LEASED',
            holder: active.holder,
            expiresAt: new Date(active.expiresAt).toISOString(),
          });
        }
        // Edge case: race condition cleared the lease
        return reply.status(409).send({
          error: 'SECTION_LEASED',
          holder: 'unknown',
          expiresAt: new Date().toISOString(),
        });
      }

      return reply.status(200).send({
        leaseId: lease.id,
        holder: lease.holder,
        expiresAt: new Date(lease.expiresAt).toISOString(),
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
      const resource = `${slug}:${sid}`;

      const lease = await app.backendCore.getLease(resource);
      if (!lease) {
        return reply.status(404).send({ error: 'NO_ACTIVE_LEASE' });
      }

      return reply.status(200).send({
        leaseId: lease.id,
        holder: lease.holder,
        expiresAt: new Date(lease.expiresAt).toISOString(),
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
      const resource = `${slug}:${sid}`;
      const agentId = (request as unknown as { user?: { id?: string } }).user?.id ?? 'anonymous';

      // Check if there's an active lease and if this agent holds it
      const active = await app.backendCore.getLease(resource);
      if (!active) {
        return reply.status(404).send({ error: 'NO_ACTIVE_LEASE' });
      }
      if (active.holder !== agentId) {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'Only the lease holder can release it',
        });
      }

      const released = await app.backendCore.releaseLease(resource, agentId);
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

      const resource = `${slug}:${sid}`;
      const agentId = (request as unknown as { user?: { id?: string } }).user?.id ?? 'anonymous';
      const ttlMs = leaseDurationSeconds * 1000;

      // Verify there's an active lease
      const active = await app.backendCore.getLease(resource);
      if (!active) {
        return reply.status(404).send({ error: 'NO_ACTIVE_LEASE' });
      }
      if (active.holder !== agentId) {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'Only the lease holder can renew it',
        });
      }

      const updated = await app.backendCore.renewLease(resource, agentId, ttlMs);
      if (!updated) {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'Only the lease holder can renew it',
        });
      }

      return reply.status(200).send({
        leaseId: updated.id,
        holder: updated.holder,
        expiresAt: new Date(updated.expiresAt).toISOString(),
      });
    },
  );
}
