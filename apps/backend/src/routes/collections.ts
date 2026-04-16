/**
 * Collection routes: create, list, retrieve, manage membership, reorder, and export.
 *
 * Routes:
 *   POST   /collections                                    - Create collection (auth required)
 *   GET    /collections                                    - List accessible collections
 *   GET    /collections/:slug                              - Get collection with documents
 *   POST   /collections/:slug/documents                   - Add document to collection
 *   DELETE /collections/:slug/documents/:documentSlug     - Remove document from collection
 *   PUT    /collections/:slug/order                       - Reorder documents
 *   GET    /collections/:slug/export                      - Export as single concatenated document
 *
 * Wave D (T353.7): all persistence calls delegate to fastify.backendCore.* (CollectionOps).
 * Auth + RBAC + input validation remain in this route layer.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { decompress } from 'llmtxt';
import { slugify, COLLECTION_EXPORT_SEPARATOR } from 'llmtxt';
import { auth } from '../auth.js';

// ────────────────────────────────────────────────────────────────
// Validation schemas
// ────────────────────────────────────────────────────────────────

const createCollectionSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  visibility: z.enum(['public', 'private']).default('public'),
});

const addDocumentSchema = z.object({
  documentSlug: z.string().min(1).max(20),
  position: z.number().int().min(0).optional(),
});

const reorderSchema = z.object({
  documents: z.array(
    z.object({
      slug: z.string().min(1).max(20),
      position: z.number().int().min(0),
    })
  ).min(1).max(500),
});

// ────────────────────────────────────────────────────────────────
// Auth helpers
// ────────────────────────────────────────────────────────────────

/** Try to get the authenticated user from session cookies. Returns null if no session. */
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

/** Require authentication and return user, or send 401. */
async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<{ id: string; email?: string; name?: string } | null> {
  const user = await getOptionalUser(request);
  if (!user) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
    return null;
  }
  return user;
}

/** Check whether a user can read a collection. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function canReadCollection(col: { visibility: string; ownerId: string }, userId: string | null): boolean {
  if (col.visibility === 'public') return true;
  return col.ownerId === userId;
}

/** Check whether a user owns a collection. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ownsCollection(col: { ownerId: string }, userId: string): boolean {
  return col.ownerId === userId;
}

// ────────────────────────────────────────────────────────────────
// Route registration
// ────────────────────────────────────────────────────────────────

/** Register collection management routes. */
export async function collectionRoutes(fastify: FastifyInstance) {

  // ──────────────────────────────────────────────────────────────
  // POST /collections — Create a new collection
  // ──────────────────────────────────────────────────────────────

  fastify.post<{ Body: z.infer<typeof createCollectionSchema> }>(
    '/collections',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await requireUser(request, reply);
      if (!user) return;

      const bodyResult = createCollectionSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { name, description } = bodyResult.data;

      const col = await fastify.backendCore.createCollection({
        name,
        description,
        ownerId: user.id,
        slug: slugify(name) || undefined,
      });

      return reply.status(201).send({
        id: col.id,
        name: col.name ?? name,
        slug: col.slug,
        description: description ?? null,
        visibility: 'public',
        ownerId: user.id,
        createdAt: col.createdAt,
        updatedAt: col.updatedAt,
        documentCount: 0,
      });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /collections — List collections accessible to the user
  // ──────────────────────────────────────────────────────────────

  fastify.get(
    '/collections',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = await getOptionalUser(request);
      const userId = user?.id ?? null;

      const result = await fastify.backendCore.listCollections();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const accessible = result.items.filter((c: any) => canReadCollection(c, userId));

      return reply.status(200).send({ collections: accessible, total: accessible.length });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /collections/:slug — Get collection with document list
  // ──────────────────────────────────────────────────────────────

  fastify.get<{ Params: { slug: string } }>(
    '/collections/:slug',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;
      const user = await getOptionalUser(request);
      const userId = user?.id ?? null;

      const col = await fastify.backendCore.getCollection(slug);
      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!canReadCollection(col as any, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      }

      return reply.status(200).send(col);
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /collections/:slug/documents — Add a document to a collection
  // ──────────────────────────────────────────────────────────────

  fastify.post<{
    Params: { slug: string };
    Body: z.infer<typeof addDocumentSchema>;
  }>(
    '/collections/:slug/documents',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;
      const user = await requireUser(request, reply);
      if (!user) return;

      const col = await fastify.backendCore.getCollection(slug);
      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!ownsCollection(col as any, user.id)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the collection owner can add documents' });
      }

      const bodyResult = addDocumentSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { documentSlug, position } = bodyResult.data;

      try {
        await fastify.backendCore.addDocToCollection(slug, documentSlug, position);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('not found')) {
          return reply.status(404).send({ error: 'Not Found', message: msg });
        }
        // Duplicate is silently idempotent per interface contract
      }

      return reply.status(201).send({
        collectionSlug: slug,
        documentSlug,
        position: position ?? 0,
        addedAt: Date.now(),
      });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // DELETE /collections/:slug/documents/:documentSlug — Remove document
  // ──────────────────────────────────────────────────────────────

  fastify.delete<{ Params: { slug: string; documentSlug: string } }>(
    '/collections/:slug/documents/:documentSlug',
    async (
      request: FastifyRequest<{ Params: { slug: string; documentSlug: string } }>,
      reply: FastifyReply
    ) => {
      const { slug, documentSlug } = request.params;
      const user = await requireUser(request, reply);
      if (!user) return;

      const col = await fastify.backendCore.getCollection(slug);
      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!ownsCollection(col as any, user.id)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the collection owner can remove documents' });
      }

      const removed = await fastify.backendCore.removeDocFromCollection(slug, documentSlug);
      if (!removed) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document is not in this collection' });
      }

      return reply.status(200).send({ message: 'Document removed from collection', documentSlug });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // PUT /collections/:slug/order — Reorder documents in a collection
  // ──────────────────────────────────────────────────────────────

  fastify.put<{
    Params: { slug: string };
    Body: z.infer<typeof reorderSchema>;
  }>(
    '/collections/:slug/order',
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;
      const user = await requireUser(request, reply);
      if (!user) return;

      const col = await fastify.backendCore.getCollection(slug);
      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!ownsCollection(col as any, user.id)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the collection owner can reorder documents' });
      }

      const bodyResult = reorderSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { documents: orderItems } = bodyResult.data;
      const orderedSlugs = orderItems.sort((a, b) => a.position - b.position).map((item) => item.slug);

      await fastify.backendCore.reorderCollection(slug, orderedSlugs);

      return reply.status(200).send({ message: 'Order updated', collectionSlug: slug });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /collections/:slug/export — Export all documents as single context
  // ──────────────────────────────────────────────────────────────

  fastify.get<{
    Params: { slug: string };
    Querystring: { format?: string };
  }>(
    '/collections/:slug/export',
    async (
      request: FastifyRequest<{ Params: { slug: string }; Querystring: { format?: string } }>,
      reply: FastifyReply
    ) => {
      const { slug } = request.params;
      const outputFormat = request.query.format || 'text';
      const user = await getOptionalUser(request);
      const userId = user?.id ?? null;

      const col = await fastify.backendCore.getCollection(slug);
      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!canReadCollection(col as any, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exportData = await fastify.backendCore.exportCollection(slug) as any;
      const docRows = exportData.documents ?? [];

      if (docRows.length === 0) {
        return reply.status(200).send({
          collection: slug,
          documentCount: 0,
          totalTokens: 0,
          content: '',
        });
      }

      // Concatenate documents in order with separators
      const parts: string[] = [];
      let totalTokens = 0;
      let documentCount = 0;

      for (const doc of docRows) {
        if (!doc?.compressedData) continue;
        try {
          const buf =
            doc.compressedData instanceof Buffer
              ? doc.compressedData
              : Buffer.from(doc.compressedData as ArrayBuffer);
          const content = await decompress(buf);
          parts.push(`--- Document: ${doc.slug} ---\n${content}`);
          totalTokens += doc.tokenCount ?? 0;
          documentCount++;
        } catch (err) {
          fastify.log.warn(`export: failed to decompress document ${doc.slug}: ${err}`);
        }
      }

      const combined = parts.join(COLLECTION_EXPORT_SEPARATOR);

      const contentType =
        outputFormat === 'json'
          ? 'application/json'
          : outputFormat === 'markdown'
          ? 'text/markdown'
          : 'text/plain';

      if (outputFormat === 'json') {
        return reply.status(200).send({
          collection: slug,
          name: col.name,
          documentCount,
          totalTokens,
          content: combined,
        });
      }

      reply.header('X-Collection-Slug', slug);
      reply.header('X-Document-Count', String(documentCount));
      reply.header('X-Total-Tokens', String(totalTokens));
      return reply.type(contentType).send(combined);
    }
  );
}
