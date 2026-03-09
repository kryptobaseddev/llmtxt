// Main entry point
import Fastify from 'fastify';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import http from 'http';
import { apiRoutes } from './routes/api.js';
import { disclosureRoutes } from './routes/disclosure.js';
import { publicDir, extractSlug, extractSlugWithExtension, handleContentNegotiation, getDocumentWithContent } from './routes/web.js';

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
// This rewrites URLs for api.llmtxt.my so /health → /api/health.
const app = Fastify({
  logger: true,
  serverFactory: (handler) => {
    const server = http.createServer((req, res) => {
      // Rewrite URL for API subdomain before Fastify routes the request
      const host = req.headers.host || '';
      if (isApiHost(host) && req.url && !req.url.startsWith('/api')) {
        req.url = `/api${req.url}`;
      }
      handler(req, res);
    });
    return server;
  },
});

async function main() {
  try {
    // Register CORS plugin
    await app.register(cors, {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    // Register compression plugin
    await app.register(compress);

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
        schema_version: '1.0',
        name: 'llmtxt API',
        description: 'API for managing and serving llms.txt documents',
        base_url: 'https://api.llmtxt.my',
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
            path: '/disclosure',
            method: 'POST',
            description: 'Submit AI disclosure information'
          }
        ],
        llms_txt: 'https://api.llmtxt.my/llms.txt'
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
    // API routes: always at /api prefix
    // On api.llmtxt.my, the serverFactory rewrites / → /api/ before
    // Fastify route matching, so api.llmtxt.my/compress hits /api/compress
    // ──────────────────────────────────────────────────────────────────
    await app.register(apiRoutes, { prefix: '/api' });
    await app.register(disclosureRoutes, { prefix: '/api' });

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
