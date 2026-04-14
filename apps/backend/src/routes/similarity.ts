/**
 * Similarity route: find similar sections within a document.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { generateOverview } from 'llmtxt/disclosure';
import { rankBySimilarity } from 'llmtxt/similarity';
import { decompress } from 'llmtxt';
import { canRead } from '../middleware/rbac.js';

/** Register similarity route: GET /documents/:slug/similar?q=query&method=ngram&threshold=0 to rank document sections by similarity to a query. */
export async function similarityRoutes(fastify: FastifyInstance) {
  // GET /documents/:slug/similar?q=searchterm
  fastify.get<{
    Params: { slug: string };
    Querystring: { q: string; method?: string; threshold?: string };
  }>(
    '/documents/:slug/similar',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;
      const { q, method = 'ngram', threshold = '0' } = request.query;

      if (!q) return reply.status(400).send({ error: 'Missing q parameter' });

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const content = doc[0].compressedData
        ? await decompress(Buffer.from(doc[0].compressedData as ArrayBuffer))
        : '';

      const overview = generateOverview(content);
      const lines = content.split('\n');

      // Extract section content as candidates
      const candidates = overview.sections.map(s =>
        lines.slice(s.startLine - 1, s.endLine).join('\n'),
      );

      const ranked = rankBySimilarity(q, candidates, {
        method: method === 'shingle' ? 'shingle' : 'ngram',
        threshold: parseFloat(threshold),
      });

      return {
        slug,
        query: q,
        resultCount: ranked.length,
        results: ranked.map(r => ({
          title: overview.sections[r.index]?.title ?? '',
          sectionIndex: r.index,
          startLine: overview.sections[r.index]?.startLine ?? 0,
          endLine: overview.sections[r.index]?.endLine ?? 0,
          tokenCount: overview.sections[r.index]?.tokenCount ?? 0,
          score: r.score,
        })),
      };
    },
  );
}
