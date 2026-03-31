/**
 * Retrieval planning route: token-budget-aware section selection.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { planRetrieval } from 'llmtxt/sdk';
import { generateOverview } from 'llmtxt/disclosure';
import { decompress } from 'llmtxt';

/** Register retrieval planning route: POST /documents/:slug/plan-retrieval for token-budget-aware section selection. Ranks sections by relevance and greedily packs within a token budget. */
export async function retrievalRoutes(fastify: FastifyInstance) {
  // POST /documents/:slug/plan-retrieval
  fastify.post<{
    Params: { slug: string };
    Body: {
      tokenBudget: number;
      query?: string;
      minScore?: number;
      includeIntro?: boolean;
    };
  }>(
    '/documents/:slug/plan-retrieval',
    async (request, reply) => {
      const { slug } = request.params;
      const { tokenBudget, query, minScore, includeIntro } = request.body;

      if (!tokenBudget || tokenBudget < 1) {
        return reply.status(400).send({ error: 'tokenBudget must be a positive integer' });
      }

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const content = doc[0].compressedData
        ? await decompress(Buffer.from(doc[0].compressedData as ArrayBuffer))
        : '';

      const overview = generateOverview(content);
      const plan = planRetrieval(overview, tokenBudget, query, { minScore, includeIntro });

      return { slug, plan };
    },
  );
}
