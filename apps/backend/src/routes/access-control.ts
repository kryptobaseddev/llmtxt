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
 *
 * Wave D (T353.7): role grants + visibility changes delegate to
 * fastify.backendCore.* (AccessControlOps).
 * Invite resolution and pending invites remain direct (schema-specific logic).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  documents,
  documentOrgs,
  organizations,
  users,
  pendingInvites,
  documentRoles,
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

      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      const docRow = doc as unknown as Record<string, unknown>;
      const docId = docRow.id as string;

      const acl = await fastify.backendCore.getDocumentAccess(docId);

      // Fetch associated orgs (schema-specific join — stays direct)
      const orgs = await db
        .select({
          orgId: documentOrgs.orgId,
          name: organizations.name,
          slug: organizations.slug,
          addedAt: documentOrgs.addedAt,
        })
        .from(documentOrgs)
        .innerJoin(organizations, eq(organizations.id, documentOrgs.orgId))
        .where(eq(documentOrgs.documentId, docId));

      // Fetch pending invites (schema-specific — stays direct)
      const invites = await db
        .select({
          id: pendingInvites.id,
          email: pendingInvites.email,
          role: pendingInvites.role,
          createdAt: pendingInvites.createdAt,
          expiresAt: pendingInvites.expiresAt,
        })
        .from(pendingInvites)
        .where(eq(pendingInvites.documentId, docId));

      return {
        slug,
        visibility: acl.visibility,
        ownerId: docRow.ownerId,
        roles: acl.grants,
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
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { userId, role } = bodyResult.data;

      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      const docRow = doc as unknown as Record<string, unknown>;
      const docId = docRow.id as string;
      const ownerId = docRow.ownerId as string | null;

      if (ownerId === userId) {
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
      await fastify.backendCore.grantDocumentAccess(docId, { userId, role });

      return reply.status(201).send({ slug, userId, role, grantedAt: now });
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

      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      const docRow = doc as unknown as Record<string, unknown>;
      const docId = docRow.id as string;
      const ownerId = docRow.ownerId as string | null;

      if (ownerId === userId) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Cannot revoke owner access. Transfer ownership first.',
        });
      }

      const revoked = await fastify.backendCore.revokeDocumentAccess(docId, userId);
      if (!revoked) {
        return reply.status(404).send({ error: 'Not Found', message: 'No role grant found for this user' });
      }

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
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { visibility } = bodyResult.data;

      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      const docId = (doc as unknown as Record<string, unknown>).id as string;

      await fastify.backendCore.setDocumentVisibility(docId, visibility);

      return { slug, visibility, updatedAt: Date.now() };
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /documents/:slug/access/invite — invite by email
  // (Invite logic is schema-specific and stays direct)
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
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { email, role } = bodyResult.data;

      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      const docRow = doc as unknown as Record<string, unknown>;
      const docId = docRow.id as string;
      const ownerId = docRow.ownerId as string | null;

      const now = Date.now();
      const invitedBy = request.user!.id;

      // Check if the user already exists by email
      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        if (ownerId === existingUser.id) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'User is the document owner and already has full access',
          });
        }

        await fastify.backendCore.grantDocumentAccess(docId, { userId: existingUser.id, role });

        return reply.status(201).send({
          slug,
          email,
          userId: existingUser.id,
          role,
          status: 'granted',
          grantedAt: now,
        });
      }

      // User does not exist — store a pending invite
      const [existingInvite] = await db
        .select({ id: pendingInvites.id })
        .from(pendingInvites)
        .where(and(eq(pendingInvites.documentId, docId), eq(pendingInvites.email, email)))
        .limit(1);

      if (existingInvite) {
        await db
          .update(pendingInvites)
          .set({ role, invitedBy, createdAt: now })
          .where(eq(pendingInvites.id, existingInvite.id));

        return reply.status(200).send({ slug, email, role, status: 'pending', updatedAt: now });
      }

      await db.insert(pendingInvites).values({
        id: crypto.randomUUID(),
        documentId: docId,
        email,
        role,
        invitedBy,
        createdAt: now,
        expiresAt: null,
      });

      return reply.status(201).send({ slug, email, role, status: 'pending', createdAt: now });
    }
  );
}
