/**
 * Auth middleware for Fastify routes.
 *
 * requireAuth: populates request.user or returns 401
 * requireOwner: checks request.user is document owner or returns 403
 *
 * Authentication priority:
 *   1. Authorization: Bearer llmtxt_... — API key auth
 *      - If a Bearer token is provided but invalid/revoked/expired → 401 immediately
 *      - If valid → populate request.user and request.session (synthetic)
 *   2. Cookie-based session via better-auth (existing behaviour)
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../auth.js';
import { db } from '../db/index.js';
import { documents, apiKeys, users } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { hashApiKey, isApiKeyFormat } from '../utils/api-keys.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email?: string; name?: string; isAnonymous?: boolean };
    session?: { id: string; userId: string };
  }
}

/**
 * Attempt to authenticate via a Bearer API key.
 *
 * Returns:
 *   - `'authenticated'` when the token is valid and request.user is set
 *   - `'invalid'` when the Bearer token is present but bad (caller must 401)
 *   - `'not_present'` when no Bearer token exists (fall through to cookie auth)
 */
async function tryBearerAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<'authenticated' | 'invalid' | 'not_present'> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return 'not_present';
  }

  const token = authHeader.slice('Bearer '.length).trim();

  // Quick format check before touching the database
  if (!isApiKeyFormat(token)) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Invalid API key format' });
    return 'invalid';
  }

  const keyHash = hashApiKey(token);
  const now = Date.now();

  // Look up key by hash — only active, non-expired keys
  const [keyRow] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      revoked: apiKeys.revoked,
      expiresAt: apiKeys.expiresAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!keyRow) {
    reply.status(401).send({ error: 'Unauthorized', message: 'API key not found' });
    return 'invalid';
  }

  if (keyRow.revoked) {
    reply.status(401).send({ error: 'Unauthorized', message: 'API key has been revoked' });
    return 'invalid';
  }

  if (keyRow.expiresAt !== null && keyRow.expiresAt <= now) {
    reply.status(401).send({ error: 'Unauthorized', message: 'API key has expired' });
    return 'invalid';
  }

  // Update lastUsedAt asynchronously (fire-and-forget) — don't block the request
  db.update(apiKeys)
    .set({ lastUsedAt: now, updatedAt: now })
    .where(eq(apiKeys.id, keyRow.id))
    .catch(() => {
      // Non-fatal: audit update failure shouldn't break the request
    });

  // Fetch the owning user
  const [userRow] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isAnonymous: users.isAnonymous,
    })
    .from(users)
    .where(eq(users.id, keyRow.userId))
    .limit(1);

  if (!userRow) {
    reply.status(401).send({ error: 'Unauthorized', message: 'API key owner not found' });
    return 'invalid';
  }

  // Populate synthetic session on the request
  request.user = {
    id: userRow.id,
    email: userRow.email ?? undefined,
    name: userRow.name ?? undefined,
    isAnonymous: userRow.isAnonymous === true,
  };
  // Synthetic session — use the key ID as the session ID for traceability
  request.session = { id: `apikey:${keyRow.id}`, userId: userRow.id };

  return 'authenticated';
}

/**
 * Attempt API key authentication without sending a 401 on failure.
 * Populates request.user / request.session if a valid API key Bearer token is present.
 * Safe to call on optional-auth routes (e.g. /compress) — never sends a response.
 */
export async function tryAuthenticateApiKey(request: FastifyRequest): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return;
  // Use a no-op reply object so tryBearerAuth can send responses without affecting the live reply.
  // We discard any 401 it would send — this is intentional for optional-auth paths.
  const noopReply = {
    status: () => noopReply,
    send: () => noopReply,
    sent: false,
  } as unknown as import('fastify').FastifyReply;
  await tryBearerAuth(request, noopReply);
  // If tryBearerAuth succeeded it populated request.user; if it failed, request.user stays unset.
}

/** Authenticate the request via Bearer API key first, then session cookie. Populates request.user and request.session, or returns 401. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  // 1. Try Bearer API key first
  const bearerResult = await tryBearerAuth(request, reply);
  if (bearerResult === 'authenticated') return;
  if (bearerResult === 'invalid') return reply; // 401 already sent

  // 2. Fall through to cookie-based session auth
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

/** Require an authenticated, non-anonymous user. Calls requireAuth first, then rejects anonymous sessions with 403. */
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

/** Require the authenticated user to be the document owner. Checks slug from route params against document ownerId. Returns 403 if not owner, 404 if document not found. */
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

/**
 * Require the authenticated user (anonymous OK) to be the document owner.
 * Reads slug from request body (for routes like POST /signed-urls where slug is a body field).
 * Does NOT call requireRegistered — anonymous owners are permitted.
 * Returns 403 if not owner, 404 if document not found.
 */
export async function requireOwnerAllowAnon(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  const body = request.body as { slug?: string } | null;
  const slug = body?.slug;

  if (!slug) {
    reply.status(400).send({ error: 'Bad Request', message: 'slug is required' });
    return reply;
  }

  const doc = await db.select({ ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.slug, slug))
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

/**
 * Require the authenticated user (anonymous OK) to be the document owner.
 * Reads slug from route params (for routes like POST /documents/:slug/transition).
 * Does NOT call requireRegistered — anonymous owners are permitted.
 * Returns 403 if not owner, 404 if document not found.
 */
export async function requireOwnerAllowAnonParams(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  const params = request.params as { slug?: string };
  const slug = params.slug;

  if (!slug) {
    reply.status(400).send({ error: 'Bad Request', message: 'slug param is required' });
    return reply;
  }

  const doc = await db.select({ ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.slug, slug))
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
