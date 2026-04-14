/**
 * Conflict resolution routes:
 *
 *   POST /api/documents/:slug/merge-conflict
 *     Auto-merge or pick a resolution strategy when two agents diverged.
 *
 *   POST /api/documents/:slug/resolve-conflict
 *     Submit manually resolved content to create a new version.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../db/index.js';
import { documents, versions, contributors } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import {
  compress,
  decompress,
  generateId,
  hashContent,
  calculateTokens,
  calculateCompressionRatio,
} from '../utils/compression.js';
// @ts-ignore — threeWayMerge is exported once WASM is built
import { threeWayMerge } from 'llmtxt';
import { invalidateDocumentCache } from '../middleware/cache.js';
import { auth } from '../auth.js';

// ── Auth helper ───────────────────────────────────────────────────────────────

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

// ── Shared helpers ────────────────────────────────────────────────────────────

const slugParamsSchema = z.object({
  slug: z.string().min(1).max(20),
});

/** Decompress a version row's compressedData to a string. */
async function decompressRow(row: { compressedData: unknown }): Promise<string> {
  const buf =
    row.compressedData instanceof Buffer
      ? row.compressedData
      : Buffer.from(row.compressedData as ArrayBuffer);
  return decompress(buf);
}

// ── Version persistence helper ────────────────────────────────────────────────

type DocRow = {
  id: string;
  compressedData: unknown;
  contentHash: string;
  tokenCount: number | null;
  createdAt: number;
  currentVersion: number | null;
};

/**
 * Compress `content` then atomically insert a new version row, update the
 * document head, and upsert the contributor record.
 *
 * Uses IMMEDIATE transaction mode so SQLite acquires the write lock at BEGIN
 * time, preventing two concurrent requests from racing on the version number.
 * better-sqlite3 is synchronous — no async/await inside the transaction callback.
 *
 * Returns the new version number and metadata.
 */
async function persistNewVersion(opts: {
  doc: DocRow;
  content: string;
  changelog: string;
  effectiveCreatedBy: string | null;
}): Promise<{
  nextVersionNumber: number;
  contentHash: string;
  tokenCount: number;
  originalSize: number;
  compressedSize: number;
  now: number;
}> {
  const { doc, content, changelog, effectiveCreatedBy } = opts;

  // CPU-bound operations outside the transaction to keep the write lock duration minimal.
  const compressedData = await compress(content);
  const contentHash = hashContent(content);
  const tokenCount = calculateTokens(content);
  const originalSize = Buffer.byteLength(content, 'utf-8');
  const compressedSize = compressedData.length;
  const now = Date.now();

  const runInsert = (): number =>
    db.transaction(
      (tx: any) => {
        const [latestVersion] = tx
          .select({ versionNumber: versions.versionNumber })
          .from(versions)
          .where(eq(versions.documentId, doc.id))
          .orderBy(desc(versions.versionNumber))
          .limit(1)
          .all();

        const nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 2;

        // Snapshot the original content as version 1 if no prior versions exist.
        if (!latestVersion) {
          tx
            .insert(versions)
            .values({
              id: generateId(),
              documentId: doc.id,
              versionNumber: 1,
              compressedData: doc.compressedData,
              contentHash: doc.contentHash,
              tokenCount: doc.tokenCount,
              createdAt: doc.createdAt,
              changelog: 'Initial version',
            })
            .run();
        }

        // Insert the new version row.
        tx
          .insert(versions)
          .values({
            id: generateId(),
            documentId: doc.id,
            versionNumber: nextVersionNumber,
            compressedData,
            contentHash,
            tokenCount,
            createdAt: now,
            createdBy: effectiveCreatedBy,
            changelog,
          })
          .run();

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

        // Upsert contributor record inside the same transaction.
        if (effectiveCreatedBy) {
          const [existing] = tx
            .select()
            .from(contributors)
            .where(
              and(
                eq(contributors.documentId, doc.id),
                eq(contributors.agentId, effectiveCreatedBy),
              ),
            )
            .all();

          if (existing) {
            tx
              .update(contributors)
              .set({
                versionsAuthored: existing.versionsAuthored + 1,
                lastContribution: now,
              })
              .where(eq(contributors.id, existing.id))
              .run();
          } else {
            tx
              .insert(contributors)
              .values({
                id: generateId(),
                documentId: doc.id,
                agentId: effectiveCreatedBy,
                versionsAuthored: 1,
                totalTokensAdded: tokenCount ?? 0,
                totalTokensRemoved: 0,
                netTokens: tokenCount ?? 0,
                firstContribution: now,
                lastContribution: now,
              })
              .run();
          }
        }

        return nextVersionNumber;
      },
      { behavior: 'immediate' },
    );

  // Retry once on UNIQUE constraint collision from a concurrent write.
  let nextVersionNumber: number;
  try {
    nextVersionNumber = runInsert();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE constraint failed')) {
      nextVersionNumber = runInsert();
    } else {
      throw err;
    }
  }

  return { nextVersionNumber, contentHash, tokenCount, originalSize, compressedSize, now };
}

// ── Route schemas ─────────────────────────────────────────────────────────────

const mergeConflictBodySchema = z.object({
  /** The common ancestor version number (the version both agents diverged from). */
  baseVersion: z.number().int().positive(),
  /** Our version number. */
  oursVersion: z.number().int().positive(),
  /** Their version number. Defaults to the document's current version when omitted. */
  theirsVersion: z.number().int().positive().optional(),
  /**
   * Merge resolution strategy.
   * - `"auto"` (default): run 3-way merge; persist only if no conflicts.
   * - `"ours"`: accept our version wholesale.
   * - `"theirs"`: accept their version wholesale.
   */
  resolution: z.enum(['auto', 'ours', 'theirs']).default('auto'),
  /** Human-readable changelog (when a version is created). */
  changelog: z.string().max(500).optional(),
  /** Explicit author identifier. */
  createdBy: z.string().max(100).optional(),
  /** Agent identifier alias for createdBy. */
  agentId: z.string().max(100).optional(),
});

const resolveConflictBodySchema = z.object({
  /** Manually resolved content to store as a new version. */
  content: z.string().min(1).max(5 * 1024 * 1024),
  /** The version that was used as a base when resolving. */
  baseVersion: z.number().int().positive(),
  /** Human-readable changelog entry. */
  changelog: z.string().max(500).optional(),
  /** Explicit author identifier. */
  createdBy: z.string().max(100).optional(),
  /** Agent identifier alias for createdBy. */
  agentId: z.string().max(100).optional(),
});

// ── Route registration ────────────────────────────────────────────────────────

/** Register conflict resolution routes. */
export async function conflictRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/documents/:slug/merge-conflict
   *
   * Resolve a conflict between two diverged versions of a document.
   *
   * When `resolution` is `"auto"` and no conflicts remain, a new version is
   * persisted and returned.  When conflicts are present, the merged content
   * (with `<<<<<<<`/`=======`/`>>>>>>>` markers) is returned without persisting
   * so the caller can resolve manually and POST to `/resolve-conflict`.
   *
   * When `resolution` is `"ours"` or `"theirs"`, the chosen version's content
   * is copied as a new version directly.
   */
  fastify.post(
    '/documents/:slug/merge-conflict',
    async (
      request: FastifyRequest<{
        Params: { slug: string };
        Body: z.infer<typeof mergeConflictBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const paramsResult = slugParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return reply
            .status(400)
            .send({ error: 'Invalid slug', details: paramsResult.error.errors });
        }
        const { slug } = paramsResult.data;

        const bodyResult = mergeConflictBodySchema.safeParse(request.body);
        if (!bodyResult.success) {
          return reply
            .status(400)
            .send({ error: 'Invalid request body', details: bodyResult.error.errors });
        }
        const { baseVersion, oursVersion, theirsVersion, resolution, changelog, createdBy, agentId } =
          bodyResult.data;

        // ── Look up document ────────────────────────────────────────────────
        const [doc] = await db.select().from(documents).where(eq(documents.slug, slug));
        if (!doc) {
          return reply.status(404).send({ error: 'Document not found' });
        }

        if (doc.state === 'LOCKED' || doc.state === 'ARCHIVED') {
          return reply.status(423).send({
            error: 'Locked',
            message: `Document is ${doc.state.toLowerCase()} and cannot be modified.`,
          });
        }

        const effectiveTheirsVersion = theirsVersion ?? doc.currentVersion ?? oursVersion;

        // ── Fetch the three version rows ──────────────────────────────────
        const fetchVersion = async (num: number) => {
          const [row] = await db
            .select()
            .from(versions)
            .where(and(eq(versions.documentId, doc.id), eq(versions.versionNumber, num)));
          return row ?? null;
        };

        const [baseRow, oursRow, theirsRow] = await Promise.all([
          fetchVersion(baseVersion),
          fetchVersion(oursVersion),
          fetchVersion(effectiveTheirsVersion),
        ]);

        if (!baseRow) {
          return reply.status(404).send({ error: `Base version ${baseVersion} not found` });
        }
        if (!oursRow) {
          return reply.status(404).send({ error: `Ours version ${oursVersion} not found` });
        }
        if (!theirsRow) {
          return reply
            .status(404)
            .send({ error: `Theirs version ${effectiveTheirsVersion} not found` });
        }

        // ── Decompress all three ──────────────────────────────────────────
        const [baseContent, oursContent, theirsContent] = await Promise.all([
          decompressRow(baseRow),
          decompressRow(oursRow),
          decompressRow(theirsRow),
        ]);

        // ── Resolve effective author ──────────────────────────────────────
        const callerSuppliedId = createdBy || agentId || null;
        const user = await getOptionalUser(request);
        const effectiveCreatedBy = callerSuppliedId || user?.id || null;

        // ── Apply resolution strategy ─────────────────────────────────────

        if (resolution === 'ours') {
          const effectiveChangelog =
            changelog ?? `Conflict resolved: accepted ours (v${oursVersion})`;
          const result = await persistNewVersion({
            doc,
            content: oursContent,
            changelog: effectiveChangelog,
            effectiveCreatedBy,
          });
          invalidateDocumentCache(slug);
          return reply.status(201).send({
            slug,
            version: result.nextVersionNumber,
            merged: oursContent,
            hasConflicts: false,
            conflicts: [],
            resolution: 'ours',
            contentHash: result.contentHash,
            tokenCount: result.tokenCount,
            compressionRatio: calculateCompressionRatio(result.originalSize, result.compressedSize),
            changelog: effectiveChangelog,
            createdBy: effectiveCreatedBy,
          });
        }

        if (resolution === 'theirs') {
          const effectiveChangelog =
            changelog ?? `Conflict resolved: accepted theirs (v${effectiveTheirsVersion})`;
          const result = await persistNewVersion({
            doc,
            content: theirsContent,
            changelog: effectiveChangelog,
            effectiveCreatedBy,
          });
          invalidateDocumentCache(slug);
          return reply.status(201).send({
            slug,
            version: result.nextVersionNumber,
            merged: theirsContent,
            hasConflicts: false,
            conflicts: [],
            resolution: 'theirs',
            contentHash: result.contentHash,
            tokenCount: result.tokenCount,
            compressionRatio: calculateCompressionRatio(result.originalSize, result.compressedSize),
            changelog: effectiveChangelog,
            createdBy: effectiveCreatedBy,
          });
        }

        // resolution === 'auto': run 3-way merge
        const mergeResult = threeWayMerge(baseContent, oursContent, theirsContent);

        if (!mergeResult.hasConflicts) {
          const effectiveChangelog =
            changelog ??
            `Auto-merged from v${oursVersion} and v${effectiveTheirsVersion} (base: v${baseVersion})`;
          const result = await persistNewVersion({
            doc,
            content: mergeResult.merged,
            changelog: effectiveChangelog,
            effectiveCreatedBy,
          });
          invalidateDocumentCache(slug);
          return reply.status(201).send({
            slug,
            version: result.nextVersionNumber,
            merged: mergeResult.merged,
            hasConflicts: false,
            conflicts: [],
            resolution: 'auto',
            stats: mergeResult.stats,
            contentHash: result.contentHash,
            tokenCount: result.tokenCount,
            compressionRatio: calculateCompressionRatio(result.originalSize, result.compressedSize),
            changelog: effectiveChangelog,
            createdBy: effectiveCreatedBy,
          });
        }

        // Conflicts remain — return merged content with markers; do not persist.
        return reply.status(200).send({
          slug,
          version: null,
          merged: mergeResult.merged,
          hasConflicts: true,
          conflicts: mergeResult.conflicts,
          resolution: 'auto',
          stats: mergeResult.stats,
          message:
            'Conflicts detected. Resolve the conflict markers and POST the resolved content to /resolve-conflict.',
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /api/documents/:slug/resolve-conflict
   *
   * Submit manually resolved document content to create a new version.
   *
   * Use this after receiving a conflicted merge response from `/merge-conflict`,
   * resolving the `<<<<<<<`/`=======`/`>>>>>>>` markers, and submitting the
   * final content.
   */
  fastify.post(
    '/documents/:slug/resolve-conflict',
    async (
      request: FastifyRequest<{
        Params: { slug: string };
        Body: z.infer<typeof resolveConflictBodySchema>;
      }>,
      reply: FastifyReply,
    ) => {
      try {
        const paramsResult = slugParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return reply
            .status(400)
            .send({ error: 'Invalid slug', details: paramsResult.error.errors });
        }
        const { slug } = paramsResult.data;

        const bodyResult = resolveConflictBodySchema.safeParse(request.body);
        if (!bodyResult.success) {
          return reply
            .status(400)
            .send({ error: 'Invalid request body', details: bodyResult.error.errors });
        }
        const { content, baseVersion, changelog, createdBy, agentId } = bodyResult.data;

        // ── Look up document ────────────────────────────────────────────────
        const [doc] = await db.select().from(documents).where(eq(documents.slug, slug));
        if (!doc) {
          return reply.status(404).send({ error: 'Document not found' });
        }

        if (doc.state === 'LOCKED' || doc.state === 'ARCHIVED') {
          return reply.status(423).send({
            error: 'Locked',
            message: `Document is ${doc.state.toLowerCase()} and cannot be modified.`,
          });
        }

        // ── Resolve author ────────────────────────────────────────────────
        const callerSuppliedId = createdBy || agentId || null;
        const user = await getOptionalUser(request);
        const effectiveCreatedBy = callerSuppliedId || user?.id || null;

        const effectiveChangelog =
          changelog ?? `Manual conflict resolution (base: v${baseVersion})`;

        // ── Persist the resolved version ──────────────────────────────────
        const result = await persistNewVersion({
          doc,
          content,
          changelog: effectiveChangelog,
          effectiveCreatedBy,
        });

        invalidateDocumentCache(slug);

        return reply.status(201).send({
          slug,
          versionNumber: result.nextVersionNumber,
          contentHash: result.contentHash,
          tokenCount: result.tokenCount,
          compressionRatio: calculateCompressionRatio(result.originalSize, result.compressedSize),
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          createdAt: result.now,
          changelog: effectiveChangelog,
          createdBy: effectiveCreatedBy,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
