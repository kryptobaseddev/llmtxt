/**
 * Health check routes for Railway uptime monitoring and readiness probes.
 *
 * GET /api/health  — liveness: always 200, no I/O, responds in <50ms.
 * GET /api/ready   — readiness: runs SELECT 1 on the active DB connection.
 *
 * Both routes are exempt from authentication and rate limiting.
 * The allowList in registerRateLimiting already covers /api/health;
 * /api/ready is added here via the route-level config.
 */
import type { FastifyInstance } from 'fastify';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Read package version at startup — resolved relative to this file's directory.
function readPackageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../package.json'
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const PKG_VERSION = readPackageVersion();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /health (registered at /api/health via prefix in index.ts)
   *
   * Liveness probe — no I/O. Returns immediately with package version and
   * an ISO-8601 timestamp. Used by Railway to determine if the process is
   * alive and should receive traffic.
   *
   * SPEC 8.1: MUST return 200 with { status, version, ts }.
   * SPEC 8.2: MUST NOT perform any I/O.
   * SPEC 8.4: Exempt from authentication and rate limiting.
   */
  app.get(
    '/health',
    {
      config: {
        // Disable rate limiting for this route (belt-and-suspenders alongside allowList).
        rateLimit: false,
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        version: PKG_VERSION,
        ts: new Date().toISOString(),
      });
    }
  );

  /**
   * GET /ready (registered at /api/ready via prefix in index.ts)
   *
   * Readiness probe — performs a quick DB ping before marking the instance
   * ready. Returns 503 if the DB cannot be reached so Railway (or any load
   * balancer) stops routing traffic to this instance.
   *
   * SPEC 8.3: MUST return 200 when DB is alive, 503 with reason when not.
   * SPEC 8.4: Exempt from authentication and rate limiting.
   */
  app.get(
    '/ready',
    {
      config: {
        rateLimit: false,
      },
    },
    async (_request, reply) => {
      try {
        // Dynamic import so health.ts has zero coupling to the DB at module
        // load time — this lets tests import this route without a real DB.
        const { db, DATABASE_PROVIDER } = await import('../db/index.js');

        if (DATABASE_PROVIDER === 'postgresql') {
          // Drizzle over node-postgres: use sql template tag for a raw query.
          const { sql } = await import('drizzle-orm');
          await db.execute(sql`SELECT 1`);
        } else {
          // Drizzle over better-sqlite3: use .run() for a synchronous probe.
          const { sql } = await import('drizzle-orm');
          db.run(sql`SELECT 1`);
        }

        return reply.status(200).send({
          status: 'ok',
          version: PKG_VERSION,
          ts: new Date().toISOString(),
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Database unavailable';
        app.log.error({ err }, 'readiness check failed');
        return reply.status(503).send({
          status: 'unavailable',
          reason: message,
          ts: new Date().toISOString(),
        });
      }
    }
  );
}
