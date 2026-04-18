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
import { writeRateLimit } from '../middleware/rate-limit.js';
import { KNOWN_INSECURE_SIGNING_SECRETS } from '../lib/signing-secret-validator.js';

// The production fail-fast check for SIGNING_SECRET is performed once at
// process start in index.ts (T108.6 / T472).  This module only needs the
// constant list to derive the effective runtime secret safely.

const SIGNING_SECRET = process.env.SIGNING_SECRET ?? '';

// Fall back to dev secret in non-production only (index.ts exits before here in prod)
const _effectiveSigningSecret = KNOWN_INSECURE_SIGNING_SECRETS.has(SIGNING_SECRET)
  ? 'llmtxt-dev-secret'
  : SIGNING_SECRET;

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
    { preHandler: [requireOwnerAllowAnon], config: writeRateLimit },
    async (request, reply) => {
      const { slug, agentId, conversationId, expiresIn = 3600000 } = request.body;

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const signingKey = deriveSigningKey(_effectiveSigningSecret);
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
