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

export async function apiRoutes(fastify: FastifyInstance) {
  // Health check endpoint
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    version: '1.0.0',
  }));

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

      // Build URL
      const baseUrl = `${request.protocol}://${request.hostname}`;
      const url = `${baseUrl}/api/documents/${slug}`;

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
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { slug } = bodyResult.data;

      // Look up document by slug
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!document) {
        return reply.status(404).send({
          error: 'Document not found',
        });
      }

      // Update access stats
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
          details: error.errors,
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
    request: FastifyRequest<{ Body: { content: string; format?: 'json' | 'text'; schema?: string } }>,
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
  fastify.get('/documents/:slug', async (
    request: FastifyRequest<{ Params: SlugParams }>,
    reply: FastifyReply
  ) => {
    try {
      // Validate params
      const { slug } = slugParamsSchema.parse(request.params);

      // Look up document
      const [document] = await db
        .select({
          id: documents.id,
          slug: documents.slug,
          format: documents.format,
          contentHash: documents.contentHash,
          originalSize: documents.originalSize,
          compressedSize: documents.compressedSize,
          tokenCount: documents.tokenCount,
          createdAt: documents.createdAt,
          expiresAt: documents.expiresAt,
          accessCount: documents.accessCount,
          lastAccessedAt: documents.lastAccessedAt,
        })
        .from(documents)
        .where(eq(documents.slug, slug));

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

      return reply.send({
        ...document,
        compressionRatio,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: error.errors,
        });
      }

      fastify.log.error(error);
      return reply.status(500).send({
        error: 'Internal server error',
      });
    }
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
