/**
 * Cross-document operations: enhanced search, document links, and multi-document graph.
 *
 * Routes:
 *   POST /search                          - Full-text search across accessible documents
 *   GET  /documents/:slug/links           - List all links for a document
 *   POST /documents/:slug/links           - Create a link (write access required)
 *   DELETE /documents/:slug/links/:linkId - Remove a link (write access required)
 *   GET  /graph                           - Multi-document dependency graph
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, documentLinks, collections, collectionDocuments } from '../db/schema.js';
import { auth } from '../auth.js';
import { decompress, generateId } from '../utils/compression.js';

// ────────────────────────────────────────────────────────────────
// Validation schemas
// ────────────────────────────────────────────────────────────────

const VALID_LINK_TYPES = [
  'references',
  'depends_on',
  'derived_from',
  'supersedes',
  'related',
] as const;

type LinkType = typeof VALID_LINK_TYPES[number];

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
// Public docs: always readable. Private docs: only owner.
// ────────────────────────────────────────────────────────────────

function canUserReadDoc(
  doc: { ownerId: string | null; isAnonymous: boolean },
  userId: string | null
): boolean {
  // All documents are currently readable by anyone (no per-doc visibility flag yet).
  // When visibility field is added, this is the single place to update.
  // For now, treat all documents as public unless private (owner-only).
  // Since there is no visibility column yet, every document is readable.
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
      // Find the best matching line as snippet
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
    // Detect section headers (Markdown H1-H3 or plain ALL-CAPS lines)
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

  // Sort sections by score descending, take top 5
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
          details: bodyResult.error.errors.map((e) => ({
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
      // Priority: explicit slugs → collection-derived slugs → all accessible docs.
      let targetSlugs: string[] = [];

      if (slugs && slugs.length > 0) {
        targetSlugs = slugs;
      } else if (collectionSlugs && collectionSlugs.length > 0) {
        // Resolve slugs from named collections
        const collRows = await db
          .select({ id: collections.id, ownerId: collections.ownerId, visibility: collections.visibility })
          .from(collections)
          .where(inArray(collections.slug, collectionSlugs));

        const accessibleCollectionIds = collRows
          .filter((c) => c.visibility === 'public' || c.ownerId === userId)
          .map((c) => c.id);

        if (accessibleCollectionIds.length > 0) {
          const memberRows = await db
            .select({ documentId: collectionDocuments.documentId })
            .from(collectionDocuments)
            .where(inArray(collectionDocuments.collectionId, accessibleCollectionIds));

          const docIds = memberRows.map((r) => r.documentId);
          if (docIds.length > 0) {
            const docRows = await db
              .select({ slug: documents.slug })
              .from(documents)
              .where(inArray(documents.id, docIds));
            targetSlugs = docRows.map((d) => d.slug);
          }
        }
      } else {
        // Search all accessible documents
        const allDocs = await db
          .select({ slug: documents.slug, ownerId: documents.ownerId, isAnonymous: documents.isAnonymous })
          .from(documents);
        targetSlugs = allDocs
          .filter((d) => canUserReadDoc(d, userId))
          .map((d) => d.slug);
      }

      // Execute search
      const allResults: Array<{
        slug: string;
        title: string;
        sections: SectionMatch[];
        relevanceScore: number;
      }> = [];

      for (const slug of targetSlugs) {
        try {
          const [doc] = await db
            .select({
              id: documents.id,
              slug: documents.slug,
              format: documents.format,
              compressedData: documents.compressedData,
              ownerId: documents.ownerId,
              isAnonymous: documents.isAnonymous,
              tokenCount: documents.tokenCount,
            })
            .from(documents)
            .where(eq(documents.slug, slug));

          if (!doc) continue;
          if (!canUserReadDoc(doc, userId)) continue;
          if (!doc.compressedData) continue;

          const compressedBuffer =
            doc.compressedData instanceof Buffer
              ? doc.compressedData
              : Buffer.from(doc.compressedData as ArrayBuffer);

          const content = await decompress(compressedBuffer);

          const { sections, relevanceScore } = scoreContent(content, query);
          if (relevanceScore === 0) continue;

          // Extract title from first heading or first line
          const firstHeading = content.match(/^#{1,3}\s+(.+)/m);
          const title = firstHeading ? firstHeading[1].trim() : slug;

          allResults.push({ slug, title, sections, relevanceScore });
        } catch (err) {
          fastify.log.warn(`search: failed to process document ${slug}: ${err}`);
        }
      }

      // Sort by relevance score descending
      allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

      const total = allResults.length;
      const pageResults = allResults.slice(offset, offset + limit);

      return reply.status(200).send({
        results: pageResults,
        total,
        limit,
        offset,
      });
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

      const [doc] = await db
        .select({ id: documents.id, ownerId: documents.ownerId, isAnonymous: documents.isAnonymous })
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!doc) return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      if (!canUserReadDoc(doc, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      }

      // Outgoing links: this doc → others
      const outgoingRows = await db
        .select({
          linkId: documentLinks.id,
          targetDocId: documentLinks.targetDocId,
          linkType: documentLinks.linkType,
          label: documentLinks.label,
          createdAt: documentLinks.createdAt,
        })
        .from(documentLinks)
        .where(eq(documentLinks.sourceDocId, doc.id));

      // Incoming links: others → this doc
      const incomingRows = await db
        .select({
          linkId: documentLinks.id,
          sourceDocId: documentLinks.sourceDocId,
          linkType: documentLinks.linkType,
          label: documentLinks.label,
          createdAt: documentLinks.createdAt,
        })
        .from(documentLinks)
        .where(eq(documentLinks.targetDocId, doc.id));

      // Resolve target/source slugs for outgoing/incoming, filtering by RBAC
      const outgoing = [];
      for (const row of outgoingRows) {
        const [target] = await db
          .select({ slug: documents.slug, ownerId: documents.ownerId, isAnonymous: documents.isAnonymous })
          .from(documents)
          .where(eq(documents.id, row.targetDocId));
        if (!target || !canUserReadDoc(target, userId)) continue;
        outgoing.push({
          linkId: row.linkId,
          slug: target.slug,
          linkType: row.linkType,
          label: row.label ?? null,
          createdAt: row.createdAt,
        });
      }

      const incoming = [];
      for (const row of incomingRows) {
        const [source] = await db
          .select({ slug: documents.slug, ownerId: documents.ownerId, isAnonymous: documents.isAnonymous })
          .from(documents)
          .where(eq(documents.id, row.sourceDocId));
        if (!source || !canUserReadDoc(source, userId)) continue;
        incoming.push({
          linkId: row.linkId,
          slug: source.slug,
          linkType: row.linkType,
          label: row.label ?? null,
          createdAt: row.createdAt,
        });
      }

      return reply.status(200).send({ slug, outgoing, incoming });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /documents/:slug/links — Create a link
  // Requires the caller to be the owner (or have write access) on source
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
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { targetSlug, linkType, label } = bodyResult.data;

      // Resolve source document
      const [sourceDoc] = await db
        .select({ id: documents.id, ownerId: documents.ownerId })
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!sourceDoc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Source document not found' });
      }

      // Write access: must be document owner
      if (sourceDoc.ownerId !== user.id) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Write access required on source document' });
      }

      // Resolve target document
      const [targetDoc] = await db
        .select({ id: documents.id, ownerId: documents.ownerId, isAnonymous: documents.isAnonymous })
        .from(documents)
        .where(eq(documents.slug, targetSlug));

      if (!targetDoc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Target document not found' });
      }

      if (!canUserReadDoc(targetDoc, user.id)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You do not have read access to the target document' });
      }

      // Prevent self-linking
      if (sourceDoc.id === targetDoc.id) {
        return reply.status(400).send({ error: 'Bad Request', message: 'A document cannot link to itself' });
      }

      // Check uniqueness constraint (sourceDocId + targetDocId + linkType)
      const [existing] = await db
        .select({ id: documentLinks.id })
        .from(documentLinks)
        .where(
          and(
            eq(documentLinks.sourceDocId, sourceDoc.id),
            eq(documentLinks.targetDocId, targetDoc.id),
            eq(documentLinks.linkType, linkType)
          )
        );

      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `A link of type '${linkType}' from '${slug}' to '${targetSlug}' already exists`,
        });
      }

      const now = Date.now();
      const linkId = generateId();

      await db.insert(documentLinks).values({
        id: linkId,
        sourceDocId: sourceDoc.id,
        targetDocId: targetDoc.id,
        linkType,
        label: label ?? null,
        createdBy: user.id,
        createdAt: now,
      });

      return reply.status(201).send({
        linkId,
        sourceSlug: slug,
        targetSlug,
        linkType,
        label: label ?? null,
        createdAt: now,
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

      // Resolve source document
      const [sourceDoc] = await db
        .select({ id: documents.id, ownerId: documents.ownerId })
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!sourceDoc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Source document not found' });
      }

      if (sourceDoc.ownerId !== user.id) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Write access required on source document' });
      }

      // Find the link
      const [link] = await db
        .select({ id: documentLinks.id, sourceDocId: documentLinks.sourceDocId })
        .from(documentLinks)
        .where(and(eq(documentLinks.id, linkId), eq(documentLinks.sourceDocId, sourceDoc.id)));

      if (!link) {
        return reply.status(404).send({ error: 'Not Found', message: 'Link not found' });
      }

      await db.delete(documentLinks).where(eq(documentLinks.id, linkId));

      return reply.status(200).send({ message: 'Link removed', linkId });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /graph — Multi-document dependency graph
  // Query: ?slugs=a,b,c  (optional — defaults to user's documents)
  // ──────────────────────────────────────────────────────────────

  fastify.get<{ Querystring: { slugs?: string } }>(
    '/graph',
    async (
      request: FastifyRequest<{ Querystring: { slugs?: string } }>,
      reply: FastifyReply
    ) => {
      const user = await getOptionalUser(request);
      const userId = user?.id ?? null;

      let targetSlugs: string[] = [];

      if (request.query.slugs) {
        targetSlugs = request.query.slugs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (userId) {
        // Default: all documents owned by the user
        const ownedDocs = await db
          .select({ slug: documents.slug })
          .from(documents)
          .where(eq(documents.ownerId, userId));
        targetSlugs = ownedDocs.map((d) => d.slug);
      }

      if (targetSlugs.length === 0) {
        return reply.status(200).send({ nodes: [], edges: [] });
      }

      // Fetch accessible documents
      const docRows = await db
        .select({
          id: documents.id,
          slug: documents.slug,
          state: documents.state,
          ownerId: documents.ownerId,
          isAnonymous: documents.isAnonymous,
          compressedData: documents.compressedData,
        })
        .from(documents)
        .where(inArray(documents.slug, targetSlugs));

      const accessibleDocs = docRows.filter((d) => canUserReadDoc(d, userId));
      const accessibleIds = new Set(accessibleDocs.map((d) => d.id));

      // Build nodes with title (from first heading in content)
      const nodes: Array<{ slug: string; title: string; state: string }> = [];
      for (const doc of accessibleDocs) {
        let title = doc.slug;
        if (doc.compressedData) {
          try {
            const buf =
              doc.compressedData instanceof Buffer
                ? doc.compressedData
                : Buffer.from(doc.compressedData as ArrayBuffer);
            const content = await decompress(buf);
            const m = content.match(/^#{1,3}\s+(.+)/m);
            if (m) title = m[1].trim();
          } catch {
            // use slug as title if decompress fails
          }
        }
        nodes.push({ slug: doc.slug, title, state: doc.state });
      }

      // Fetch edges between accessible documents
      const accessibleIdArray = Array.from(accessibleIds);
      const edges: Array<{ source: string; target: string; type: string; label: string | null }> = [];

      if (accessibleIdArray.length > 0) {
        const linkRows = await db
          .select({
            sourceDocId: documentLinks.sourceDocId,
            targetDocId: documentLinks.targetDocId,
            linkType: documentLinks.linkType,
            label: documentLinks.label,
          })
          .from(documentLinks)
          .where(
            and(
              inArray(documentLinks.sourceDocId, accessibleIdArray),
              inArray(documentLinks.targetDocId, accessibleIdArray)
            )
          );

        // Build id→slug map for edge labels
        const idToSlug = new Map(accessibleDocs.map((d) => [d.id, d.slug]));

        for (const row of linkRows) {
          const source = idToSlug.get(String(row.sourceDocId));
          const target = idToSlug.get(String(row.targetDocId));
          if (source && target) {
            edges.push({
              source,
              target,
              type: String(row.linkType),
              label: row.label != null ? String(row.label) : null,
            });
          }
        }
      }

      return reply.status(200).send({ nodes, edges });
    }
  );

}
