/**
 * T164: GET /api/v1/audit/verify — tamper-evident audit log verification endpoint.
 *
 * Re-derives every stored chain_hash from the sequence of audit_log rows and
 * reports whether the chain is intact. Also reports the last checkpoint date
 * and whether it has an RFC 3161 TSR token.
 *
 * Response (chain intact):
 *   { valid: true, chainLength: N, lastCheckpointAt: ISO8601|null, tsrAnchored: bool }
 *
 * Response (chain broken):
 *   { valid: false, firstInvalidAt: "<row_id>", chainLength: N, lastCheckpointAt: ISO8601|null }
 *
 * Authentication: admin required (uses requireAuth; production callers should
 * additionally check for admin role — see access-control.ts).
 */

import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, isNotNull, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLogs, auditCheckpoints } from '../db/schema-pg.js';
import { requireAuth } from '../middleware/auth.js';

// ── Hash verification helpers ────────────────────────────────────────────────

const GENESIS_HASH = '0'.repeat(64);

function sha256hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function canonicalEventStr(
  id: string,
  eventType: string | null,
  actorId: string | null,
  resourceId: string | null,
  timestampMs: number,
): string {
  return [id, eventType ?? '', actorId ?? '', resourceId ?? '', String(timestampMs)].join('|');
}

function computeChainHash(prevChainHashHex: string, payloadHashHex: string): string {
  const prev = Buffer.from(prevChainHashHex, 'hex');
  const payload = Buffer.from(payloadHashHex, 'hex');
  return crypto.createHash('sha256').update(prev).update(payload).digest('hex');
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function auditVerifyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/audit/verify',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      // 1. Fetch all chained rows ordered by timestamp.
      const rows = await db
        .select({
          id: auditLogs.id,
          eventType: auditLogs.eventType,
          actorId: auditLogs.actorId,
          resourceId: auditLogs.resourceId,
          timestamp: auditLogs.timestamp,
          payloadHash: auditLogs.payloadHash,
          chainHash: auditLogs.chainHash,
        })
        .from(auditLogs)
        .where(isNotNull(auditLogs.chainHash))
        .orderBy(asc(auditLogs.timestamp));

      // 2. Verify each row.
      let prevChainHash = GENESIS_HASH;
      let firstInvalidAt: string | null = null;
      let chainLength = 0;

      for (const row of rows) {
        chainLength++;

        // Re-derive payload_hash from canonical serialization.
        const expectedPayloadHash = sha256hex(
          canonicalEventStr(row.id, row.eventType, row.actorId, row.resourceId, row.timestamp),
        );

        // Re-derive chain_hash from prev + payload.
        const expectedChainHash = computeChainHash(prevChainHash, expectedPayloadHash);

        if (
          row.payloadHash !== expectedPayloadHash ||
          row.chainHash !== expectedChainHash
        ) {
          firstInvalidAt = row.id;
          break;
        }

        prevChainHash = row.chainHash as string;
      }

      // 3. Fetch last checkpoint.
      const lastCheckpointRows = await db
        .select({
          createdAt: auditCheckpoints.createdAt,
          tsrToken: auditCheckpoints.tsrToken,
        })
        .from(auditCheckpoints)
        .orderBy(desc(auditCheckpoints.createdAt))
        .limit(1);

      const lastCheckpoint = lastCheckpointRows[0] ?? null;
      const lastCheckpointAt = lastCheckpoint?.createdAt?.toISOString() ?? null;
      const tsrAnchored = lastCheckpoint?.tsrToken != null;

      // 4. Return result.
      if (firstInvalidAt !== null) {
        return reply.send({
          valid: false,
          firstInvalidAt,
          chainLength,
          lastCheckpointAt,
        });
      }

      return reply.send({
        valid: true,
        chainLength,
        lastCheckpointAt,
        tsrAnchored,
      });
    },
  );
}
