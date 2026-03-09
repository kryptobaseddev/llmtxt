/**
 * Progressive Disclosure API routes.
 * Allows agents to query only the portions of a document they need.
 *
 * All endpoints under: /api/documents/:slug/...
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decompress } from '../utils/compression.js';
import { calculateTokens } from '../utils/compression.js';
import {
  generateOverview,
  getLineRange,
  searchContent,
  queryJsonPath,
  getSection,
} from '../utils/disclosure.js';
import {
  contentCache,
  getDocumentCacheKey,
  setCachedContent,
  shouldSkipCache,
} from '../middleware/cache.js';

// ──────────────────────────────────────────────────────────────────
// Shared helper: resolve a slug to decompressed content
// ──────────────────────────────────────────────────────────────────

async function resolveDocument(
  slug: string,
  skipCache: boolean,
): Promise<{ content: string; format: string; totalTokens: number; originalSize: number; compressedSize: number } | null> {
  // Try cache first
  if (!skipCache) {
    const cacheKey = getDocumentCacheKey(slug, 'content');
    const cached = contentCache.get(cacheKey);
    if (cached) {
      return {
        content: cached as string,
        format: 'unknown', // We'd need metadata from DB
        totalTokens: calculateTokens(cached as string),
        originalSize: 0, // Not available from cache
        compressedSize: 0, // Not available from cache
      };
    }
  }

  // Fetch from DB
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.slug, slug));

  if (!doc) return null;

  // Decompress
  const compressedBuffer = doc.compressedData instanceof Buffer
    ? doc.compressedData
    : Buffer.from(doc.compressedData as ArrayBuffer);
  const content = await decompress(compressedBuffer);

  // Cache for subsequent queries
  setCachedContent(slug, content);

  // Update access count
  await db
    .update(documents)
    .set({
      accessCount: (doc.accessCount || 0) + 1,
      lastAccessedAt: Date.now(),
    })
    .where(eq(documents.id, doc.id));

  return {
    content,
    format: doc.format || 'text',
    totalTokens: doc.tokenCount || calculateTokens(content),
    originalSize: doc.originalSize,
    compressedSize: doc.compressedSize,
  };
}

// ──────────────────────────────────────────────────────────────────
// Param / query schemas
// ──────────────────────────────────────────────────────────────────

const slugSchema = z.object({
  slug: z.string().min(1).max(20),
});

const lineRangeQuery = z.object({
  start: z.coerce.number().int().min(1).default(1),
  end: z.coerce.number().int().min(1).default(50),
});

const searchQuery = z.object({
  q: z.string().min(1).max(500),
  context: z.coerce.number().int().min(0).max(10).default(2),
  max: z.coerce.number().int().min(1).max(100).default(20),
});

const jsonPathQuery = z.object({
  path: z.string().min(1).max(500),
});

const sectionQuery = z.object({
  name: z.string().min(1).max(200),
});

const batchQuerySchema = z.object({
  sections: z.array(z.string()).optional(),
  paths: z.array(z.string()).optional(),
});

// ──────────────────────────────────────────────────────────────────
// Route registration
// ──────────────────────────────────────────────────────────────────

export async function disclosureRoutes(fastify: FastifyInstance) {

  /**
   * GET /api/documents/:slug/overview
   * Returns document structure without full content.
   * Agents use this to understand what's in the document before drilling in.
   *
   * Response:
   * {
   *   slug: string,
   *   format: 'json' | 'markdown' | 'code' | 'text',
   *   lineCount: number,
   *   tokenCount: number,
   *   sections: [{ title, depth, startLine, endLine, tokenCount, type }],
   *   keys?: [{ key, type, preview }],  // JSON documents
   *   toc?: [{ title, depth, line }],   // Markdown documents
   * }
   */
  fastify.get('/documents/:slug/overview', async (
    request: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const overview = generateOverview(doc.content);

    reply.header('X-Token-Count', overview.tokenCount);
    return reply.send({
      slug,
      ...overview,
    });
  });

  /**
   * GET /api/documents/:slug/lines?start=1&end=50
   * Returns a specific range of lines from the document.
   * Dramatically reduces tokens vs fetching the entire document.
   *
   * Query params:
   *   start: 1-indexed start line (default: 1)
   *   end: 1-indexed end line inclusive (default: 50)
   *
   * Response:
   * {
   *   slug: string,
   *   startLine: number,
   *   endLine: number,
   *   content: string,
   *   tokenCount: number,
   *   totalLines: number,
   *   totalTokens: number,
   *   tokensSaved: number,
   * }
   */
  fastify.get('/documents/:slug/lines', async (
    request: FastifyRequest<{
      Params: { slug: string };
      Querystring: { start?: string; end?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const { start, end } = lineRangeQuery.parse(request.query);

    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const result = getLineRange(doc.content, start, end);

    reply.header('X-Token-Count', result.tokenCount);
    reply.header('X-Total-Tokens', result.totalTokens);
    reply.header('X-Tokens-Saved', result.tokensSaved);
    return reply.send({
      slug,
      ...result,
    });
  });

  /**
   * GET /api/documents/:slug/search?q=auth&context=2&max=20
   * Search within a document for matching lines.
   * Supports plain text search and /regex/ patterns.
   *
   * Query params:
   *   q: search query (plain text or /regex/flags)
   *   context: number of context lines (default: 2)
   *   max: maximum results (default: 20)
   *
   * Response:
   * {
   *   slug: string,
   *   query: string,
   *   resultCount: number,
   *   tokenCount: number,
   *   totalTokens: number,
   *   tokensSaved: number,
   *   results: [{
   *     line: number,
   *     content: string,
   *     contextBefore: string[],
   *     contextAfter: string[],
   *   }],
   * }
   */
  fastify.get('/documents/:slug/search', async (
    request: FastifyRequest<{
      Params: { slug: string };
      Querystring: { q?: string; context?: string; max?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const parsed = searchQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid search query',
        details: parsed.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    const { q, context, max } = parsed.data;

    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const results = searchContent(doc.content, q, context, max);

    // Calculate tokens for the returned results
    const resultContent = results.map(r =>
      [...r.contextBefore, r.content, ...r.contextAfter].join('\n')
    ).join('\n\n');
    const resultTokens = calculateTokens(resultContent);

    reply.header('X-Token-Count', resultTokens);
    reply.header('X-Total-Tokens', doc.totalTokens);
    reply.header('X-Tokens-Saved', doc.totalTokens - resultTokens);
    return reply.send({
      slug,
      query: q,
      resultCount: results.length,
      tokenCount: resultTokens,
      totalTokens: doc.totalTokens,
      tokensSaved: doc.totalTokens - resultTokens,
      results,
    });
  });

  /**
   * GET /api/documents/:slug/query?path=$.users[0].name
   * JSONPath-style query for JSON documents.
   * Access specific nested values without fetching the entire document.
   *
   * Query params:
   *   path: JSONPath expression (e.g., "$.users[0].name", "$.config.database")
   *
   * Response:
   * {
   *   slug: string,
   *   path: string,
   *   result: any,
   *   tokenCount: number,
   *   totalTokens: number,
   *   tokensSaved: number,
   * }
   */
  fastify.get('/documents/:slug/query', async (
    request: FastifyRequest<{
      Params: { slug: string };
      Querystring: { path?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const parsed = jsonPathQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid query path',
        details: parsed.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
        hint: 'Use JSONPath syntax: $.key, $.array[0], $.nested.path',
      });
    }
    const { path } = parsed.data;

    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    try {
      const result = queryJsonPath(doc.content, path);
      reply.header('X-Token-Count', result.tokenCount);
      reply.header('X-Total-Tokens', doc.totalTokens);
      reply.header('X-Tokens-Saved', doc.totalTokens - result.tokenCount);
      return reply.send({
        slug,
        path: result.path,
        result: result.result,
        tokenCount: result.tokenCount,
        totalTokens: doc.totalTokens,
        tokensSaved: doc.totalTokens - result.tokenCount,
      });
    } catch (err) {
      return reply.status(400).send({
        error: 'Query failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  /**
   * GET /api/documents/:slug/sections
   * List all detected sections in the document.
   *
   * Response:
   * {
   *   slug: string,
   *   format: string,
   *   sections: [{ title, depth, startLine, endLine, tokenCount, type }],
   * }
   */
  fastify.get('/documents/:slug/sections', async (
    request: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const overview = generateOverview(doc.content);
    return reply.send({
      slug,
      format: overview.format,
      sections: overview.sections,
    });
  });

  /**
   * GET /api/documents/:slug/toc
   * Lightweight table-of-contents returning just section names/titles.
   * Helps agents discover available sections with minimal token cost.
   *
   * Response:
   * {
   *   slug: string,
   *   toc: string[]
   * }
   */
  fastify.get('/documents/:slug/toc', async (
    request: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const overview = generateOverview(doc.content);
    const toc = overview.sections.map(s => s.title);

    return reply.send({
      slug,
      toc,
    });
  });

  /**
   * GET /api/documents/:slug/sections/:name
   * Get a specific section by name.
   *
   * Query params:
   *   depth: 'all' to include all nested children concatenated
   *
   * Response:
   * {
   *   slug: string,
   *   section: { title, depth, startLine, endLine, tokenCount, type },
   *   content: string,
   *   tokenCount: number,
   *   totalTokens: number,
   *   tokensSaved: number,
   * }
   */
  fastify.get('/documents/:slug/sections/:name', async (
    request: FastifyRequest<{
      Params: { slug: string; name: string };
      Querystring: { depth?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse({ slug: request.params.slug });
    const { name } = sectionQuery.parse({ name: request.params.name });
    const depthAll = request.query.depth === 'all';

    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const result = getSection(doc.content, name, depthAll);
    if (!result) {
      const overview = generateOverview(doc.content);
      return reply.status(404).send({
        error: 'Section not found',
        availableSections: overview.sections.map(s => s.title),
      });
    }

    reply.header('X-Token-Count', result.tokenCount);
    reply.header('X-Total-Tokens', result.totalTokens);
    reply.header('X-Tokens-Saved', result.tokensSaved);
    return reply.send({
      slug,
      ...result,
    });
  });

  /**
   * GET /api/documents/:slug/raw
   * Get raw document content (plain text, no JSON wrapper).
   * Useful for agents that just need the content piped directly.
   *
   * Query params:
   *   start: optional 1-indexed start line
   *   end: optional 1-indexed end line
   *   section: optional section name to extract
   */
  fastify.get('/documents/:slug/raw', async (
    request: FastifyRequest<{
      Params: { slug: string };
      Querystring: { start?: string; end?: string; section?: string };
    }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const { start: startStr, end: endStr, section } = request.query;

    let content = doc.content;
    if (section) {
      const result = getSection(doc.content, section, false);
      if (!result) {
        return reply.status(404).type('text/plain').send(`Error: Section '${section}' not found`);
      }
      content = result.content;
      reply.header('X-Token-Count', result.tokenCount);
      reply.header('X-Total-Tokens', result.totalTokens);
      reply.header('X-Tokens-Saved', result.tokensSaved);
    } else if (startStr !== undefined || endStr !== undefined) {
      const start = startStr ? parseInt(startStr, 10) : 1;
      const end = endStr ? parseInt(endStr, 10) : doc.content.split('\n').length;
      const result = getLineRange(doc.content, start, end);
      content = result.content;
      reply.header('X-Token-Count', result.tokenCount);
      reply.header('X-Total-Tokens', result.totalTokens);
      reply.header('X-Tokens-Saved', result.tokensSaved);
    } else {
      reply.header('X-Token-Count', doc.totalTokens);
    }

    // Add metadata headers
    reply.header('X-Original-Size', doc.originalSize);
    reply.header('X-Compressed-Size', doc.compressedSize);

    return reply.type('text/plain').send(content);
  });

  /**
   * POST /api/documents/:slug/batch
   * Batch query for multiple sections in one request.
   * Accepts JSON body with sections array and returns combined results.
   *
   * Body:
   *   { sections: string[] }
   *
   * Response:
   * {
   *   slug: string,
   *   results: [{ section: string, content: string }],
   *   totalTokenCount: number,
   *   totalTokensSaved: number,
   * }
   */
  fastify.post('/documents/:slug/batch', async (
    request: FastifyRequest<{
      Params: { slug: string };
      Body: { sections: string[] };
    }>,
    reply: FastifyReply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const parsed = batchQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parsed.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    const { sections } = parsed.data;

    if (!sections || sections.length === 0) {
      return reply.status(400).send({
        error: 'Invalid request body',
        message: 'sections array is required and must not be empty',
      });
    }

    const doc = await resolveDocument(slug, shouldSkipCache(request));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const results = [];
    let totalTokenCount = 0;

    for (const sectionName of sections) {
      const result = getSection(doc.content, sectionName, false);
      if (result) {
        results.push({
          section: sectionName,
          content: result.content,
        });
        totalTokenCount += result.tokenCount;
      }
    }

    reply.header('X-Token-Count', totalTokenCount);
    reply.header('X-Total-Tokens', doc.totalTokens);
    reply.header('X-Tokens-Saved', doc.totalTokens - totalTokenCount);
    return reply.send({
      slug,
      results,
      totalTokenCount,
      totalTokensSaved: doc.totalTokens - totalTokenCount,
    });
  });
}
