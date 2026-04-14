/**
 * CSRF protection middleware for cookie-authenticated requests.
 *
 * Strategy:
 * - Bearer token (API key) requests are CSRF-immune by design — the token is
 *   the authentication credential and a cross-origin attacker cannot read it.
 * - better-auth handles its own CSRF for /api/auth/* endpoints.
 * - All other state-changing requests that rely on cookies (POST, PUT, DELETE,
 *   PATCH) are protected by @fastify/csrf-protection via the `csrfProtection`
 *   preHandler injected by the plugin.
 *
 * The plugin adds:
 *   - `reply.generateCsrf()` — call from a GET endpoint to issue a token.
 *   - `fastify.csrfProtection` — a preHandler that validates the token.
 *
 * Clients that use cookie-based sessions must:
 *   1. Fetch a CSRF token via GET /api/csrf-token
 *   2. Send it in the `x-csrf-token` header on every state-changing request.
 *
 * API key (Bearer) clients are automatically exempt.
 *
 * Registration order (in index.ts):
 *   1. @fastify/cookie  (must come before csrf)
 *   2. @fastify/csrf-protection (registered here)
 *   3. this hook (preHandler on every state-changing route)
 *   4. route registration
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyCookie from '@fastify/cookie';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

/**
 * Paths that are exempt from CSRF checks.
 * - /api/auth/* — better-auth manages its own CSRF protection.
 */
function isCsrfExemptPath(path: string): boolean {
  return path.startsWith('/api/auth/');
}

/**
 * Returns true when the request uses Bearer token authentication.
 * Bearer-authenticated requests are not cookie-based and are therefore
 * immune to CSRF attacks regardless of origin.
 */
function hasBearerToken(request: FastifyRequest): boolean {
  const authHeader = request.headers.authorization;
  return typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ');
}

/** Register @fastify/cookie and @fastify/csrf-protection, and add a preHandler hook that enforces CSRF for cookie-authenticated, state-changing requests. */
export async function registerCsrf(app: FastifyInstance) {
  // Register cookie parser — required by csrf-protection.
  await app.register(fastifyCookie);

  // Register CSRF plugin. Uses cookies for token storage.
  await app.register(fastifyCsrf, {
    cookieOpts: {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
    },
    // Read token from the `x-csrf-token` request header.
    getToken: (req: FastifyRequest) => req.headers['x-csrf-token'] as string | undefined,
  });

  // GET /api/csrf-token — issue a CSRF token for cookie-authenticated browser clients.
  // API-key clients do not need this endpoint.
  app.get('/api/csrf-token', async (_request, reply) => {
    const token = reply.generateCsrf();
    return reply.send({ csrfToken: token });
  });

  // Selective CSRF enforcement — runs as a preHandler on every request.
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip safe methods — they cannot trigger state changes.
    if (!STATE_CHANGING_METHODS.has(request.method)) return;

    // Skip better-auth routes — they manage CSRF internally.
    if (isCsrfExemptPath(request.url)) return;

    // Skip requests authenticated by Bearer token — CSRF does not apply.
    if (hasBearerToken(request)) return;

    // Validate CSRF token for cookie-authenticated state-changing requests.
    // app.csrfProtection is a synchronous-style callback — wrap in a promise.
    await new Promise<void>((resolve, reject) => {
      app.csrfProtection(request, reply, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    }).catch(() => {
      reply.status(403).send({
        error: 'Forbidden',
        message: 'CSRF token missing or invalid. Include a valid x-csrf-token header.',
      });
    });
  });
}
