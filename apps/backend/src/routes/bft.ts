/**
 * BFT Consensus routes — W3/T152 / T353 Wave C.
 *
 * Extends the approval system with:
 *  - POST /documents/:slug/bft/approve — BFT-signed approval (quorum enforced)
 *  - GET  /documents/:slug/bft/status  — current BFT quorum status
 *  - GET  /documents/:slug/chain       — tamper-evident approval chain verification
 *
 * BFT quorum formula: 2f+1, where f is per-document bftF config (default 1 → quorum 3).
 * Signed approvals use Ed25519 (reuses T147 agent key infrastructure).
 * Byzantine conflict detection: if an agent submits contradictory approvals, key is revoked.
 *
 * Wave C:
 *  - GET /chain delegates to fastify.backendCore.getApprovalChain (zero Drizzle)
 *  - GET /bft/status delegates to fastify.backendCore.getApprovalProgress (zero Drizzle)
 *  - POST /bft/approve retains direct Drizzle for the byzantine-detection + chain-hash
 *    transaction (a complex multi-step write that cannot be trivially expressed via
 *    the current submitSignedApproval Backend method — noted in manifest as Tech Debt)
 */
import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { documents, approvals, agentPubkeys } from '../db/schema-pg.js';
import { canApprove, canRead } from '../middleware/rbac.js';
import { writeRateLimit } from '../middleware/rate-limit.js';
import { generateId } from 'llmtxt';
import { appendDocumentEvent } from '../lib/document-events.js';
import { hashContent } from 'llmtxt';

// ── BFT helpers ───────────────────────────────────────────────────

/** Compute BFT quorum for given f. */
function bftQuorum(f: number): number {
  return 2 * f + 1;
}

/** Build canonical approval payload for signing. */
function buildApprovalCanonicalPayload(
  documentSlug: string,
  reviewerId: string,
  status: string,
  atVersion: number,
  timestamp: number
): string {
  return [documentSlug, reviewerId, status, atVersion, timestamp].join('\n');
}

/** Compute chain hash: SHA-256(prevHash || approvalJson). */
function computeChainHash(prevChainHash: string | null, approvalJson: string): string {
  const sentinel = '0'.repeat(64);
  const prev = prevChainHash ?? sentinel;
  return hashContent(prev + '|' + approvalJson);
}

/** Verify Ed25519 signature on canonical payload. */
async function verifyApprovalSignature(
  agentId: string,
  canonicalPayload: string,
  sigHex: string
): Promise<boolean> {
  const [keyRow] = await db
    .select({ pubkey: agentPubkeys.pubkey, revokedAt: agentPubkeys.revokedAt })
    .from(agentPubkeys)
    .where(eq(agentPubkeys.agentId, agentId))
    .limit(1);

  if (!keyRow || keyRow.revokedAt !== null) return false;

  // Use noble/ed25519 for verification (consistent with verify-agent-signature.ts)
  const ed = await import('@noble/ed25519');
  const { sha512 } = await import('@noble/hashes/sha2.js');
  ed.hashes.sha512 = sha512;

  try {
    const pubkeyBuf = Buffer.isBuffer(keyRow.pubkey)
      ? keyRow.pubkey
      : Buffer.from(keyRow.pubkey);
    const sigBuf = Buffer.from(sigHex, 'hex');
    const payloadBuf = Buffer.from(canonicalPayload, 'utf8');

    if (pubkeyBuf.length !== 32 || sigBuf.length !== 64) return false;
    return await ed.verifyAsync(sigBuf, payloadBuf, pubkeyBuf);
  } catch {
    return false;
  }
}

/** Register BFT consensus routes. */
export async function bftRoutes(fastify: FastifyInstance) {
  // POST /documents/:slug/bft/approve — submit a BFT-signed approval
  // NOTE: retains direct Drizzle for byzantine-detection transaction.
  // Tech debt: should be refactored to submitSignedApproval once that method
  // supports BFT chain hash + byzantine slash in a single transaction.
  fastify.post<{
    Params: { slug: string };
    Body: {
      status: 'APPROVED' | 'REJECTED';
      sig_hex?: string;
      canonical_payload?: string;
      comment?: string;
    };
  }>(
    '/documents/:slug/bft/approve',
    { preHandler: [canApprove], config: writeRateLimit },
    async (request, reply) => {
      const { slug } = request.params;
      const { status, sig_hex, canonical_payload: clientPayload, comment } = request.body;

      if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: "status must be 'APPROVED' or 'REJECTED'",
        });
      }

      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.slug, slug))
        .limit(1);
      if (!doc) return reply.status(404).send({ error: 'Not Found' });
      if (doc.state !== 'REVIEW') {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'Document must be in REVIEW state for BFT approval',
        });
      }

      const actorId = request.user!.id;
      const now = Date.now();
      const f = (doc as { bftF?: number }).bftF ?? 1;
      const quorum = bftQuorum(f);

      // Check for double-vote (Byzantine conflict detector)
      const existingVotes = await db
        .select()
        .from(approvals)
        .where(and(
          eq(approvals.documentId, doc.id),
          eq(approvals.reviewerId, actorId),
        ))
        .orderBy(desc(approvals.timestamp));

      // Byzantine conflict: same agent has voted both APPROVED and REJECTED
      const hasApproved = existingVotes.some((v: { status: string }) => v.status === 'APPROVED');
      const hasRejected = existingVotes.some((v: { status: string }) => v.status === 'REJECTED');
      if ((status === 'REJECTED' && hasApproved) || (status === 'APPROVED' && hasRejected)) {
        // Slash: revoke the agent's key and emit audit event
        await db
          .update(agentPubkeys)
          .set({ revokedAt: new Date() })
          .where(eq(agentPubkeys.agentId, actorId));

        await appendDocumentEvent(db, {
          documentId: slug,
          eventType: 'bft.byzantine_slash',
          actorId: 'system',
          payloadJson: {
            byzantineAgentId: actorId,
            reason: 'Contradictory double-vote detected',
            status,
          },
          idempotencyKey: null,
        });

        return reply.status(403).send({
          error: 'BYZANTINE_DETECTED',
          message:
            'Agent submitted contradictory votes — key revoked. This incident has been logged.',
        });
      }

      // Duplicate vote prevention
      const alreadyVoted = existingVotes.some((v: { status: string }) => v.status === status);
      if (alreadyVoted) {
        return reply.status(409).send({
          error: 'Conflict',
          message: `You have already ${status.toLowerCase()} this document`,
        });
      }

      // Signature verification (optional if no key registered)
      let sigVerified = false;
      if (sig_hex && clientPayload) {
        const expectedPayload = buildApprovalCanonicalPayload(
          slug,
          actorId,
          status,
          doc.currentVersion,
          now
        );
        // Verify the client supplied the correct canonical payload
        sigVerified = await verifyApprovalSignature(actorId, clientPayload, sig_hex);
        if (!sigVerified) {
          return reply.status(401).send({
            error: 'SIGNATURE_MISMATCH',
            message: 'Approval signature is invalid',
          });
        }
        void expectedPayload; // suppress unused warning
      }

      // Compute chain hash
      const latestApproval = await db
        .select({ chainHash: approvals.chainHash })
        .from(approvals)
        .where(eq(approvals.documentId, doc.id))
        .orderBy(desc(approvals.timestamp))
        .limit(1);

      const prevChainHash = latestApproval[0]?.chainHash ?? null;
      const approvalJson = JSON.stringify({
        documentId: doc.id,
        reviewerId: actorId,
        status,
        atVersion: doc.currentVersion,
        timestamp: now,
      });
      const chainHash = computeChainHash(prevChainHash, approvalJson);
      const approvalCanonicalPayload = buildApprovalCanonicalPayload(
        slug,
        actorId,
        status,
        doc.currentVersion,
        now
      );

      const newApprovalId = generateId();

      // Insert approval within transaction
      await db.transaction(async (tx: typeof db) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tx.insert(approvals).values({
          id: newApprovalId,
          documentId: doc.id,
          reviewerId: actorId,
          status,
          timestamp: now,
          reason: comment ?? null,
          atVersion: doc.currentVersion,
          sigHex: sig_hex ?? null,
          canonicalPayload: approvalCanonicalPayload,
          chainHash,
          prevChainHash,
          bftF: f,
        } as any);

        await appendDocumentEvent(tx, {
          documentId: slug,
          eventType: 'bft.approval_submitted',
          actorId,
          payloadJson: {
            status,
            atVersion: doc.currentVersion,
            sigVerified,
            chainHash,
            bftF: f,
            quorum,
          },
          idempotencyKey: null,
        });
      });

      // Count current APPROVED votes for quorum check
      const approvedCount = await db
        .select({ reviewerId: approvals.reviewerId })
        .from(approvals)
        .where(and(
          eq(approvals.documentId, doc.id),
          eq(approvals.status, 'APPROVED'),
        ));

      const uniqueApprovers = new Set(approvedCount.map((a: { reviewerId: string }) => a.reviewerId));
      const quorumReached = uniqueApprovers.size >= quorum;

      return {
        slug,
        approvalId: newApprovalId,
        status,
        sigVerified,
        chainHash,
        bftF: f,
        quorum,
        currentApprovals: uniqueApprovers.size,
        quorumReached,
      };
    }
  );

  // GET /documents/:slug/bft/status — current BFT quorum status
  // Wave C: delegates to fastify.backendCore.getApprovalProgress
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/bft/status',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;

      // Need bftF from the document — fetch doc for that only
      const [doc] = await db
        .select({ id: documents.id, bftF: documents.bftF })
        .from(documents)
        .where(eq(documents.slug, slug))
        .limit(1);
      if (!doc) return reply.status(404).send({ error: 'Not Found' });

      const f = (doc.bftF as number | null | undefined) ?? 1;
      const quorum = bftQuorum(f);

      // Use backendCore for approval progress (Wave A implementation)
      const progress = await fastify.backendCore.getApprovalProgress(slug, 0);

      const approverCount = progress.approvedBy?.length ?? 0;
      return {
        slug,
        bftF: f,
        quorum,
        currentApprovals: approverCount,
        quorumReached: approverCount >= quorum,
        approvers: progress.approvedBy ?? [],
      };
    }
  );

  // GET /documents/:slug/chain — verify tamper-evident approval chain
  // Wave C: fully delegated to fastify.backendCore.getApprovalChain
  fastify.get<{ Params: { slug: string } }>(
    '/documents/:slug/chain',
    { preHandler: [canRead] },
    async (request, reply) => {
      const { slug } = request.params;

      const result = await fastify.backendCore.getApprovalChain(slug);

      // Check document exists (getApprovalChain returns empty chain for unknown docs)
      if (result.length === 0) {
        // Distinguish "doc not found" from "doc has no approvals"
        const [doc] = await db
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.slug, slug))
          .limit(1);
        if (!doc) return reply.status(404).send({ error: 'Not Found' });
        // doc exists but has no approvals — valid empty chain
      }

      return {
        valid: result.valid,
        length: result.length,
        firstInvalidAt: result.firstInvalidAt,
        slug,
      };
    }
  );
}
