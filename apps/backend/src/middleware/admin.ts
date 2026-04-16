/**
 * Admin authentication middleware.
 *
 * Admin access is determined by the ADMIN_EMAILS environment variable —
 * a comma-separated list of email addresses. This avoids adding a role
 * column to the users table (no schema migration required).
 *
 * Usage:
 *   fastify.get('/api/v1/admin/...', { preHandler: [requireAdmin] }, handler)
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.js';

/**
 * Return the set of admin email addresses configured in the environment.
 * Falls back to an empty set if the variable is not set.
 */
function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? '';
  const emails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(emails);
}

/**
 * Fastify preHandler: ensures the authenticated user is an admin.
 *
 * Returns 401 if unauthenticated, 403 if authenticated but not admin.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return; // 401 already sent by requireAuth

  const email = (request.user?.email ?? '').toLowerCase();
  const adminEmails = getAdminEmails();

  if (adminEmails.size === 0) {
    // No admins configured — fail closed for safety.
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Admin access not configured. Set ADMIN_EMAILS on the backend service.',
    });
    return;
  }

  if (!adminEmails.has(email)) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Admin access required.',
    });
  }
}

/**
 * Check (without sending a response) whether the authenticated user is admin.
 * Useful for conditional rendering in non-protected routes.
 */
export function isAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  const adminEmails = getAdminEmails();
  return adminEmails.has(email.toLowerCase());
}
