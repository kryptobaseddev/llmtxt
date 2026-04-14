/**
 * Cherry-pick merge route: POST /documents/:slug/merge
 *
 * Assembles a new document version from line ranges and/or sections
 * cherry-picked across multiple existing versions via the WASM
 * cherryPickMerge primitive.
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
} from '../utils/compression.js';
import { countTokens } from '../utils/tokenizer.js';
import { cherryPickMerge } from 'llmtxt';
import { invalidateDocumentCache } from '../middleware/cache.js';
import { auth } from '../auth.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import { eventBus } from '../events/bus.js';
import { canWrite } from '../middleware/rbac.js';

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

// ── Zod schemas ───────────────────────────────────────────────────────────────

const slugParamsSchema = z.object({
  slug: z.string().min(1).max(20),
});

/** One source entry: a version number plus either lineRanges or sections (or both). */
const sourceSchema = z.object({
  /** Document version number (e.g. 2, 3, 4). */
  version: z.number().int().positive(),
  /** Array of [startLine, endLine] pairs (1-based, inclusive). */
  lineRanges: z
    .array(z.tuple([z.number().int().positive(), z.number().int().positive()]))
    .optional(),
  /** Markdown section headings to extract (e.g. "## Section 3"). */
  sections: z.array(z.string().min(1)).optional(),
}).refine(
  (s) => (s.lineRanges && s.lineRanges.length > 0) || (s.sections && s.sections.length > 0),
  { message: 'Each source must specify at least one lineRange or section' },
);

const mergeBodySchema = z.object({
  /** Sources to cherry-pick from. */
  sources: z.array(sourceSchema).min(1).max(10),
  /**
   * Version number to fill unspecified lines from.
   * Defaults to the first source version if omitted.
   */
  fillFrom: z.number().int().positive().optional(),
  /** Human-readable changelog for the new version. */
  changelog: z.string().max(500).optional(),
  /** Explicit author identifier (takes precedence over agentId and session). */
  createdBy: z.string().max(100).optional(),
  /** Agent identifier alias for createdBy. */
  agentId: z.string().max(100).optional(),
});

// ── Route registration ────────────────────────────────────────────────────────

/** Register the cherry-pick merge route. */
export async function mergeRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/documents/:slug/merge
   *
   * Assembles a new version by cherry-picking line ranges and/or markdown
   * sections from multiple existing versions using the WASM cherry-pick merge
   * primitive. Does not require authentication (anonymous sessions work).
   */
  fastify.post<{
    Params: { slug: string };
    Body: z.infer<typeof mergeBodySchema>;
  }>(
    '/documents/:slug/merge',
    { config: writeRateLimit, preHandler: [canWrite] },
    async (
      request,
      reply,
    ) => {
      try {
        // ── Validate params ─────────────────────────────────────────────────
        const paramsResult = slugParamsSchema.safeParse(request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            error: 'Invalid slug',
            details: paramsResult.error.errors,
          });
        }
        const { slug } = paramsResult.data;

        // ── Validate body ───────────────────────────────────────────────────
        const bodyResult = mergeBodySchema.safeParse(request.body);
        if (!bodyResult.success) {
          return reply.status(400).send({
            error: 'Invalid request body',
            details: bodyResult.error.errors,
          });
        }
        const { sources, fillFrom, changelog, createdBy, agentId } = bodyResult.data;

        // ── Look up document ────────────────────────────────────────────────
        const [doc] = await db
          .select()
          .from(documents)
          .where(eq(documents.slug, slug));

        if (!doc) {
          return reply.status(404).send({ error: 'Document not found' });
        }

        if (doc.state === 'LOCKED' || doc.state === 'ARCHIVED') {
          return reply.status(423).send({
            error: 'Locked',
            message: `Document is ${doc.state.toLowerCase()} and cannot be modified. Transition to DRAFT to enable editing.`,
          });
        }

        // ── Collect all version numbers needed ──────────────────────────────
        const requestedVersionNumbers = new Set<number>(sources.map((s) => s.version));
        if (fillFrom !== undefined) {
          requestedVersionNumbers.add(fillFrom);
        }

        // ── Fetch all referenced versions from DB ───────────────────────────
        const versionRows = await db
          .select()
          .from(versions)
          .where(eq(versions.documentId, doc.id));

        // Build a map from version number → row
        const versionRowMap = new Map<number, any>(versionRows.map((v: any) => [v.versionNumber, v]));

        // Validate all requested version numbers exist
        for (const num of requestedVersionNumbers) {
          if (!versionRowMap.has(num)) {
            return reply.status(404).send({
              error: `Version ${num} not found`,
            });
          }
        }

        // ── Decompress content for each referenced version ──────────────────
        const versionContentMap = new Map<number, string>();
        for (const num of requestedVersionNumbers) {
          const row: any = versionRowMap.get(num)!;
          const buf =
            row.compressedData instanceof Buffer
              ? row.compressedData
              : Buffer.from(row.compressedData as ArrayBuffer);
          versionContentMap.set(num, await decompress(buf));
        }

        // ── Map DB version numbers to 0-based indices for the WASM call ─────
        //
        // cherryPickMerge expects:
        //   versionsJson: {"0": "...", "1": "...", "2": "..."} (string keys)
        //   selectionJson.sources[].versionIndex: 0-based index
        //   selectionJson.fillFrom: 0-based index (optional)
        //
        // We assign index 0 to the first source's version, then 1, 2, ... for
        // the remaining unique versions in encounter order.
        const versionToIndex = new Map<number, number>();
        let nextIndex = 0;

        // Register sources in encounter order to get stable indices
        for (const source of sources) {
          if (!versionToIndex.has(source.version)) {
            versionToIndex.set(source.version, nextIndex++);
          }
        }
        // Register fillFrom version (if not already registered)
        const fillFromVersion = fillFrom ?? sources[0].version;
        if (!versionToIndex.has(fillFromVersion)) {
          versionToIndex.set(fillFromVersion, nextIndex++);
        }

        // ── Build versionsJson ──────────────────────────────────────────────
        const versionsObj: Record<string, string> = {};
        for (const [vNum, idx] of versionToIndex.entries()) {
          versionsObj[String(idx)] = versionContentMap.get(vNum)!;
        }
        const versionsJson = JSON.stringify(versionsObj);

        // ── Build selectionJson ─────────────────────────────────────────────
        const selectionSources = sources.map((source) => {
          const entry: {
            versionIndex: number;
            lineRanges?: number[][];
            sections?: string[];
          } = { versionIndex: versionToIndex.get(source.version)! };

          if (source.lineRanges && source.lineRanges.length > 0) {
            entry.lineRanges = source.lineRanges.map(([s, e]) => [s, e]);
          }
          if (source.sections && source.sections.length > 0) {
            entry.sections = source.sections;
          }
          return entry;
        });

        const selectionObj: { sources: typeof selectionSources; fillFrom?: number } = {
          sources: selectionSources,
          fillFrom: versionToIndex.get(fillFromVersion)!,
        };
        const selectionJson = JSON.stringify(selectionObj);

        // ── Call WASM cherry-pick merge ─────────────────────────────────────
        // Use the first source's content as the base argument. The WASM
        // function inserts it as index 0 when key "0" is absent from
        // versionsJson, but we already populate versionsJson fully, so base
        // is only a fallback — pass the fill-from content for safety.
        const baseContent = versionContentMap.get(fillFromVersion)!;

        let mergeResult;
        try {
          mergeResult = cherryPickMerge(baseContent, versionsJson, selectionJson);
        } catch (err) {
          return reply.status(400).send({
            error: 'Merge failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }

        const { content: mergedContent, provenance: rawProvenance, stats } = mergeResult;

        // ── Translate provenance indices back to DB version numbers ──────────
        // cherryPickMerge returns 0-based indices in provenance.fromVersion.
        // Build the inverse of versionToIndex so consumers see real version
        // numbers (e.g. 2, 3, 4) instead of opaque indices (0, 1, 2).
        const indexToVersion = new Map<number, number>();
        for (const [vNum, idx] of versionToIndex.entries()) {
          indexToVersion.set(idx, vNum);
        }

        const provenance = rawProvenance.map((entry) => ({
          ...entry,
          fromVersion: indexToVersion.get(entry.fromVersion) ?? entry.fromVersion,
        }));

        // ── Resolve author ──────────────────────────────────────────────────
        // Done outside the transaction to avoid holding the write lock during
        // a potential network call.
        const callerSuppliedId = createdBy || agentId || null;
        const user = await getOptionalUser(request);
        const effectiveCreatedBy = callerSuppliedId || user?.id || null;

        // ── Build provenance-enriched changelog ─────────────────────────────
        const provenanceSummary = sources
          .map((s) => {
            const parts: string[] = [];
            if (s.lineRanges && s.lineRanges.length > 0) {
              parts.push(`lines ${s.lineRanges.map(([a, b]) => `${a}-${b}`).join(', ')}`);
            }
            if (s.sections && s.sections.length > 0) {
              parts.push(`sections [${s.sections.join(', ')}]`);
            }
            return `v${s.version}(${parts.join('; ')})`;
          })
          .join(' + ');

        const effectiveChangelog = changelog
          ? `${changelog} [cherry-pick: ${provenanceSummary}]`
          : `Cherry-pick merge: ${provenanceSummary}`;

        // ── Compress merged content ─────────────────────────────────────────
        // Pure CPU work — done outside the transaction.
        const compressedData = await compress(mergedContent);
        const contentHash = hashContent(mergedContent);
        const tokenCount = countTokens(mergedContent);
        const originalSize = Buffer.byteLength(mergedContent, 'utf-8');
        const compressedSize = compressedData.length;
        const now = Date.now();

        // ── Atomic version creation ─────────────────────────────────────────
        // Uses async transaction syntax which works for both Drizzle-over-SQLite
        // (better-sqlite3 wraps sync ops transparently) and Drizzle-over-pg.
        // The { behavior: 'immediate' } option was SQLite-only and is omitted
        // for dual-provider compatibility.
        const runMergeInsert = async (): Promise<number> =>
          db.transaction(async (tx: typeof db) => {
            // Read current max version number inside the transaction.
            const [latestVersion] = await tx
              .select({ versionNumber: versions.versionNumber })
              .from(versions)
              .where(eq(versions.documentId, doc.id))
              .orderBy(desc(versions.versionNumber))
              .limit(1);

            const nextVersionNumber = latestVersion ? latestVersion.versionNumber + 1 : 2;

            // Snapshot to version 1 if this is the very first versioned update.
            if (!latestVersion) {
              await tx.insert(versions).values({
                id: generateId(),
                documentId: doc.id,
                versionNumber: 1,
                compressedData: doc.compressedData,
                contentHash: doc.contentHash,
                tokenCount: doc.tokenCount,
                createdAt: doc.createdAt,
                changelog: 'Initial version',
              });
            }

            // Insert new version row.
            await tx.insert(versions).values({
              id: generateId(),
              documentId: doc.id,
              versionNumber: nextVersionNumber,
              compressedData,
              contentHash,
              tokenCount,
              createdAt: now,
              createdBy: effectiveCreatedBy,
              changelog: effectiveChangelog,
              storageType: 'inline',
            });

            // Update document head.
            await tx
              .update(documents)
              .set({
                compressedData,
                contentHash,
                originalSize,
                compressedSize,
                tokenCount,
                currentVersion: nextVersionNumber,
              })
              .where(eq(documents.id, doc.id));

            // Upsert contributor record inside the same transaction.
            if (effectiveCreatedBy) {
              const [existing] = await tx
                .select()
                .from(contributors)
                .where(
                  and(
                    eq(contributors.documentId, doc.id),
                    eq(contributors.agentId, effectiveCreatedBy),
                  ),
                );

              if (existing) {
                await tx
                  .update(contributors)
                  .set({
                    versionsAuthored: existing.versionsAuthored + 1,
                    lastContribution: now,
                  })
                  .where(eq(contributors.id, existing.id));
              } else {
                await tx.insert(contributors).values({
                  id: generateId(),
                  documentId: doc.id,
                  agentId: effectiveCreatedBy,
                  versionsAuthored: 1,
                  totalTokensAdded: tokenCount ?? 0,
                  totalTokensRemoved: 0,
                  netTokens: tokenCount ?? 0,
                  firstContribution: now,
                  lastContribution: now,
                });
              }
            }

            return nextVersionNumber;
          });

        // Retry once on UNIQUE constraint collision (concurrent merge hit the
        // same version number). The retry reads a fresh MAX inside its own
        // transaction so it lands on the correct next number.
        let nextVersionNumber: number;
        try {
          nextVersionNumber = await runMergeInsert();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('UNIQUE constraint failed') || msg.includes('unique constraint')) {
            nextVersionNumber = await runMergeInsert();
          } else {
            throw err;
          }
        }

        // ── Invalidate cache ────────────────────────────────────────────────
        invalidateDocumentCache(slug);

        // Emit version.created AFTER the successful DB write — non-blocking.
        eventBus.emitVersionCreated(slug, doc.id, effectiveCreatedBy || 'anonymous', {
          version: nextVersionNumber,
          changelog: effectiveChangelog,
          createdBy: effectiveCreatedBy,
        });

        // ── Respond ─────────────────────────────────────────────────────────
        return reply.status(201).send({
          slug,
          version: nextVersionNumber,
          content: mergedContent,
          createdBy: effectiveCreatedBy,
          changelog: effectiveChangelog,
          provenance,
          stats,
          tokenCount,
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
