/**
 * Lifecycle + Consensus routes: transition, approve, reject, approvals, contributors.
 */
import type { FastifyInstance } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, stateTransitions, approvals, versions, contributors } from '../db/schema.js';
import { requireRegistered, requireOwner } from '../middleware/auth.js';
import {
  validateTransition,
  isEditable,
  evaluateApprovals,
  markStaleReviews,
} from 'llmtxt/sdk';
import type { DocumentState, Review, ApprovalPolicy } from 'llmtxt/sdk';
import { generateId } from 'llmtxt';

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
  fastify.post<{ Params: { slug: string }; Body: { state: string; reason?: string } }>(
    '/documents/:slug/transition',
    { preHandler: [requireOwner] },
    async (request, reply) => {
      const { slug } = request.params;
      const { state: targetState, reason } = request.body;

      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });

      const currentState = doc[0].state as DocumentState;
      const result = validateTransition(currentState, targetState as DocumentState);

      if (!result.valid) {
        return reply.status(409).send({
          error: 'Invalid Transition',
          message: result.reason,
          allowedTargets: result.allowedTargets,
        });
      }

      const now = Date.now();
      await db.update(documents).set({ state: targetState }).where(eq(documents.slug, slug));
      await db.insert(stateTransitions).values({
        id: generateId(),
        documentId: doc[0].id,
        fromState: currentState,
        toState: targetState,
        changedBy: request.user!.id,
        changedAt: now,
        reason: reason ?? null,
        atVersion: doc[0].currentVersion,
      });

      return { slug, previousState: currentState, currentState: targetState, reason, changedAt: now };
    },
  );

  // POST /documents/:slug/approve
  fastify.post<{ Params: { slug: string }; Body: { comment?: string } }>(
    '/documents/:slug/approve',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const { slug } = request.params;
      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });
      if (doc[0].state !== 'REVIEW') {
        return reply.status(409).send({ error: 'Document must be in REVIEW state to approve' });
      }

      const now = Date.now();
      await db.insert(approvals).values({
        id: generateId(),
        documentId: doc[0].id,
        reviewerId: request.user!.id,
        status: 'APPROVED',
        timestamp: now,
        reason: request.body.comment ?? null,
        atVersion: doc[0].currentVersion,
      });

      const allReviews = await db.select().from(approvals).where(eq(approvals.documentId, doc[0].id));
      const policy = buildPolicy(doc[0]);
      const consensus = evaluateApprovals(toSdkReviews(allReviews), policy, doc[0].currentVersion);

      let autoLocked = false;
      if (consensus.approved) {
        await db.update(documents).set({ state: 'LOCKED' }).where(eq(documents.slug, slug));
        await db.insert(stateTransitions).values({
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

      return { slug, status: 'APPROVED', consensus, autoLocked };
    },
  );

  // POST /documents/:slug/reject
  fastify.post<{ Params: { slug: string }; Body: { comment: string } }>(
    '/documents/:slug/reject',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const { slug } = request.params;
      const doc = await db.select().from(documents).where(eq(documents.slug, slug)).limit(1);
      if (!doc.length) return reply.status(404).send({ error: 'Not Found' });
      if (doc[0].state !== 'REVIEW') {
        return reply.status(409).send({ error: 'Document must be in REVIEW state to reject' });
      }

      const now = Date.now();
      await db.insert(approvals).values({
        id: generateId(),
        documentId: doc[0].id,
        reviewerId: request.user!.id,
        status: 'REJECTED',
        timestamp: now,
        reason: request.body.comment,
        atVersion: doc[0].currentVersion,
      });

      const allReviews = await db.select().from(approvals).where(eq(approvals.documentId, doc[0].id));
      const policy = buildPolicy(doc[0]);
      const consensus = evaluateApprovals(toSdkReviews(allReviews), policy, doc[0].currentVersion);

      return { slug, status: 'REJECTED', consensus };
    },
  );

  // GET /documents/:slug/approvals
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/approvals',
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
