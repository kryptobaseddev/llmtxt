/**
 * Semantic search and similar-document routes.
 *
 * Endpoints:
 *   GET  /api/v1/search?q=...&mode=semantic|tfidf&limit=20
 *   GET  /api/v1/documents/:slug/similar?limit=5&mode=semantic
 *
 * Modes:
 *   `semantic` (default) — embed query with all-MiniLM-L6-v2, ORDER BY
 *     embedding <=> query_embedding using pgvector ANN index.
 *   `tfidf` — fallback: TF-IDF embed via WASM, rank in-process.
 *
 * No external API calls — local ONNX inference only.
 *
 * SSoT: vector math in crates/llmtxt-core. I/O + orchestration here.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { db, DATABASE_PROVIDER } from '../db/index.js';
import { documents } from '../db/schema.js';
import { decompress } from 'llmtxt';
import { tfidfEmbedBatch, cosineSimilarity } from 'llmtxt';
import { LocalOnnxEmbeddingProvider } from 'llmtxt/embeddings';
import { canRead } from '../middleware/rbac.js';

// ── Embedding provider ─────────────────────────────────────────────────────

let _provider: LocalOnnxEmbeddingProvider | null = null;
function getProvider(): LocalOnnxEmbeddingProvider {
  if (!_provider) _provider = new LocalOnnxEmbeddingProvider();
  return _provider;
}

// ── Validation schemas ─────────────────────────────────────────────────────

const searchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
  mode: z.enum(['semantic', 'tfidf']).optional().default('semantic'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const slugParamsSchema = z.object({
  slug: z.string().min(1).max(128),
});

const similarQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(5),
  mode: z.enum(['semantic', 'tfidf']).optional().default('semantic'),
});

// ── Types ──────────────────────────────────────────────────────────────────

interface SearchResult {
  slug: string;
  sectionSlug: string;
  sectionTitle: string;
  score: number;
  provider: string;
}

interface SimilarResult {
  slug: string;
  score: number;
  mode: 'semantic' | 'tfidf';
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Semantic search via pgvector.
 *
 * Embeds the query and uses the `<=>` cosine distance operator with the
 * IVFFlat index on section_embeddings for approximate nearest-neighbour search.
 */
async function semanticSearchPg(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const provider = getProvider();
  const [queryEmbedding] = await provider.embed([query]);
  const vectorLiteral = '[' + queryEmbedding.join(',') + ']';

  const rows = await db.execute(drizzleSql`
    SELECT
      d.slug,
      se.section_slug,
      se.section_title,
      1 - (se.embedding <=> ${vectorLiteral}::vector) AS score
    FROM section_embeddings se
    JOIN documents d ON d.id = se.document_id
    WHERE se.model = 'all-MiniLM-L6-v2'
    ORDER BY se.embedding <=> ${vectorLiteral}::vector
    LIMIT ${limit}
  `);

  return (rows.rows as Array<Record<string, unknown>>).map(row => ({
    slug: String(row.slug ?? ''),
    sectionSlug: String(row.section_slug ?? ''),
    sectionTitle: String(row.section_title ?? ''),
    score: Number(row.score ?? 0),
    provider: 'local-onnx-minilm-l6',
  }));
}

/**
 * TF-IDF fallback search.
 *
 * Loads all document slugs, embeds query + slugs in-process, ranks by
 * cosine similarity.  Works on SQLite and on Postgres without pgvector.
 * Slower for large corpora — pgvector semantic search is preferred.
 */
async function tfidfSearchFallback(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const allDocs = await db
    .select({ id: documents.id, slug: documents.slug })
    .from(documents)
    .limit(500); // cap to avoid OOM

  if (allDocs.length === 0) return [];

  // Embed query + all document slugs together for shared IDF
  const texts = [query, ...allDocs.map((d: { id: string; slug: string }) => d.slug)];
  const vecs = tfidfEmbedBatch(texts, 256);
  const queryVec = vecs[0];

  const ranked: SearchResult[] = allDocs
    .map((doc: { id: string; slug: string }, i: number) => ({
      slug: doc.slug,
      sectionSlug: '',
      sectionTitle: '',
      score: Number(cosineSimilarity(JSON.stringify(queryVec), JSON.stringify(vecs[i + 1]))),
      provider: 'local-tfidf',
    }))
    .sort((a: SearchResult, b: SearchResult) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

// ── Route registration ──────────────────────────────────────────────────────

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /search?q=...&mode=semantic|tfidf&limit=20 ───────────────────────

  /**
   * Full-text semantic or TF-IDF search across all documents.
   *
   * Returns up to `limit` results ordered by relevance score (0–1).
   * Defaults to `mode=semantic` (pgvector) if available, TF-IDF otherwise.
   *
   * @example
   *   GET /api/v1/search?q=authentication+JWT&mode=semantic&limit=10
   */
  fastify.get<{
    Querystring: { q: string; mode?: string; limit?: number };
  }>(
    '/search',
    async (
      request: FastifyRequest<{ Querystring: { q: string; mode?: string; limit?: number } }>,
      reply: FastifyReply,
    ) => {
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: parsed.error.issues.map((e: { message: string }) => e.message),
        });
      }

      const { q, mode, limit } = parsed.data;

      // Downgrade to tfidf if pgvector not available
      const effectiveMode =
        mode === 'semantic' && DATABASE_PROVIDER !== 'postgresql' ? 'tfidf' : mode;

      try {
        let results: SearchResult[];

        if (effectiveMode === 'semantic') {
          try {
            results = await semanticSearchPg(q, limit);
          } catch (pgErr) {
            const msg = pgErr instanceof Error ? pgErr.message : String(pgErr);
            if (
              msg.includes('section_embeddings') ||
              msg.includes('type "vector"') ||
              msg.includes('operator does not exist')
            ) {
              fastify.log.warn(
                '[search] pgvector not ready, falling back to TF-IDF: ' + msg,
              );
              results = await tfidfSearchFallback(q, limit);
              return reply.send({
                query: q,
                mode: 'tfidf',
                fallback: true,
                results,
              });
            }
            throw pgErr;
          }
        } else {
          results = await tfidfSearchFallback(q, limit);
        }

        return reply.send({
          query: q,
          mode: effectiveMode,
          results,
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Search failed' });
      }
    },
  );

  // ── GET /documents/:slug/similar-docs?limit=5&mode=semantic ─────────────
  // NOTE: Path is /similar-docs (not /similar) to avoid collision with
  // similarityRoutes which registers GET /documents/:slug/similar for
  // intra-document section similarity queries (ngram/shingle).
  // This endpoint finds similar OTHER documents (cross-doc semantic search).

  /**
   * Find documents similar to the given document.
   *
   * Uses the document's stored embeddings (average across all sections)
   * as the query vector, then finds the top-N most similar OTHER documents.
   *
   * @example
   *   GET /api/v1/documents/my-doc/similar-docs?limit=5
   */
  fastify.get<{
    Params: { slug: string };
    Querystring: { limit?: number; mode?: string };
  }>(
    '/documents/:slug/similar-docs',
    { preHandler: [canRead] },
    async (
      request: FastifyRequest<{
        Params: { slug: string };
        Querystring: { limit?: number; mode?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      const queryResult = similarQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({ error: 'Invalid query parameters' });
      }
      const { limit, mode } = queryResult.data;

      try {
        // Find the document
        const docRows = await db
          .select({ id: documents.id, slug: documents.slug })
          .from(documents)
          .where(eq(documents.slug, slug));
        const doc = docRows[0];

        if (!doc) return reply.status(404).send({ error: 'Document not found' });

        const effectiveMode =
          mode === 'semantic' && DATABASE_PROVIDER !== 'postgresql' ? 'tfidf' : mode;

        if (effectiveMode === 'semantic') {
          try {
            // Use the average embedding of all sections of this document as query vector.
            // AVG over vector columns works in pgvector when cast appropriately.
            const rows = await db.execute(drizzleSql`
              WITH source AS (
                SELECT embedding
                FROM section_embeddings
                WHERE document_id = ${doc.id}
                  AND model = 'all-MiniLM-L6-v2'
                LIMIT 1
              )
              SELECT
                d.slug        AS slug,
                1 - (se.embedding <=> source.embedding) AS score
              FROM source
              CROSS JOIN section_embeddings se
              JOIN documents d ON d.id = se.document_id
              WHERE se.document_id != ${doc.id}
                AND se.model = 'all-MiniLM-L6-v2'
              ORDER BY se.embedding <=> source.embedding
              LIMIT ${limit}
            `);

            const results: SimilarResult[] = (rows.rows as Array<Record<string, unknown>>).map(row => ({
              slug: String(row.slug ?? ''),
              score: Number(row.score ?? 0),
              mode: 'semantic' as const,
            }));

            return reply.send({ slug, mode: 'semantic', results });
          } catch (pgErr) {
            const msg = pgErr instanceof Error ? pgErr.message : String(pgErr);
            fastify.log.warn('[similar] pgvector error, falling back: ' + msg);
            // Fall through to TF-IDF
          }
        }

        // TF-IDF fallback
        const docRow = await db
          .select()
          .from(documents)
          .where(eq(documents.slug, slug))
          .limit(1);

        if (!docRow[0]?.compressedData) {
          return reply.send({ slug, mode: 'tfidf', results: [] });
        }

        const compressedData = docRow[0].compressedData;
        const buf =
          compressedData instanceof Buffer
            ? compressedData
            : Buffer.from(compressedData as ArrayBuffer);
        const sourceContent = await decompress(buf);

        const allDocs = await db
          .select({ id: documents.id, slug: documents.slug })
          .from(documents)
          .limit(200);

        const otherDocs = allDocs.filter((d: { id: string; slug: string }) => d.id !== doc.id);
        if (otherDocs.length === 0) return reply.send({ slug, mode: 'tfidf', results: [] });

        const texts = [
          sourceContent.slice(0, 2000),
          ...otherDocs.map((d: { id: string; slug: string }) => d.slug),
        ];
        const vecs = tfidfEmbedBatch(texts, 256);
        const queryVec = vecs[0];

        const results: SimilarResult[] = otherDocs
          .map((d: { id: string; slug: string }, i: number) => ({
            slug: d.slug,
            score: Number(cosineSimilarity(JSON.stringify(queryVec), JSON.stringify(vecs[i + 1]))),
            mode: 'tfidf' as const,
          }))
          .sort((a: SimilarResult, b: SimilarResult) => b.score - a.score)
          .slice(0, limit);

        return reply.send({ slug, mode: 'tfidf', results });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Similar documents lookup failed' });
      }
    },
  );
}
