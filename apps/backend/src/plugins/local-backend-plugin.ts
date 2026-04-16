/**
 * local-backend-plugin — Fastify plugin that provides a LocalBackend instance
 * as fastify.localBackend.
 *
 * This plugin makes the portable SDK's LocalBackend available to any Fastify
 * route or plugin via the decorator pattern. Existing routes are NOT changed —
 * they continue using the apps/backend Drizzle/Postgres connection.
 *
 * New routes that want portable, backend-agnostic storage SHOULD use
 * `fastify.localBackend` instead of importing directly from apps/backend/src/db.
 *
 * Usage in a route plugin:
 * ```ts
 * import { registerLocalBackendPlugin } from './plugins/local-backend-plugin.js';
 *
 * await app.register(registerLocalBackendPlugin);
 *
 * app.get('/my-portable-route', async (req, reply) => {
 *   const doc = await app.localBackend.getDocument(req.params.id);
 *   return reply.send(doc);
 * });
 * ```
 *
 * Storage: defaults to LLMTXT_LOCAL_STORAGE env var, falling back to
 * .llmtxt/ in the current working directory.
 */

import type { FastifyInstance } from 'fastify';
import { LocalBackend } from 'llmtxt/local';
import type { Backend } from 'llmtxt/local';

declare module 'fastify' {
  interface FastifyInstance {
    /** Portable LocalBackend instance for SDK-first feature routes. */
    localBackend: Backend;
  }
}

/**
 * Register the LocalBackend plugin with a Fastify instance.
 *
 * Opens the backend on registration and closes it on app shutdown via onClose.
 */
export async function registerLocalBackendPlugin(app: FastifyInstance): Promise<void> {
  const storagePath = process.env.LLMTXT_LOCAL_STORAGE ?? '.llmtxt';

  const backend = new LocalBackend({ storagePath });
  await backend.open();

  app.decorate('localBackend', backend);

  app.addHook('onClose', async () => {
    await backend.close();
  });
}
