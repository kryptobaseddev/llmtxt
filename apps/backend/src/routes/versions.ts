/**
 * Version management routes: PUT /documents/:slug (update + create version),
 * GET /documents/:slug/versions, GET /documents/:slug/versions/:num,
 * GET /documents/:slug/diff?from=N&to=M.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { documents, versions, contributors } from '../db/schema.js';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import {
  compress,
  decompress,
  generateId,
  hashContent,
  calculateTokens,
  calculateCompressionRatio,
  structuredDiff,
} from '../utils/compression.js';
import { createPatch, multiWayDiff } from 'llmtxt';
import { invalidateDocumentCache } from '../middleware/cache.js';
import { auth } from '../auth.js';

/** Try to get the authenticated user from session cookies. */
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

const slugParamsSchema = z.object({
  slug: z.string().min(1).max(20),
});

const versionParamsSchema = z.object({
  slug: z.string().min(1).max(20),
  num: z.coerce.number().int().positive(),
});

const diffQuerySchema = z.object({
  from: z.coerce.number().int().positive(),
  to: z.coerce.number().int().positive(),
});

const multiDiffQuerySchema = z.object({
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
      if (nums.length > 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Maximum 5 version numbers allowed',
        });
        return z.NEVER;
      }
      return nums;
    }),
});

const updateBodySchema = z.object({
  content: z.string().min(1).max(5 * 1024 * 1024),
  changelog: z.string().max(500).optional(),
  createdBy: z.string().max(100).optional(),
  agentId: z.string().max(100).optional(),
});

/** Register version management routes: document update, version listing, version retrieval, and pairwise diff computation. */
export async function versionRoutes(fastify: FastifyInstance) {
  /**
   * PUT /api/documents/:slug - Update document content (creates a new version)
   */
  fastify.put('/documents/:slug', async (
    request: FastifyRequest<{ Params: { slug: string }; Body: { content: string; changelog?: string; createdBy?: string; agentId?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug', details: paramsResult.error.errors });
      }
      const { slug } = paramsResult.data;

      const bodyResult = updateBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: bodyResult.error.errors });
      }
      const { content, changelog, createdBy, agentId } = bodyResult.data;

      // Resolve effective author: explicit createdBy wins, then agentId alias,
      // then session user (resolved below after getOptionalUser).
      // We store the pre-session value here; session fallback is applied later.
      const callerSuppliedId = createdBy || agentId || null;

      // Find the existing document
      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Compress and hash the new content outside the transaction — these are
      // pure CPU/memory operations and do not touch the DB.
      const compressedData = await compress(content);
      const contentHash = hashContent(content);
      const tokenCount = calculateTokens(content);
      const originalSize = Buffer.byteLength(content, 'utf-8');
      const compressedSize = compressedData.length;
      const now = Date.now();

      // Resolve session user for fallback attribution outside the transaction so
      // we don't hold the write lock during a network call.
      const user = await getOptionalUser(request);
      const effectiveCreatedBy = callerSuppliedId || user?.id || null;

      // Pre-compute diff stats for the contributor upsert.  We do this outside
      // the transaction for the same reason — decompress is CPU-bound but we
      // want to avoid any latency inside the critical section.
      let tokensAdded = 0;
      let tokensRemoved = 0;
      if (effectiveCreatedBy) {
        const oldBuffer = doc.compressedData instanceof Buffer
          ? doc.compressedData
          : Buffer.from(doc.compressedData as ArrayBuffer);
        const oldContent = await decompress(oldBuffer);
        const diff = structuredDiff(oldContent, content);
        tokensAdded = diff.addedTokens;
        tokensRemoved = diff.removedTokens;
      }

      // Helper that performs the atomic version creation inside a transaction.
      // Uses IMMEDIATE mode so SQLite acquires the write lock at BEGIN time,
      // preventing two concurrent readers from both seeing the same MAX and
      // then racing on the INSERT.
      // better-sqlite3 is a synchronous driver — transaction callbacks MUST be
      // synchronous.  Passing an async callback causes better-sqlite3 to throw
      // "Transaction function cannot return a promise", which is the root cause
      // of the HTTP 500.  All Drizzle ORM calls inside a better-sqlite3
      // transaction are synchronous; await is not needed (and must not be used).
      const runVersionInsert = (overrideVersionNumber?: number): number =>
        db.transaction((tx) => {
          // Read the current max version number inside the transaction so the
          // read and write are atomic.
          const [latestVersion] = tx
            .select({ versionNumber: versions.versionNumber })
            .from(versions)
            .where(eq(versions.documentId, doc.id))
            .orderBy(desc(versions.versionNumber))
            .limit(1)
            .all();

          const nextVersionNumber =
            overrideVersionNumber ?? (latestVersion ? latestVersion.versionNumber + 1 : 2);

          // If this is the first update, snapshot the current content as version 1.
          if (!latestVersion) {
            tx.insert(versions).values({
              id: generateId(),
              documentId: doc.id,
              versionNumber: 1,
              compressedData: doc.compressedData,
              contentHash: doc.contentHash,
              tokenCount: doc.tokenCount,
              createdAt: doc.createdAt,
              changelog: 'Initial version',
            }).run();
          }

          // Insert the new version row.
          tx.insert(versions).values({
            id: generateId(),
            documentId: doc.id,
            versionNumber: nextVersionNumber,
            compressedData,
            contentHash,
            tokenCount,
            createdAt: now,
            createdBy: effectiveCreatedBy,
            changelog: changelog || null,
          }).run();

          // Update the document head.
          tx
            .update(documents)
            .set({
              compressedData,
              contentHash,
              originalSize,
              compressedSize,
              tokenCount,
              currentVersion: nextVersionNumber,
            })
            .where(eq(documents.id, doc.id))
            .run();

          // Upsert contributor record inside the same transaction so it is
          // also rolled back if anything above fails.
          if (effectiveCreatedBy) {
            const [existing] = tx
              .select()
              .from(contributors)
              .where(and(
                eq(contributors.documentId, doc.id),
                eq(contributors.agentId, effectiveCreatedBy),
              ))
              .all();

            if (existing) {
              tx.update(contributors)
                .set({
                  versionsAuthored: existing.versionsAuthored + 1,
                  totalTokensAdded: existing.totalTokensAdded + tokensAdded,
                  totalTokensRemoved: existing.totalTokensRemoved + tokensRemoved,
                  netTokens: existing.netTokens + tokensAdded - tokensRemoved,
                  lastContribution: now,
                })
                .where(eq(contributors.id, existing.id))
                .run();
            } else {
              tx.insert(contributors).values({
                id: generateId(),
                documentId: doc.id,
                agentId: effectiveCreatedBy,
                versionsAuthored: 1,
                totalTokensAdded: tokensAdded,
                totalTokensRemoved: tokensRemoved,
                netTokens: tokensAdded - tokensRemoved,
                firstContribution: now,
                lastContribution: now,
              }).run();
            }
          }

          return nextVersionNumber;
        }, { behavior: 'immediate' });

      // Attempt the transaction.  If a concurrent request wins the race and
      // inserts the same version number first, SQLite throws a UNIQUE constraint
      // error.  Retry once: the second attempt reads the updated MAX inside its
      // own transaction so it will naturally land on MAX+1.
      let nextVersionNumber: number;
      try {
        nextVersionNumber = runVersionInsert();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UNIQUE constraint failed')) {
          nextVersionNumber = runVersionInsert();
        } else {
          throw err;
        }
      }

      // Invalidate cache for this document
      invalidateDocumentCache(slug);

      return reply.status(200).send({
        slug,
        versionNumber: nextVersionNumber,
        contentHash,
        tokenCount,
        compressionRatio: calculateCompressionRatio(originalSize, compressedSize),
        originalSize,
        compressedSize,
        createdAt: now,
        changelog: changelog || null,
        createdBy: effectiveCreatedBy,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/documents/:slug/versions - List all versions of a document
   */
  fastify.get('/documents/:slug/versions', async (
    request: FastifyRequest<{ Params: { slug: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const versionList = await db
        .select({
          versionNumber: versions.versionNumber,
          contentHash: versions.contentHash,
          tokenCount: versions.tokenCount,
          createdAt: versions.createdAt,
          createdBy: versions.createdBy,
          changelog: versions.changelog,
        })
        .from(versions)
        .where(eq(versions.documentId, doc.id))
        .orderBy(desc(versions.versionNumber));

      return reply.send({
        slug,
        totalVersions: versionList.length,
        versions: versionList,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/documents/:slug/versions/:num - Get a specific version's content
   */
  fastify.get('/documents/:slug/versions/:num', async (
    request: FastifyRequest<{ Params: { slug: string; num: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const paramsResult = versionParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid parameters' });
      }
      const { slug, num } = paramsResult.data;

      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      const [version] = await db
        .select()
        .from(versions)
        .where(and(
          eq(versions.documentId, doc.id),
          eq(versions.versionNumber, num),
        ));

      if (!version) {
        return reply.status(404).send({ error: `Version ${num} not found` });
      }

      const compressedBuffer = version.compressedData instanceof Buffer
        ? version.compressedData
        : Buffer.from(version.compressedData as ArrayBuffer);
      const content = await decompress(compressedBuffer);

      return reply.send({
        slug,
        versionNumber: version.versionNumber,
        content,
        contentHash: version.contentHash,
        tokenCount: version.tokenCount,
        createdAt: version.createdAt,
        createdBy: version.createdBy,
        changelog: version.changelog,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/documents/:slug/diff?from=1&to=2 - Compute diff between two versions
   */
  fastify.get('/documents/:slug/diff', async (
    request: FastifyRequest<{ Params: { slug: string }; Querystring: { from: string; to: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      const queryResult = diffQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: 'Required: ?from=<number>&to=<number>',
        });
      }
      const { from, to } = queryResult.data;

      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Fetch both versions
      const [fromVersion] = await db
        .select()
        .from(versions)
        .where(and(eq(versions.documentId, doc.id), eq(versions.versionNumber, from)));

      const [toVersion] = await db
        .select()
        .from(versions)
        .where(and(eq(versions.documentId, doc.id), eq(versions.versionNumber, to)));

      if (!fromVersion) {
        return reply.status(404).send({ error: `Version ${from} not found` });
      }
      if (!toVersion) {
        return reply.status(404).send({ error: `Version ${to} not found` });
      }

      // Decompress both
      const fromBuffer = fromVersion.compressedData instanceof Buffer
        ? fromVersion.compressedData
        : Buffer.from(fromVersion.compressedData as ArrayBuffer);
      const toBuffer = toVersion.compressedData instanceof Buffer
        ? toVersion.compressedData
        : Buffer.from(toVersion.compressedData as ArrayBuffer);

      const fromContent = await decompress(fromBuffer);
      const toContent = await decompress(toBuffer);

      // Use the portable Rust structured diff primitive
      const diff = structuredDiff(fromContent, toContent);
      const patchText = createPatch(fromContent, toContent);

      return reply.send({
        documentId: doc.id,
        slug,
        fromVersion: from,
        toVersion: to,
        lines: diff.lines,
        addedLineCount: diff.addedLineCount,
        removedLineCount: diff.removedLineCount,
        addedTokens: diff.addedTokens,
        removedTokens: diff.removedTokens,
        patchText,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/documents/:slug/multi-diff?versions=2,3,4 - Multi-way diff across up to 5 versions
   *
   * Returns per-line consensus data showing where all requested versions agree
   * and where they diverge. The lowest version number in the list is used as the base.
   * No authentication required — works for anonymous sessions.
   */
  fastify.get('/documents/:slug/multi-diff', async (
    request: FastifyRequest<{ Params: { slug: string }; Querystring: { versions: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const paramsResult = slugParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      const queryResult = multiDiffQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: queryResult.error.errors.map(e => e.message),
        });
      }
      const requestedVersions = queryResult.data.versions;

      // Look up document
      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, slug));

      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' });
      }

      // Fetch all requested version rows in one query, then verify each exists
      const versionRows = await db
        .select()
        .from(versions)
        .where(and(
          eq(versions.documentId, doc.id),
          inArray(versions.versionNumber, requestedVersions),
        ));

      // Check that every requested version was found
      for (const num of requestedVersions) {
        if (!versionRows.find(r => r.versionNumber === num)) {
          return reply.status(404).send({ error: `Version ${num} not found` });
        }
      }

      // Decompress each version's content, ordered by version number
      const sorted = [...requestedVersions].sort((a, b) => a - b);
      const baseVersionNumber = sorted[0];

      const contentByVersion = new Map<number, string>();
      for (const num of sorted) {
        const row = versionRows.find(r => r.versionNumber === num)!;
        const buf = row.compressedData instanceof Buffer
          ? row.compressedData
          : Buffer.from(row.compressedData as ArrayBuffer);
        contentByVersion.set(num, await decompress(buf));
      }

      const baseContent = contentByVersion.get(baseVersionNumber)!;
      const otherVersionNumbers = sorted.slice(1);
      const otherContents = otherVersionNumbers.map(n => contentByVersion.get(n)!);

      // Call the WASM multi-way diff function
      const diffResult = multiWayDiff(baseContent, JSON.stringify(otherContents));

      return reply.send({
        slug,
        versions: sorted,
        baseVersion: baseVersionNumber,
        versionCount: sorted.length,
        lines: diffResult.lines,
        stats: diffResult.stats,
      });
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/documents/:slug/batch-versions
   * Get content for multiple selected versions in one call.
   * Body: { versions: number[] } (max 10)
   * Returns array of { versionNumber, content, contentHash, tokenCount }
   */
  fastify.post('/documents/:slug/batch-versions', async (
    request: FastifyRequest<{
      Params: { slug: string };
      Body: { versions: number[] };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { slug } = request.params;
      const { versions: requestedVersions } = request.body;

      if (!Array.isArray(requestedVersions) || requestedVersions.length === 0) {
        return reply.status(400).send({ error: 'versions array required' });
      }
      if (requestedVersions.length > 10) {
        return reply.status(400).send({ error: 'Maximum 10 versions per request' });
      }

      const [doc] = await db.select().from(documents).where(eq(documents.slug, slug));
      if (!doc) return reply.status(404).send({ error: 'Document not found' });

      const versionRows = await db.select()
        .from(versions)
        .where(eq(versions.documentId, doc.id))
        .orderBy(versions.versionNumber);

      const results = [];
      for (const num of requestedVersions) {
        const ver = versionRows.find(v => v.versionNumber === num);
        if (!ver) continue;

        const buffer = ver.compressedData instanceof Buffer
          ? ver.compressedData
          : Buffer.from(ver.compressedData as ArrayBuffer);
        const content = await decompress(buffer);

        results.push({
          versionNumber: ver.versionNumber,
          content,
          contentHash: ver.contentHash,
          tokenCount: ver.tokenCount,
          createdAt: ver.createdAt,
          createdBy: ver.createdBy,
          changelog: ver.changelog,
        });
      }

      return { slug, versions: results };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
