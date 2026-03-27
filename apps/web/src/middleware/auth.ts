/**
 * Auth middleware for Fastify routes.
 *
 * requireAuth: populates request.user or returns 401
 * requireOwner: checks request.user is document owner or returns 403
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../auth.js';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email?: string; name?: string; isAnonymous?: boolean };
    session?: { id: string; userId: string };
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value) headers.append(key, String(value));
  }

  const session = await auth.api.getSession({ headers });

  if (!session?.user) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
    return reply;
  }

  request.user = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    isAnonymous: (session.user as Record<string, unknown>).isAnonymous === true,
  };
  request.session = { id: session.session.id, userId: session.user.id };
}

export async function requireRegistered(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user?.isAnonymous) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'This feature requires a registered account. Sign up at /api/auth/sign-up/email',
    });
    return reply;
  }
}

export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  await requireRegistered(request, reply);
  if (reply.sent) return;

  const params = request.params as { slug?: string };
  if (!params.slug) return;

  const doc = await db.select({ ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.slug, params.slug))
    .limit(1);

  if (doc.length === 0) {
    reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
    return reply;
  }

  if (doc[0].ownerId !== request.user?.id) {
    reply.status(403).send({ error: 'Forbidden', message: 'You are not the owner of this document' });
    return reply;
  }
}
