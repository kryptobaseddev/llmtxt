/**
 * Role-Based Access Control (RBAC) middleware for LLMtxt document routes.
 *
 * Permission model:
 *   owner  → read | write | delete | manage | approve
 *   editor → read | write | approve
 *   viewer → read
 *
 * Authorization resolution order for a given (userId, slug) pair:
 *   1. Document visibility='public' → everyone gets 'read'
 *   2. User is the document ownerId → full owner permissions
 *   3. Explicit documentRoles row → role permissions
 *   4. User is a member of an org associated with the document → org-role permissions
 *      (admin→editor, member→viewer, viewer→viewer)
 *   5. No match → empty permission set (→ 403 on protected routes)
 *
 * Public documents remain fully readable without authentication to preserve
 * backwards compatibility with existing agents and public-facing URLs.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, documentRoles, documentOrgs, orgMembers } from '../db/schema.js';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

export type DocumentRole = 'owner' | 'editor' | 'viewer';
export type OrgRole = 'admin' | 'member' | 'viewer';
export type Permission = 'read' | 'write' | 'delete' | 'manage' | 'approve';

// ────────────────────────────────────────────────────────────────
// Permission matrix
// ────────────────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<DocumentRole, Permission[]> = {
  owner: ['read', 'write', 'delete', 'manage', 'approve'],
  editor: ['read', 'write', 'approve'],
  viewer: ['read'],
};

/**
 * Map an org-level role to the effective document permission set.
 * Org admins get editor-level access to org-associated documents.
 * Org members and viewers get read-only access.
 */
function orgRoleToDocumentRole(orgRole: OrgRole): DocumentRole {
  if (orgRole === 'admin') return 'editor';
  return 'viewer';
}

// ────────────────────────────────────────────────────────────────
// Core authorization logic
// ────────────────────────────────────────────────────────────────

/**
 * Resolve the set of permissions a user holds for a document identified by slug.
 *
 * Returns an empty array when the user has no access at all.
 * Callers should treat an empty result as a 403 for private/org documents,
 * or allow through for public documents (already handled inside this function).
 */
export async function getDocumentPermissions(
  userId: string | null | undefined,
  slug: string
): Promise<Permission[]> {
  // Fetch the minimal document fields needed for auth decisions
  const [doc] = await db
    .select({
      id: documents.id,
      ownerId: documents.ownerId,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);

  if (!doc) {
    // Document does not exist — return empty; the route handler should 404.
    return [];
  }

  // 1. Public documents: grant read to everyone (including unauthenticated).
  if (doc.visibility === 'public') {
    if (!userId) return ['read'];
    // Authenticated users may have higher permissions — fall through to check.
  }

  // Unauthenticated users on non-public documents have no access.
  if (!userId) return [];

  // 2. Document owner → full permissions.
  if (doc.ownerId === userId) {
    return [...ROLE_PERMISSIONS.owner];
  }

  // 3. Explicit documentRoles grant.
  const [roleRow] = await db
    .select({ role: documentRoles.role })
    .from(documentRoles)
    .where(
      and(
        eq(documentRoles.documentId, doc.id),
        eq(documentRoles.userId, userId)
      )
    )
    .limit(1);

  if (roleRow) {
    const docRole = roleRow.role as DocumentRole;
    const perms = ROLE_PERMISSIONS[docRole] ?? [];
    // Public documents already give 'read'; return the role's full set.
    return [...perms];
  }

  // 4. Org membership — check if user is in any org associated with this document.
  if (doc.visibility === 'org' || doc.visibility === 'public') {
    // For 'org' visibility we check org membership to grant elevated access.
    // For 'public' visibility we already returned 'read' above; no need to check org.
    if (doc.visibility === 'org') {
      const orgAccess = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .innerJoin(documentOrgs, eq(documentOrgs.orgId, orgMembers.orgId))
        .where(
          and(
            eq(documentOrgs.documentId, doc.id),
            eq(orgMembers.userId, userId)
          )
        )
        .limit(1);

      if (orgAccess.length > 0) {
        const effectiveDocRole = orgRoleToDocumentRole(orgAccess[0].role as OrgRole);
        return [...ROLE_PERMISSIONS[effectiveDocRole]];
      }
    }
  }

  // 5. Public fallback — authenticated user reading a public doc.
  if (doc.visibility === 'public') {
    return ['read'];
  }

  // No access.
  return [];
}

/**
 * Check whether a user holds a specific permission on a document.
 * Returns false for non-existent documents (caller should 404 separately).
 */
export async function hasPermission(
  userId: string | null | undefined,
  slug: string,
  permission: Permission
): Promise<boolean> {
  const perms = await getDocumentPermissions(userId, slug);
  return perms.includes(permission);
}

// ────────────────────────────────────────────────────────────────
// Fastify preHandler factory
// ────────────────────────────────────────────────────────────────

/**
 * Create a Fastify preHandler that enforces a minimum permission level.
 *
 * Usage:
 *   fastify.get('/documents/:slug', { preHandler: [requirePermission('read')] }, handler)
 *
 * The handler is responsible for checking document existence (404) separately
 * when the slug is not found — this middleware returns 403 for permission
 * denied and 401 for unauthenticated requests on private documents.
 */
export function requirePermission(permission: Permission) {
  return async function checkPermission(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as Record<string, string>;
    const slug = params.slug;

    if (!slug) {
      // Route does not use :slug — cannot enforce document-level RBAC here.
      return;
    }

    const userId = request.user?.id ?? null;
    const perms = await getDocumentPermissions(userId, slug);

    if (perms.length === 0 && !userId) {
      // Non-existent document or unauthenticated on private doc — 401 to signal
      // the client should authenticate before retrying.
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required to access this document',
      });
    }

    if (!perms.includes(permission)) {
      return reply.status(403).send({
        error: 'Forbidden',
        message: `You do not have '${permission}' permission on this document`,
      });
    }
  };
}

// ────────────────────────────────────────────────────────────────
// Convenience preHandler exports
// ────────────────────────────────────────────────────────────────

export const canRead = requirePermission('read');
export const canWrite = requirePermission('write');
export const canDelete = requirePermission('delete');
export const canManage = requirePermission('manage');
export const canApprove = requirePermission('approve');
