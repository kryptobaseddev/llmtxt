/**
 * Cross-document operations: enhanced search, document links, and multi-document graph.
 *
 * Routes:
 *   POST /search                          - Full-text search across accessible documents
 *   GET  /documents/:slug/links           - List all links for a document
 *   POST /documents/:slug/links           - Create a link (write access required)
 *   DELETE /documents/:slug/links/:linkId - Remove a link (write access required)
 *   GET  /graph                           - Multi-document dependency graph
 *
 * Wave D (T353.7): link CRUD delegates to fastify.backendCore.* (CrossDocOps).
 * Search and graph remain with direct decompress logic (stateless content scoring).
 * Document lookups for RBAC stay direct via backendCore.getDocumentBySlug.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, collections, collectionDocuments } from '../db/schema.js';
import { auth } from '../auth.js';
import { decompress } from 'llmtxt';
import { generateId } from '../utils/compression.js';
import { VALID_LINK_TYPES, type LinkType } from 'llmtxt';

// ────────────────────────────────────────────────────────────────
// Validation schemas
// ────────────────────────────────────────────────────────────────

const createLinkBodySchema = z.object({
  targetSlug: z.string().min(1).max(20),
  linkType: z.enum(VALID_LINK_TYPES),
  label: z.string().max(255).optional(),
});

const enhancedSearchBodySchema = z.object({
  query: z.string().min(1).max(500),
  slugs: z.array(z.string().min(1).max(20)).max(100).optional(),
  collections: z.array(z.string().min(1).max(100)).max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ────────────────────────────────────────────────────────────────
// Auth helper (optional — returns null when unauthenticated)
// ────────────────────────────────────────────────────────────────

async function getOptionalUser(request: FastifyRequest) {
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

// ────────────────────────────────────────────────────────────────
// RBAC helper: check if user can read a document
// ────────────────────────────────────────────────────────────────

function canUserReadDoc(
  doc: { ownerId: string | null; isAnonymous: boolean },
  _userId: string | null
): boolean {
  // All documents are currently readable by anyone.
  // Update this when per-doc visibility is enforced.
  return true;
}

// ────────────────────────────────────────────────────────────────
// Search helper: score a document's content against a query
// ────────────────────────────────────────────────────────────────

interface SectionMatch {
  name: string;
  snippet: string;
  score: number;
}

function scoreContent(
  content: string,
  query: string
): { sections: SectionMatch[]; relevanceScore: number } {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);
  const lines = content.split('\n');

  const sections: SectionMatch[] = [];
  let currentSection = 'Introduction';
  let currentLines: string[] = [];
  let sectionScore = 0;

  function flushSection() {
    if (sectionScore > 0 && currentLines.length > 0) {
      let bestLine = '';
      let bestLineScore = 0;
      for (const ln of currentLines) {
        const lnLower = ln.toLowerCase();
        const s = queryTerms.filter((t) => lnLower.includes(t)).length;
        if (s > bestLineScore) {
          bestLineScore = s;
          bestLine = ln.trim();
        }
      }
      sections.push({
        name: currentSection,
        snippet: bestLine.substring(0, 200),
        score: sectionScore,
      });
    }
  }

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      flushSection();
      currentSection = headerMatch[1].trim();
      currentLines = [];
      sectionScore = 0;
      continue;
    }

    currentLines.push(line);
    const lineLower = line.toLowerCase();
    const termHits = queryTerms.filter((t) => lineLower.includes(t)).length;
    sectionScore += termHits;
  }
  flushSection();

  const totalScore = sections.reduce((sum, s) => sum + s.score, 0);
  sections.sort((a, b) => b.score - a.score);

  return {
    sections: sections.slice(0, 5),
    relevanceScore: totalScore,
  };
}

// ────────────────────────────────────────────────────────────────
// Route registration
// ────────────────────────────────────────────────────────────────

/** Register cross-document routes: enhanced search, document links, and multi-document graph. */
export async function crossDocRoutes(fastify: FastifyInstance) {

  // ──────────────────────────────────────────────────────────────
  // POST /search — Enhanced full-text search
  // ──────────────────────────────────────────────────────────────

  fastify.post<{
    Body: z.infer<typeof enhancedSearchBodySchema>;
  }>(
    '/search',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodyResult = enhancedSearchBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { query, slugs, collections: collectionSlugs, limit, offset } = bodyResult.data;
      const user = await getOptionalUser(request);
      const userId = user?.id ?? null;

      // Resolve the set of document slugs to search.
      let targetSlugs: string[] = [];

      if (slugs && slugs.length > 0) {
        targetSlugs = slugs;
      } else if (collectionSlugs && collectionSlugs.length > 0) {
        // Resolve slugs from named collections (still uses direct db for collection resolution)
        const collRows = await db
          .select({ id: collections.id, ownerId: collections.ownerId, visibility: collections.visibility })
          .from(collections)
          .where(inArray(collections.slug, collectionSlugs));

        const accessibleCollectionIds = collRows
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((c: any) => c.visibility === 'public' || c.ownerId === userId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((c: any) => c.id as string);

        if (accessibleCollectionIds.length > 0) {
          const memberRows = await db
            .select({ documentId: collectionDocuments.documentId })
            .from(collectionDocuments)
            .where(inArray(collectionDocuments.collectionId, accessibleCollectionIds));

          const docIds = memberRows.map((r: { documentId: string }) => r.documentId as string);
          if (docIds.length > 0) {
            const docRows = await db
              .select({ slug: documents.slug })
              .from(documents)
              .where(inArray(documents.id, docIds));
            targetSlugs = docRows.map((d: { slug: string }) => d.slug as string);
          }
        }
      } else {
        // Search all accessible documents
        const allDocs = await db
          .select({ slug: documents.slug, ownerId: documents.ownerId, isAnonymous: documents.isAnonymous })
          .from(documents);
        targetSlugs = allDocs
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((d: any) => canUserReadDoc(d, userId))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((d: any) => d.slug as string);
      }

      // Execute search (content decompression stays in route layer — stateless)
      const allResults: Array<{
        slug: string;
        title: string;
        sections: SectionMatch[];
        relevanceScore: number;
      }> = [];

      for (const slug of targetSlugs) {
        try {
          const doc = await fastify.backendCore.getDocumentBySlug(slug);
          if (!doc) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!canUserReadDoc(doc as any, userId)) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!(doc as any).compressedData) continue;

          const compressedBuffer =
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (doc as any).compressedData instanceof Buffer
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? (doc as any).compressedData
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              : Buffer.from((doc as any).compressedData as ArrayBuffer);

          const content = await decompress(compressedBuffer);
          const { sections, relevanceScore } = scoreContent(content, query);
          if (relevanceScore === 0) continue;

          const firstHeading = content.match(/^#{1,3}\s+(.+)/m);
          const title = firstHeading ? firstHeading[1].trim() : slug;

          allResults.push({ slug, title, sections, relevanceScore });
        } catch (err) {
          fastify.log.warn(`search: failed to process document ${slug}: ${err}`);
        }
      }

      allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
      const total = allResults.length;
      const pageResults = allResults.slice(offset, offset + limit);

      return reply.status(200).send({ results: pageResults, total, limit, offset });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /documents/:slug/links — List links for a document
  // ──────────────────────────────────────────────────────────────

  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/links',
    async (request: FastifyRequest<{ Params: { slug: string } }>, reply: FastifyReply) => {
      const { slug } = request.params;
      const user = await getOptionalUser(request);
      const userId = user?.id ?? null;

      const doc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!canUserReadDoc(doc as any, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const docRow = doc as any;
      const links = await fastify.backendCore.getDocumentLinks(docRow.id as string);

      // Separate outgoing vs incoming, then resolve slugs
      const outgoing: Array<{ linkId: string; slug: string; label: string | null; createdAt: number }> = [];
      const incoming: Array<{ linkId: string; slug: string; label: string | null; createdAt: number }> = [];

      for (const link of links) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const l = link as any;
        if (l.sourceDocumentId === docRow.id) {
          // Outgoing: resolve target slug
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = await fastify.backendCore.getDocument(l.targetDocumentId) as any;
          if (target && canUserReadDoc(target, userId)) {
            outgoing.push({ linkId: l.id, slug: target.slug as string, label: l.label ?? null, createdAt: l.createdAt });
          }
        } else {
          // Incoming: resolve source slug
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const source = await fastify.backendCore.getDocument(l.sourceDocumentId) as any;
          if (source && canUserReadDoc(source, userId)) {
            incoming.push({ linkId: l.id, slug: source.slug as string, label: l.label ?? null, createdAt: l.createdAt });
          }
        }
      }

      return reply.status(200).send({ slug, outgoing, incoming });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /documents/:slug/links — Create a link
  // ──────────────────────────────────────────────────────────────

  fastify.post<{
    Params: { slug: string };
    Body: z.infer<typeof createLinkBodySchema>;
  }>(
    '/documents/:slug/links',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;
      const user = await getOptionalUser(request);

      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      }

      const bodyResult = createLinkBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { targetSlug, linkType, label } = bodyResult.data;

      const sourceDoc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!sourceDoc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Source document not found' });
      }

      // Write access: must be document owner
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((sourceDoc as any).ownerId !== user.id) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Write access required on source document' });
      }

      const targetDoc = await fastify.backendCore.getDocumentBySlug(targetSlug);
      if (!targetDoc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Target document not found' });
      }

      // Prevent self-linking
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sourceRow = sourceDoc as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const targetRow = targetDoc as any;
      if (sourceRow.id === targetRow.id) {
        return reply.status(400).send({ error: 'Bad Request', message: 'A document cannot link to itself' });
      }

      const now = Date.now();
      const linkId = generateId();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const link = await fastify.backendCore.createDocumentLink({
        sourceDocumentId: sourceRow.id as string,
        targetDocumentId: targetRow.id as string,
        label: label ?? linkType,
      }) as any;

      return reply.status(201).send({
        linkId: link.id ?? linkId,
        sourceSlug: slug,
        targetSlug,
        linkType,
        label: label ?? null,
        createdAt: link.createdAt ?? now,
      });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // DELETE /documents/:slug/links/:linkId — Remove a link
  // ──────────────────────────────────────────────────────────────

  fastify.delete<{ Params: { slug: string; linkId: string } }>(
    '/documents/:slug/links/:linkId',
    async (
      request: FastifyRequest<{ Params: { slug: string; linkId: string } }>,
      reply: FastifyReply
    ) => {
      const { slug, linkId } = request.params;
      const user = await getOptionalUser(request);

      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      }

      const sourceDoc = await fastify.backendCore.getDocumentBySlug(slug);
      if (!sourceDoc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Source document not found' });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((sourceDoc as any).ownerId !== user.id) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Write access required on source document' });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sourceRow = sourceDoc as any;
      const deleted = await fastify.backendCore.deleteDocumentLink(
        sourceRow.id as string,
        linkId
      );

      if (!deleted) {
        return reply.status(404).send({ error: 'Not Found', message: 'Link not found' });
      }

      return reply.status(200).send({ message: 'Link removed', linkId });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /graph — Multi-document dependency graph
  // ──────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { slugs?: string } }>(
    '/graph',
    async (
      request: FastifyRequest<{ Querystring: { slugs?: string } }>,
      reply: FastifyReply
    ) => {
      const user = await getOptionalUser(request);
      const userId = user?.id ?? null;

      // For user-scoped graphs, still build from accessible documents
      let maxNodes = 500;
      if (request.query.slugs) {
        const targetSlugs = request.query.slugs.split(',').map((s) => s.trim()).filter(Boolean);
        maxNodes = Math.min(targetSlugs.length, 500);
      }

      const graph = await fastify.backendCore.getGlobalGraph({ maxNodes });

      return reply.status(200).send(graph);
    }
  );

}
