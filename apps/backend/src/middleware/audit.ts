/**
 * Audit logging middleware.
 *
 * Records all state-changing HTTP operations (POST, PUT, DELETE, PATCH) that
 * return a 2xx or 3xx status code. The log entry captures who made the request,
 * what resource was affected, and the outcome.
 *
 * Design decisions:
 * - Writes are fire-and-forget (non-blocking) so audit logging never adds
 *   latency to the request path. Errors are logged but do not affect the
 *   response.
 * - GET requests are not logged (too noisy; cache and access_count tracking
 *   already cover read auditing).
 * - Health check and well-known discovery endpoints are excluded.
 * - Failed authentication attempts are excluded (rate limiting handles those;
 *   better-auth logs them separately).
 * - Auth events from better-auth (/api/auth/*) are logged as auth.* actions.
 *
 * Action naming convention:
 *   <resourceType>.<verb>
 *   Examples: document.create, document.update, document.delete,
 *             version.create, lifecycle.transition, approval.submit,
 *             approval.reject, auth.login, auth.logout, signed_url.create
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { requireAuth } from './auth.js';
import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { STATE_CHANGING_METHODS } from 'llmtxt';

/** Paths that should never generate audit log entries. */
const EXCLUDED_PATH_SET = new Set([
  '/api/health',
  '/.well-known/llm.json',
  '/robots.txt',
  '/api/llms.txt',
  '/api/stats/cache',
]);

/** Returns true for paths that should be skipped. */
function isExcludedPath(path: string): boolean {
  const pathOnly = path.split('?')[0];
  return EXCLUDED_PATH_SET.has(pathOnly);
}

/** Returns true for 2xx and 3xx status codes (successful operations). */
function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

/**
 * Derive a structured action name from the HTTP method and request path.
 * Returns null if the route does not warrant audit logging.
 */
function deriveAction(method: string, path: string): { action: string; resourceType: string; resourceId: string | null } | null {
  const pathOnly = path.split('?')[0];

  // Auth events
  if (pathOnly.startsWith('/api/auth/')) {
    if (pathOnly.includes('sign-in')) return { action: 'auth.login', resourceType: 'auth', resourceId: null };
    if (pathOnly.includes('sign-up')) return { action: 'auth.register', resourceType: 'auth', resourceId: null };
    if (pathOnly.includes('sign-out')) return { action: 'auth.logout', resourceType: 'auth', resourceId: null };
    return { action: 'auth.event', resourceType: 'auth', resourceId: null };
  }

  // Extract slug from /api/documents/:slug/...
  const docMatch = pathOnly.match(/^\/api\/documents\/([^/]+)(\/(.*))?$/);
  if (docMatch) {
    const slug = docMatch[1];
    const subPath = docMatch[3] || '';

    if (subPath === 'transition') return { action: 'lifecycle.transition', resourceType: 'document', resourceId: slug };
    if (subPath === 'approve') return { action: 'approval.submit', resourceType: 'approval', resourceId: slug };
    if (subPath === 'reject') return { action: 'approval.reject', resourceType: 'approval', resourceId: slug };
    if (subPath === 'patch') return { action: 'version.patch', resourceType: 'version', resourceId: slug };
    if (subPath === 'merge') return { action: 'version.merge', resourceType: 'version', resourceId: slug };
    if (subPath === 'batch-versions') return { action: 'version.batch_read', resourceType: 'version', resourceId: slug };

    if (!subPath && method === 'PUT') return { action: 'document.update', resourceType: 'document', resourceId: slug };
    if (!subPath && method === 'DELETE') return { action: 'document.delete', resourceType: 'document', resourceId: slug };
    return null; // Other sub-routes (GET-only reads)
  }

  // Document creation
  if (pathOnly === '/api/compress' && method === 'POST') {
    return { action: 'document.create', resourceType: 'document', resourceId: null };
  }

  // Signed URL creation
  if (pathOnly === '/api/signed-urls' && method === 'POST') {
    return { action: 'signed_url.create', resourceType: 'signed_url', resourceId: null };
  }

  // Cache invalidation
  if (pathOnly === '/api/cache' && method === 'DELETE') {
    return { action: 'cache.clear', resourceType: 'cache', resourceId: null };
  }

  return null;
}

/** Extract the client IP address from the request (respects x-forwarded-for). */
function getIpAddress(request: FastifyRequest): string | null {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return request.socket?.remoteAddress ?? null;
}

/** Extract agentId from the request body if present. */
function extractAgentId(request: FastifyRequest): string | null {
  try {
    const body = request.body as Record<string, unknown> | null;
    if (!body) return null;
    if (typeof body.agentId === 'string') return body.agentId;
    if (typeof body.createdBy === 'string') return body.createdBy;
    return null;
  } catch {
    return null;
  }
}

/** Register an onResponse hook that writes audit log entries for all successful state-changing requests. */
export async function registerAuditLogging(app: FastifyInstance) {
  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only audit state-changing methods.
    if (!STATE_CHANGING_METHODS.has(request.method)) return;

    // Skip excluded paths.
    if (isExcludedPath(request.url)) return;

    // Only log successful operations.
    const statusCode = reply.statusCode;
    if (!isSuccessStatus(statusCode)) return;

    // Derive structured action metadata.
    const actionMeta = deriveAction(request.method, request.url);
    if (!actionMeta) return;

    const now = Date.now();
    const userId = (request.user as { id?: string } | undefined)?.id ?? null;
    const agentId = extractAgentId(request);
    const ipAddress = getIpAddress(request);
    const userAgent = (request.headers['user-agent'] as string | undefined) ?? null;

    // Build a details blob for context-specific data.
    const details: Record<string, unknown> = {};
    if (request.params && typeof request.params === 'object') {
      const params = request.params as Record<string, unknown>;
      if (params.slug) details.slug = params.slug;
    }
    const detailsJson = Object.keys(details).length > 0 ? JSON.stringify(details) : null;

    const entry = {
      id: crypto.randomUUID(),
      userId,
      agentId,
      ipAddress,
      userAgent,
      action: actionMeta.action,
      resourceType: actionMeta.resourceType,
      resourceId: actionMeta.resourceId,
      details: detailsJson,
      timestamp: now,
      requestId: request.id,
      method: request.method,
      path: request.url.split('?')[0],
      statusCode,
    };

    // Fire-and-forget via setImmediate — never blocks the response.
    setImmediate(async () => {
      try {
        await db.insert(auditLogs).values(entry);
      } catch (err) {
        app.log.error({ err, entry }, 'audit log write failed');
      }
    });
  });
}

/**
 * Register the GET /api/audit-logs route.
 * Requires authentication. Returns paginated audit logs with optional filtering.
 *
 * Query parameters:
 *   - action: filter by exact action name (e.g. 'document.create')
 *   - resourceType: filter by resource type
 *   - userId: filter by user ID
 *   - from: start timestamp (unix ms)
 *   - to: end timestamp (unix ms)
 *   - limit: max results (default 50, max 500)
 *   - offset: pagination offset (default 0)
 */
export async function auditLogRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      action?: string;
      resourceType?: string;
      userId?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/audit-logs',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const q = request.query;
      const limit = Math.min(parseInt(q.limit ?? '50', 10) || 50, 500);
      const offset = parseInt(q.offset ?? '0', 10) || 0;

      // Build Drizzle ORM conditions — compatible with both SQLite and PostgreSQL.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const conditions: any[] = [];

      if (q.action) conditions.push(eq(auditLogs.action, q.action));
      if (q.resourceType) conditions.push(eq(auditLogs.resourceType, q.resourceType));
      if (q.userId) conditions.push(eq(auditLogs.userId, q.userId));
      if (q.from) {
        const ts = parseInt(q.from, 10);
        if (!isNaN(ts)) conditions.push(gte(auditLogs.timestamp, ts));
      }
      if (q.to) {
        const ts = parseInt(q.to, 10);
        if (!isNaN(ts)) conditions.push(lte(auditLogs.timestamp, ts));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, countResult] = await Promise.all([
        db
          .select()
          .from(auditLogs)
          .where(whereClause)
          .orderBy(desc(auditLogs.timestamp))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)` })
          .from(auditLogs)
          .where(whereClause),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return reply.send({
        logs: rows,
        total,
        limit,
        offset,
      });
    },
  );
}
