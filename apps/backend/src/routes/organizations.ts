/**
 * Organization management routes.
 *
 * Organizations allow grouping users for shared document access.
 * A document with visibility='org' is readable by all members of
 * any organization associated with that document.
 *
 * Endpoints:
 *   POST   /organizations                         — Create an organization
 *   GET    /organizations                         — List the caller's organizations
 *   GET    /organizations/:slug                   — Get org details + member list
 *   POST   /organizations/:slug/members           — Add a member
 *   DELETE /organizations/:slug/members/:userId   — Remove a member
 *   POST   /organizations/:slug/documents         — Associate a document with the org
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  organizations,
  orgMembers,
  documentOrgs,
  documents,
  users,
} from '../db/schema.js';
import { requireRegistered } from '../middleware/auth.js';
import { canManage } from '../middleware/rbac.js';

// ────────────────────────────────────────────────────────────────
// Validation schemas
// ────────────────────────────────────────────────────────────────

const orgSlugParams = z.object({ slug: z.string().min(1).max(64) });
const orgMemberParams = z.object({
  slug: z.string().min(1).max(64),
  userId: z.string().min(1),
});

const createOrgBody = z.object({
  name: z.string().min(1).max(128),
  /** URL-safe slug for the organization, e.g. "acme-corp". */
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
});

const addMemberBody = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

const associateDocBody = z.object({
  /** Slug of the document to associate with this org. */
  documentSlug: z.string().min(1).max(20),
});

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/** Resolve an org by its URL slug, returning id + createdBy or null. */
async function resolveOrg(slug: string) {
  const [org] = await db
    .select({ id: organizations.id, createdBy: organizations.createdBy, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return org ?? null;
}

/** Check whether userId is an admin of the given org (by orgId). */
async function isOrgAdmin(orgId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, userId)))
    .limit(1);
  return row?.role === 'admin';
}

// ────────────────────────────────────────────────────────────────
// Route plugin
// ────────────────────────────────────────────────────────────────

export async function organizationRoutes(fastify: FastifyInstance) {

  // ──────────────────────────────────────────────────────────────
  // POST /organizations — create an organization
  // ──────────────────────────────────────────────────────────────
  fastify.post<{ Body: z.infer<typeof createOrgBody> }>(
    '/organizations',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const bodyResult = createOrgBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { name, slug } = bodyResult.data;
      const userId = request.user!.id;
      const now = Date.now();

      // Enforce slug uniqueness
      const [existing] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);

      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `Organization slug '${slug}' is already taken`,
        });
      }

      const orgId = crypto.randomUUID();
      await db.insert(organizations).values({
        id: orgId,
        name,
        slug,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });

      // Creator is automatically an admin member
      await db.insert(orgMembers).values({
        id: crypto.randomUUID(),
        orgId,
        userId,
        role: 'admin',
        joinedAt: now,
      });

      return reply.status(201).send({
        id: orgId,
        name,
        slug,
        createdBy: userId,
        createdAt: now,
        role: 'admin',
      });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /organizations — list caller's organizations
  // ──────────────────────────────────────────────────────────────
  fastify.get(
    '/organizations',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const userId = request.user!.id;

      const rows = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          createdAt: organizations.createdAt,
          role: orgMembers.role,
          joinedAt: orgMembers.joinedAt,
        })
        .from(orgMembers)
        .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
        .where(eq(orgMembers.userId, userId));

      return { organizations: rows, total: rows.length };
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /organizations/:slug — get org details + members
  // ──────────────────────────────────────────────────────────────
  fastify.get<{ Params: { slug: string } }>(
    '/organizations/:slug',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const { slug } = orgSlugParams.parse(request.params);
      const userId = request.user!.id;

      const org = await resolveOrg(slug);
      if (!org) return reply.status(404).send({ error: 'Not Found', message: 'Organization not found' });

      // Require the caller to be a member to view details
      const [memberRow] = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, userId)))
        .limit(1);

      if (!memberRow) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You are not a member of this organization' });
      }

      const members = await db
        .select({
          userId: orgMembers.userId,
          role: orgMembers.role,
          joinedAt: orgMembers.joinedAt,
        })
        .from(orgMembers)
        .where(eq(orgMembers.orgId, org.id));

      const [orgRow] = await db
        .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, createdBy: organizations.createdBy, createdAt: organizations.createdAt, updatedAt: organizations.updatedAt })
        .from(organizations)
        .where(eq(organizations.id, org.id))
        .limit(1);

      return {
        ...orgRow,
        callerRole: memberRow.role,
        members,
        memberCount: members.length,
      };
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /organizations/:slug/members — add a member
  // ──────────────────────────────────────────────────────────────
  fastify.post<{ Params: { slug: string }; Body: z.infer<typeof addMemberBody> }>(
    '/organizations/:slug/members',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const { slug } = orgSlugParams.parse(request.params);

      const bodyResult = addMemberBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { userId: targetUserId, role } = bodyResult.data;
      const callerId = request.user!.id;

      const org = await resolveOrg(slug);
      if (!org) return reply.status(404).send({ error: 'Not Found', message: 'Organization not found' });

      // Only org admins or the creator can add members
      const adminCheck = await isOrgAdmin(org.id, callerId);
      if (!adminCheck && org.createdBy !== callerId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only org admins can add members' });
      }

      // Verify the target user exists
      const [targetUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, targetUserId))
        .limit(1);

      if (!targetUser) {
        return reply.status(404).send({ error: 'Not Found', message: 'User not found' });
      }

      const now = Date.now();

      // Check if already a member — if so, update role
      const [existingMember] = await db
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, targetUserId)))
        .limit(1);

      if (existingMember) {
        await db
          .update(orgMembers)
          .set({ role })
          .where(eq(orgMembers.id, existingMember.id));

        return reply.status(200).send({ orgSlug: slug, userId: targetUserId, role, updated: true, joinedAt: now });
      }

      await db.insert(orgMembers).values({
        id: crypto.randomUUID(),
        orgId: org.id,
        userId: targetUserId,
        role,
        joinedAt: now,
      });

      return reply.status(201).send({ orgSlug: slug, userId: targetUserId, role, joinedAt: now });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // DELETE /organizations/:slug/members/:userId — remove a member
  // ──────────────────────────────────────────────────────────────
  fastify.delete<{ Params: { slug: string; userId: string } }>(
    '/organizations/:slug/members/:userId',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const paramsResult = orgMemberParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid parameters' });
      }
      const { slug, userId: targetUserId } = paramsResult.data;
      const callerId = request.user!.id;

      const org = await resolveOrg(slug);
      if (!org) return reply.status(404).send({ error: 'Not Found', message: 'Organization not found' });

      // Allow self-removal; otherwise require admin
      if (targetUserId !== callerId) {
        const adminCheck = await isOrgAdmin(org.id, callerId);
        if (!adminCheck && org.createdBy !== callerId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'Only org admins can remove members' });
        }
      }

      // Cannot remove the creator
      if (targetUserId === org.createdBy) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Cannot remove the organization creator. Transfer ownership first.',
        });
      }

      const [existingMember] = await db
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, targetUserId)))
        .limit(1);

      if (!existingMember) {
        return reply.status(404).send({ error: 'Not Found', message: 'User is not a member of this organization' });
      }

      await db.delete(orgMembers).where(eq(orgMembers.id, existingMember.id));

      return { orgSlug: slug, userId: targetUserId, removed: true, removedAt: Date.now() };
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /organizations/:slug/documents — associate a document
  // ──────────────────────────────────────────────────────────────
  fastify.post<{ Params: { slug: string }; Body: z.infer<typeof associateDocBody> }>(
    '/organizations/:slug/documents',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const { slug: orgSlug } = orgSlugParams.parse(request.params);

      const bodyResult = associateDocBody.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
          })),
        });
      }
      const { documentSlug } = bodyResult.data;
      const callerId = request.user!.id;

      const org = await resolveOrg(orgSlug);
      if (!org) return reply.status(404).send({ error: 'Not Found', message: 'Organization not found' });

      // Only org admins or creator can associate documents
      const adminCheck = await isOrgAdmin(org.id, callerId);
      if (!adminCheck && org.createdBy !== callerId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only org admins can associate documents' });
      }

      // Look up document — the caller must also have 'manage' permission on it
      const [doc] = await db
        .select({ id: documents.id, ownerId: documents.ownerId })
        .from(documents)
        .where(eq(documents.slug, documentSlug))
        .limit(1);

      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });

      // Only the document owner can associate it with an org
      if (doc.ownerId !== callerId) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Only the document owner can associate it with an organization',
        });
      }

      const now = Date.now();

      // Idempotent: return 200 if already associated
      const [existing] = await db
        .select({ id: documentOrgs.id })
        .from(documentOrgs)
        .where(and(eq(documentOrgs.documentId, doc.id), eq(documentOrgs.orgId, org.id)))
        .limit(1);

      if (existing) {
        return reply.status(200).send({
          orgSlug,
          documentSlug,
          message: 'Document is already associated with this organization',
          addedAt: now,
        });
      }

      await db.insert(documentOrgs).values({
        id: crypto.randomUUID(),
        documentId: doc.id,
        orgId: org.id,
        addedAt: now,
      });

      return reply.status(201).send({ orgSlug, documentSlug, addedAt: now });
    }
  );
}
