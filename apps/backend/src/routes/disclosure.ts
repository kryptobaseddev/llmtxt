/**
 * Progressive Disclosure API routes.
 * Allows agents to query only the portions of a document they need.
 *
 * All endpoints under: /api/documents/:slug/...
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
// Schema type imports for access-stat update (infrastructure concern kept in route layer).
import { documents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decompress } from '../utils/compression.js';
import { countTokens } from '../utils/tokenizer.js';
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
import { canRead } from '../middleware/rbac.js';
import { CONTENT_LIMITS } from '../middleware/content-limits.js';

// ──────────────────────────────────────────────────────────────────
// Shared helper: resolve a slug to decompressed content
// Wave A: accepts getDocBySlug callback to use backendCore.
// ──────────────────────────────────────────────────────────────────

async function resolveDocument(
  slug: string,
  skipCache: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDocBySlug: (slug: string) => Promise<any>,
): Promise<{ content: string; format: string; totalTokens: number; originalSize: number; compressedSize: number } | null> {
  // Try cache first
  if (!skipCache) {
    const cacheKey = getDocumentCacheKey(slug, 'content');
    const cached = contentCache.get(cacheKey);
    if (cached) {
      return {
        content: cached as string,
        format: 'unknown', // We'd need metadata from DB
        totalTokens: countTokens(cached as string),
        originalSize: 0, // Not available from cache
        compressedSize: 0, // Not available from cache
      };
    }
  }

  // Wave A: fetch via backendCore.getDocumentBySlug
  const doc = await getDocBySlug(slug);
  if (!doc) return null;

  // Decompress
  const compressedBuffer = doc.compressedData instanceof Buffer
    ? doc.compressedData
    : Buffer.from(doc.compressedData as ArrayBuffer);
  const content = await decompress(compressedBuffer);

  // Cache for subsequent queries
  setCachedContent(slug, content);

  // Update access count (infrastructure concern — stays in route layer)
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
    totalTokens: doc.tokenCount || countTokens(content),
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

// O-05: Search query capped at 1KB to prevent catastrophic backtracking with
// large patterns and to bound allocations in the Rust search_content function. [T108.2]
const SEARCH_QUERY_MAX_BYTES = 1024;

const searchQuery = z.object({
  q: z.string().min(1).max(SEARCH_QUERY_MAX_BYTES),
  context: z.coerce.number().int().min(0).max(10).default(2),
  max: z.coerce.number().int().min(1).max(100).default(20),
});

const jsonPathQuery = z.object({
  path: z.string().min(1).max(500),
});

const sectionQuery = z.object({
  name: z.string().min(1).max(200),
});

// O-04: Batch section fetch capped at CONTENT_LIMITS.maxBatchSize (50) to prevent
// runaway memory allocation on documents with many sections. [T108.4]
const batchQuerySchema = z.object({
  sections: z.array(z.string()).max(CONTENT_LIMITS.maxBatchSize).optional(),
  paths: z.array(z.string()).max(CONTENT_LIMITS.maxBatchSize).optional(),
});

// ──────────────────────────────────────────────────────────────────
// Route registration
// ──────────────────────────────────────────────────────────────────

/** Register progressive disclosure routes: overview, sections, toc, search, lines, raw, query, and batch endpoints for token-efficient content retrieval. */
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
  fastify.get<{ Params: { slug: string } }>('/documents/:slug/overview', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
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
  fastify.get<{
    Params: { slug: string };
    Querystring: { start?: string; end?: string };
  }>('/documents/:slug/lines', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const { start, end } = lineRangeQuery.parse(request.query);

    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
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
  fastify.get<{
    Params: { slug: string };
    Querystring: { q?: string; context?: string; max?: string };
  }>('/documents/:slug/search', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const parsed = searchQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid search query',
        details: parsed.error.issues.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }
    const { q, context, max } = parsed.data;

    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const results = searchContent(doc.content, q, context, max);

    // Calculate tokens for the returned results
    const resultContent = results.map(r =>
      [...r.contextBefore, r.content, ...r.contextAfter].join('\n')
    ).join('\n\n');
    const resultTokens = countTokens(resultContent);

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
  fastify.get<{
    Params: { slug: string };
    Querystring: { path?: string };
  }>('/documents/:slug/query', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const parsed = jsonPathQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid query path',
        details: parsed.error.issues.map(e => ({
          field: e.path.join('.'),
          message: e.message,
        })),
        hint: 'Use JSONPath syntax: $.key, $.array[0], $.nested.path',
      });
    }
    const { path } = parsed.data;

    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
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
   *   sections: [{ slug, title, depth, startLine, endLine, tokenCount, type }],
   * }
   *
   * Each section includes a `slug` field (URL-safe kebab-case derived from the
   * section title) that clients can use as the `:sectionId` parameter in the
   * CRDT collab WebSocket URL:
   *   wss://api.llmtxt.my/api/v1/documents/:slug/sections/:sectionId/collab
   * (T370 fix: observer-bot needs sectionId to build the /collab WS URL)
   */
  fastify.get<{ Params: { slug: string } }>('/documents/:slug/sections', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
    if (!doc) {
      return reply.status(404).send({ error: 'Document not found' });
    }

    const overview = generateOverview(doc.content);

    // Derive a stable URL-safe slug for each section from its title.
    // This is the identifier used as :sectionId in the /collab WS endpoint.
    const sections = overview.sections.map((section, idx) => {
      const sectionSlug = section.title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')     // strip non-word, non-space, non-hyphen
        .replace(/\s+/g, '-')         // spaces → hyphens
        .replace(/-+/g, '-')          // collapse repeated hyphens
        .replace(/^-+|-+$/g, '')      // trim leading/trailing hyphens
        || `section-${idx}`;          // fallback for empty titles
      return { ...section, slug: sectionSlug };
    });

    return reply.send({
      slug,
      format: overview.format,
      sections,
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
  fastify.get<{ Params: { slug: string } }>('/documents/:slug/toc', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
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
  fastify.get<{
    Params: { slug: string; name: string };
    Querystring: { depth?: string; since?: string };
  }>('/documents/:slug/sections/:name', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse({ slug: request.params.slug });
    const { name } = sectionQuery.parse({ name: request.params.name });
    const depthAll = request.query.depth === 'all';

    // ── T299: Differential delta mode (?since=<seq>) ──────────────────────
    // When ?since is provided, return a SectionDelta instead of full content.
    const sinceParam = request.query.since;
    if (sinceParam !== undefined) {
      const since = parseInt(sinceParam, 10);
      if (isNaN(since) || since < 0) {
        return reply.status(400).send({ error: 'since must be a non-negative integer' });
      }

      // Resolve document for currentSeq
      const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Import diff helper (lazy to avoid circular deps in tests)
      const { computeSectionDelta } = await import('../subscriptions/diff-helper.js');
      const { db } = await import('../db/index.js');

      const delta = await computeSectionDelta(db, slug, name, since);

      // Get currentSeq from DB
      const { documentEvents } = await import('../db/schema-pg.js');
      const { max } = await import('drizzle-orm');
      const maxResult = await db
        .select({ maxSeq: max(documentEvents.seq) })
        .from(documentEvents)
        .where((await import('drizzle-orm')).eq(documentEvents.documentId, slug));
      const currentSeq = Number(maxResult[0]?.maxSeq ?? BigInt(0));

      reply.header('Cache-Control', 'no-store');
      return reply.status(200).send({ delta, currentSeq });
    }
    // ── End T299 ──────────────────────────────────────────────────────────

    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
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
  fastify.get<{
    Params: { slug: string };
    Querystring: { start?: string; end?: string; section?: string };
  }>('/documents/:slug/raw', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);
    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
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
  fastify.post<{
    Params: { slug: string };
    Body: { sections: string[] };
  }>('/documents/:slug/batch', { preHandler: [canRead] }, async (
    request,
    reply,
  ) => {
    const { slug } = slugSchema.parse(request.params);

    // O-04: Enforce batch cap before Zod so the response code is 413. [T108.4]
    const rawSections = (request.body as { sections?: unknown })?.sections;
    if (Array.isArray(rawSections) && rawSections.length > CONTENT_LIMITS.maxBatchSize) {
      return reply.status(413).send({
        error: 'Batch Too Large',
        message: `Batch section fetch is limited to ${CONTENT_LIMITS.maxBatchSize} sections per request. Received ${rawSections.length}.`,
        limit: CONTENT_LIMITS.maxBatchSize,
        actual: rawSections.length,
      });
    }

    const parsed = batchQuerySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request body',
        details: parsed.error.issues.map(e => ({
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

    const doc = await resolveDocument(slug, shouldSkipCache(request), (s) => request.server.backendCore.getDocumentBySlug(s));
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
