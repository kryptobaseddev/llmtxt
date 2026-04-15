/**
 * Health check and metrics routes for Railway uptime monitoring.
 *
 * GET /api/health   — liveness: always 200, no I/O, responds in <50ms.
 * GET /api/ready    — readiness: runs SELECT 1 on the active DB connection.
 * GET /api/metrics  — Prometheus text format metrics (prom-client registry).
 *
 * All three routes are exempt from authentication and rate limiting.
 * The allowList in registerRateLimiting covers /api/health, /api/ready, and
 * /api/metrics.
 *
 * SPEC references: SPEC-T145 §7.4–7.8 (metrics), §8.1–8.4 (health/ready)
 */
import type { FastifyInstance } from 'fastify';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { metricsRegistry } from '../middleware/metrics.js';

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
          // Drizzle over postgres-js: use sql template tag for a raw query.
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

  /**
   * GET /metrics (registered at /api/metrics via prefix in index.ts)
   *
   * Prometheus text format metrics endpoint. Returns the full default registry
   * including HTTP request duration histogram, request counter, and process
   * metrics collected by prom-client.
   *
   * Authentication: if METRICS_TOKEN env var is set, requires
   *   Authorization: Bearer <METRICS_TOKEN>
   * and returns 401 if the header is absent or the token doesn't match.
   * If METRICS_TOKEN is unset the endpoint is publicly accessible (dev-only).
   *
   * SPEC-T145 §7.4–7.8
   */
  app.get(
    '/metrics',
    {
      config: {
        // Exempt from rate limiting — Prometheus scraper hits this frequently.
        rateLimit: false,
      },
    },
    async (request, reply) => {
      const metricsToken = process.env.METRICS_TOKEN;

      if (metricsToken) {
        const authHeader = request.headers['authorization'];
        const provided = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : null;

        if (!provided || provided !== metricsToken) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Valid Authorization: Bearer <METRICS_TOKEN> header required',
          });
        }
      }

      try {
        const [metrics, contentType] = await Promise.all([
          metricsRegistry.metrics(),
          Promise.resolve(metricsRegistry.contentType),
        ]);
        return reply
          .status(200)
          .header('Content-Type', contentType)
          .send(metrics);
      } catch (err) {
        app.log.error({ err }, 'failed to collect metrics');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Failed to collect metrics',
        });
      }
    }
  );
}
