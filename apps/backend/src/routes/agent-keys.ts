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
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, isNull } from 'drizzle-orm';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { hashContent } from 'llmtxt';
import { db } from '../db/index.js';
import { agentPubkeys } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
// generateId import removed — agent_pubkeys uses Postgres UUID defaultRandom()

// Noble ed25519 v3 requires setting the hash function in Node.js:
// https://github.com/paulmillr/noble-ed25519#usage
ed.hashes.sha512 = sha512;

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Compute SHA-256 fingerprint of a public key (first 8 hex chars).
 *
 * Returns the first 16 hex chars (64 bits) of SHA-256(pubkey_bytes).
 */
function computeFingerprint(pubkeyHex: string): string {
  // Hash the canonical hex string of the pubkey bytes (deterministic).
  // hashContent = WASM Rust SHA-256 (SSOT per docs/SSOT.md).
  const hash = hashContent(pubkeyHex);
  return hash.slice(0, 16);
}

/** Validate that the 32-byte buffer represents a valid Ed25519 point. */
function isValidEd25519Point(pubkeyHex: string): boolean {
  try {
    if (pubkeyHex.length !== 64) return false;
    // Noble v3: Point.fromHex accepts a lowercase hex string and throws on invalid points.
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

// ── Safe view ────────────────────────────────────────────────────

function safeKeyView(row: {
  id: string;
  agentId: string;
  pubkey: Buffer;
  createdAt: Date | number;
  revokedAt: Date | number | null;
}) {
  const pubkeyHex = Buffer.isBuffer(row.pubkey)
    ? row.pubkey.toString('hex')
    : Buffer.from(row.pubkey).toString('hex');
  return {
    id: row.id,
    agent_id: row.agentId,
    pubkey_hex: pubkeyHex,
    fingerprint: computeFingerprint(pubkeyHex),
    created_at:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt as number).toISOString(),
    revoked: row.revokedAt !== null,
    revoked_at:
      row.revokedAt instanceof Date
        ? (row.revokedAt as Date).toISOString()
        : row.revokedAt !== null
          ? new Date(row.revokedAt as number).toISOString()
          : null,
  };
}

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

      const userId = request.user!.id;

      // Check if this agent_id already has an active key
      // If so, reject — caller must revoke first
      const [existing] = await db
        .select({ id: agentPubkeys.id, revokedAt: agentPubkeys.revokedAt })
        .from(agentPubkeys)
        .where(eq(agentPubkeys.agentId, agent_id))
        .limit(1);

      if (existing && existing.revokedAt === null) {
        return reply.status(409).send({
          error: 'Conflict',
          message:
            'An active key for this agent_id already exists. Revoke it first via DELETE /agents/keys/:id',
        });
      }

      const pubkeyLower = pubkey_hex.toLowerCase();
      const fingerprint = computeFingerprint(pubkeyLower);
      const now = new Date();

      // Insert new key — let Postgres generate the UUID primary key via defaultRandom()
      await db.insert(agentPubkeys).values({
        agentId: agent_id,
        pubkey: Buffer.from(pubkeyLower, 'hex'),
        createdAt: now,
      });

      // Fetch back by agent_id (since we don't have the generated UUID)
      const [row] = await db
        .select()
        .from(agentPubkeys)
        .where(eq(agentPubkeys.agentId, agent_id))
        .limit(1);

      return reply.status(201).send({
        ...safeKeyView(row),
        fingerprint,
        label: label ?? null,
      });
    }
  );

  // GET /agents/keys — list active keys for the authenticated user
  fastify.get(
    '/agents/keys',
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const rows = await db
        .select()
        .from(agentPubkeys)
        .where(isNull(agentPubkeys.revokedAt));

      return { keys: rows.map((r: { id: string; agentId: string; pubkey: Buffer; createdAt: Date | number; revokedAt: Date | number | null }) => safeKeyView(r)) };
    }
  );

  // DELETE /agents/keys/:id — soft-revoke a key
  fastify.delete<{ Params: KeyIdParams }>(
    '/agents/keys/:id',
    { preHandler: requireAuth },
    async (request: FastifyRequest<{ Params: KeyIdParams }>, reply: FastifyReply) => {
      const parseResult = keyIdParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        return reply.status(400).send({ error: 'Invalid params' });
      }

      const { id } = parseResult.data;

      // Look up the key row
      const [row] = await db
        .select()
        .from(agentPubkeys)
        .where(eq(agentPubkeys.id, id))
        .limit(1);

      if (!row) {
        return reply.status(404).send({ error: 'Key not found' });
      }

      // Soft-revoke
      const now = new Date();
      await db
        .update(agentPubkeys)
        .set({ revokedAt: now })
        .where(eq(agentPubkeys.id, id));

      return reply.status(200).send({
        id,
        agent_id: row.agentId,
        revoked: true,
        revoked_at: now.toISOString(),
      });
    }
  );
}
