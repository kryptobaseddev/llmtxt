/**
 * Core document API routes: POST /compress, GET /documents/:slug, POST /decompress,
 * POST /validate, GET /schemas, POST /search, GET /stats/cache, DELETE /cache.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z, type ZodIssue } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
// Schema type imports only — no direct Drizzle query use in refactored handlers.
// documents still used for access-stat updates (infrastructure concern).
import { documents } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { auth } from '../auth.js';
import {
  compress,
  decompress,
  generateId,
  hashContent,
  calculateCompressionRatio,
} from '../utils/compression.js';
import { countTokens } from '../utils/tokenizer.js';
import {
  compressRequestSchema,
  decompressRequestSchema,
  isPredefinedSchema,
  predefinedSchemas,
} from '../schemas/validation.js';
import {
  validateContent,
  detectFormat,
} from '../utils/validator.js';
import {
  setCachedContent,
  setCachedMetadata,
  invalidateDocumentCache,
  getCacheStats,
  shouldSkipCache,
  getDocumentCacheKey,
  contentCache,
  metadataCache,
} from '../middleware/cache.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import { enforceContentSize, enforceDocumentLimit } from '../middleware/content-limits.js';
import { eventBus } from '../events/bus.js';
import { canRead } from '../middleware/rbac.js';
import { documentCreatedTotal, versionCreatedTotal } from '../middleware/metrics.js';
import { appendDocumentEvent } from '../lib/document-events.js';
import { computeAndStoreEmbeddings } from '../jobs/embeddings.js';

// Legacy validation schemas (kept for backward compatibility)
const slugParamsSchema = z.object({
  slug: z.string().min(1).max(20),
});

type SlugParams = z.infer<typeof slugParamsSchema>;

/**
 * Format validation errors for API response
 */
function formatValidationErrors(errors: Array<{ path: string; message: string; code: string }>) {
  return {
    error: 'Validation failed',
    details: errors.map((e) => ({
      field: e.path || 'content',
      message: e.message,
      code: e.code,
    })),
  };
}

/** Try to get the authenticated user from session cookies. Returns null if no session. */
async function getOptionalUser(request: FastifyRequest) {
  // Fast path: if the auth middleware (requireAuth / tryAuth) already ran and
  // populated request.user, use it. This is the case for API-key Bearer tokens
  // when the route has requireAuth as a preHandler.
  if (request.user?.id) {
    return request.user as { id: string; email?: string; name?: string; isAnonymous?: boolean };
  }

  // Compress and other optional-auth routes don't run requireAuth, so request.user
  // may not be set even when a valid Bearer API key is in the Authorization header.
  // Try to resolve the API key directly so compress documents get proper ownership.
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const { tryAuthenticateApiKey } = await import('../middleware/auth.js');
    if (tryAuthenticateApiKey) {
      // tryAuthenticateApiKey populates request.user if the token is valid
      await tryAuthenticateApiKey(request);
      if (request.user?.id) {
        return request.user as { id: string; email?: string; name?: string; isAnonymous?: boolean };
      }
    }
  }

  // Fall back to session-based auth (cookie / better-auth)
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value) headers.append(key, String(value));
    }
    const session = await auth.api.getSession({ headers });
    return session?.user ?? null;
  } catch {
    return null;
  }
}

/** Register core document API routes: compress, decompress, validate, search, schemas, and cache management. */
export async function apiRoutes(fastify: FastifyInstance) {
  // Serve llms.txt at API root for agent auto-discovery
  fastify.get('/llms.txt', async (_request, reply) => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const llmsTxtPath = path.join(__dirname, '..', '..', 'public', 'llms.txt');
    const content = fs.readFileSync(llmsTxtPath, 'utf-8');
    return reply.type('text/plain').send(content);
  });

  // Health check endpoints moved to routes/health.ts (T210):
  // - GET /api/health (liveness, no I/O)
  // - GET /api/ready (readiness, pings DB)

  /** GET /api/documents/mine - List documents owned by the authenticated user. */
  fastify.get('/documents/mine', async (request, reply) => {
    const user = await getOptionalUser(request);
    if (!user) {
      return reply.status(401).send({ error: 'Authentication required' });
    }

    // Wave A: delegate to backendCore.listDocuments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (await (request.server.backendCore.listDocuments as any)({ ownerId: user.id })) as { items: unknown[] };
    const docs = result.items;

    return { documents: docs, total: docs.length };
  });

  /**
   * POST /api/compress - Compress and store document with format validation
   * 
   * Request body:
   * {
   *   content: string (required) - Content to compress
   *   format?: 'json' | 'text' - Explicit format (auto-detected if not provided)
   *   schema?: string - Schema to validate JSON against (e.g., 'prompt-v1')
   * }
   * 
   * Response (201):
   * {
   *   id: string,
   *   slug: string,
   *   url: string,
   *   format: 'json' | 'text',
   *   tokenCount: number,
   *   compressionRatio: number,
   *   originalSize: number,
   *   compressedSize: number,
   *   schema?: string
   * }
   * 
   * Error (400):
   * {
   *   error: 'Validation failed',
   *   details: [...]
   * }
   */
  fastify.post<{ Body: { content: string; format?: 'json' | 'text' | 'markdown'; schema?: string; createdBy?: string; agentId?: string } }>(
    '/compress',
    {
      config: writeRateLimit,
      preHandler: [enforceContentSize, enforceDocumentLimit],
    },
    async (request, reply) => {
    try {
      // Step 1: Validate request body structure
      const bodyResult = compressRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues.map((e: ZodIssue) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { content, format, schema } = bodyResult.data;

      // Read agentId / createdBy alias from the raw body (not in the shared schema).
      const rawBody = request.body as Record<string, unknown>;
      const bodyCreatedBy = typeof rawBody.createdBy === 'string' ? rawBody.createdBy : null;
      const bodyAgentId = typeof rawBody.agentId === 'string' ? rawBody.agentId : null;
      // bft_f: per-document BFT fault-tolerance config (T369 fix).
      // Pass through to createDocument so demo documents can be seeded with bft_f=0.
      const bodyBftF = typeof rawBody.bft_f === 'number' ? rawBody.bft_f : undefined;

      // Step 2: Validate schema parameter if provided
      if (schema && !isPredefinedSchema(schema)) {
        return reply.status(400).send({
          error: 'Invalid schema parameter',
          details: [{
            field: 'schema',
            message: `Unknown schema '${schema}'. Available: ${Object.keys(predefinedSchemas).join(', ')}`,
            code: 'unknown_schema',
          }],
        });
      }

      // Step 3: Determine format (explicit or auto-detect)
      const contentFormat = format || detectFormat(content);

      // Step 4: Validate content based on format
      const validationResult = validateContent(content, contentFormat, schema);

      if (!validationResult.success) {
        return reply.status(400).send(formatValidationErrors(validationResult.errors || []));
      }

      // Step 5: Generate IDs and compress
      const id = generateId();
      const slug = generateId();

      const compressedData = await compress(content);
      const originalSize = Buffer.byteLength(content, 'utf-8');
      const compressedSize = compressedData.length;

      // Calculate metadata
      const contentHash = hashContent(content);
      const tokenCount = countTokens(content);
      const compressionRatio = calculateCompressionRatio(originalSize, compressedSize);

      // Get optional user from session for ownership
      const user = await getOptionalUser(request);

      // Resolve effective author: body-supplied createdBy wins, then agentId alias,
      // then session user ID.
      const effectiveCreatedBy = bodyCreatedBy || bodyAgentId || user?.id || null;

      // Delegate document creation + version 1 + contributor + role to PostgresBackend.
      // All content-derived fields are pre-computed above.
      const now = Date.now();
      await request.server.backendCore.createDocument({
        // Type-cast: CreateDocumentParams extended for compress flow.
        title: slug,
        createdBy: effectiveCreatedBy ?? '',
        // Extended fields consumed by PostgresBackend.createDocument:
        id,
        slug,
        format: contentFormat,
        contentHash,
        compressedData,
        originalSize,
        compressedSize,
        tokenCount,
        ownerId: user?.id ?? null,
        isAnonymous: user ? ((user as Record<string, unknown>).isAnonymous === true) : false,
        // bftF: optional; undefined lets schema default (1) apply
        ...(bodyBftF !== undefined ? { bftF: bodyBftF } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // Increment document created counter (visibility defaults to 'public')
      documentCreatedTotal.inc({ visibility: 'public' });

      // Increment version created counter (source: 'compress' for initial version in compress endpoint)
      versionCreatedTotal.inc({ source: 'compress' });

      // Build URL - use /documents/:slug for API host, /api/documents/:slug otherwise
      const host = request.hostname.split(':')[0];
      const isApiHost = host === 'api.llmtxt.my';
      const baseUrl = `${request.protocol}://${request.hostname}`;
      const url = isApiHost
        ? `${baseUrl}/documents/${slug}`
        : `${baseUrl}/api/documents/${slug}`;

      // Build response with format metadata
      const response: Record<string, unknown> = {
        id,
        slug,
        url,
        format: contentFormat,
        tokenCount,
        compressionRatio,
        originalSize,
        compressedSize,
      };

      // Include schema info if used
      if (schema) {
        response.schema = schema;
        response.validated = true;
      }

      // Append document.created event to the event log.
      // Fire-and-forget: event log failure must not fail the compress response.
      try {
        const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'] ?? null;
        await appendDocumentEvent(db, {
          documentId: slug,
          eventType: 'document.created',
          actorId: effectiveCreatedBy || 'anonymous',
          payloadJson: { tokenCount, format: contentFormat, id },
          idempotencyKey,
        });
      } catch (evtErr) {
        fastify.log.warn({ err: evtErr }, 'appendDocumentEvent failed on compress');
      }

      // Emit document.created AFTER the successful DB write — non-blocking.
      eventBus.emitDocumentCreated(slug, id, effectiveCreatedBy || 'anonymous', {
        tokenCount,
        format: contentFormat,
      });

      // Fire-and-forget: compute and store section embeddings asynchronously.
      // Embedding failures must never fail the compress response.
      computeAndStoreEmbeddings(id, content).catch(embErr => {
        fastify.log.warn({ err: embErr }, '[embeddings] computeAndStoreEmbeddings failed on document create');
      });

      return reply.status(201).send(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.issues.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
            code: e.code,
          })),
        });
      }

      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/validate - Validate content without compressing
   * Useful for checking format/schema before storage
   * 
   * Request body:
   * {
   *   content: string (required)
   *   format?: 'json' | 'text'
   *   schema?: string
   * }
   * 
   * Response (200):
   * {
   *   valid: true,
   *   format: 'json' | 'text',
   *   schema?: string,
   *   data?: any
   * }
   * 
   * Response (400):
   * {
   *   valid: false,
   *   format: 'json' | 'text',
   *   errors: [...]
   * }
   */
  fastify.post('/validate', async (
    request: FastifyRequest<{ Body: { content: string; format?: 'json' | 'text' | 'markdown'; schema?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { content, format, schema } = request.body;

      // Validate schema if provided
      if (schema && !isPredefinedSchema(schema)) {
        return reply.status(400).send({
          valid: false,
          error: 'Invalid schema',
          availableSchemas: Object.keys(predefinedSchemas),
        });
      }

      // Determine format
      const contentFormat = format || detectFormat(content);

      // Validate content
      const result = validateContent(content, contentFormat, schema);

      if (!result.success) {
        return reply.status(400).send({
          valid: false,
          format: contentFormat,
          errors: result.errors,
        });
      }

      return reply.status(200).send({
        valid: true,
        format: contentFormat,
        schema: schema || null,
        data: result.data,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * GET /api/schemas - List available predefined schemas
   * 
   * Response:
   * {
   *   schemas: [
   *     { name: 'prompt-v1', description: '...' }
   *   ]
   * }
   */
  fastify.get('/schemas', async () => ({
    schemas: Object.keys(predefinedSchemas).map((name) => ({
      name,
      description: getSchemaDescription(name),
    })),
  }));

  /**
   * GET /api/schemas/:name - Get schema details
   * 
   * Response:
   * {
   *   name: string,
   *   description: string,
   *   structure: { ... }
   * }
   */
  fastify.get('/schemas/:name', async (
    request: FastifyRequest<{ Params: { name: string } }>,
    reply: FastifyReply
  ) => {
    const { name } = request.params;

    if (!isPredefinedSchema(name)) {
      return reply.status(404).send({
        error: `Schema '${name}' not found`,
        available: Object.keys(predefinedSchemas),
      });
    }

    return reply.status(200).send({
      name,
      description: getSchemaDescription(name),
      // Schema structure available in validation.ts
    });
  });

  /**
   * GET /api/documents/:slug - Get document metadata
   */
  fastify.get<{ Params: SlugParams }>('/documents/:slug', { preHandler: [canRead] }, async (
    request,
    reply
  ) => {
    try {
      // Validate params
      const { slug } = slugParamsSchema.parse(request.params);

      // Check cache first (skip if nocache=1)
      if (shouldSkipCache(request)) {
        reply.header('X-Cache', 'SKIP');
      } else {
        const cacheKey = getDocumentCacheKey(slug, 'metadata');
        const cached = metadataCache.get(cacheKey);
        if (cached) {
          reply.header('X-Cache', 'HIT');
          return reply.send(cached);
        }
        reply.header('X-Cache', 'MISS');
      }

      // Wave A: delegate to backendCore.getDocumentBySlug
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const document = (await request.server.backendCore.getDocumentBySlug(slug)) as any;

      if (!document) {
        return reply.status(404).send({
          error: 'Document not found',
        });
      }

      // Calculate compression ratio
      const compressionRatio = calculateCompressionRatio(
        document.originalSize,
        document.compressedSize
      );

      const response = {
        id: document.id,
        slug: document.slug,
        format: document.format,
        contentHash: document.contentHash,
        originalSize: document.originalSize,
        compressedSize: document.compressedSize,
        tokenCount: document.tokenCount,
        createdAt: document.createdAt,
        expiresAt: document.expiresAt,
        accessCount: document.accessCount,
        lastAccessedAt: document.lastAccessedAt,
        state: document.state,
        currentVersion: document.currentVersion,
        ownerId: document.ownerId,
        compressionRatio,
      };

      // Cache the response
      setCachedMetadata(slug, response);

      return reply.send(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.issues,
        });
      }

      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });

  /**
   * POST /api/decompress - Decompress and retrieve document
   * 
   * Request body:
   * {
   *   slug: string - Document slug
   * }
   * 
   * Response:
   * {
   *   id: string,
   *   slug: string,
   *   format: 'json' | 'text',
   *   content: string,
   *   tokenCount: number,
   *   originalSize: number,
   *   compressedSize: number,
   *   createdAt: number,
   *   accessCount: number
   * }
   */
  fastify.post('/decompress', async (
    request: FastifyRequest<{ Body: { slug: string } }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate request body
      const bodyResult = decompressRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues.map((e: ZodIssue) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { slug } = bodyResult.data;

      // Check cache first (skip if nocache query param is set)
      const skipCache = shouldSkipCache(request);

      if (!skipCache) {
        const cacheKey = getDocumentCacheKey(slug, 'content');
        const cachedContent = contentCache.get(cacheKey);

        if (cachedContent) {
          // Wave A: delegate document lookup to backendCore
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const document = (await request.server.backendCore.getDocumentBySlug(slug)) as any;

          if (!document) {
            // Cache hit but document not in DB (inconsistency), delete cache entry
            contentCache.delete(cacheKey);
            return reply.status(404).send({
              error: 'Document not found',
            });
          }

          // Update access stats (direct db call — access tracking is an infrastructure concern)
          await db
            .update(documents)
            .set({
              accessCount: (document.accessCount || 0) + 1,
              lastAccessedAt: Date.now(),
            })
            .where(eq(documents.id, document.id));

          reply.header('X-Cache', 'HIT');
          return reply.send({
            id: document.id,
            slug: document.slug,
            format: document.format,
            content: cachedContent,
            tokenCount: document.tokenCount,
            originalSize: document.originalSize,
            compressedSize: document.compressedSize,
            createdAt: document.createdAt,
            accessCount: (document.accessCount || 0) + 1,
          });
        }
      }

      reply.header('X-Cache', skipCache ? 'SKIP' : 'MISS');

      // Wave A: delegate document lookup to backendCore
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const document = (await request.server.backendCore.getDocumentBySlug(slug)) as any;

      if (!document) {
        return reply.status(404).send({
          error: 'Document not found',
        });
      }

      // Update access stats (direct db call — access tracking is an infrastructure concern)
      await db
        .update(documents)
        .set({
          accessCount: (document.accessCount || 0) + 1,
          lastAccessedAt: Date.now(),
        })
        .where(eq(documents.id, document.id));

      // Decompress content
      const compressedBuffer = document.compressedData instanceof Buffer
        ? document.compressedData
        : Buffer.from(document.compressedData as ArrayBuffer);
      const content = await decompress(compressedBuffer);

      // Cache the decompressed content
      setCachedContent(slug, content);

      return reply.send({
        id: document.id,
        slug: document.slug,
        format: document.format,
        content,
        tokenCount: document.tokenCount,
        originalSize: document.originalSize,
        compressedSize: document.compressedSize,
        createdAt: document.createdAt,
        accessCount: (document.accessCount || 0) + 1,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.issues,
        });
      }

      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
  });

  // POST /api/search is now handled by crossDocRoutes (cross-doc.ts) which provides
  // an enhanced version supporting collections, RBAC-filtered scope, and section-level
  // relevance scoring. The old legacy handler has been removed to prevent duplicate routes.

  /**
   * GET /api/stats/cache - Get cache statistics
   * 
   * Response:
   * {
   *   content: {
   *     hits: number,
   *     misses: number,
   *     size: number,
   *     maxSize: number,
   *     hitRate: number
   *   },
   *   metadata: {
   *     hits: number,
   *     misses: number,
   *     size: number,
   *     maxSize: number,
   *     hitRate: number
   *   }
   * }
   */
  fastify.get('/stats/cache', async () => {
    return getCacheStats();
  });

  /**
   * DELETE /api/cache - Clear all cache
   */
  fastify.delete('/cache', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    contentCache.clear();
    metadataCache.clear();
    return reply.send({ message: 'Cache cleared' });
  });
}

/**
 * Get human-readable description for a schema
 */
function getSchemaDescription(name: string): string {
  const descriptions: Record<string, string> = {
    'prompt-v1': 'Standard LLM prompt format with messages array (OpenAI/Anthropic style)',
  };
  return descriptions[name] || 'No description available';
}
