/**
 * Access control routes — manage document visibility and per-user role grants.
 *
 * All endpoints require the caller to hold 'manage' permission on the document,
 * which means they must be the owner or hold an explicit 'owner' role grant.
 *
 * Endpoints:
 *   GET    /documents/:slug/access               — list all grants + orgs
 *   POST   /documents/:slug/access               — grant a role to a user
 *   DELETE /documents/:slug/access/:userId       — revoke a role grant
 *   PUT    /documents/:slug/visibility           — change document visibility
 *   POST   /documents/:slug/access/invite        — invite by email
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  documents,
  documentRoles,
  documentOrgs,
  organizations,
  users,
  pendingInvites,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { canManage } from '../middleware/rbac.js';

// ────────────────────────────────────────────────────────────────
// Validation schemas
// ────────────────────────────────────────────────────────────────

const slugParams = z.object({ slug: z.string().min(1).max(20) });
const userIdParams = z.object({ slug: z.string().min(1).max(20), userId: z.string().min(1) });

const grantAccessBody = z.object({
  userId: z.string().min(1),
  role: z.enum(['editor', 'viewer']),
});

const visibilityBody = z.object({
  visibility: z.enum(['public', 'private', 'org']),
});

const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(['editor', 'viewer']),
});

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

async function resolveDocumentId(slug: string): Promise<{ id: string; ownerId: string | null; visibility: string } | null> {
  const [doc] = await db
    .select({ id: documents.id, ownerId: documents.ownerId, visibility: documents.visibility })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  return doc ?? null;
}

// ────────────────────────────────────────────────────────────────
// Route plugin
// ────────────────────────────────────────────────────────────────

export async function accessControlRoutes(fastify: FastifyInstance) {

  // ──────────────────────────────────────────────────────────────
  // GET /documents/:slug/access — list who has access
  // ──────────────────────────────────────────────────────────────
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/access',
    { preHandler: [requireAuth, canManage] },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);

      const doc = await resolveDocumentId(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });

      // Fetch explicit role grants
      const roles = await db
        .select({
          userId: documentRoles.userId,
          role: documentRoles.role,
          grantedBy: documentRoles.grantedBy,
          grantedAt: documentRoles.grantedAt,
        })
        .from(documentRoles)
        .where(eq(documentRoles.documentId, doc.id));

      // Fetch associated orgs
      const orgs = await db
        .select({
          orgId: documentOrgs.orgId,
          name: organizations.name,
          slug: organizations.slug,
          addedAt: documentOrgs.addedAt,
        })
        .from(documentOrgs)
        .innerJoin(organizations, eq(organizations.id, documentOrgs.orgId))
        .where(eq(documentOrgs.documentId, doc.id));

      // Fetch pending invites
      const invites = await db
        .select({
          id: pendingInvites.id,
          email: pendingInvites.email,
          role: pendingInvites.role,
          createdAt: pendingInvites.createdAt,
          expiresAt: pendingInvites.expiresAt,
        })
        .from(pendingInvites)
        .where(eq(pendingInvites.documentId, doc.id));

      return {
        slug,
        visibility: doc.visibility,
        ownerId: doc.ownerId,
        roles,
        orgs,
        pendingInvites: invites,
      };
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /documents/:slug/access — grant a role to a user
  // ──────────────────────────────────────────────────────────────
  fastify.post<{ Params: { slug: string }; Body: z.infer<typeof grantAccessBody> }>(
    '/documents/:slug/access',
    { preHandler: [requireAuth, canManage] },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);

      const bodyResult = grantAccessBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { userId, role } = bodyResult.data;

      const doc = await resolveDocumentId(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });

      // Cannot grant roles to the owner — they already have owner-level access
      if (doc.ownerId === userId) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'User is the document owner and already has full access',
        });
      }

      // Verify the target user exists
      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!targetUser) {
        return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
      }

      const now = Date.now();
      const grantedBy = request.user!.id;

      // Upsert: if a role row exists for this (document, user) pair, update the role.
      const [existing] = await db
        .select({ id: documentRoles.id })
        .from(documentRoles)
        .where(and(eq(documentRoles.documentId, doc.id), eq(documentRoles.userId, userId)))
        .limit(1);

      if (existing) {
        await db
          .update(documentRoles)
          .set({ role, grantedBy, grantedAt: now })
          .where(eq(documentRoles.id, existing.id));

        return reply.status(200).send({ slug, userId, role, grantedBy, grantedAt: now, updated: true });
      }

      const id = crypto.randomUUID();
      await db.insert(documentRoles).values({
        id,
        documentId: doc.id,
        userId,
        role,
        grantedBy,
        grantedAt: now,
      });

      return reply.status(201).send({ id, slug, userId, role, grantedBy, grantedAt: now });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // DELETE /documents/:slug/access/:userId — revoke a role grant
  // ──────────────────────────────────────────────────────────────
  fastify.delete<{ Params: { slug: string; userId: string } }>(
    '/documents/:slug/access/:userId',
    { preHandler: [requireAuth, canManage] },
    async (request, reply) => {
      const paramsResult = userIdParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid parameters' });
      }
      const { slug, userId } = paramsResult.data;

      const doc = await resolveDocumentId(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });

      // Cannot revoke the owner's implicit access
      if (doc.ownerId === userId) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Cannot revoke owner access. Transfer ownership first.',
        });
      }

      const [existing] = await db
        .select({ id: documentRoles.id, role: documentRoles.role })
        .from(documentRoles)
        .where(and(eq(documentRoles.documentId, doc.id), eq(documentRoles.userId, userId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({ error: 'Not Found', message: 'No role grant found for this user' });
      }

      // Do not allow revoking an 'owner' role through this endpoint
      if (existing.role === 'owner') {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Cannot revoke owner role through this endpoint',
        });
      }

      await db.delete(documentRoles).where(eq(documentRoles.id, existing.id));

      return { slug, userId, revoked: true, revokedAt: Date.now() };
    }
  );

  // ──────────────────────────────────────────────────────────────
  // PUT /documents/:slug/visibility — change document visibility
  // ──────────────────────────────────────────────────────────────
  fastify.put<{ Params: { slug: string }; Body: z.infer<typeof visibilityBody> }>(
    '/documents/:slug/visibility',
    { preHandler: [requireAuth, canManage] },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);

      const bodyResult = visibilityBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { visibility } = bodyResult.data;

      const doc = await resolveDocumentId(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });

      await db
        .update(documents)
        .set({ visibility })
        .where(eq(documents.slug, slug));

      return { slug, visibility, updatedAt: Date.now() };
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /documents/:slug/access/invite — invite by email
  // ──────────────────────────────────────────────────────────────
  fastify.post<{ Params: { slug: string }; Body: z.infer<typeof inviteBody> }>(
    '/documents/:slug/access/invite',
    { preHandler: [requireAuth, canManage] },
    async (request, reply) => {
      const { slug } = slugParams.parse(request.params);

      const bodyResult = inviteBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { email, role } = bodyResult.data;

      const doc = await resolveDocumentId(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });

      const now = Date.now();
      const invitedBy = request.user!.id;

      // Check if the user already exists by email
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        // User exists — skip the invite queue and grant the role directly.
        // Upsert logic same as POST /access.
        if (doc.ownerId === existingUser.id) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'User is the document owner and already has full access',
          });
        }

        const [existingRole] = await db
          .select({ id: documentRoles.id })
          .from(documentRoles)
          .where(and(eq(documentRoles.documentId, doc.id), eq(documentRoles.userId, existingUser.id)))
          .limit(1);

        if (existingRole) {
          await db
            .update(documentRoles)
            .set({ role, grantedBy: invitedBy, grantedAt: now })
            .where(eq(documentRoles.id, existingRole.id));
        } else {
          await db.insert(documentRoles).values({
            id: crypto.randomUUID(),
            documentId: doc.id,
            userId: existingUser.id,
            role,
            grantedBy: invitedBy,
            grantedAt: now,
          });
        }

        return reply.status(201).send({
          slug,
          email,
          userId: existingUser.id,
          role,
          status: 'granted',
          grantedAt: now,
        });
      }

      // User does not exist — store a pending invite.
      // Upsert: update the role if an invite already exists for this (document, email).
      const [existingInvite] = await db
        .select({ id: pendingInvites.id })
        .from(pendingInvites)
        .where(and(eq(pendingInvites.documentId, doc.id), eq(pendingInvites.email, email)))
        .limit(1);

      if (existingInvite) {
        await db
          .update(pendingInvites)
          .set({ role, invitedBy, createdAt: now })
          .where(eq(pendingInvites.id, existingInvite.id));

        return reply.status(200).send({
          slug,
          email,
          role,
          status: 'pending',
          updatedAt: now,
        });
      }

      await db.insert(pendingInvites).values({
        id: crypto.randomUUID(),
        documentId: doc.id,
        email,
        role,
        invitedBy,
        createdAt: now,
        expiresAt: null,
      });

      return reply.status(201).send({
        slug,
        email,
        role,
        status: 'pending',
        createdAt: now,
      });
    }
  );
}
