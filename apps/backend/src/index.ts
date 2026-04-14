// Main entry point
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
import { sseRoutes } from './routes/sse.js';
import { webhookRoutes } from './routes/webhooks.js';
import { startWebhookWorker } from './events/webhooks.js';
import { crossDocRoutes } from './routes/cross-doc.js';
import { collectionRoutes } from './routes/collections.js';
import { publicDir, extractSlug, extractSlugWithExtension, handleContentNegotiation, getDocumentWithContent } from './routes/web.js';
import { v1Routes } from './routes/v1/index.js';
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
import { registerRateLimiting } from './middleware/rate-limit.js';

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
  logger: true,
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
    // Register API version plugin globally so request.apiVersion is always set
    await app.register(apiVersionPlugin);

    // Register CORS plugin
    const corsOrigin = process.env.CORS_ORIGIN || 'https://www.llmtxt.my';
    await app.register(cors, {
      origin: corsOrigin.split(',').map(o => o.trim()),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-API-Version'],
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
    // Versioned API routes: /api/v1/*
    //
    // This is the canonical, forward-looking location for all endpoints.
    // Agents and SDK users should migrate here.
    // On api.llmtxt.my the serverFactory already prepended /api, so:
    //   api.llmtxt.my/v1/health   → /api/v1/health   (served here)
    // ──────────────────────────────────────────────────────────────────
    await app.register(v1Routes, { prefix: '/api/v1' });

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
    }, { prefix: '/api' });

    // ──────────────────────────────────────────────────────────────────
    // Real-time routes
    // WS routes use /ws prefix (separate from /api — different protocol).
    // SSE and webhook routes live under /api like all other HTTP routes.
    // ──────────────────────────────────────────────────────────────────
    await app.register(wsRoutes, { prefix: '/ws' });
    await app.register(sseRoutes, { prefix: '/api' });
    await app.register(webhookRoutes, { prefix: '/api' });

    // Start the webhook delivery worker (attaches a single event-bus listener).
    startWebhookWorker();

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
              const html = renderViewHtml(slug, documentData);
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

    // Start server
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/* (or api.llmtxt.my/*)`);
    console.log(`Web: http://localhost:${PORT}/ (or www.llmtxt.my/)`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
