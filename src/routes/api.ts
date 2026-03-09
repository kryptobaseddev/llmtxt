// API routes for document management with dual format validation
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  compress,
  decompress,
  generateId,
  hashContent,
  calculateTokens,
  calculateCompressionRatio,
} from '../utils/compression.js';
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

/**
 * Check if request is coming from API subdomain
 */
function isApiSubdomain(request: FastifyRequest): boolean {
  return request.hostname === 'api.llmtxt.my';
}

export async function apiRoutes(fastify: FastifyInstance) {
  // Health check endpoint - works on both domains
  fastify.get('/health', async (request) => {
    const baseUrl = isApiSubdomain(request) ? 'https://api.llmtxt.my' : `${request.protocol}://${request.hostname}/api`;
    return {
      status: 'ok',
      timestamp: Date.now(),
      uptime: process.uptime(),
      version: '1.0.0',
      baseUrl,
    };
  });

  /**
   * POST /compress - Compress and store document with format validation
   */
  fastify.post('/compress', async (
    request: FastifyRequest<{ Body: { content: string; format?: 'json' | 'text'; schema?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      // Step 1: Validate request body structure
      const bodyResult = compressRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { content, format, schema } = bodyResult.data;

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
      const tokenCount = calculateTokens(content);
      const compressionRatio = calculateCompressionRatio(originalSize, compressedSize);

      // Save to database with format field
      const now = Date.now();
      await db.insert(documents).values({
        id,
        slug,
        format: contentFormat,
        contentHash,
        compressedData,
        originalSize,
        compressedSize,
        tokenCount,
        createdAt: now,
        accessCount: 0,
      });

      // Build URLs based on hostname
      const isApi = isApiSubdomain(request);
      const webUrl = isApi ? `https://www.llmtxt.my/${slug}` : `${request.protocol}://${request.hostname}/${slug}`;
      const apiUrl = isApi ? `https://api.llmtxt.my/documents/${slug}` : `${request.protocol}://${request.hostname}/api/documents/${slug}`;

      // Build response with format metadata
      const response: Record<string, unknown> = {
        id,
        slug,
        url: webUrl,
        apiUrl,
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

      return reply.status(201).send(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
            code: e.code,
          })),
        });
      }

      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to compress document',
      });
    }
  });

  /**
   * POST /decompress - Decompress and retrieve document by slug
   */
  fastify.post('/decompress', async (
    request: FastifyRequest<{ Body: { slug?: string; url?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const bodyResult = decompressRequestSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { slug: requestSlug, url } = bodyResult.data;
      
      let slug = requestSlug;
      
      // Extract slug from URL if provided
      if (url) {
        const urlMatch = url.match(/\/([a-zA-Z0-9]+)(?:\?|$)/);
        if (urlMatch) {
          slug = urlMatch[1];
        }
      }

      if (!slug) {
        return reply.status(400).send({
          error: 'Missing slug',
          message: 'Either slug or url must be provided',
        });
      }

      // Check cache first
      const cacheKey = getDocumentCacheKey('content', slug);
      if (!shouldSkipCache(request)) {
        const cached = contentCache.get(cacheKey);
        if (cached) {
          reply.header('X-Cache', 'HIT');
          return reply.send(cached);
        }
      }

      reply.header('X-Cache', 'MISS');

      // Fetch from database
      const doc = await db.query.documents.findFirst({
        where: eq(documents.slug, slug),
      });

      if (!doc) {
        return reply.status(404).send({
          error: 'Document not found',
          message: `No document found with slug: ${slug}`,
        });
      }

      // Decompress content
      const content = await decompress(doc.compressedData);

      // Update access count
      await db.update(documents)
        .set({ 
          accessCount: (doc.accessCount || 0) + 1,
          lastAccessedAt: Date.now(),
        })
        .where(eq(documents.slug, slug));

      const response = {
        slug: doc.slug,
        content,
        format: doc.format,
        tokenCount: doc.tokenCount,
        createdAt: doc.createdAt,
      };

      // Cache the response
      setCachedContent(slug, response);

      return reply.send(response);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to decompress document',
      });
    }
  });

  /**
   * GET /documents/:slug - Get document metadata
   */
  fastify.get('/documents/:slug', async (
    request: FastifyRequest<{ Params: SlugParams }>,
    reply: FastifyReply
  ) => {
    try {
      const { slug } = request.params;

      // Validate slug format
      const slugResult = slugParamsSchema.safeParse({ slug });
      if (!slugResult.success) {
        return reply.status(400).send({
          error: 'Invalid slug',
          message: 'Slug must be 1-20 alphanumeric characters',
        });
      }

      // Check cache first
      const cacheKey = getDocumentCacheKey('metadata', slug);
      if (!shouldSkipCache(request)) {
        const cached = metadataCache.get(cacheKey);
        if (cached) {
          reply.header('X-Cache', 'HIT');
          return reply.send(cached);
        }
      }

      reply.header('X-Cache', 'MISS');

      // Fetch from database (exclude compressed data)
      const doc = await db.query.documents.findFirst({
        where: eq(documents.slug, slug),
      });

      if (!doc) {
        return reply.status(404).send({
          error: 'Document not found',
          message: `No document found with slug: ${slug}`,
        });
      }

      const response = {
        id: doc.id,
        slug: doc.slug,
        format: doc.format,
        contentHash: doc.contentHash,
        tokenCount: doc.tokenCount,
        compressionRatio: calculateCompressionRatio(doc.originalSize, doc.compressedSize),
        originalSize: doc.originalSize,
        compressedSize: doc.compressedSize,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
        accessCount: doc.accessCount,
      };

      // Cache the response
      setCachedMetadata(slug, response);

      return reply.send(response);
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
        message: 'Failed to fetch document metadata',
      });
    }
  });

  /**
   * GET /schemas - List available predefined schemas
   */
  fastify.get('/schemas', async () => {
    return {
      schemas: [
        {
          name: 'prompt-v1',
          description: 'Standard LLM prompt format with messages array (OpenAI/Anthropic style)',
        },
      ],
    };
  });

  /**
   * GET /stats/cache - Get cache statistics
   */
  fastify.get('/stats/cache', async () => {
    return getCacheStats();
  });

  /**
   * DELETE /cache - Clear cache (admin endpoint)
   */
  fastify.delete('/cache', async (request, reply) => {
    invalidateDocumentCache();
    return reply.send({ message: 'Cache cleared' });
  });
}
