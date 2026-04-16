/**
 * GET /.well-known/agents/:id — public key discovery (T223).
 *
 * Returns the active public key for an agent_id.
 * Response: { pubkey_hex, fingerprint, created_at, revoked }
 * - 404 if key is revoked or does not exist.
 * - user_id and label are NOT included in the response.
 * - Cacheable: Cache-Control: public, max-age=60
 *
 * Wave D (T353.7): delegates to fastify.backendCore.lookupAgentPubkey.
 */
import type { FastifyInstance } from 'fastify';
import { hashContent } from 'llmtxt';

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

      const record = await fastify.backendCore.lookupAgentPubkey(id);
      if (!record) {
        return reply.status(404).send({ error: 'Not found' });
      }

      reply.header('Cache-Control', 'public, max-age=60');
      return reply.send({
        pubkey_hex: record.pubkeyHex,
        fingerprint: computeFingerprint(record.pubkeyHex),
        created_at: new Date(record.createdAt).toISOString(),
        revoked: false,
      });
    }
  );
}
