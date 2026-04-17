/**
 * Blob attachment HTTP routes — T464 (T428.8).
 *
 * Endpoints:
 *   POST   /documents/:slug/blobs            — attach a blob (raw binary body + query params)
 *   GET    /documents/:slug/blobs            — list blob attachments (metadata only)
 *   GET    /documents/:slug/blobs/:name      — download a blob (with hash-verify)
 *   DELETE /documents/:slug/blobs/:name      — detach (soft-delete) a blob
 *   GET    /blobs/:hash                      — fetch blob bytes by hash (sync pull)
 *
 * Upload format (POST /documents/:slug/blobs):
 *   Content-Type: application/octet-stream (or any MIME type)
 *   Body: raw binary bytes
 *   Query params:
 *     name        — attachment name (required, e.g. "diagram.png")
 *     contentType — MIME type override (optional; defaults to Content-Type header)
 *
 * Security:
 *   - All routes require requireAuth (Bearer API key or session cookie).
 *   - list + download require 'read' permission on the document.
 *   - attach + detach require 'write' permission on the document.
 *   - fetchBlobByHash requires 'read' permission on at least one document
 *     that references the requested hash (enforced here via DB query).
 *   - Blob name validated before any storage operation (400 on invalid).
 *   - Content-Disposition: attachment set on download responses (MANDATORY).
 *   - Max body size enforced at 100MB (413 on excess).
 *   - Hash verified on every byte-returning read (BlobCorruptError → 500).
 *
 * @module
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { canRead, canWrite, hasPermission } from '../middleware/rbac.js';
import { db } from '../db/index.js';
import { blobAttachments } from '../db/schema-pg.js';
import { eq, and, isNull } from 'drizzle-orm';

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_BLOB_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

// ── Validation schemas ─────────────────────────────────────────────────────────

const slugParams = z.object({
  slug: z.string().min(1).max(200),
});

const slugAndNameParams = z.object({
  slug: z.string().min(1).max(200),
  name: z.string().min(1).max(255),
});

const hashParams = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/, 'hash must be a 64-character lowercase hex string'),
});

const attachQuerySchema = z.object({
  name: z.string().min(1).max(255),
  contentType: z.string().optional(),
});

const getBlobQuery = z.object({
  includeData: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default(false),
});

// ── Name validation helper (mirrors WASM blob_name_validate) ───────────────────

/**
 * Validate a blob attachment name according to ARCH-T428 §3.2 rules.
 * Returns null on success, or an error message string on failure.
 */
function validateBlobName(name: string): string | null {
  if (!name || name.length === 0) return 'name must not be empty';
  if (Buffer.byteLength(name, 'utf8') > 255) return 'name must not exceed 255 bytes (UTF-8)';
  if (name.includes('..')) return 'name must not contain ".." (path traversal)';
  if (name.includes('/') || name.includes('\\')) return 'name must not contain path separators (/ or \\)';
  if (name.includes('\0')) return 'name must not contain null bytes';
  if (name !== name.trim()) return 'name must not start or end with whitespace';
  return null;
}

// ── Route plugin ───────────────────────────────────────────────────────────────

export async function blobRoutes(fastify: FastifyInstance): Promise<void> {
  // Register a content type parser for raw binary blob uploads.
  // Fastify only parses application/json by default.
  // We accept any content type for the upload route and read the raw body as a Buffer.
  // The wildcard '*/*' parser runs when no other parser matches (including octet-stream,
  // image/png, application/pdf, etc.).
  fastify.addContentTypeParser(
    ['application/octet-stream', 'image/*', 'video/*', 'audio/*', 'application/*'],
    { parseAs: 'buffer' },
    function (_req, body, done) {
      done(null, body);
    }
  );

  // ── POST /documents/:slug/blobs — attach a blob ──────────────────────────────
  //
  // Accepts raw binary body (any Content-Type). Metadata via query params:
  //   ?name=diagram.png&contentType=image/png
  //
  // The raw body approach avoids @fastify/multipart dependency while
  // remaining fully compatible with curl, fetch FormData, and SDK clients.

  fastify.post<{
    Params: { slug: string };
    Querystring: { name?: string; contentType?: string };
  }>(
    '/documents/:slug/blobs',
    { preHandler: [requireAuth, canWrite] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = slugParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      // Parse query params for metadata
      const queryResult = attachQuerySchema.safeParse(request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          error: 'Missing required query parameter',
          message: 'Provide ?name=<filename> in the query string',
          details: queryResult.error.flatten(),
        });
      }
      const { name, contentType: contentTypeOverride } = queryResult.data;

      // Validate name (path traversal prevention — MANDATORY per T428.8)
      const nameError = validateBlobName(name);
      if (nameError) {
        return reply.status(400).send({ error: 'Invalid blob name', message: nameError });
      }

      // Determine content type: override from query > Content-Type header > fallback
      const contentType = contentTypeOverride
        ?? (request.headers['content-type'] ?? 'application/octet-stream').split(';')[0].trim();

      // Read raw body
      const rawBody = request.body;
      if (!rawBody) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Request body is required (raw binary)' });
      }

      let blobData: Buffer;
      if (Buffer.isBuffer(rawBody)) {
        blobData = rawBody;
      } else if (rawBody instanceof Uint8Array) {
        blobData = Buffer.from(rawBody);
      } else if (typeof rawBody === 'string') {
        blobData = Buffer.from(rawBody, 'binary');
      } else {
        return reply.status(400).send({ error: 'Bad Request', message: 'Unexpected body type — send raw binary bytes' });
      }

      // Enforce size limit before delegating to backend
      if (blobData.byteLength > MAX_BLOB_SIZE_BYTES) {
        return reply.status(413).send({
          error: 'Payload Too Large',
          message: `Blob size ${blobData.byteLength} bytes exceeds maximum of ${MAX_BLOB_SIZE_BYTES} bytes (100 MB)`,
        });
      }

      const uploadedBy = request.user?.id ?? 'anonymous';

      try {
        const attachment = await fastify.backendCore.attachBlob({
          docSlug: slug,
          name,
          contentType,
          data: blobData,
          uploadedBy,
        });
        return reply.status(201).send({ data: attachment });
      } catch (err: unknown) {
        const errName = err instanceof Error ? err.constructor.name : '';
        if (errName === 'BlobTooLargeError') {
          return reply.status(413).send({ error: 'Payload Too Large', message: (err as Error).message });
        }
        if (errName === 'BlobNameInvalidError') {
          return reply.status(400).send({ error: 'Invalid blob name', message: (err as Error).message });
        }
        request.log.error({ err }, '[blobs] attachBlob error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to attach blob' });
      }
    }
  );

  // ── GET /documents/:slug/blobs — list blobs (metadata only) ──────────────────

  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/blobs',
    { preHandler: [requireAuth, canRead] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = slugParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid slug' });
      }
      const { slug } = paramsResult.data;

      try {
        const items = await fastify.backendCore.listBlobs(slug);
        return reply.send({ data: { items } });
      } catch (err: unknown) {
        request.log.error({ err }, '[blobs] listBlobs error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to list blobs' });
      }
    }
  );

  // ── GET /documents/:slug/blobs/:name — download a blob ───────────────────────
  //
  // Without ?includeData=true: returns JSON metadata only.
  // With ?includeData=true: returns raw bytes with metadata in response headers.
  //   Response headers include:
  //     Content-Type: <blob's contentType>
  //     Content-Disposition: attachment; filename="<name>"  (MANDATORY)
  //     X-Blob-Hash, X-Blob-Size, X-Blob-Uploaded-By, X-Blob-Uploaded-At, X-Blob-Id

  fastify.get<{
    Params: { slug: string; name: string };
    Querystring: { includeData?: string };
  }>(
    '/documents/:slug/blobs/:name',
    { preHandler: [requireAuth, canRead] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = slugAndNameParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params', details: paramsResult.error.flatten() });
      }
      const { slug, name } = paramsResult.data;

      // Validate name before any storage operation (T428.8 — MANDATORY)
      const nameError = validateBlobName(name);
      if (nameError) {
        return reply.status(400).send({ error: 'Invalid blob name', message: nameError });
      }

      const queryResult = getBlobQuery.safeParse(request.query);
      const includeData = queryResult.success ? queryResult.data.includeData : false;

      try {
        const blob = await fastify.backendCore.getBlob(slug, name, { includeData });
        if (!blob) {
          return reply.status(404).send({ error: 'Not Found', message: 'Blob not found' });
        }

        if (includeData && blob.data) {
          // MANDATORY: Content-Disposition: attachment prevents browser execution (T428 §9.5)
          reply
            .header('Content-Type', blob.contentType)
            .header('Content-Disposition', `attachment; filename="${encodeURIComponent(blob.blobName)}"`)
            .header('X-Blob-Id', blob.id)
            .header('X-Blob-Hash', blob.hash)
            .header('X-Blob-Size', String(blob.size))
            .header('X-Blob-Content-Type', blob.contentType)
            .header('X-Blob-Uploaded-By', blob.uploadedBy)
            .header('X-Blob-Uploaded-At', String(blob.uploadedAt))
            .header('Content-Length', String(blob.data.length));
          return reply.status(200).send(blob.data);
        }

        // Metadata only — return JSON
        return reply.send({ data: blob });
      } catch (err: unknown) {
        const errName = err instanceof Error ? err.constructor.name : '';
        if (errName === 'BlobNameInvalidError') {
          return reply.status(400).send({ error: 'Invalid blob name', message: (err as Error).message });
        }
        if (errName === 'BlobCorruptError') {
          request.log.error({ err, slug, name }, '[blobs] BlobCorruptError on read — storage integrity issue');
          return reply.status(500).send({
            error: 'Storage Error',
            message: 'Blob integrity check failed — the blob may be corrupt. Please re-upload.',
          });
        }
        request.log.error({ err }, '[blobs] getBlob error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to retrieve blob' });
      }
    }
  );

  // ── DELETE /documents/:slug/blobs/:name — detach a blob ──────────────────────

  fastify.delete<{ Params: { slug: string; name: string } }>(
    '/documents/:slug/blobs/:name',
    { preHandler: [requireAuth, canWrite] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = slugAndNameParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Invalid params', details: paramsResult.error.flatten() });
      }
      const { slug, name } = paramsResult.data;

      // Validate name before any storage operation (T428.8 — MANDATORY)
      const nameError = validateBlobName(name);
      if (nameError) {
        return reply.status(400).send({ error: 'Invalid blob name', message: nameError });
      }

      const detachedBy = request.user?.id ?? 'anonymous';

      try {
        const removed = await fastify.backendCore.detachBlob(slug, name, detachedBy);
        if (!removed) {
          return reply.status(404).send({ error: 'Not Found', message: 'Blob not found or already detached' });
        }
        return reply.status(200).send({ data: { detached: true, name } });
      } catch (err: unknown) {
        const errName = err instanceof Error ? err.constructor.name : '';
        if (errName === 'BlobNameInvalidError') {
          return reply.status(400).send({ error: 'Invalid blob name', message: (err as Error).message });
        }
        request.log.error({ err }, '[blobs] detachBlob error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to detach blob' });
      }
    }
  );

  // ── GET /blobs/:hash — fetch blob bytes by hash (sync pull path) ──────────────
  //
  // Access control: caller must have read access on at least one document
  // that currently has an active attachment referencing this hash.
  // This is the lazy-pull path used by the changeset sync layer (T428 §7.2).

  fastify.get<{ Params: { hash: string } }>(
    '/blobs/:hash',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsResult = hashParams.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          error: 'Invalid hash format',
          message: 'Hash must be 64 lowercase hex characters',
        });
      }
      const { hash } = paramsResult.data;
      const userId = request.user?.id ?? null;

      // RBAC: find all doc slugs that reference this hash (active records only),
      // then verify the caller can read at least one of them.
      // This enforces T428 §9.3: fetchBlobByHash requires read access on at least
      // one referencing document.
      try {
        const refs = await db
          .select({ docSlug: blobAttachments.docSlug })
          .from(blobAttachments)
          .where(and(eq(blobAttachments.hash, hash), isNull(blobAttachments.deletedAt)))
          .limit(20);

        if (refs.length === 0) {
          return reply.status(404).send({ error: 'Not Found', message: 'No blob with this hash found' });
        }

        // Check if the caller can read at least one of the referencing documents
        let authorized = false;
        for (const ref of refs) {
          const allowed = await hasPermission(userId, ref.docSlug, 'read');
          if (allowed) {
            authorized = true;
            break;
          }
        }

        if (!authorized) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'You do not have read access to any document that references this blob',
          });
        }
      } catch (err: unknown) {
        request.log.error({ err }, '[blobs] fetchBlobByHash RBAC query error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to check blob access' });
      }

      try {
        const bytes = await fastify.backendCore.fetchBlobByHash(hash);
        if (!bytes) {
          return reply.status(404).send({ error: 'Not Found', message: 'Blob bytes not found in store' });
        }

        // MANDATORY: Content-Disposition: attachment (T428 §9.5)
        reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${hash}"`)
          .header('X-Blob-Hash', hash)
          .header('Content-Length', String(bytes.length));
        return reply.status(200).send(bytes);
      } catch (err: unknown) {
        const errName = err instanceof Error ? err.constructor.name : '';
        if (errName === 'BlobCorruptError') {
          request.log.error({ err, hash }, '[blobs] BlobCorruptError on fetchBlobByHash — storage integrity issue');
          return reply.status(500).send({
            error: 'Storage Error',
            message: 'Blob integrity check failed — the stored bytes are corrupt.',
          });
        }
        request.log.error({ err }, '[blobs] fetchBlobByHash error');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Failed to fetch blob' });
      }
    }
  );
}
