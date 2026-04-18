/**
 * Knowledge graph route: extract @mentions, #tags, /directives from content.
 * Also returns cross-document links (outgoing and incoming) for the document.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, documentLinks } from '../db/schema.js';
import {
  buildGraph, topTopics, topAgents,
  extractMentions, extractTags, extractDirectives,
} from 'llmtxt/graph';
import { decompress } from 'llmtxt';
import { canRead } from '../middleware/rbac.js';

/**
 * O-01: Maximum number of nodes allowed in an expanded knowledge graph.
 * Requests that would produce a larger graph return HTTP 413. [T108.3]
 */
export const MAX_GRAPH_NODES = 500;

/** Register knowledge graph route: GET /documents/:slug/graph to extract @mentions, #tags, /directives from document content, and cross-document links. */
export async function graphRoutes(fastify: FastifyInstance) {
  // GET /documents/:slug/graph
  fastify.get<{
    Params: { slug: string };
    Querystring: { topicLimit?: string; agentLimit?: string };
  }>(
    '/documents/:slug/graph',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;
      const topicLimit = parseInt(request.query.topicLimit || '10', 10);
      const agentLimit = parseInt(request.query.agentLimit || '10', 10);

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const content = doc[0].compressedData
        ? await decompress(Buffer.from(doc[0].compressedData as ArrayBuffer))
        : '';

      // Build a single-message graph from the document content
      const messages = [{
        id: doc[0].id,
        fromAgentId: doc[0].ownerId || 'unknown',
        content,
        metadata: {
          mentions: extractMentions(content),
          tags: extractTags(content),
          directives: extractDirectives(content),
        },
        createdAt: new Date(doc[0].createdAt).toISOString(),
      }];

      const graph = buildGraph(messages);

      // O-01: Guard against runaway graph expansion. [T108.3]
      const nodeCount = graph.nodes?.length ?? 0;
      if (nodeCount > MAX_GRAPH_NODES) {
        return reply.status(413).send({
          error: 'Graph Too Large',
          message: `Graph expansion produced ${nodeCount} nodes, exceeding the ${MAX_GRAPH_NODES}-node limit. Reduce document complexity or use targeted extraction endpoints.`,
          limit: MAX_GRAPH_NODES,
          actual: nodeCount,
        });
      }

      // Fetch cross-document links (outgoing: this → others)
      const outgoingLinkRows = await db
        .select({
          linkId: documentLinks.id,
          targetDocId: documentLinks.targetDocId,
          linkType: documentLinks.linkType,
          label: documentLinks.label,
        })
        .from(documentLinks)
        .where(eq(documentLinks.sourceDocId, doc[0].id));

      // Fetch cross-document links (incoming: others → this)
      const incomingLinkRows = await db
        .select({
          linkId: documentLinks.id,
          sourceDocId: documentLinks.sourceDocId,
          linkType: documentLinks.linkType,
          label: documentLinks.label,
        })
        .from(documentLinks)
        .where(eq(documentLinks.targetDocId, doc[0].id));

      // Resolve target slugs for outgoing links
      const outgoing: Array<{ slug: string; linkType: string; label: string | null }> = [];
      for (const row of outgoingLinkRows) {
        const [target] = await db
          .select({ slug: documents.slug })
          .from(documents)
          .where(eq(documents.id, row.targetDocId));
        if (!target) continue;
        outgoing.push({ slug: target.slug, linkType: row.linkType, label: row.label ?? null });
      }

      // Resolve source slugs for incoming links
      const incoming: Array<{ slug: string; linkType: string; label: string | null }> = [];
      for (const row of incomingLinkRows) {
        const [source] = await db
          .select({ slug: documents.slug })
          .from(documents)
          .where(eq(documents.id, row.sourceDocId));
        if (!source) continue;
        incoming.push({ slug: source.slug, linkType: row.linkType, label: row.label ?? null });
      }

      return {
        slug,
        graph,
        topTopics: topTopics(graph, topicLimit),
        topAgents: topAgents(graph, agentLimit),
        documentLinks: {
          outgoing,
          incoming,
        },
      };
    },
  );
}
