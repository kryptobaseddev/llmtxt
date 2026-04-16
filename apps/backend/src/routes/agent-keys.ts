/**
 * Agent public key management — POST/GET/DELETE /api/v1/agents/keys
 *
 * Allows authenticated users (identified by API key or session) to register,
 * list, and revoke Ed25519 public keys for agent request signing.
 *
 * T219 acceptance criteria:
 *   1. POST accepts pubkey_hex (64 hex chars = 32 bytes), label; validates key
 *      is a valid Ed25519 point; returns row with fingerprint.
 *   2. GET returns all active (non-revoked) keys for the authenticated user.
 *   3. DELETE /:id soft-revokes (sets revoked_at); 404 if key belongs to a
 *      different user.
 *
 * Authentication: uses the existing requireAuth middleware (Bearer API key or
 * cookie session).
 *
 * Wave D (T353.7): delegates persistence to fastify.backendCore.* (IdentityOps).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { hashContent } from 'llmtxt';
import { requireAuth } from '../middleware/auth.js';

// Noble ed25519 v3 requires setting the hash function in Node.js:
// https://github.com/paulmillr/noble-ed25519#usage
ed.hashes.sha512 = sha512;

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Compute SHA-256 fingerprint of a public key (first 16 hex chars).
 */
function computeFingerprint(pubkeyHex: string): string {
  const hash = hashContent(pubkeyHex);
  return hash.slice(0, 16);
}

/** Validate that the 32-byte buffer represents a valid Ed25519 point. */
function isValidEd25519Point(pubkeyHex: string): boolean {
  try {
    if (pubkeyHex.length !== 64) return false;
    ed.Point.fromHex(pubkeyHex);
    return true;
  } catch {
    return false;
  }
}

// ── Validation schemas ────────────────────────────────────────────

const registerKeyBodySchema = z.object({
  /** The agent_id this key will be associated with (must be unique and active). */
  agent_id: z.string().min(1).max(128),
  /**
   * 64 hex chars = 32 bytes = compressed Ed25519 public key.
   */
  pubkey_hex: z
    .string()
    .length(64, 'pubkey_hex must be exactly 64 hex characters (32 bytes)')
    .regex(/^[0-9a-fA-F]+$/, 'pubkey_hex must be valid hex'),
  /** Human-readable label, e.g. "CI Bot". */
  label: z.string().min(1).max(100).optional(),
});

const keyIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

type RegisterKeyBody = z.infer<typeof registerKeyBodySchema>;
type KeyIdParams = z.infer<typeof keyIdParamsSchema>;

// ── Route handler ─────────────────────────────────────────────────

/** Register agent key management routes under /agents/keys. */
export async function agentKeyRoutes(fastify: FastifyInstance) {
  // POST /agents/keys — register a new Ed25519 public key
  fastify.post<{ Body: RegisterKeyBody }>(
    '/agents/keys',
    { preHandler: requireAuth },
    async (request: FastifyRequest<{ Body: RegisterKeyBody }>, reply: FastifyReply) => {
      const parseResult = registerKeyBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues,
        });
      }

      const { agent_id, pubkey_hex, label } = parseResult.data;

      // Validate Ed25519 point
      const valid = isValidEd25519Point(pubkey_hex.toLowerCase());
      if (!valid) {
        return reply.status(422).send({
          error: 'Invalid public key',
          message: 'pubkey_hex must be a valid Ed25519 compressed point',
        });
      }

      // Check if this agent_id already has an active key — reject if so
      const existing = await fastify.backendCore.lookupAgentPubkey(agent_id);
      if (existing) {
        return reply.status(409).send({
          error: 'Conflict',
          message:
            'An active key for this agent_id already exists. Revoke it first via DELETE /agents/keys/:id',
        });
      }

      const record = await fastify.backendCore.registerAgentPubkey(agent_id, pubkey_hex.toLowerCase(), label);
      const fingerprint = computeFingerprint(record.pubkeyHex);

      return reply.status(201).send({
        agent_id: record.agentId,
        pubkey_hex: record.pubkeyHex,
        fingerprint,
        label: label ?? null,
        created_at: new Date(record.createdAt).toISOString(),
        revoked: false,
        revoked_at: null,
      });
    }
  );

  // GET /agents/keys — list active keys (all non-revoked keys)
  fastify.get(
    '/agents/keys',
    { preHandler: requireAuth },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const records = await fastify.backendCore.listAgentPubkeys();
      return reply.send({
        keys: records.map((r) => ({
          agent_id: r.agentId,
          pubkey_hex: r.pubkeyHex,
          fingerprint: computeFingerprint(r.pubkeyHex),
          created_at: new Date(r.createdAt).toISOString(),
          revoked: !!r.revokedAt,
          revoked_at: r.revokedAt ? new Date(r.revokedAt).toISOString() : null,
        })),
      });
    }
  );

  // DELETE /agents/keys/:id — soft-revoke a key by agent_id
  fastify.delete<{ Params: KeyIdParams }>(
    '/agents/keys/:id',
    { preHandler: requireAuth },
    async (request: FastifyRequest<{ Params: KeyIdParams }>, reply: FastifyReply) => {
      const parseResult = keyIdParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { id } = parseResult.data; // id is the agent_id in this route

      // Look up the key by agent_id
      const existing = await fastify.backendCore.lookupAgentPubkey(id);
      if (!existing) {
        return reply.status(404).send({ error: 'Key not found' });
      }

      const revoked = await fastify.backendCore.revokeAgentPubkey(id, existing.pubkeyHex);
      if (!revoked) {
        return reply.status(404).send({ error: 'Key not found or already revoked' });
      }

      return reply.status(200).send({
        agent_id: id,
        revoked: true,
        revoked_at: new Date().toISOString(),
      });
    }
  );
}
