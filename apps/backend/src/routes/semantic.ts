/**
 * Semantic diff and consensus routes.
 *
 * Endpoints:
 *   POST /api/documents/:slug/semantic-diff
 *   GET  /api/documents/:slug/semantic-similarity?versions=1,2,3
 *   POST /api/documents/:slug/semantic-consensus
 *
 * These routes augment the existing syntactic (LCS) diff with embedding-based
 * semantic comparison. Embeddings are computed on-demand via the configured
 * `EmbeddingProvider` (OpenAI `text-embedding-3-small` when `OPENAI_API_KEY`
 * is set, local TF-IDF otherwise). Results are NOT cached or persisted.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, versions, approvals } from '../db/schema.js';
import { decompress, structuredDiff } from '../utils/compression.js';
import { generateOverview } from 'llmtxt';
import { createEmbeddingProvider } from '../utils/embeddings.js';
import { canRead } from '../middleware/rbac.js';

// Import WASM-compiled Rust primitives from the llmtxt npm package.
// `semantic_diff` and `semantic_consensus` accept pre-computed embeddings so
// they never call external APIs — all I/O happens here in TypeScript.
// `cosineSimilarity` is the Rust SSoT for vector math (replaces the inline TS impl).
import {
  semanticDiff as rustSemanticDiff,
  semanticConsensus as rustSemanticConsensus,
  cosineSimilarity as rustCosineSimilarity,
} from 'llmtxt';
// eslint-disable-next-line @typescript-eslint/no-explicit-any

// ── Validation schemas ────────────────────────────────────────────────────

const slugParamsSchema = z.object({
  slug: z.string().min(1).max(20),
});

const semanticDiffBodySchema = z.object({
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
});

const semanticSimilarityQuerySchema = z.object({
  versions: z
    .string()
    .min(1)
    .transform((val, ctx) => {
      const parts = val.split(',');
      const nums: number[] = [];
      for (const part of parts) {
        const n = Number(part.trim());
        if (!Number.isInteger(n) || n <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `'${part.trim()}' is not a positive integer`,
          });
          return z.NEVER;
        }
        nums.push(n);
      }
      if (nums.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'At least 2 version numbers are required',
        });
        return z.NEVER;
      }
      if (nums.length > 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Maximum 10 version numbers allowed',
        });
        return z.NEVER;
      }
      return nums;
    }),
});

const semanticConsensusBodySchema = z.object({
  /** Cosine similarity threshold for clustering reviews (default 0.80). */
  threshold: z.number().min(0).max(1).optional().default(0.8),
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** Decompress a version blob to UTF-8 string. */
async function decompressVersion(
  compressedData: unknown,
): Promise<string> {
  const buf =
    compressedData instanceof Buffer
      ? compressedData
      : Buffer.from(compressedData as ArrayBuffer);
  return decompress(buf);
}

/** Fetch and decompress a specific document version. */
async function getVersionContent(
  documentId: string,
  versionNumber: number,
): Promise<string | null> {
  const [ver] = await db
    .select()
    .from(versions)
    .where(
      and(
        eq(versions.documentId, documentId),
        eq(versions.versionNumber, versionNumber),
      ),
    );
  if (!ver) return null;
  return decompressVersion(ver.compressedData);
}

/**
 * Embed sections using the configured provider.
 *
 * Uses the SDK `generateOverview` section parser (the SSoT for section
 * splitting — fixes audit item #9).  Section content is reconstructed from
 * the line ranges returned by `generateOverview`.
 *
 * @returns Array of `{ title, content, embedding }` objects ready for the
 *   Rust semantic diff / consensus primitives.
 */
async function embedSections(
  content: string,
  provider: Awaited<ReturnType<typeof createEmbeddingProvider>>,
): Promise<Array<{ title: string; content: string; embedding: number[] }>> {
  const overview = generateOverview(content);

  if (overview.sections.length === 0) {
    // Treat the entire content as one unnamed section.
    const [embedding] = await provider.embed([content]);
    return [{ title: 'Document', content, embedding: embedding ?? [] }];
  }

  const lines = content.split('\n');

  const sections = overview.sections.map(s => ({
    title: s.title,
    // Reconstruct content from the line range (1-based → 0-based).
    content: lines.slice(s.startLine - 1, s.endLine).join('\n'),
  }));

  const texts = sections.map(s => s.content);
  const embeddings = await provider.embed(texts);

  return sections.map((s, i) => ({
    title: s.title,
    content: s.content,
    embedding: embeddings[i] ?? [],
  }));
}

// ── Route registration ────────────────────────────────────────────────────

/** Register semantic diff and consensus routes. */
export async function semanticRoutes(fastify: FastifyInstance) {
  // Lazily create the embedding provider once per process.
  const provider = createEmbeddingProvider();

  fastify.log.info(
    `Semantic routes: using embedding provider "${provider.model}" (${provider.dimensions}d)`,
  );

  // ── POST /api/documents/:slug/semantic-diff ───────────────────────────

  /**
   * Compute semantic diff between two versions of a document.
   *
   * Returns both the syntactic (LCS) diff and a semantic (embedding-based)
   * section-by-section comparison. Useful for detecting when two agents have
   * expressed the same architecture in different words.
   */
  fastify.post<{
    Params: { slug: string };
    Body: { fromVersion: number; toVersion: number };
  }>(
    '/documents/:slug/semantic-diff',
    { preHandler: [canRead] },
    async (
      request: FastifyRequest<{
        Params: { slug: string };
        Body: { fromVersion: number; toVersion: number };
      }>,
      reply: FastifyReply,
    ) => {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      const bodyResult = semanticDiffBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues,
        });
      }
      const { fromVersion, toVersion } = bodyResult.data;

      try {
        const [doc] = await db
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.slug, slug));

        if (!doc) return reply.status(404).send({ error: 'Document not found' });

        const [fromContent, toContent] = await Promise.all([
          getVersionContent(doc.id, fromVersion),
          getVersionContent(doc.id, toVersion),
        ]);

        if (fromContent === null) {
          return reply.status(404).send({ error: `Version ${fromVersion} not found` });
        }
        if (toContent === null) {
          return reply.status(404).send({ error: `Version ${toVersion} not found` });
        }

        // Compute syntactic diff (existing LCS-based).
        const syntacticDiff = structuredDiff(fromContent, toContent);

        // Embed sections from each version in parallel.
        const [sectionsA, sectionsB] = await Promise.all([
          embedSections(fromContent, provider),
          embedSections(toContent, provider),
        ]);

        // Run semantic diff via the Rust WASM primitive.
        const semanticResult = rustSemanticDiff(
          JSON.stringify(sectionsA),
          JSON.stringify(sectionsB),
        );

        return reply.send({
          slug,
          fromVersion,
          toVersion,
          embeddingModel: provider.model,
          syntacticDiff: {
            addedLineCount: syntacticDiff.addedLineCount,
            removedLineCount: syntacticDiff.removedLineCount,
            addedTokens: syntacticDiff.addedTokens,
            removedTokens: syntacticDiff.removedTokens,
          },
          semanticDiff: semanticResult,
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // ── GET /api/documents/:slug/semantic-similarity?versions=1,2,3 ──────

  /**
   * Compare multiple document versions semantically.
   *
   * Returns a pairwise cosine similarity matrix across the entire document
   * content (not per-section). Useful for spotting convergence/divergence
   * across a version history at a glance.
   *
   * Query: `?versions=1,2,3` (2–10 version numbers, comma-separated)
   */
  fastify.get<{
    Params: { slug: string };
    Querystring: { versions: string };
  }>(
    '/documents/:slug/semantic-similarity',
    { preHandler: [canRead] },
    async (
      request: FastifyRequest<{
        Params: { slug: string };
        Querystring: { versions: string };
      }>,
      reply: FastifyReply,
    ) => {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      const queryResult = semanticSimilarityQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: queryResult.error.issues.map(e => e.message),
        });
      }
      const requestedVersions = queryResult.data.versions;

      try {
        const [doc] = await db
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.slug, slug));

        if (!doc) return reply.status(404).send({ error: 'Document not found' });

        // Fetch all requested version rows in one query.
        const versionRows = await db
          .select()
          .from(versions)
          .where(
            and(
              eq(versions.documentId, doc.id),
              inArray(versions.versionNumber, requestedVersions),
            ),
          );

        for (const num of requestedVersions) {
          if (!versionRows.find((r: any) => r.versionNumber === num)) {
            return reply.status(404).send({ error: `Version ${num} not found` });
          }
        }

        // Decompress all versions.
        const contentByVersion = new Map<number, string>();
        await Promise.all(
          requestedVersions.map(async num => {
            const row = versionRows.find((r: any) => r.versionNumber === num)!;
            const content = await decompressVersion(row.compressedData);
            contentByVersion.set(num, content);
          }),
        );

        // Embed each version's full content as a single vector.
        const texts = requestedVersions.map(v => contentByVersion.get(v)!);
        const embeddings = await provider.embed(texts);

        // Build pairwise cosine similarity matrix.
        const n = requestedVersions.length;
        const matrix: number[][] = Array.from({ length: n }, () =>
          new Array<number>(n).fill(0),
        );

        for (let i = 0; i < n; i++) {
          matrix[i][i] = 1.0;
          for (let j = i + 1; j < n; j++) {
            const sim = rustCosineSimilarity(
            JSON.stringify(embeddings[i]),
            JSON.stringify(embeddings[j]),
          );
            matrix[i][j] = sim;
            matrix[j][i] = sim;
          }
        }

        // Overall consensus = mean of all off-diagonal similarities.
        const pairCount = (n * (n - 1)) / 2;
        let pairSum = 0;
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            pairSum += matrix[i][j];
          }
        }
        const overallConsensus = pairCount > 0 ? pairSum / pairCount : 1.0;

        return reply.send({
          slug,
          versions: requestedVersions,
          embeddingModel: provider.model,
          matrix,
          overallConsensus: Number(overallConsensus.toFixed(4)),
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  // ── POST /api/documents/:slug/semantic-consensus ──────────────────────

  /**
   * Evaluate semantic consensus across all approved reviews of a document.
   *
   * Reviews are fetched from the approvals table (APPROVED status only),
   * their content is embedded, and the Rust `semantic_consensus` primitive
   * clusters them by cosine similarity.
   *
   * Body: `{ threshold?: number }` (default 0.80)
   */
  fastify.post<{
    Params: { slug: string };
    Body: { threshold?: number };
  }>(
    '/documents/:slug/semantic-consensus',
    { preHandler: [canRead] },
    async (
      request: FastifyRequest<{
        Params: { slug: string };
        Body: { threshold?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      const bodyResult = semanticConsensusBodySchema.safeParse(
        request.body ?? {},
      );
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues,
        });
      }
      const { threshold } = bodyResult.data;

      try {
        const [doc] = await db
          .select()
          .from(documents)
          .where(eq(documents.slug, slug));

        if (!doc) return reply.status(404).send({ error: 'Document not found' });

        // Fetch APPROVED reviews.
        const reviewRows = await db
          .select()
          .from(approvals)
          .where(
            and(
              eq(approvals.documentId, doc.id),
              eq(approvals.status, 'APPROVED'),
            ),
          );

        if (reviewRows.length === 0) {
          return reply.send({
            slug,
            embeddingModel: provider.model,
            reviewCount: 0,
            threshold,
            semanticConsensus: {
              consensus: false,
              agreementScore: 0,
              clusters: [],
              outliers: [],
            },
          });
        }

        // Use the review reason/comment as the text to embed.
        // Fall back to a synthetic label when no comment was provided.
        const texts = reviewRows.map(
          (r: any) => r.reason?.trim() || `Approved by ${r.reviewerId}`,
        );

        const embeddings = await provider.embed(texts);

        // Build the reviews payload for the Rust primitive.
        const embeddedReviews = reviewRows.map((r: any, i: number) => ({
          reviewerId: r.reviewerId,
          content: texts[i],
          embedding: embeddings[i] ?? [],
        }));

        const consensusResult = rustSemanticConsensus(
          JSON.stringify(embeddedReviews),
          threshold,
        );

        return reply.send({
          slug,
          embeddingModel: provider.model,
          reviewCount: reviewRows.length,
          threshold,
          semanticConsensus: consensusResult,
        });
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}

