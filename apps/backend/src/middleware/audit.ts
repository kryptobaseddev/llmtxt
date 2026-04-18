/**
 * Audit logging middleware — T164: tamper-evident hash chain.
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
 * - T164: Every inserted row now carries payload_hash and chain_hash for
 *   tamper-evidence. Chain appends are serialized via a module-level mutex
 *   (single write at a time) to guarantee chain consistency without a DB-level
 *   transaction lock on every audit write.
 * - Chain root: prev_chain_hash for the first row is [0u8;32] (the genesis
 *   sentinel), encoded as 64 zeros hex.
 *
 * Action naming convention:
 *   <resourceType>.<verb>
 *   Examples: document.create, document.update, document.delete,
 *             version.create, lifecycle.transition, approval.submit,
 *             approval.reject, auth.login, auth.logout, signed_url.create
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema-pg.js';
import { requireAuth } from './auth.js';
import { eq, and, gte, lte, desc, sql, isNotNull } from 'drizzle-orm';
import { STATE_CHANGING_METHODS } from 'llmtxt';

// ── Hash chain helpers ───────────────────────────────────────────────────────

const GENESIS_HASH = '0'.repeat(64); // [0u8; 32] encoded as hex

/**
 * Compute the canonical serialization for a security event.
 * Format: `{id}|{event_type}|{actor_id}|{resource_id}|{timestamp_ms}`
 * NULL values are represented as the empty string.
 */
function canonicalEventStr(
  id: string,
  eventType: string,
  actorId: string | null,
  resourceId: string | null,
  timestampMs: number,
): string {
  return [id, eventType, actorId ?? '', resourceId ?? '', String(timestampMs)].join('|');
}

/**
 * Compute SHA-256 of a UTF-8 string, returned as 64-char lowercase hex.
 */
function sha256hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Compute chain_hash = SHA-256(prev_chain_hash_bytes || payload_hash_bytes).
 * Both inputs are 64-char hex strings (32 raw bytes each).
 */
function computeChainHash(prevChainHashHex: string, payloadHashHex: string): string {
  const prev = Buffer.from(prevChainHashHex, 'hex');
  const payload = Buffer.from(payloadHashHex, 'hex');
  return crypto.createHash('sha256').update(prev).update(payload).digest('hex');
}

/**
 * Fetch the chain_hash of the most recently inserted audit_log row that has
 * a non-null chain_hash, or return the genesis sentinel if none exists.
 */
async function fetchPrevChainHash(): Promise<string> {
  const rows = await db
    .select({ chainHash: auditLogs.chainHash })
    .from(auditLogs)
    .where(isNotNull(auditLogs.chainHash))
    .orderBy(desc(auditLogs.timestamp))
    .limit(1);

  return rows[0]?.chainHash ?? GENESIS_HASH;
}

/**
 * Module-level mutex: ensures only one audit write computes and stores its
 * chain_hash at a time. Prevents race conditions on concurrent requests.
 */
let chainMutex: Promise<void> = Promise.resolve();

/**
 * Append an audit log row with a computed payload_hash and chain_hash.
 * Serialized: each call waits for the previous one before fetching prev_hash.
 */
async function appendAuditRow(entry: {
  id: string;
  userId: string | null;
  agentId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  action: string;
  eventType: string;
  actorId: string | null;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  timestamp: number;
  requestId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
}): Promise<void> {
  // Serialize by chaining promises — each write waits for the previous.
  const thisWrite = chainMutex.then(async () => {
    const payloadHash = sha256hex(
      canonicalEventStr(entry.id, entry.eventType, entry.actorId, entry.resourceId, entry.timestamp),
    );
    const prevChainHash = await fetchPrevChainHash();
    const chainHash = computeChainHash(prevChainHash, payloadHash);

    await db.insert(auditLogs).values({
      ...entry,
      payloadHash,
      chainHash,
    });
  });

  chainMutex = thisWrite.catch(() => {
    // On error, reset mutex so subsequent writes can still proceed.
  });

  await thisWrite;
}

// ── Path exclusion ───────────────────────────────────────────────────────────

/** Paths that should never generate audit log entries. */
const EXCLUDED_PATH_SET = new Set([
  '/api/health',
  '/api/ready',
  '/.well-known/llm.json',
  '/robots.txt',
  '/api/llms.txt',
  '/api/stats/cache',
  '/api/metrics',
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
function deriveAction(
  method: string,
  path: string,
): { action: string; eventType: string; resourceType: string; resourceId: string | null } | null {
  const pathOnly = path.split('?')[0];

  // Auth events
  if (pathOnly.startsWith('/api/auth/')) {
    if (pathOnly.includes('sign-in'))
      return { action: 'auth.login', eventType: 'auth.login', resourceType: 'auth', resourceId: null };
    if (pathOnly.includes('sign-up'))
      return { action: 'auth.register', eventType: 'auth.register', resourceType: 'auth', resourceId: null };
    if (pathOnly.includes('sign-out'))
      return { action: 'auth.logout', eventType: 'auth.logout', resourceType: 'auth', resourceId: null };
    return { action: 'auth.event', eventType: 'auth.event', resourceType: 'auth', resourceId: null };
  }

  // API key management
  if (pathOnly.startsWith('/api/api-keys') || pathOnly.startsWith('/api/v1/api-keys')) {
    if (method === 'POST')
      return { action: 'api_key.create', eventType: 'api_key.create', resourceType: 'api_key', resourceId: null };
    if (method === 'DELETE') {
      const keyId = pathOnly.split('/').pop() ?? null;
      return { action: 'api_key.revoke', eventType: 'api_key.revoke', resourceType: 'api_key', resourceId: keyId };
    }
  }

  // Extract slug from /api/documents/:slug/...
  const docMatch = pathOnly.match(/^\/api\/documents\/([^/]+)(\/(.*))?$/);
  if (docMatch) {
    const slug = docMatch[1];
    const subPath = docMatch[3] || '';

    if (subPath === 'transition')
      return { action: 'lifecycle.transition', eventType: 'lifecycle.transition', resourceType: 'document', resourceId: slug };
    if (subPath === 'approve')
      return { action: 'approval.submit', eventType: 'approval.submit', resourceType: 'approval', resourceId: slug };
    if (subPath === 'reject')
      return { action: 'approval.reject', eventType: 'approval.reject', resourceType: 'approval', resourceId: slug };
    if (subPath === 'patch')
      return { action: 'version.patch', eventType: 'version.patch', resourceType: 'version', resourceId: slug };
    if (subPath === 'merge')
      return { action: 'version.merge', eventType: 'version.merge', resourceType: 'version', resourceId: slug };
    if (subPath === 'batch-versions')
      return { action: 'version.batch_read', eventType: 'version.batch_read', resourceType: 'version', resourceId: slug };
    if (!subPath && method === 'PUT')
      return { action: 'document.update', eventType: 'document.update', resourceType: 'document', resourceId: slug };
    if (!subPath && method === 'DELETE')
      return { action: 'document.delete', eventType: 'document.delete', resourceType: 'document', resourceId: slug };
    return null;
  }

  // v1 document routes
  const v1DocMatch = pathOnly.match(/^\/api\/v1\/documents\/([^/]+)(\/(.*))?$/);
  if (v1DocMatch) {
    const slug = v1DocMatch[1];
    const subPath = v1DocMatch[3] || '';
    if (subPath === 'transition')
      return { action: 'lifecycle.transition', eventType: 'lifecycle.transition', resourceType: 'document', resourceId: slug };
    if (subPath === 'approve')
      return { action: 'approval.submit', eventType: 'approval.submit', resourceType: 'approval', resourceId: slug };
    if (subPath === 'reject')
      return { action: 'approval.reject', eventType: 'approval.reject', resourceType: 'approval', resourceId: slug };
    if (!subPath && method === 'PUT')
      return { action: 'document.update', eventType: 'document.update', resourceType: 'document', resourceId: slug };
    if (!subPath && method === 'DELETE')
      return { action: 'document.delete', eventType: 'document.delete', resourceType: 'document', resourceId: slug };
  }

  // Document creation
  if (pathOnly === '/api/compress' && method === 'POST') {
    return { action: 'document.create', eventType: 'document.create', resourceType: 'document', resourceId: null };
  }

  // Signed URL creation
  if ((pathOnly === '/api/signed-urls' || pathOnly === '/api/v1/signed-urls') && method === 'POST') {
    return { action: 'signed_url.create', eventType: 'signed_url.create', resourceType: 'signed_url', resourceId: null };
  }

  // Cache invalidation
  if (pathOnly === '/api/cache' && method === 'DELETE') {
    return { action: 'cache.clear', eventType: 'cache.clear', resourceType: 'cache', resourceId: null };
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

// ── Middleware registration ───────────────────────────────────────────────────

/** Register an onResponse hook that writes tamper-evident audit log entries. */
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

    // Actor: prefer agentId (T147 signed identity), fall back to userId.
    const actorId = agentId ?? userId;

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
      eventType: actionMeta.eventType,
      actorId,
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
    // Chain hash computation is serialized inside appendAuditRow.
    setImmediate(async () => {
      try {
        await appendAuditRow(entry);
      } catch (err) {
        app.log.error({ err, entryId: entry.id }, 'audit log write failed');
      }
    });
  });
}

// ── Audit log query route ────────────────────────────────────────────────────

/**
 * Register the GET /api/audit-logs route.
 * Requires authentication. Returns paginated audit logs with optional filtering.
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
