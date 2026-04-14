/**
 * Patch route: submit unified diff to create a new version.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, versions } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { canWrite } from '../middleware/rbac.js';
import {
  applyPatch, hashContent, compress, generateId,
} from 'llmtxt';
import { countTokens } from '../utils/tokenizer.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import { enforcePatchSize } from '../middleware/content-limits.js';
import { eventBus } from '../events/bus.js';

/** Register patch route: POST /documents/:slug/patch to apply a unified diff and create a new version. Requires authentication and editable document state. */
export async function patchRoutes(fastify: FastifyInstance) {
  // POST /documents/:slug/patch
  fastify.post<{
    Params: { slug: string };
    Body: { patchText: string; changelog: string };
  }>(
    '/documents/:slug/patch',
    { preHandler: [canWrite, enforcePatchSize], config: writeRateLimit },
    async (request, reply) => {
      const { slug } = request.params;
      const { patchText, changelog } = request.body;

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      if (doc[0].state === 'LOCKED' || doc[0].state === 'ARCHIVED') {
        return reply.status(423).send({
          error: 'Locked',
          message: `Document is ${(doc[0].state as string).toLowerCase()} and cannot be modified. Transition to DRAFT to enable editing.`,
        });
      }

      // Decompress current content
      const currentContent = doc[0].compressedData
        ? (await import('llmtxt')).decompress(Buffer.from(doc[0].compressedData as ArrayBuffer))
        : '';

      // Apply patch
      let newContent: string;
      try {
        newContent = applyPatch(await currentContent, patchText);
      } catch (err) {
        return reply.status(400).send({
          error: 'Patch failed',
          message: err instanceof Error ? err.message : 'Patch does not apply cleanly',
        });
      }

      const contentHash = hashContent(newContent);
      const tokenCount = countTokens(newContent);
      const compressed = await compress(newContent);
      const nextVersion = doc[0].currentVersion + 1;
      const now = Date.now();

      await db.insert(versions).values({
        id: generateId(),
        documentId: doc[0].id,
        versionNumber: nextVersion,
        compressedData: compressed,
        contentHash,
        tokenCount,
        createdAt: now,
        createdBy: request.user!.id,
        changelog,
        patchText,
        baseVersion: doc[0].currentVersion,
        storageType: 'inline',
      });

      await db.update(documents).set({
        compressedData: compressed,
        contentHash,
        tokenCount,
        originalSize: Buffer.byteLength(newContent, 'utf8'),
        compressedSize: compressed.length,
        currentVersion: nextVersion,
        versionCount: doc[0].versionCount + 1,
      }).where(eq(documents.slug, slug));

      // Emit version.created AFTER the successful DB write — non-blocking.
      eventBus.emitVersionCreated(slug, doc[0].id, request.user!.id, {
        version: nextVersion,
        changelog,
        createdBy: request.user!.id,
      });

      reply.status(201);
      return {
        slug,
        versionNumber: nextVersion,
        contentHash,
        tokenCount,
        changelog,
        createdBy: request.user!.id,
        createdAt: now,
      };
    },
  );
}
