/**
 * Lifecycle + Consensus routes: transition, approve, reject, approvals, contributors.
 */
import type { FastifyInstance } from 'fastify';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, stateTransitions, approvals, versions, contributors } from '../db/schema.js';
import { requireAuth, requireOwner, requireOwnerAllowAnonParams } from '../middleware/auth.js';
import { canWrite, canApprove, canRead } from '../middleware/rbac.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import {
  validateTransition,
  isEditable,
  evaluateApprovals,
  markStaleReviews,
} from 'llmtxt/sdk';
import type { DocumentState, Review, ApprovalPolicy } from 'llmtxt/sdk';
import { generateId } from 'llmtxt';
import { invalidateDocumentCache } from '../middleware/cache.js';
import { eventBus } from '../events/bus.js';
import { documentApprovalSubmittedTotal, documentStateTransitionTotal } from '../middleware/metrics.js';
import { appendDocumentEvent } from '../lib/document-events.js';

function buildPolicy(doc: {
  approvalRequiredCount: number;
  approvalRequireUnanimous: boolean;
  approvalAllowedReviewers: string;
  approvalTimeoutMs: number;
}): ApprovalPolicy {
  return {
    requiredCount: doc.approvalRequiredCount,
    requireUnanimous: doc.approvalRequireUnanimous,
    allowedReviewerIds: doc.approvalAllowedReviewers
      ? doc.approvalAllowedReviewers.split(',').filter(Boolean)
      : [],
    timeoutMs: doc.approvalTimeoutMs,
  };
}

function toSdkReviews(rows: Array<{
  reviewerId: string;
  status: string;
  timestamp: number;
  reason: string | null;
  atVersion: number;
}>): Review[] {
  return rows.map(r => ({
    reviewerId: r.reviewerId,
    status: r.status as Review['status'],
    timestamp: r.timestamp,
    reason: r.reason ?? undefined,
    atVersion: r.atVersion,
  }));
}

/** Register lifecycle and consensus routes: state transitions, approve/reject voting, approval listing, and contributor attribution. */
export async function lifecycleRoutes(fastify: FastifyInstance) {
  // POST /documents/:slug/transition
  fastify.post<{ Params: { slug: string }; Body: { state?: string; targetState?: string; reason?: string } }>(
    '/documents/:slug/transition',
    { preHandler: [canWrite, requireOwnerAllowAnonParams], config: writeRateLimit },
    async (request, reply) => {
      const { slug } = request.params;
      const { state, targetState, reason } = request.body;

      const effectiveState = state || targetState;
      if (!effectiveState) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: "Either 'state' or 'targetState' is required",
        });
      }

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const currentState = doc[0].state as DocumentState;
      const result = validateTransition(currentState, effectiveState as DocumentState);

      if (!result.valid) {
        return reply.status(409).send({
          error: 'Invalid Transition',
          message: result.reason,
          allowedTargets: result.allowedTargets,
        });
      }

      const now = Date.now();
      const actorId = request.user!.id;
      const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'] ?? null;

      await db.transaction(async (tx: typeof db) => {
        await tx.update(documents).set({ state: effectiveState }).where(eq(documents.slug, slug));
        await tx.insert(stateTransitions).values({
          id: generateId(),
          documentId: doc[0].id,
          fromState: currentState,
          toState: effectiveState,
          changedBy: actorId,
          changedAt: now,
          reason: reason ?? null,
          atVersion: doc[0].currentVersion,
        });

        // When reopening for edits, clear rejection records so the next
        // review cycle starts clean.
        if (currentState === 'REVIEW' && effectiveState === 'DRAFT') {
          await tx.delete(approvals)
            .where(
              and(
                eq(approvals.documentId, doc[0].id),
                eq(approvals.status, 'REJECTED')
              )
            );
        }

        await appendDocumentEvent(tx, {
          documentId: slug,
          eventType: 'lifecycle.transitioned',
          actorId,
          payloadJson: { fromState: currentState, toState: effectiveState, reason: reason ?? null },
          idempotencyKey,
        });
      });

      documentStateTransitionTotal.inc({ from_state: currentState, to_state: effectiveState });

      invalidateDocumentCache(slug);

      // Emit state.changed (or document.locked / document.archived) — non-blocking.
      eventBus.emitStateChanged(slug, doc[0].id, actorId, {
        fromState: currentState,
        toState: effectiveState,
        reason: reason ?? null,
      });

      return { slug, previousState: currentState, currentState: effectiveState, reason, changedAt: now };
    },
  );

  // POST /documents/:slug/approve
  fastify.post<{ Params: { slug: string }; Body: { comment?: string } }>(
    '/documents/:slug/approve',
    { preHandler: [canApprove], config: writeRateLimit },
    async (request, reply) => {
      const { slug } = request.params;
      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });
      if (doc[0].state !== 'REVIEW') {
        return reply.status(409).send({ error: 'Document must be in REVIEW state to approve' });
      }

      const existingApproval = await db.select()
        .from(approvals)
        .where(and(
          eq(approvals.documentId, doc[0].id),
          eq(approvals.reviewerId, request.user!.id),
          eq(approvals.status, 'APPROVED'),
        ))
        .limit(1);

      if (existingApproval.length > 0) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'You have already approved this document',
        });
      }

      const now = Date.now();
      const actorId = request.user!.id;
      const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'] ?? null;
      let autoLocked = false;
      let consensus: ReturnType<typeof evaluateApprovals>;

      await db.transaction(async (tx: typeof db) => {
        await tx.insert(approvals).values({
          id: generateId(),
          documentId: doc[0].id,
          reviewerId: actorId,
          status: 'APPROVED',
          timestamp: now,
          reason: request.body.comment ?? null,
          atVersion: doc[0].currentVersion,
        });

        const allReviews = await tx.select().from(approvals).where(eq(approvals.documentId, doc[0].id));
        const policy = buildPolicy(doc[0]);
        consensus = evaluateApprovals(toSdkReviews(allReviews), policy, doc[0].currentVersion);

        if (consensus.approved) {
          const lockResult = await tx.update(documents)
            .set({ state: 'LOCKED' })
            .where(and(
              eq(documents.id, doc[0].id),
              eq(documents.state, 'REVIEW'),
            ))
            .returning({ state: documents.state });

          if (lockResult.length > 0) {
            await tx.insert(stateTransitions).values({
              id: generateId(),
              documentId: doc[0].id,
              fromState: 'REVIEW',
              toState: 'LOCKED',
              changedBy: 'system',
              changedAt: now,
              reason: 'Auto-locked: consensus reached',
              atVersion: doc[0].currentVersion,
            });
            autoLocked = true;
          }
        }

        await appendDocumentEvent(tx, {
          documentId: slug,
          eventType: 'approval.submitted',
          actorId,
          payloadJson: { status: 'APPROVED', atVersion: doc[0].currentVersion, autoLocked },
          idempotencyKey,
        });
      });

      documentApprovalSubmittedTotal.inc({ status: 'approved' });

      invalidateDocumentCache(slug);

      // Emit approval event — non-blocking.
      eventBus.emitApprovalSubmitted(slug, doc[0].id, actorId, {
        status: 'APPROVED',
        atVersion: doc[0].currentVersion,
        autoLocked,
      });

      // If auto-lock happened, also emit the state.changed / document.locked event.
      if (autoLocked) {
        eventBus.emitStateChanged(slug, doc[0].id, 'system', {
          fromState: 'REVIEW',
          toState: 'LOCKED',
          reason: 'Auto-locked: consensus reached',
        });
      }

      return { slug, status: 'APPROVED', consensus: consensus!, autoLocked };
    },
  );

  // POST /documents/:slug/reject
  fastify.post<{ Params: { slug: string }; Body: { comment: string } }>(
    '/documents/:slug/reject',
    { preHandler: [canApprove], config: writeRateLimit },
    async (request, reply) => {
      const { slug } = request.params;
      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });
      if (doc[0].state !== 'REVIEW') {
        return reply.status(409).send({ error: 'Document must be in REVIEW state to reject' });
      }

      const existingRejection = await db.select()
        .from(approvals)
        .where(and(
          eq(approvals.documentId, doc[0].id),
          eq(approvals.reviewerId, request.user!.id),
          eq(approvals.status, 'REJECTED'),
        ))
        .limit(1);

      if (existingRejection.length > 0) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'You have already rejected this document',
        });
      }

      const now = Date.now();
      const actorId = request.user!.id;
      const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'] ?? null;
      let consensus: ReturnType<typeof evaluateApprovals>;

      await db.transaction(async (tx: typeof db) => {
        await tx.insert(approvals).values({
          id: generateId(),
          documentId: doc[0].id,
          reviewerId: actorId,
          status: 'REJECTED',
          timestamp: now,
          reason: request.body.comment,
          atVersion: doc[0].currentVersion,
        });

        const allReviews = await tx.select().from(approvals).where(eq(approvals.documentId, doc[0].id));
        const policy = buildPolicy(doc[0]);
        consensus = evaluateApprovals(toSdkReviews(allReviews), policy, doc[0].currentVersion);

        await appendDocumentEvent(tx, {
          documentId: slug,
          eventType: 'approval.rejected',
          actorId,
          payloadJson: { status: 'REJECTED', atVersion: doc[0].currentVersion },
          idempotencyKey,
        });
      });

      documentApprovalSubmittedTotal.inc({ status: 'rejected' });

      invalidateDocumentCache(slug);

      // Emit rejection event — non-blocking.
      eventBus.emitApprovalSubmitted(slug, doc[0].id, actorId, {
        status: 'REJECTED',
        atVersion: doc[0].currentVersion,
      });

      return { slug, status: 'REJECTED', consensus: consensus! };
    },
  );

  // GET /documents/:slug/approvals
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/approvals',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;
      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const rows = await db.select().from(approvals)
        .where(eq(approvals.documentId, doc[0].id))
        .orderBy(desc(approvals.timestamp));

      const policy = buildPolicy(doc[0]);
      const consensus = evaluateApprovals(toSdkReviews(rows), policy, doc[0].currentVersion);

      return { slug, state: doc[0].state, reviews: rows, consensus };
    },
  );

  // GET /documents/:slug/contributors
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/contributors',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;
      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const rows = await db.select().from(contributors)
        .where(eq(contributors.documentId, doc[0].id))
        .orderBy(desc(contributors.netTokens));

      return { slug, totalContributors: rows.length, contributors: rows };
    },
  );
}
