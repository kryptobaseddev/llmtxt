/**
 * Content size and resource count limits for LLMtxt API.
 *
 * Hard limits enforced as preHandler hooks. These cannot be bypassed
 * regardless of authentication tier. They protect against:
 *   - Extremely large document uploads exhausting memory/storage
 *   - Runaway document or key accumulation per user
 *   - Oversized patch submissions
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../db/index.js';
import { documents } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

/** Hard content and resource limits. */
export const CONTENT_LIMITS = {
  /** Maximum document content size: 10MB. */
  maxDocumentSize: 10 * 1024 * 1024,
  /** Maximum patch content size: 1MB. */
  maxPatchSize: 1 * 1024 * 1024,
  /** Maximum items in batch requests. */
  maxBatchSize: 50,
  /** Maximum version history per document. */
  maxVersionsPerDocument: 1000,
  /** Maximum documents owned per user. */
  maxDocumentsPerUser: 10_000,
  /** Maximum signed URL tokens per user (future use). */
  maxWebhooksPerUser: 20,
  /** Maximum cherry-pick merge sources per request. */
  maxMergeSources: 10,
} as const;

/**
 * Enforce the maximum document content size.
 *
 * Reads `content` from the request body and rejects with 413 if
 * the UTF-8 byte length exceeds CONTENT_LIMITS.maxDocumentSize.
 * Safe to call on any route that accepts a `content` body field.
 */
export async function enforceContentSize(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { content?: string } | null;
  if (!body?.content) return;

  const byteLength = Buffer.byteLength(body.content, 'utf-8');
  if (byteLength > CONTENT_LIMITS.maxDocumentSize) {
    const limitMb = CONTENT_LIMITS.maxDocumentSize / 1024 / 1024;
    return reply.status(413).send({
      error: 'Content Too Large',
      message: `Document content exceeds the ${limitMb}MB limit (${byteLength} bytes received).`,
      limit: CONTENT_LIMITS.maxDocumentSize,
    });
  }
}

/**
 * Enforce the maximum patch content size.
 *
 * Reads `patchText` from the request body and rejects with 413 if
 * its byte length exceeds CONTENT_LIMITS.maxPatchSize.
 */
export async function enforcePatchSize(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as { patchText?: string } | null;
  if (!body?.patchText) return;

  const byteLength = Buffer.byteLength(body.patchText, 'utf-8');
  if (byteLength > CONTENT_LIMITS.maxPatchSize) {
    const limitMb = CONTENT_LIMITS.maxPatchSize / 1024 / 1024;
    return reply.status(413).send({
      error: 'Content Too Large',
      message: `Patch content exceeds the ${limitMb}MB limit (${byteLength} bytes received).`,
      limit: CONTENT_LIMITS.maxPatchSize,
    });
  }
}

/**
 * Enforce the maximum number of documents per authenticated user.
 *
 * Counts documents owned by request.user.id and rejects with 429 if
 * at or above CONTENT_LIMITS.maxDocumentsPerUser. Skips the check for
 * unauthenticated requests (anonymous creation still allowed up to the
 * rate limit; ownership won't accumulate).
 */
export async function enforceDocumentLimit(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user?.id) return;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(eq(documents.ownerId, request.user.id));

  const count = Number(result[0]?.count ?? 0);
  if (count >= CONTENT_LIMITS.maxDocumentsPerUser) {
    return reply.status(429).send({
      error: 'Limit Exceeded',
      message: `Maximum ${CONTENT_LIMITS.maxDocumentsPerUser} documents per user. Delete unused documents to create new ones.`,
      limit: CONTENT_LIMITS.maxDocumentsPerUser,
      current: count,
    });
  }
}
