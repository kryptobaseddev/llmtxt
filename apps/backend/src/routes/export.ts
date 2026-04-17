/**
 * Document export HTTP route — T427.6.
 *
 * GET /documents/:slug/export?format=md&includeMetadata=true&signed=false
 *
 * Returns the formatted document body with the appropriate Content-Type header.
 * Formatting is performed server-side using the same format serializers
 * (packages/llmtxt/src/export/) that LocalBackend uses on disk.
 *
 * Auth: existing canRead preHandler (API key or session bearer).
 *
 * Response Content-Types:
 *   markdown  → text/markdown; charset=utf-8
 *   json      → application/json; charset=utf-8
 *   txt       → text/plain; charset=utf-8
 *   llmtxt    → application/x-llmtxt; charset=utf-8
 *
 * @see docs/specs/ARCH-T427-document-export-ssot.md §5.3
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { decompress } from '../utils/compression.js';
import { canRead } from '../middleware/rbac.js';
import {
  serializeDocument,
  contentHashHex,
  FORMAT_CONTENT_TYPE,
} from 'llmtxt/export-backend';
import type { DocumentExportState, ExportFormat } from 'llmtxt/export-backend';

// ── Schemas ────────────────────────────────────────────────────────────────────

const exportParamsSchema = z.object({
  slug: z.string().min(1).max(200),
});

const exportQuerySchema = z.object({
  format: z.enum(['markdown', 'json', 'txt', 'llmtxt']).default('markdown'),
  includeMetadata: z
    .string()
    .optional()
    .transform((v) => v !== 'false')
    .default(true),
  signed: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default(false),
});

// ── Route registration ─────────────────────────────────────────────────────────

export async function exportRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /documents/:slug/export
   *
   * Query params:
   *   format          — 'markdown' | 'json' | 'txt' | 'llmtxt'  (default: 'markdown')
   *   includeMetadata — 'true' | 'false'                        (default: 'true')
   *   signed          — 'true' | 'false'                        (default: 'false'; signing unsupported server-side)
   *
   * Returns the formatted document with the appropriate Content-Type.
   * On success: HTTP 200 with Content-Disposition: attachment; filename=<slug>.<ext>
   * On error: HTTP 404 (not found) or 422 (validation error).
   */
  fastify.get<{
    Params: { slug: string };
    Querystring: {
      format?: string;
      includeMetadata?: string;
      signed?: string;
    };
  }>(
    '/documents/:slug/export',
    { preHandler: [canRead] },
    async (request, reply) => {
      // Validate path params.
      const paramsResult = exportParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      // Validate query params.
      const queryResult = exportQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          details: queryResult.error.flatten(),
        });
      }
      const { format, includeMetadata } = queryResult.data;

      try {
        // 1. Resolve slug → document via backendCore.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = (await request.server.backendCore.getDocumentBySlug(slug)) as any;
        if (!doc) {
          return reply.status(404).send({ error: 'Document not found' });
        }

        // 2. Get version list.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const versionList = (await request.server.backendCore.listVersions(doc.id)) as any[];
        if (!versionList || versionList.length === 0) {
          return reply.status(404).send({ error: 'Document has no versions' });
        }

        // PostgresBackend.listVersions() orders desc — first entry is latest.
        // LocalBackend.listVersions() orders asc — last entry is latest.
        // Determine ordering by checking if versionNumber is increasing or decreasing.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let latestVersionEntry: any;
        if (versionList.length === 1) {
          latestVersionEntry = versionList[0];
        } else {
          const first = versionList[0].versionNumber as number;
          const second = versionList[1].versionNumber as number;
          // desc ordering: first > second → latest is first
          latestVersionEntry = first > second ? versionList[0] : versionList[versionList.length - 1];
        }

        const latestVersionNumber = latestVersionEntry.versionNumber as number;

        // 3. Get full version row with compressedData.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const versionRow = (await request.server.backendCore.getVersion(doc.id, latestVersionNumber)) as any;
        if (!versionRow) {
          return reply.status(404).send({ error: `Version ${latestVersionNumber} not found` });
        }

        // 4. Decompress content.
        const compressedBuffer = versionRow.compressedData instanceof Buffer
          ? versionRow.compressedData
          : Buffer.from(versionRow.compressedData as ArrayBuffer);
        const content = await decompress(compressedBuffer);

        // 5. Build contributors list.
        const contributors = [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...new Set(versionList.map((v: any) => v.createdBy as string | undefined).filter(Boolean)),
        ] as string[];

        // 6. Build DocumentExportState.
        const exportedAt = new Date().toISOString();
        const state: DocumentExportState = {
          title: doc.title ?? slug,
          slug: doc.slug ?? slug,
          version: latestVersionNumber,
          state: doc.state ?? 'DRAFT',
          contributors,
          contentHash: contentHashHex(content),
          exportedAt,
          content,
          labels: Array.isArray(doc.labels) ? doc.labels : null,
          createdBy: doc.createdBy ?? null,
          createdAt: doc.createdAt instanceof Date ? doc.createdAt.getTime() : (doc.createdAt ?? null),
          updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : (doc.updatedAt ?? null),
          versionCount: versionList.length,
          chainRef: null, // T384 stub
        };

        // 7. Serialize using format dispatcher.
        const serialized = serializeDocument(state, format as ExportFormat, { includeMetadata });

        // 8. Respond with correct Content-Type and disposition.
        const ext = format === 'markdown' ? 'md' : format;
        const contentType = FORMAT_CONTENT_TYPE[format as ExportFormat];
        reply
          .header('Content-Type', contentType)
          .header('Content-Disposition', `attachment; filename="${slug}.${ext}"`)
          .status(200)
          .send(serialized);
      } catch (err: unknown) {
        fastify.log.error(err, '[export] exportDocument failed');
        return reply.status(500).send({ error: 'Internal server error' });
      }
    },
  );
}
