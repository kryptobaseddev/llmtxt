/**
 * Knowledge graph route: extract @mentions, #tags, /directives from content.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import {
  buildGraph, topTopics, topAgents,
  extractMentions, extractTags, extractDirectives,
} from 'llmtxt/graph';
import { decompress } from 'llmtxt';

/** Register knowledge graph route: GET /documents/:slug/graph to extract @mentions, #tags, and /directives from document content. */
export async function graphRoutes(fastify: FastifyInstance) {
  // GET /documents/:slug/graph
  fastify.get<{
    Params: { slug: string };
    Querystring: { topicLimit?: string; agentLimit?: string };
  }>(
    '/documents/:slug/graph',
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

      return {
        slug,
        graph,
        topTopics: topTopics(graph, topicLimit),
        topAgents: topAgents(graph, agentLimit),
      };
    },
  );
}
