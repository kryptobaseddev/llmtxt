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
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and, inArray, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, collections, collectionDocuments } from '../db/schema.js';
import { auth } from '../auth.js';
import { decompress, generateId } from '../utils/compression.js';

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
// Helpers
// ────────────────────────────────────────────────────────────────

/** Convert a collection name to a URL-safe slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

/** Generate a unique slug for a collection name (appends -N suffix on conflict). */
async function generateCollectionSlug(name: string): Promise<string> {
  const base = slugify(name) || generateId().substring(0, 8);
  let candidate = base;
  let attempts = 0;

  while (attempts < 20) {
    const [existing] = await db
      .select({ id: collections.id })
      .from(collections)
      .where(eq(collections.slug, candidate));

    if (!existing) return candidate;

    attempts++;
    candidate = `${base}-${attempts}`;
  }

  // Fallback: base + random suffix
  return `${base}-${generateId().substring(0, 6)}`;
}

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
function canReadCollection(col: { visibility: string; ownerId: string }, userId: string | null): boolean {
  if (col.visibility === 'public') return true;
  return col.ownerId === userId;
}

/** Check whether a user owns a collection. */
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
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { name, description, visibility } = bodyResult.data;
      const slug = await generateCollectionSlug(name);
      const now = Date.now();
      const id = generateId();

      await db.insert(collections).values({
        id,
        name,
        slug,
        description: description ?? null,
        ownerId: user.id,
        visibility,
        createdAt: now,
        updatedAt: now,
      });

      return reply.status(201).send({
        id,
        name,
        slug,
        description: description ?? null,
        visibility,
        ownerId: user.id,
        createdAt: now,
        updatedAt: now,
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

      const allCollections = await db
        .select({
          id: collections.id,
          name: collections.name,
          slug: collections.slug,
          description: collections.description,
          ownerId: collections.ownerId,
          visibility: collections.visibility,
          createdAt: collections.createdAt,
          updatedAt: collections.updatedAt,
        })
        .from(collections)
        .orderBy(asc(collections.createdAt));

      const accessible = allCollections.filter((c: any) => canReadCollection(c, userId));

      // Attach document counts
      const result = await Promise.all(
        accessible.map(async (col: any) => {
          const memberRows = await db
            .select({ id: collectionDocuments.id })
            .from(collectionDocuments)
            .where(eq(collectionDocuments.collectionId, col.id));

          return { ...col, documentCount: memberRows.length };
        })
      );

      return reply.status(200).send({ collections: result, total: result.length });
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

      const [col] = await db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug));

      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      if (!canReadCollection(col, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      }

      // Fetch ordered document membership
      const memberRows = await db
        .select({
          documentId: collectionDocuments.documentId,
          position: collectionDocuments.position,
          addedAt: collectionDocuments.addedAt,
          addedBy: collectionDocuments.addedBy,
        })
        .from(collectionDocuments)
        .where(eq(collectionDocuments.collectionId, col.id))
        .orderBy(asc(collectionDocuments.position));

      const docIds = memberRows.map((r: any) => r.documentId);
      const docDetails =
        docIds.length > 0
          ? await db
              .select({
                id: documents.id,
                slug: documents.slug,
                format: documents.format,
                state: documents.state,
                tokenCount: documents.tokenCount,
                originalSize: documents.originalSize,
              })
              .from(documents)
              .where(inArray(documents.id, docIds))
          : [];

      const docMap = new Map<string, any>(docDetails.map((d: any) => [d.id, d]));

      const docsInOrder = memberRows
        .flatMap((r: any) => {
          const d = docMap.get(r.documentId);
          if (!d) return [];
          return [{
            id: d.id,
            slug: d.slug,
            format: d.format,
            state: d.state,
            tokenCount: d.tokenCount,
            originalSize: d.originalSize,
            position: r.position,
            addedAt: r.addedAt,
            addedBy: r.addedBy,
          }];
        });

      return reply.status(200).send({
        id: col.id,
        name: col.name,
        slug: col.slug,
        description: col.description,
        ownerId: col.ownerId,
        visibility: col.visibility,
        createdAt: col.createdAt,
        updatedAt: col.updatedAt,
        documents: docsInOrder,
      });
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

      const [col] = await db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug));

      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      if (!ownsCollection(col, user.id)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the collection owner can add documents' });
      }

      const bodyResult = addDocumentSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { documentSlug, position } = bodyResult.data;

      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, documentSlug));

      if (!doc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      }

      // Check for duplicate membership
      const [existing] = await db
        .select({ id: collectionDocuments.id })
        .from(collectionDocuments)
        .where(
          and(
            eq(collectionDocuments.collectionId, col.id),
            eq(collectionDocuments.documentId, doc.id)
          )
        );

      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `Document '${documentSlug}' is already in this collection`,
        });
      }

      // Determine position: use provided or append at end
      let effectivePosition = position;
      if (effectivePosition === undefined) {
        const lastRow = await db
          .select({ position: collectionDocuments.position })
          .from(collectionDocuments)
          .where(eq(collectionDocuments.collectionId, col.id))
          .orderBy(asc(collectionDocuments.position));

        effectivePosition =
          lastRow.length > 0 ? lastRow[lastRow.length - 1].position + 1 : 0;
      }

      const now = Date.now();
      const membershipId = generateId();

      await db.insert(collectionDocuments).values({
        id: membershipId,
        collectionId: col.id,
        documentId: doc.id,
        position: effectivePosition,
        addedBy: user.id,
        addedAt: now,
      });

      // Update collection updatedAt
      await db.update(collections).set({ updatedAt: now }).where(eq(collections.id, col.id));

      return reply.status(201).send({
        membershipId,
        collectionSlug: slug,
        documentSlug,
        position: effectivePosition,
        addedAt: now,
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

      const [col] = await db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug));

      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      if (!ownsCollection(col, user.id)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the collection owner can remove documents' });
      }

      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.slug, documentSlug));

      if (!doc) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document not found' });
      }

      const [membership] = await db
        .select({ id: collectionDocuments.id })
        .from(collectionDocuments)
        .where(
          and(
            eq(collectionDocuments.collectionId, col.id),
            eq(collectionDocuments.documentId, doc.id)
          )
        );

      if (!membership) {
        return reply.status(404).send({ error: 'Not Found', message: 'Document is not in this collection' });
      }

      await db.delete(collectionDocuments).where(eq(collectionDocuments.id, membership.id));

      const now = Date.now();
      await db.update(collections).set({ updatedAt: now }).where(eq(collections.id, col.id));

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

      const [col] = await db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug));

      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      if (!ownsCollection(col, user.id)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only the collection owner can reorder documents' });
      }

      const bodyResult = reorderSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.errors.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { documents: orderItems } = bodyResult.data;

      // Resolve document slugs to IDs
      const docSlugs = orderItems.map((item) => item.slug);
      const docRows = await db
        .select({ id: documents.id, slug: documents.slug })
        .from(documents)
        .where(inArray(documents.slug, docSlugs));

      const slugToId = new Map<string, string>(docRows.map((d: any) => [d.slug, d.id]));

      // Update positions
      const now = Date.now();
      for (const item of orderItems) {
        const docId = slugToId.get(item.slug);
        if (!docId) continue;

        await db
          .update(collectionDocuments)
          .set({ position: item.position })
          .where(
            and(
              eq(collectionDocuments.collectionId, col.id),
              eq(collectionDocuments.documentId, docId)
            )
          );
      }

      await db.update(collections).set({ updatedAt: now }).where(eq(collections.id, col.id));

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

      const [col] = await db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug));

      if (!col) return reply.status(404).send({ error: 'Not Found', message: 'Collection not found' });
      if (!canReadCollection(col, userId)) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied' });
      }

      // Fetch ordered members
      const memberRows = await db
        .select({
          documentId: collectionDocuments.documentId,
          position: collectionDocuments.position,
        })
        .from(collectionDocuments)
        .where(eq(collectionDocuments.collectionId, col.id))
        .orderBy(asc(collectionDocuments.position));

      const docIds = memberRows.map((r: any) => r.documentId);
      if (docIds.length === 0) {
        return reply.status(200).send({
          collection: slug,
          documentCount: 0,
          totalTokens: 0,
          content: '',
        });
      }

      type DocRow = {
        id: string;
        slug: string;
        format: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compressedData: any;
        tokenCount: number | null;
      };

      const docRows: DocRow[] = (await db
        .select({
          id: documents.id,
          slug: documents.slug,
          format: documents.format,
          compressedData: documents.compressedData,
          tokenCount: documents.tokenCount,
        })
        .from(documents)
        .where(inArray(documents.id, docIds))) as DocRow[];

      const docMap = new Map<string, DocRow>(docRows.map((d) => [d.id, d]));

      // Concatenate documents in order with separators
      const parts: string[] = [];
      let totalTokens = 0;
      let documentCount = 0;

      for (const member of memberRows) {
        const doc = docMap.get(member.documentId);
        if (!doc || !doc.compressedData) continue;

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

      const separator = '\n\n';
      const combined = parts.join(separator);

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
