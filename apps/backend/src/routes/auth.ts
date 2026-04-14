/**
 * Auth routes: proxies to better-auth handler.
 *
 * Endpoints (auto-provided by better-auth):
 *   POST /auth/sign-up/email
 *   POST /auth/sign-in/email
 *   POST /auth/sign-in/anonymous
 *   POST /auth/sign-out
 *   GET  /auth/get-session
 */
import type { FastifyInstance } from 'fastify';
import { auth } from '../auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';

/** Register authentication routes by proxying all /auth/* requests to the better-auth handler. */
export async function authRoutes(fastify: FastifyInstance) {
  fastify.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    config: authRateLimit,
    async handler(request, reply) {
      const url = new URL(
        request.url,
        `${request.protocol}://${request.hostname}`,
      );
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value) headers.append(key, String(value));
      }

      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });

      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      const body = await response.text();
      reply.send(body || null);
    },
  });
}
