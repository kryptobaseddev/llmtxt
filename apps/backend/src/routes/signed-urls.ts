/**
 * Signed URL routes: generate and verify time-limited access tokens.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, signedUrlTokens } from '../db/schema.js';
import { requireOwnerAllowAnon } from '../middleware/auth.js';
import {
  generateSignedUrl, deriveSigningKey, generateId,
} from 'llmtxt';

const SIGNING_SECRET = process.env.SIGNING_SECRET || 'llmtxt-dev-secret';

/** Register signed URL route: POST /signed-urls to generate time-limited HMAC-signed access tokens for document retrieval. Requires owner authentication. */
export async function signedUrlRoutes(fastify: FastifyInstance) {
  // POST /signed-urls
  fastify.post<{
    Body: {
      slug: string;
      agentId: string;
      conversationId: string;
      expiresIn?: number;
    };
  }>(
    '/signed-urls',
    { preHandler: [requireOwnerAllowAnon] },
    async (request, reply) => {
      const { slug, agentId, conversationId, expiresIn = 3600000 } = request.body;

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const signingKey = deriveSigningKey(SIGNING_SECRET);
      const expiresAt = Date.now() + expiresIn;

      const url = generateSignedUrl(
        { slug, agentId, conversationId, expiresAt },
        {
          secret: signingKey,
          baseUrl: process.env.BASE_URL || 'https://api.llmtxt.my',
          pathPrefix: 'documents',
          signatureLength: 32,
        },
      );

      // Persist the token
      await db.insert(signedUrlTokens).values({
        id: generateId(),
        documentId: doc[0].id,
        slug,
        agentId,
        conversationId,
        signature: url.split('sig=')[1] || '',
        signatureLength: 32,
        expiresAt,
        createdAt: Date.now(),
      });

      reply.status(201);
      return { url, slug, agentId, conversationId, expiresAt };
    },
  );
}
