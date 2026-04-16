/**
 * GET /.well-known/agents/:id — public key discovery (T223).
 *
 * Returns the active public key for an agent_id.
 * Response: { pubkey_hex, fingerprint, created_at, revoked }
 * - 404 if key is revoked or does not exist.
 * - user_id and label are NOT included in the response.
 * - Cacheable: Cache-Control: public, max-age=60
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { hashContent } from 'llmtxt';
import { db } from '../db/index.js';
import { agentPubkeys } from '../db/schema.js';

function computeFingerprint(pubkeyHex: string): string {
  return hashContent(pubkeyHex).slice(0, 16);
}

/** Register the /.well-known/agents/:id discovery route. */
export async function wellKnownAgentsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>(
    '/.well-known/agents/:id',
    async (request, reply) => {
      const { id } = request.params;

      if (!id || id.length > 128) {
        return reply.status(400).send({ error: 'Invalid agent id' });
      }

      const [row] = await db
        .select({
          id: agentPubkeys.id,
          agentId: agentPubkeys.agentId,
          pubkey: agentPubkeys.pubkey,
          createdAt: agentPubkeys.createdAt,
          revokedAt: agentPubkeys.revokedAt,
        })
        .from(agentPubkeys)
        .where(eq(agentPubkeys.agentId, id))
        .limit(1);

      if (!row || row.revokedAt !== null) {
        return reply.status(404).send({ error: 'Not found' });
      }

      const pubkeyHex = Buffer.isBuffer(row.pubkey)
        ? row.pubkey.toString('hex')
        : Buffer.from(row.pubkey).toString('hex');

      const createdAt =
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(row.createdAt as number).toISOString();

      reply.header('Cache-Control', 'public, max-age=60');
      return reply.send({
        pubkey_hex: pubkeyHex,
        fingerprint: computeFingerprint(pubkeyHex),
        created_at: createdAt,
        revoked: false,
      });
    }
  );
}
