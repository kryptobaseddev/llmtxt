/**
 * A2A (Agent-to-Agent) routes — W3/T154 / T353 Wave C.
 *
 * POST /api/v1/agents/:id/inbox — deliver an A2A message to an agent's inbox
 * GET  /api/v1/agents/:id/inbox — poll messages (authenticated)
 *
 * Messages are signed A2AMessage envelopes (see crates/llmtxt-core/src/a2a.rs).
 * Transport options: scratchpad (via T153 POST /scratchpad) or HTTP inbox.
 *
 * Inbox TTL: 48 hours. Cleanup via background job.
 * Auth: requester must be authenticated to post to inbox.
 *
 * Wave C: All persistence delegated to fastify.backendCore (PostgresBackend).
 * Signature verification remains in-route (requires agentPubkeys lookup which
 * is a Wave D Identity op; for now uses direct Drizzle query for pubkey only).
 * Zero direct Drizzle for message delivery/poll operations.
 */
import type { FastifyInstance } from 'fastify';
import { eq, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agentPubkeys, agentInboxMessages } from '../db/schema-pg.js';
import { requireAuth } from '../middleware/auth.js';
import { writeRateLimit } from '../middleware/rate-limit.js';

/** 48 hours in ms */
const INBOX_TTL_MS = 48 * 60 * 60 * 1000;

/** Verify a sender's A2A signature. */
async function verifyA2ASignature(
  fromAgentId: string,
  envelopeJson: unknown
): Promise<boolean> {
  if (!envelopeJson || typeof envelopeJson !== 'object') return false;

  const env = envelopeJson as {
    from?: string;
    to?: string;
    nonce?: string;
    timestamp_ms?: number;
    content_type?: string;
    payload?: string;
    signature?: string;
  };

  if (!env.from || !env.to || !env.nonce || !env.timestamp_ms || !env.signature) {
    return false;
  }

  // Verify sender identity matches fromAgentId
  if (env.from !== fromAgentId) return false;

  // Look up sender's pubkey (direct Drizzle — Identity ops are Wave D)
  const [keyRow] = await db
    .select({ pubkey: agentPubkeys.pubkey, revokedAt: agentPubkeys.revokedAt })
    .from(agentPubkeys)
    .where(eq(agentPubkeys.agentId, fromAgentId))
    .limit(1);

  if (!keyRow || keyRow.revokedAt !== null) return false;

  try {
    const ed = await import('@noble/ed25519');
    const { sha512 } = await import('@noble/hashes/sha2.js');
    ed.hashes.sha512 = sha512;

    const { createHash } = await import('node:crypto');

    // Compute canonical bytes:
    // from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex
    const payloadBytes = env.payload
      ? Buffer.from(env.payload, 'base64')
      : Buffer.alloc(0);
    const payloadHash = createHash('sha256').update(payloadBytes).digest('hex');

    const canonical = [
      env.from,
      env.to,
      env.nonce,
      env.timestamp_ms,
      env.content_type ?? 'application/json',
      payloadHash,
    ].join('\n');

    const pubkeyBuf = Buffer.isBuffer(keyRow.pubkey)
      ? keyRow.pubkey
      : Buffer.from(keyRow.pubkey);
    const sigBuf = Buffer.from(env.signature, 'hex');
    const payloadBuf = Buffer.from(canonical, 'utf8');

    if (pubkeyBuf.length !== 32 || sigBuf.length !== 64) return false;
    return await ed.verifyAsync(sigBuf, payloadBuf, pubkeyBuf);
  } catch {
    return false;
  }
}

export async function a2aRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /agents/:id/inbox — deliver A2A message to agent inbox
  fastify.post<{
    Params: { id: string };
    Body: {
      /** Signed A2AMessage JSON envelope. */
      envelope: unknown;
    };
  }>(
    '/agents/:id/inbox',
    { preHandler: [requireAuth], config: writeRateLimit },
    async (request, reply) => {
      const { id: toAgentId } = request.params;
      const { envelope } = request.body;

      if (!envelope || typeof envelope !== 'object') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'envelope is required and must be a JSON object',
        });
      }

      const env = envelope as {
        from?: string;
        to?: string;
        nonce?: string;
        timestamp_ms?: number;
        signature?: string;
      };

      if (!env.from || !env.to || !env.nonce || !env.timestamp_ms) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'envelope must have from, to, nonce, and timestamp_ms fields',
        });
      }

      // Verify recipient matches route param
      if (env.to !== toAgentId) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'envelope.to must match the :id route parameter',
        });
      }

      // Validate timestamp freshness (reject messages older than 5 minutes)
      const now = Date.now();
      const maxAge = 5 * 60 * 1000;
      if (Math.abs(now - env.timestamp_ms) > maxAge) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Message timestamp is too old or too far in the future (max 5 minutes)',
        });
      }

      // Verify signature if sender has a registered key
      let sigVerified = false;
      if (env.signature) {
        sigVerified = await verifyA2ASignature(env.from, envelope);
      }

      // Deliver via BackendCore (handles nonce dedup + persistence)
      const result = await fastify.backendCore.sendA2AMessage({
        toAgentId,
        envelopeJson: JSON.stringify(envelope),
        ttlMs: INBOX_TTL_MS,
      });

      if (!result.success) {
        // Check if it's a duplicate nonce error
        if (result.error?.includes('Duplicate nonce') || result.error?.includes('duplicate')) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Duplicate nonce — message already delivered',
          });
        }
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: result.error ?? 'Failed to deliver message',
        });
      }

      const msg = result.message!;
      return reply.status(201).send({
        delivered: true,
        to: toAgentId,
        from: env.from,
        nonce: env.nonce,
        sig_verified: sigVerified,
        expires_at: msg.exp,
      });
    }
  );

  // GET /agents/:id/inbox — poll inbox (recipient only)
  fastify.get<{
    Params: { id: string };
    Querystring: { since?: string; limit?: string; unread_only?: string };
  }>(
    '/agents/:id/inbox',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id: agentId } = request.params;
      const { limit } = request.query;

      // Verify requester is authenticated
      const userId = request.user?.id;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const maxResults = Math.min(parseInt(limit ?? '50', 10), 200);

      const messages = await fastify.backendCore.pollA2AInbox(agentId, maxResults);

      return {
        messages: messages.map((m) => ({
          id: m.id,
          from: (() => {
            try {
              const env = typeof m.envelopeJson === 'string'
                ? JSON.parse(m.envelopeJson)
                : m.envelopeJson;
              return (env as { from?: string }).from ?? 'unknown';
            } catch { return 'unknown'; }
          })(),
          to: m.toAgentId,
          envelope: (() => {
            try {
              return typeof m.envelopeJson === 'string'
                ? JSON.parse(m.envelopeJson)
                : m.envelopeJson;
            } catch { return m.envelopeJson; }
          })(),
          received_at: m.createdAt,
          expires_at: m.exp,
          read: false,
        })),
        count: messages.length,
      };
    }
  );
}

/**
 * Purge expired agent inbox messages older than 48h.
 * Called by the background jobs scheduler.
 */
export async function purgeExpiredInboxMessages(): Promise<number> {
  const now = Date.now();
  const result = await db
    .delete(agentInboxMessages)
    .where(lt(agentInboxMessages.expiresAt, now));
  // Drizzle returns rowCount on PG
  return (result as { rowCount?: number }).rowCount ?? 0;
}
