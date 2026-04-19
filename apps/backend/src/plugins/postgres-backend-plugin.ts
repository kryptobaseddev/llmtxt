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
// Blob adapter (Wave T461): inject BlobPgAdapter so PostgresBackend.attachBlob/getBlob/etc work.
import { BlobPgAdapter } from '../storage/blob-pg-adapter.js';
// Wave B: inject event-log + CRDT helpers (monorepo boundary: cannot import from packages/llmtxt).
import { appendDocumentEvent } from '../lib/document-events.js';
import { persistCrdtUpdate, loadSectionState } from '../crdt/persistence.js';
import { subscribeCrdtUpdates } from '../realtime/redis-pubsub.js';
import { eventBus } from '../events/bus.js';
import { crdt_state_vector } from '../crdt/primitives.js';
// Wave C: inject presence registry + scratchpad helpers.
// T728: use RedisPresenceRegistry so presence is shared across Railway pods.
import { redisPresenceRegistry } from '../lib/presence-redis.js';
import { publishScratchpad, readScratchpad, subscribeScratchpad } from '../lib/scratchpad.js';

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

  // Wave B: inject event-log + CRDT dependencies.
  (backend as unknown as {
    setWaveBDeps: (deps: {
      appendDocumentEvent: typeof appendDocumentEvent;
      persistCrdtUpdate: typeof persistCrdtUpdate;
      loadSectionState: typeof loadSectionState;
      subscribeCrdtUpdates: typeof subscribeCrdtUpdates;
      eventBus: typeof eventBus;
      crdtStateVector: typeof crdt_state_vector;
    }) => void;
  }).setWaveBDeps({
    appendDocumentEvent,
    persistCrdtUpdate,
    loadSectionState,
    subscribeCrdtUpdates,
    eventBus,
    crdtStateVector: crdt_state_vector,
  });

  // Wave C: inject presence registry + scratchpad helpers.
  // T728: redisPresenceRegistry implements PresenceRegistryLike (upsert/expire/getByDoc).
  (backend as unknown as {
    setWaveCDeps: (deps: {
      presenceRegistry: typeof redisPresenceRegistry;
      scratchpadPublish: typeof publishScratchpad;
      scratchpadRead: typeof readScratchpad;
      scratchpadSubscribe: typeof subscribeScratchpad;
    }) => void;
  }).setWaveCDeps({
    presenceRegistry: redisPresenceRegistry,
    scratchpadPublish: publishScratchpad,
    scratchpadRead: readScratchpad,
    scratchpadSubscribe: subscribeScratchpad,
  });

  // Inject BlobPgAdapter (T461): wire blob storage to PostgresBackend.
  // Mode and S3 config are read from environment variables following the
  // same conventions as BackendConfig (BLOB_STORAGE_MODE, S3_BUCKET, etc.).
  const blobMode = (process.env.BLOB_STORAGE_MODE === 'pg-lo' ? 'pg-lo' : 's3') as 's3' | 'pg-lo';
  const s3Bucket = process.env.BLOB_S3_BUCKET ?? process.env.S3_BUCKET ?? '';
  // In pg-lo mode we do not require a bucket, so only construct s3 config when bucket is set.
  const blobAdapterConfig = blobMode === 'pg-lo'
    ? { mode: 'pg-lo' as const }
    : {
        mode: 's3' as const,
        s3: {
          endpoint: process.env.BLOB_S3_ENDPOINT ?? process.env.S3_ENDPOINT,
          bucket: s3Bucket,
          region: process.env.BLOB_S3_REGION ?? process.env.S3_REGION,
          accessKeyId: process.env.BLOB_S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.BLOB_S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY,
        },
      };

  try {
    // Construct the raw postgres-js sql client for the adapter by sharing
    // the backend's internal _sql client. We access it as a typed cast since
    // it is a private field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = (backend as any)._sql;
    const blobAdapter = new BlobPgAdapter(null, sql, blobAdapterConfig);
    (backend as unknown as { setBlobAdapter: (a: BlobPgAdapter) => void }).setBlobAdapter(blobAdapter);
    app.log.info(
      { mode: blobMode, bucket: s3Bucket || '(pg-lo mode)' },
      '[postgres-backend-plugin] BlobPgAdapter injected'
    );
  } catch (err: unknown) {
    // Non-fatal: blob routes will return 500 if blob operations are attempted
    // without a properly configured adapter. Log the reason so operators can fix it.
    app.log.warn(
      { err },
      '[postgres-backend-plugin] BlobPgAdapter injection failed — blob routes will error. ' +
      'Set BLOB_S3_BUCKET (and S3 credentials) or BLOB_STORAGE_MODE=pg-lo to enable blob storage.'
    );
  }

  app.log.info('[postgres-backend-plugin] PostgresBackend opened');

  app.decorate('backendCore', backend);

  app.addHook('onClose', async () => {
    await backend.close();
    app.log.info('[postgres-backend-plugin] PostgresBackend closed');
  });
}
