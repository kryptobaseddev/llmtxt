/**
 * Lifecycle + Consensus routes: transition, approve, reject, approvals, contributors.
 */
import type { FastifyInstance } from 'fastify';
// db and direct schema/drizzle imports removed — write ops delegated to backendCore.
// Only appendDocumentEvent is no longer needed; evaluateApprovals still used for GET /approvals.
import { requireOwnerAllowAnonParams } from '../middleware/auth.js';
import { canWrite, canApprove, canRead } from '../middleware/rbac.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import {
  evaluateApprovals,
} from 'llmtxt/sdk';
import type { DocumentState, Review, ApprovalPolicy } from 'llmtxt/sdk';
import { invalidateDocumentCache } from '../middleware/cache.js';
import { eventBus } from '../events/bus.js';
import { documentApprovalSubmittedTotal, documentStateTransitionTotal } from '../middleware/metrics.js';

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

      const actorId = request.user!.id;
      const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'] ?? null;
      const now = Date.now();

      // Pre-flight: look up document to capture current state for metrics / events.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existingDoc = (await request.server.backendCore.getDocumentBySlug(slug)) as any;
      if (!existingDoc) return reply.status(404).send({ error: 'Not Found' });
      const currentState = existingDoc.state as DocumentState;

      // Delegate the transaction (state update + audit row + event log) to
      // PostgresBackend.transitionVersion.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await request.server.backendCore.transitionVersion({
        documentId: slug,
        to: effectiveState as DocumentState,
        changedBy: actorId,
        reason: reason,
        idempotencyKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as any;

      if (!result.success) {
        // Invalid transition (state machine rejection)
        return reply.status(409).send({
          error: 'Invalid Transition',
          message: result.error,
          allowedTargets: result.allowedTargets,
        });
      }

      documentStateTransitionTotal.inc({ from_state: currentState, to_state: effectiveState });

      invalidateDocumentCache(slug);

      // Emit state.changed — non-blocking.
      eventBus.emitStateChanged(slug, existingDoc.id, actorId, {
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

      // Pre-flight: fetch doc for currentVersion (needed for metrics + events).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (await request.server.backendCore.getDocumentBySlug(slug)) as any;
      if (!doc) return reply.status(404).send({ error: 'Not Found' });
      if (doc.state !== 'REVIEW') {
        return reply.status(409).send({ error: 'Document must be in REVIEW state to approve' });
      }

      const actorId = request.user!.id;
      const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'] ?? null;

      // Delegate the transaction (insert approval + consensus + auto-lock + event)
      // to PostgresBackend.submitSignedApproval.
      const result = await request.server.backendCore.submitSignedApproval({
        documentId: slug,
        versionNumber: doc.currentVersion ?? 0,
        reviewerId: actorId,
        status: 'APPROVED',
        reason: request.body.comment,
        signatureBase64: '',
        // Extended fields:
        idempotencyKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      if (!result.success) {
        if (result.error === 'duplicate approved') {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'You have already approved this document',
          });
        }
        if (result.error === 'Document must be in REVIEW state') {
          return reply.status(409).send({ error: result.error });
        }
        return reply.status(400).send({ error: result.error });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const consensus = result.result as any;
      const autoLocked = consensus?.autoLocked ?? false;

      documentApprovalSubmittedTotal.inc({ status: 'approved' });
      invalidateDocumentCache(slug);

      // Emit approval event — non-blocking.
      eventBus.emitApprovalSubmitted(slug, doc.id, actorId, {
        status: 'APPROVED',
        atVersion: doc.currentVersion,
        autoLocked,
      });

      if (autoLocked) {
        eventBus.emitStateChanged(slug, doc.id, 'system', {
          fromState: 'REVIEW',
          toState: 'LOCKED',
          reason: 'Auto-locked: consensus reached',
        });
      }

      return { slug, status: 'APPROVED', consensus, autoLocked };
    },
  );

  // POST /documents/:slug/reject
  fastify.post<{ Params: { slug: string }; Body: { comment: string } }>(
    '/documents/:slug/reject',
    { preHandler: [canApprove], config: writeRateLimit },
    async (request, reply) => {
      const { slug } = request.params;

      // Pre-flight: fetch doc for currentVersion (needed for metrics + events).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (await request.server.backendCore.getDocumentBySlug(slug)) as any;
      if (!doc) return reply.status(404).send({ error: 'Not Found' });
      if (doc.state !== 'REVIEW') {
        return reply.status(409).send({ error: 'Document must be in REVIEW state to reject' });
      }

      const actorId = request.user!.id;
      const idempotencyKey = (request.headers as Record<string, string>)['idempotency-key'] ?? null;

      // Delegate the transaction (insert rejection + consensus + event)
      // to PostgresBackend.submitSignedApproval.
      const result = await request.server.backendCore.submitSignedApproval({
        documentId: slug,
        versionNumber: doc.currentVersion ?? 0,
        reviewerId: actorId,
        status: 'REJECTED',
        reason: request.body.comment,
        signatureBase64: '',
        idempotencyKey,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      if (!result.success) {
        if (result.error === 'duplicate rejected') {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'You have already rejected this document',
          });
        }
        if (result.error === 'Document must be in REVIEW state') {
          return reply.status(409).send({ error: result.error });
        }
        return reply.status(400).send({ error: result.error });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const consensus = result.result as any;

      documentApprovalSubmittedTotal.inc({ status: 'rejected' });
      invalidateDocumentCache(slug);

      // Emit rejection event — non-blocking.
      eventBus.emitApprovalSubmitted(slug, doc.id, actorId, {
        status: 'REJECTED',
        atVersion: doc.currentVersion,
      });

      return { slug, status: 'REJECTED', consensus };
    },
  );

  // GET /documents/:slug/approvals
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/approvals',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;

      // Wave A: delegate to backendCore.getApprovalProgress
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await request.server.backendCore.getApprovalProgress(slug, 0)) as any;
      if (!data) return reply.status(404).send({ error: 'Not Found' });

      const { doc, reviews: rows } = data;

      const policy = buildPolicy(doc);
      const consensus = evaluateApprovals(toSdkReviews(rows), policy, doc.currentVersion as number);

      return { slug, state: doc.state, reviews: rows, consensus };
    },
  );

  // GET /documents/:slug/contributors
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/contributors',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;

      // Wave A: delegate to backendCore.listContributors
      // First verify doc exists via getDocumentBySlug
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = (await request.server.backendCore.getDocumentBySlug(slug)) as any;
      if (!doc) return reply.status(404).send({ error: 'Not Found' });

      const rows = await request.server.backendCore.listContributors(slug);

      return { slug, totalContributors: rows.length, contributors: rows };
    },
  );
}
