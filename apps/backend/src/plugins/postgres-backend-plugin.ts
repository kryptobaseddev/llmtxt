/**
 * postgres-backend-plugin — Fastify plugin that provides a PostgresBackend instance
 * as fastify.backendCore.
 *
 * This plugin wires the portable SDK's PostgresBackend into Fastify via the
 * decorator pattern. Route handlers SHOULD call `fastify.backendCore.*` instead
 * of importing directly from apps/backend/src/db/*.
 *
 * Migration status:
 *   - T353.3 (RCASD): Plugin registered but ALL method calls throw NotImplemented.
 *   - T353.4 (Wave A): Documents + Versions + Lifecycle will be wired.
 *   - T353.5..7 (Waves B-D): Remaining domains will be wired.
 *
 * Relationship to existing `db` export:
 *   - During migration, route files may import both `db` (legacy) and use
 *     `fastify.backendCore` (new). The goal is to eliminate all direct `db`
 *     imports from routes by the end of Wave D.
 *   - The PostgresBackend internally creates its own postgres-js connection.
 *     This is intentionally separate from the `db` singleton in src/db/index.ts
 *     during the migration. After all routes are migrated, src/db/index.ts
 *     can be retired.
 *
 * Usage in route plugin:
 * ```ts
 * // Route file (after migration):
 * export async function myRoutes(fastify: FastifyInstance) {
 *   fastify.get('/documents/:slug', async (req, reply) => {
 *     const doc = await req.server.backendCore.getDocumentBySlug(req.params.slug);
 *     if (!doc) return reply.status(404).send({ error: 'Not Found' });
 *     return doc;
 *   });
 * }
 * ```
 */

import type { FastifyInstance } from 'fastify';
import { PostgresBackend } from 'llmtxt/pg';
import type { Backend } from 'llmtxt/local';
// Wave A: inject schema tables so PostgresBackend can query without cross-package static imports.
import * as schemaPg from '../db/schema-pg.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * PostgresBackend instance — the canonical Backend implementation for
     * apps/backend. All route handlers SHOULD call methods on this instance
     * instead of querying Drizzle directly.
     *
     * Registered by postgres-backend-plugin.ts.
     */
    backendCore: Backend;
  }
}

/**
 * Register the PostgresBackend plugin with a Fastify instance.
 *
 * Opens the backend on plugin registration and closes it on app shutdown.
 * Reads the PostgreSQL connection string from DATABASE_URL environment variable.
 *
 * Wave A injection: passes schema-pg.ts table references into PostgresBackend
 * via setSchema() so that domain methods can query without static cross-package imports.
 */
export async function registerPostgresBackendPlugin(app: FastifyInstance): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    app.log.warn(
      '[postgres-backend-plugin] DATABASE_URL not set — PostgresBackend will throw on first use. ' +
      'Set DATABASE_URL to a valid PostgreSQL connection string.'
    );
  }

  const backend = new PostgresBackend({
    connectionString,
    maxConnections: parseInt(process.env.PG_MAX_CONNECTIONS ?? '10', 10),
  });

  await backend.open();

  // Inject schema table references — avoids cross-package static imports.
  (backend as unknown as { setSchema: (s: typeof schemaPg) => void }).setSchema(schemaPg);

  app.log.info('[postgres-backend-plugin] PostgresBackend opened');

  app.decorate('backendCore', backend);

  app.addHook('onClose', async () => {
    await backend.close();
    app.log.info('[postgres-backend-plugin] PostgresBackend closed');
  });
}
