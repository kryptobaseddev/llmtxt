// Main entry point
// NOTE: @sentry/node is initialised in instrumentation.ts (loaded via --import).
// Importing the package here gives us access to the already-initialised singleton.
import * as Sentry from '@sentry/node';
import Fastify from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import http from 'http';
import { apiRoutes } from './routes/api.js';
import { disclosureRoutes } from './routes/disclosure.js';
import { versionRoutes } from './routes/versions.js';
import { authRoutes } from './routes/auth.js';
import { lifecycleRoutes } from './routes/lifecycle.js';
import { patchRoutes } from './routes/patches.js';
import { similarityRoutes } from './routes/similarity.js';
import { graphRoutes } from './routes/graph.js';
import { retrievalRoutes } from './routes/retrieval.js';
import { signedUrlRoutes } from './routes/signed-urls.js';
import { mergeRoutes } from './routes/merge.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { conflictRoutes } from './routes/conflicts.js';
import { semanticRoutes } from './routes/semantic.js';
import { accessControlRoutes } from './routes/access-control.js';
import { organizationRoutes } from './routes/organizations.js';
import { wsRoutes } from './routes/ws.js';
import { wsCrdtRoutes } from './routes/ws-crdt.js';
import { startCrdtCompactionJob } from './jobs/crdt-compaction.js';
import { backfillEmbeddings } from './jobs/embeddings.js';
import { initCrdtPubSub } from './realtime/redis-pubsub.js';
import { webhookRoutes } from './routes/webhooks.js';
import { startWebhookWorker } from './events/webhooks.js';
import { startEventLogJobs } from './jobs/event-log-compaction.js';
import { startAuditCheckpointJob } from './jobs/audit-checkpoint.js';
import { crossDocRoutes } from './routes/cross-doc.js';
import { collectionRoutes } from './routes/collections.js';
import { publicDir, extractSlug, extractSlugWithExtension, handleContentNegotiation, getDocumentWithContent } from './routes/web.js';
import { v1Routes } from './routes/v1/index.js';
import { healthRoutes } from './routes/health.js';
import {
  apiVersionPlugin,
  addVersionResponseHeaders,
  addDeprecationHeaders,
  API_VERSION_REGISTRY,
  CURRENT_API_VERSION,
} from './middleware/api-version.js';
import { securityHeaders } from './middleware/security.js';
import { registerCsrf } from './middleware/csrf.js';
import { registerAuditLogging, auditLogRoutes } from './middleware/audit.js';
import {
  registerRateLimiting,
  anonSessionRateLimitHook,
  anonIdResponseHook,
} from './middleware/rate-limit.js';
import { runAnonSessionCleanup } from './jobs/anon-session-cleanup.js';
import { registerMetrics } from './middleware/metrics.js';
import { wellKnownAgentsRoutes } from './routes/well-known-agents.js';
import { startNonceCleanup } from './middleware/verify-agent-signature.js';
import { presenceRegistry } from './presence/registry.js';
import { presenceRoutes } from './routes/presence.js';
import { startLeaseExpiryJob } from './leases/expiry-job.js';
import { logger as pinoLogger } from './lib/logger.js';
import { registerObservabilityHooks } from './middleware/observability.js';
import { docsRoutes } from './routes/docs.js';
import { registerPostgresBackendPlugin } from './plugins/postgres-backend-plugin.js';
import { adminRoutes } from './routes/admin.js';
import { billingRoutes } from './routes/billing.js';
import { startUsageRollupJob } from './jobs/usage-rollup.js';
import { CONTENT_LIMITS } from './middleware/content-limits.js';
import { shutdownCoordinator } from './lib/shutdown.js';
import { validateSigningSecret } from './lib/signing-secret-validator.js';

// S-01: Fail-fast before the server accepts any connections when
// SIGNING_SECRET is missing or set to a well-known insecure default in
// production.  Signed URLs produced with a dev secret can be forged by
// anyone who reads the source code.  [T108.6 / T472]
try {
  validateSigningSecret(
    process.env.SIGNING_SECRET ?? '',
    process.env.NODE_ENV ?? '',
  );
} catch (err) {
  // eslint-disable-next-line no-console
  console.error((err as Error).message);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '3000', 10);
const API_HOSTS = new Set(['api.llmtxt.my']);

/**
 * Check if a hostname is the API subdomain.
 */
function isApiHost(hostname: string): boolean {
  const host = hostname.split(':')[0];
  return API_HOSTS.has(host);
}

// Use Fastify's serverFactory to intercept requests BEFORE routing.
// This rewrites URLs for api.llmtxt.my so that:
//   api.llmtxt.my/health          → /api/health          (legacy; gets deprecation headers)
//   api.llmtxt.my/v1/health       → /api/v1/health       (versioned; no deprecation)
//   api.llmtxt.my/v2/compress     → /api/v2/compress     (future versions, same pattern)
const app = Fastify({
  // Use the explicit Pino instance (with optional Loki transport + redaction).
  // Fastify v5 requires `loggerInstance` (not `logger`) for pre-built Pino
  // instances — `logger` only accepts a config object or `true` in v5.
  loggerInstance: pinoLogger,
  // I-01/I-02: Raise the body parser limit to match CONTENT_LIMITS.maxDocumentSize
  // so that oversized request bodies are rejected at the parser level (413) before
  // reaching any route handler. Without this, Fastify's default 1MB limit silently
  // truncates or rejects smaller bodies while allowing larger ones to slip through
  // when using streaming.  [T108.1]
  bodyLimit: CONTENT_LIMITS.maxDocumentSize,
  serverFactory: (handler) => {
    const server = http.createServer((req, res) => {
      const host = req.headers.host || '';
      if (isApiHost(host) && req.url) {
        // Only rewrite if the URL doesn't already start with /api
        if (!req.url.startsWith('/api')) {
          req.url = `/api${req.url}`;
        }
      }
      handler(req, res);
    });
    return server;
  },
});

async function main() {
  try {
    // ── PostgresBackend: SDK-first adapter layer (T353) ───────────────────────
    // Registers fastify.backendCore so route handlers can call
    // fastify.backendCore.* instead of querying Drizzle directly.
    // Wave A routes (api.ts, versions.ts, lifecycle.ts, disclosure.ts) are
    // refactored; remaining routes use legacy db directly until Wave B-D.
    await registerPostgresBackendPlugin(app);

    // Register API version plugin globally so request.apiVersion is always set
    await app.register(apiVersionPlugin);

    // Register CORS plugin
    const corsOrigin = process.env.CORS_ORIGIN || 'https://www.llmtxt.my';
    await app.register(cors, {
      origin: corsOrigin.split(',').map(o => o.trim()),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Cookie',
        'X-API-Version',
        // Agent Ed25519 signature headers (T221)
        'X-Agent-Pubkey-Id',
        'X-Agent-Signature',
        'X-Agent-Nonce',
        'X-Agent-Timestamp',
        // Idempotency key (T308)
        'Idempotency-Key',
      ],
      // Expose X-Server-Receipt so JS clients can read the HMAC proof (T308-a)
      exposedHeaders: [
        'X-Server-Receipt',
        'X-API-Version',
        'X-API-Latest-Version',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Deprecation',
        'Sunset',
        'Link',
      ],
      credentials: true,
    });

    // Register WebSocket plugin — MUST be registered before any WS routes.
    // @fastify/websocket needs to intercept upgrade requests before Fastify's
    // normal routing takes over.
    await app.register(websocket);

    // Register compression plugin
    await app.register(compress);

    // Register rate limiting (after CORS and compression, before routes)
    await registerRateLimiting(app);

    // ──────────────────────────────────────────────────────────────────
    // Anonymous session enforcement hooks (T167).
    // Dual-axis rate limiting: per-session-fingerprint (300 req/hour)
    // independent of the per-IP axis registered above.
    // X-Anonymous-Id response header (non-PII, epoch-salted fingerprint).
    // ──────────────────────────────────────────────────────────────────
    app.addHook('preHandler', anonSessionRateLimitHook);
    app.addHook('onSend', async (request, reply, payload) => {
      await anonIdResponseHook(request, reply);
      return payload;
    });

    // ──────────────────────────────────────────────────────────────────
    // Metrics hooks: per-request HTTP duration + counter recording.
    // Registered after rate limiting so rate-limit overhead is included
    // in the measured duration (more accurate latency tracking).
    // ──────────────────────────────────────────────────────────────────
    await registerMetrics(app);

    // ──────────────────────────────────────────────────────────────────
    // Observability hooks: inject OTel trace_id/span_id into per-request
    // Pino child loggers for Loki trace correlation (SPEC-T145 §6.3–6.5).
    // ──────────────────────────────────────────────────────────────────
    await registerObservabilityHooks(app);

    // ──────────────────────────────────────────────────────────────────
    // Security headers (CSP, HSTS, X-Content-Type-Options, etc.)
    // Registered early so all responses — including errors — get headers.
    // ──────────────────────────────────────────────────────────────────
    await securityHeaders(app);

    // ──────────────────────────────────────────────────────────────────
    // CSRF protection for cookie-authenticated state-changing requests.
    // Must come after @fastify/cookie but before route registration.
    // Bearer token requests are exempt (CSRF does not apply to them).
    // better-auth /api/auth/* routes are exempt (they manage CSRF internally).
    // ──────────────────────────────────────────────────────────────────
    await registerCsrf(app);

    // ──────────────────────────────────────────────────────────────────
    // Audit logging: fire-and-forget onResponse hook for mutating routes.
    // ──────────────────────────────────────────────────────────────────
    await registerAuditLogging(app);

    // ──────────────────────────────────────────────────────────────────
    // robots.txt: allow all crawlers
    // ──────────────────────────────────────────────────────────────────
    app.get('/robots.txt', async (request, reply) => {
      reply.type('text/plain');
      return 'User-agent: *\nDisallow:\n';
    });

    // ──────────────────────────────────────────────────────────────────
    // .well-known/llm.json: agent discovery document
    // ──────────────────────────────────────────────────────────────────
    app.get('/.well-known/llm.json', async (request, reply) => {
      reply.type('application/json');
      return {
        schema_version: '1.1',
        api_version: CURRENT_API_VERSION,
        name: 'llmtxt API',
        description: 'API for managing and serving llms.txt documents',
        base_url: `https://api.llmtxt.my/v${CURRENT_API_VERSION}`,
        deprecated_base_url: 'https://api.llmtxt.my',
        sunset_date: '2027-01-01',
        endpoints: [
          {
            path: '/health',
            method: 'GET',
            description: 'Health check endpoint'
          },
          {
            path: '/compress',
            method: 'POST',
            description: 'Compress and analyze text content'
          },
          {
            path: '/documents',
            method: 'GET',
            description: 'List all documents'
          },
          {
            path: '/documents',
            method: 'POST',
            description: 'Create a new document'
          },
          {
            path: '/documents/:slug',
            method: 'GET',
            description: 'Get document by slug'
          },
          {
            path: '/documents/:slug/raw',
            method: 'GET',
            description: 'Get raw document content'
          },
          {
            path: '/documents/:slug/stats',
            method: 'GET',
            description: 'Get document statistics'
          },
          {
            path: '/documents/:slug',
            method: 'PUT',
            description: 'Update document content (creates a new version)'
          },
          {
            path: '/documents/:slug/versions',
            method: 'GET',
            description: 'List all versions of a document'
          },
          {
            path: '/documents/:slug/versions/:num',
            method: 'GET',
            description: 'Get a specific version of a document'
          },
          {
            path: '/documents/:slug/diff?from=N&to=M',
            method: 'GET',
            description: 'Compute diff between two document versions'
          },
          {
            path: '/disclosure',
            method: 'POST',
            description: 'Submit AI disclosure information'
          },
          {
            path: '/documents/:slug/transition',
            method: 'POST',
            description: 'Transition document lifecycle state (DRAFT/REVIEW/LOCKED/ARCHIVED)'
          },
          {
            path: '/documents/:slug/approve',
            method: 'POST',
            description: 'Approve document (consensus voting)'
          },
          {
            path: '/documents/:slug/reject',
            method: 'POST',
            description: 'Reject document with reason'
          },
          {
            path: '/documents/:slug/approvals',
            method: 'GET',
            description: 'List all approval votes and consensus status'
          },
          {
            path: '/documents/:slug/contributors',
            method: 'GET',
            description: 'Get contributor attribution summary'
          },
          {
            path: '/documents/:slug/patch',
            method: 'POST',
            description: 'Submit unified diff patch to create new version'
          },
          {
            path: '/documents/:slug/similar?q=',
            method: 'GET',
            description: 'Find similar sections by text similarity'
          },
          {
            path: '/documents/:slug/graph',
            method: 'GET',
            description: 'Extract knowledge graph (mentions, tags, directives)'
          },
          {
            path: '/documents/:slug/plan-retrieval',
            method: 'POST',
            description: 'Plan token-budget-aware section retrieval'
          },
          {
            path: '/signed-urls',
            method: 'POST',
            description: 'Generate time-limited signed URL for document access'
          },
          {
            path: '/documents/:slug/merge',
            method: 'POST',
            description: 'Cherry-pick merge: assemble new version from line ranges and sections across multiple versions'
          },
          {
            path: '/documents/:slug/semantic-diff',
            method: 'POST',
            description: 'Semantic diff between two versions using embedding-based section similarity'
          },
          {
            path: '/documents/:slug/semantic-similarity?versions=1,2,3',
            method: 'GET',
            description: 'Pairwise cosine similarity matrix across multiple versions'
          },
          {
            path: '/documents/:slug/semantic-consensus',
            method: 'POST',
            description: 'Evaluate semantic consensus across approved reviews using embedding clustering'
          },
          {
            path: '/documents/:slug/events',
            method: 'GET',
            description: 'Server-Sent Events stream for real-time document notifications (SSE fallback)'
          },
          {
            path: '/webhooks',
            method: 'POST',
            description: 'Register a webhook for real-time event delivery to an external HTTPS endpoint'
          },
          {
            path: '/webhooks',
            method: 'GET',
            description: 'List registered webhooks'
          },
          {
            path: '/webhooks/:id',
            method: 'DELETE',
            description: 'Remove a registered webhook'
          },
          {
            path: '/webhooks/:id/test',
            method: 'POST',
            description: 'Send a synthetic test event to a registered webhook'
          },
          {
            path: '/auth/sign-up/email',
            method: 'POST',
            description: 'Register with email/password'
          },
          {
            path: '/auth/sign-in/email',
            method: 'POST',
            description: 'Login with email/password'
          },
          {
            path: '/auth/sign-in/anonymous',
            method: 'POST',
            description: 'Create anonymous session (24hr TTL)'
          },
          {
            path: '/keys',
            method: 'POST',
            description: 'Create a new API key (requires registered account; returns raw key once)',
            auth: 'cookie'
          },
          {
            path: '/keys',
            method: 'GET',
            description: 'List API keys for the authenticated user (key hashes never returned)',
            auth: 'cookie'
          },
          {
            path: '/keys/:id',
            method: 'DELETE',
            description: 'Revoke an API key by ID (soft delete)',
            auth: 'cookie'
          },
          {
            path: '/keys/:id/rotate',
            method: 'POST',
            description: 'Rotate an API key — revoke old key and issue a new one with same metadata',
            auth: 'cookie'
          }
        ],
        authentication: {
          methods: ['cookie', 'bearer'],
          bearer: {
            description: 'Pass API key as Authorization: Bearer llmtxt_<token>',
            key_format: 'llmtxt_ prefix followed by 43 base64url characters',
            obtain_at: '/api/keys'
          }
        },
        llms_txt: 'https://api.llmtxt.my/llms.txt',
        rate_limits: {
          unauthenticated: { requests_per_minute: 100, writes_per_minute: 20 },
          authenticated: { requests_per_minute: 300, writes_per_minute: 60 },
          api_key: { requests_per_minute: 600, writes_per_minute: 120 },
          docs: 'Rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset) are included in all API responses.',
        },
        realtime: {
          websocket: 'wss://api.llmtxt.my/ws/documents/{slug}',
          websocket_all: 'wss://api.llmtxt.my/ws/documents',
          sse: 'https://api.llmtxt.my/documents/{slug}/events',
          webhooks: 'https://api.llmtxt.my/webhooks',
        },
      };
    });

    // ──────────────────────────────────────────────────────────────────
    // Static files: serves public/ directory for www.llmtxt.my
    // Registered BEFORE dynamic routes so index.html, view.html work
    // ──────────────────────────────────────────────────────────────────
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
    });

    // ──────────────────────────────────────────────────────────────────
    // Health check routes: /api/health and /api/ready
    //
    // Registered early — before versioned routes and legacy routes — so
    // they are always reachable even if route registration fails later.
    // Both routes are exempt from auth and rate limiting (see health.ts).
    // ──────────────────────────────────────────────────────────────────
    await app.register(healthRoutes, { prefix: '/api' });

    // ──────────────────────────────────────────────────────────────────
    // API documentation: Swagger UI at /api/docs and spec at /api/openapi.json
    //
    // Reads the pre-generated openapi.json (forge-ts build output).
    // To regenerate: pnpm --filter backend run openapi:gen
    // ──────────────────────────────────────────────────────────────────
    await app.register(docsRoutes, { prefix: '/api' });

    // ──────────────────────────────────────────────────────────────────
    // Agent identity routes (T147): key management + well-known discovery
    // ──────────────────────────────────────────────────────────────────
    // NOTE: agentSignaturePlugin is registered INSIDE v1Routes (routes/v1/index.ts)
    // so that its onSend hook runs within the same Fastify scope as the route
    // handlers and can set X-Server-Receipt on actual responses. (T368 fix)
    // NOTE: agentKeyRoutes is registered inside v1Routes (see below), so no
    // standalone /api/v1 registration is needed — doing so causes
    // FST_ERR_DUPLICATED_ROUTE. T147 is a new feature (never shipped under
    // /api without a version prefix), so we deliberately do NOT alias it to
    // the legacy /api scope either.
    // Well-known public key discovery (mounted at root /.well-known/...)
    await app.register(wellKnownAgentsRoutes);
    // Start background nonce cleanup (once)
    startNonceCleanup();

    // ──────────────────────────────────────────────────────────────────
    // Versioned API routes: /api/v1/*
    //
    // This is the canonical, forward-looking location for all endpoints.
    // Agents and SDK users should migrate here.
    // On api.llmtxt.my the serverFactory already prepended /api, so:
    //   api.llmtxt.my/v1/health   → /api/v1/health   (served here)
    // ──────────────────────────────────────────────────────────────────
    await app.register(v1Routes, { prefix: '/api/v1' });

    // ──────────────────────────────────────────────────────────────────
    // Admin API: read-only observability endpoints (admin-only).
    // Registered at /api/v1/admin/* (under the v1 prefix for consistency).
    // ──────────────────────────────────────────────────────────────────
    await app.register(adminRoutes, { prefix: '/api/v1' });

    // ──────────────────────────────────────────────────────────────────
    // Billing routes: /api/me/usage, /api/me/subscription,
    //                 /api/billing/checkout, /api/billing/portal,
    //                 /api/billing/webhook, /api/v1/admin/subscriptions
    // ──────────────────────────────────────────────────────────────────
    await app.register(billingRoutes, { prefix: '/api' });

    // ──────────────────────────────────────────────────────────────────
    // Legacy API routes: /api/* (no version prefix)
    //
    // These continue to work identically for backwards compatibility.
    // All responses carry RFC 8594 Deprecation + Sunset headers and a
    // Link header pointing to the /api/v1/* successor URL.
    //
    // On api.llmtxt.my, the serverFactory rewrites / → /api/ before
    // Fastify route matching, so api.llmtxt.my/compress → /api/compress.
    // ──────────────────────────────────────────────────────────────────
    await app.register(async (legacyScope) => {
      const legacyVersionInfo = {
        ...API_VERSION_REGISTRY[CURRENT_API_VERSION],
        deprecated: true,
        sunset: '2027-01-01',
      };

      // Stamp requests with legacy version context
      legacyScope.addHook('onRequest', async (request, _reply) => {
        request.apiVersion = legacyVersionInfo;
      });

      // Attach deprecation + version headers to every legacy response
      legacyScope.addHook('onSend', async (request, reply) => {
        addVersionResponseHeaders(reply, legacyVersionInfo);
        addDeprecationHeaders(reply, request.url, legacyVersionInfo);
      });

      // Register the same route modules as v1 — no behaviour change
      await legacyScope.register(apiRoutes);
      await legacyScope.register(disclosureRoutes);
      await legacyScope.register(versionRoutes);
      await legacyScope.register(authRoutes);
      await legacyScope.register(lifecycleRoutes);
      await legacyScope.register(patchRoutes);
      await legacyScope.register(similarityRoutes);
      await legacyScope.register(graphRoutes);
      await legacyScope.register(retrievalRoutes);
      await legacyScope.register(signedUrlRoutes);
      await legacyScope.register(mergeRoutes);
      await legacyScope.register(apiKeyRoutes);
      await legacyScope.register(auditLogRoutes);
      await legacyScope.register(conflictRoutes);
      await legacyScope.register(accessControlRoutes);
      await legacyScope.register(organizationRoutes);
      await legacyScope.register(semanticRoutes);
      await legacyScope.register(crossDocRoutes);
      await legacyScope.register(collectionRoutes);
      // NOTE: documentEventRoutes is intentionally NOT registered in legacyScope.
      // T148 (document event log + SSE) is a post-v1 feature with no legacy consumers.
      // It is only available under /api/v1/documents/:slug/events* via v1Routes.
    }, { prefix: '/api' });

    // ──────────────────────────────────────────────────────────────────
    // Real-time routes
    // WS routes use /ws prefix (separate from /api — different protocol).
    // SSE and webhook routes live under /api like all other HTTP routes.
    // ──────────────────────────────────────────────────────────────────
    await app.register(wsRoutes, { prefix: '/ws' });
    // CRDT collaborative editing: /api/v1/documents/:slug/sections/:sid/collab
    await app.register(wsCrdtRoutes, { prefix: '/api/v1' });
    // sseRoutes removed: superseded by documentEventRoutes at
    // /api/v1/documents/:slug/events/stream (T148 — paginated query + SSE
    // stream + Last-Event-ID resume + hash chain + idempotency). No consumer
    // uses the legacy /api/documents/:slug/events path — verified by grep.
    await app.register(webhookRoutes, { prefix: '/api' });

    // Start the webhook delivery worker (attaches a single event-bus listener).
    startWebhookWorker();

    // Start event log background jobs (compaction + chain validation).
    startEventLogJobs();

    // T164: Start daily audit log Merkle checkpoint job.
    startAuditCheckpointJob();

    // T010: Start daily usage rollup job (aggregates usage_events into usage_rollups).
    startUsageRollupJob();

    // Initialize CRDT pub/sub adapter (Redis or in-process fallback).
    await initCrdtPubSub();

    // Start CRDT compaction background job (periodic GC of raw update rows).
    startCrdtCompactionJob();

    // T102/T103: Backfill section embeddings for existing documents (fire-and-forget).
    // Runs once on startup with a 5-second delay to avoid blocking the server boot.
    setTimeout(() => {
      backfillEmbeddings(50).catch(err => {
        app.log.warn({ err }, '[embeddings] startup backfill failed');
      });
    }, 5_000);

    // ── Presence registry expiry sweep (T258) ─────────────────────────────────
    // Sweep every 10 seconds; entries older than 30s are removed.
    const presenceExpiryTimer = setInterval(() => presenceRegistry.expire(), 10_000);
    // Ensure the timer does not prevent process exit
    presenceExpiryTimer.unref?.();

    // ── Lease TTL expiry job (T284) ────────────────────────────────────────────
    // Runs every 15 seconds; deletes expired section_leases rows and emits events.
    const leaseExpiryTimer = startLeaseExpiryJob();
    leaseExpiryTimer.unref?.();

    // ── Anonymous session cleanup job (T167) ──────────────────────────────────
    // Purge expired anonymous users + auto-archive stale anonymous docs (30d).
    const ANON_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
    const anonCleanupTimer = setInterval(async () => {
      try {
        const result = await runAnonSessionCleanup();
        if (result.purgedUsers > 0 || result.archivedDocs > 0) {
          app.log.info(result, '[anon-cleanup] purged expired anonymous sessions/docs');
        }
      } catch (err) {
        app.log.warn({ err }, '[anon-cleanup] cleanup job failed');
      }
    }, ANON_CLEANUP_INTERVAL_MS);
    anonCleanupTimer.unref?.();

    // Register error handler
    app.setErrorHandler((error: unknown, request, reply) => {
      app.log.error(error);

      const isDev = process.env.NODE_ENV === 'development';

      if (error instanceof Error && 'validation' in error && error.validation) {
        return reply.status(400).send({
          error: 'Validation failed',
          message: isDev ? error.message : 'Invalid request data',
        });
      }

      const err = error instanceof Error ? error : new Error(String(error));
      const statusCode = (err as { statusCode?: number }).statusCode;

      // Capture 5xx errors in Sentry (no-op when SENTRY_DSN is unset).
      if (!statusCode || statusCode >= 500) {
        Sentry.captureException(err, {
          tags: {
            route: request.routeOptions?.url ?? request.url,
            method: request.method,
          },
        });
      }

      return reply.status(statusCode || 500).send({
        error: err.name || 'Internal Server Error',
        message: isDev ? err.message : 'Something went wrong',
      });
    });

    // Register 404 handler - also handles slug redirects
    app.setNotFoundHandler(async (request, reply) => {
      // On API host, return JSON 404 with helpful docs pointer
      if (isApiHost(request.hostname)) {
        return reply.status(404).send({
          error: 'Not Found',
          message: `Route ${request.method} ${request.url} not found`,
          docs: 'https://api.llmtxt.my/llms.txt',
        });
      }

      // On web host, check if this looks like a document slug
      // e.g., GET /abc123 → redirect to /view.html?slug=abc123
      if (request.method === 'GET') {
        const slugWithExt = extractSlugWithExtension(request.url);
        if (slugWithExt) {
          const { slug, ext } = slugWithExt;
          const documentData = await getDocumentWithContent(slug, request);
          
          if (!documentData) {
            return reply.status(404).send({ error: 'Document not found' });
          }

          let contentType = 'text/plain';
          if (ext === 'json') contentType = 'application/json';
          else if (ext === 'md') contentType = 'text/markdown';
          
          if (documentData.tokenCount != null) {
            reply.header('X-Token-Count', documentData.tokenCount);
          }
          return reply.type(contentType).send(documentData.content);
        }

        const slug = extractSlug(request.url);
        if (slug) {
          // Check content negotiation
          const isContentNegotiated = await handleContentNegotiation(request, reply, slug);
          if (isContentNegotiated) return reply;

          // Perform Server-Side Rendering
          try {
            const documentData = await getDocumentWithContent(slug, request);
            
            if (documentData) {
              const { renderViewHtml } = await import('./routes/viewTemplate.js');
              // X-02: Pass per-request CSP nonce so the inline <script> tag carries it. [T108.5]
              const html = renderViewHtml(slug, documentData, reply.cspNonce);
              reply.header('Link', `< /api/documents/${slug}/raw >; rel="alternate"; type="text/plain"`);
              return reply.type('text/html').send(html);
            } else {
              return reply.status(404).type('text/html').send('<h1>404 Not Found</h1><p>Document not found.</p>');
            }
          } catch (err) {
            app.log.error(err);
          }

          // Fallback in case of SSR error
          return reply.redirect(`/view.html?slug=${encodeURIComponent(slug)}`);
        }
      }

      // Otherwise, 404
      return reply.status(404).send({
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`,
      });
    });

    // ── In-flight request tracking (T092 AC2) ─────────────────────────────────
    // Track active HTTP requests so drain() can wait for them to complete.
    app.addHook('onRequest', async () => {
      shutdownCoordinator.requestStarted();
    });
    app.addHook('onResponse', async () => {
      shutdownCoordinator.requestFinished();
    });
    // Also decrement on errors so the counter never gets stuck
    app.addHook('onError', async () => {
      shutdownCoordinator.requestFinished();
    });

    // Start server
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/* (or api.llmtxt.my/*)`);
    console.log(`Web: http://localhost:${PORT}/ (or www.llmtxt.my/)`);

    // ── SIGTERM handler for Railway rolling deploys (T092 AC1) ─────────────────
    // Railway sends SIGTERM before stopping a container. We:
    //   1. Flip isDraining so /api/ready returns 503 immediately.
    //   2. Run all drain hooks (WS close, SSE retry, webhook flush).
    //   3. Wait for in-flight requests to drain (30s grace window).
    //   4. Close the Fastify server and exit cleanly.
    process.once('SIGTERM', () => {
      void (async () => {
        console.log('[shutdown] SIGTERM received');
        try {
          await shutdownCoordinator.drain();
          await app.close();
        } catch (err) {
          console.error('[shutdown] error during graceful shutdown:', err);
        } finally {
          process.exit(0);
        }
      })();
    });

    // SIGINT for local dev (Ctrl+C) — same flow
    process.once('SIGINT', () => {
      void (async () => {
        console.log('[shutdown] SIGINT received');
        try {
          await shutdownCoordinator.drain();
          await app.close();
        } catch (err) {
          console.error('[shutdown] error during graceful shutdown:', err);
        } finally {
          process.exit(0);
        }
      })();
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
