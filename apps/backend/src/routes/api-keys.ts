/**
 * API key management routes.
 *
 * All management operations require cookie-based auth (requireRegistered).
 * API keys themselves cannot be used to create/manage other API keys —
 * this is intentional to prevent key proliferation without human approval.
 *
 * Endpoints:
 *   POST   /api/keys          — Create a new API key
 *   GET    /api/keys          — List caller's API keys (no raw keys returned)
 *   DELETE /api/keys/:id      — Revoke an API key (soft delete)
 *   POST   /api/keys/:id/rotate — Revoke old key, issue new one with same metadata
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { requireRegistered } from '../middleware/auth.js';
import { generateApiKey } from '../utils/api-keys.js';
import { generateId } from '../utils/compression.js';

// ────────────────────────────────────────────────────────────────
// Validation schemas
// ────────────────────────────────────────────────────────────────

const createKeyBodySchema = z.object({
  /** Human-readable label, e.g. "CI Bot" or "GitHub Actions". */
  name: z.string().min(1).max(100),
  /**
   * Array of scope strings. Defaults to ['*'] (all scopes).
   * Reserved for future fine-grained permission enforcement.
   */
  scopes: z.array(z.string().min(1).max(64)).optional(),
  /**
   * How long until the key expires, in milliseconds from now.
   * Omit or pass null/0 for no expiry.
   */
  expiresIn: z.number().int().positive().optional().nullable(),
});

type CreateKeyBody = z.infer<typeof createKeyBodySchema>;

const keyIdParamsSchema = z.object({
  id: z.string().min(1).max(64),
});

// ────────────────────────────────────────────────────────────────
// Helper: build the safe "list" representation of a key row
// (never includes keyHash or the raw key)
// ────────────────────────────────────────────────────────────────

function safeKeyView(row: {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revoked: boolean;
  createdAt: number;
}) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes === '*' ? ['*'] : (() => {
      try { return JSON.parse(row.scopes) as string[]; } catch { return [row.scopes]; }
    })(),
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revoked: row.revoked,
    createdAt: row.createdAt,
  };
}

/** Register API key management routes. */
export async function apiKeyRoutes(fastify: FastifyInstance) {

  // ──────────────────────────────────────────────────────────────
  // POST /api/keys — Create a new API key
  // ──────────────────────────────────────────────────────────────
  fastify.post<{ Body: CreateKeyBody }>(
    '/keys',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const parseResult = createKeyBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parseResult.error.issues.map((e) => ({
            field: e.path.join('.') || 'body',
            message: e.message,
            code: e.code,
          })),
        });
      }

      const { name, scopes, expiresIn } = parseResult.data;
      const userId = request.user!.id;

      const { rawKey, keyHash, keyPrefix } = generateApiKey();

      const now = Date.now();
      const expiresAt = expiresIn ? now + expiresIn : null;
      const scopesValue = scopes && scopes.length > 0 ? JSON.stringify(scopes) : '*';
      const id = generateId();

      await db.insert(apiKeys).values({
        id,
        userId,
        name,
        keyHash,
        keyPrefix,
        scopes: scopesValue,
        expiresAt,
        revoked: false,
        createdAt: now,
        updatedAt: now,
      });

      // Return the raw key EXACTLY ONCE here — it is never retrievable again
      return reply.status(201).send({
        id,
        name,
        key: rawKey,
        keyPrefix,
        scopes: scopes && scopes.length > 0 ? scopes : ['*'],
        expiresAt,
        createdAt: now,
      });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // GET /api/keys — List caller's API keys
  // ──────────────────────────────────────────────────────────────
  fastify.get(
    '/keys',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const userId = request.user!.id;

      const rows = await db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          scopes: apiKeys.scopes,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          revoked: apiKeys.revoked,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, userId));

      return reply.send({ keys: rows.map(safeKeyView) });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // DELETE /api/keys/:id — Revoke an API key (soft delete)
  // ──────────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    '/keys/:id',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const paramsResult = keyIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid key ID' });
      }

      const { id } = paramsResult.data;
      const userId = request.user!.id;
      const now = Date.now();

      // Verify ownership before revoking
      const [existing] = await db
        .select({ id: apiKeys.id, userId: apiKeys.userId, revoked: apiKeys.revoked })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({ error: 'Not Found', message: 'API key not found' });
      }

      if (existing.revoked) {
        return reply.status(409).send({ error: 'Conflict', message: 'API key is already revoked' });
      }

      await db
        .update(apiKeys)
        .set({ revoked: true, updatedAt: now })
        .where(eq(apiKeys.id, id));

      return reply.send({ id, revoked: true, revokedAt: now });
    }
  );

  // ──────────────────────────────────────────────────────────────
  // POST /api/keys/:id/rotate — Revoke old key, issue a new one
  // ──────────────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    '/keys/:id/rotate',
    { preHandler: [requireRegistered] },
    async (request, reply) => {
      const paramsResult = keyIdParamsSchema.safeParse(request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid key ID' });
      }

      const { id } = paramsResult.data;
      const userId = request.user!.id;
      const now = Date.now();

      // Fetch the key to rotate — must belong to the caller and be active
      const [existing] = await db
        .select({
          id: apiKeys.id,
          userId: apiKeys.userId,
          name: apiKeys.name,
          scopes: apiKeys.scopes,
          expiresAt: apiKeys.expiresAt,
          revoked: apiKeys.revoked,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({ error: 'Not Found', message: 'API key not found' });
      }

      if (existing.revoked) {
        return reply.status(409).send({ error: 'Conflict', message: 'Cannot rotate a revoked API key' });
      }

      // Revoke the old key
      await db
        .update(apiKeys)
        .set({ revoked: true, updatedAt: now })
        .where(eq(apiKeys.id, id));

      // Generate a new key with the same name and scopes
      const { rawKey, keyHash, keyPrefix } = generateApiKey();
      const newId = generateId();

      await db.insert(apiKeys).values({
        id: newId,
        userId,
        name: existing.name,
        keyHash,
        keyPrefix,
        scopes: existing.scopes,
        expiresAt: existing.expiresAt,
        revoked: false,
        createdAt: now,
        updatedAt: now,
      });

      const parsedScopes = existing.scopes === '*'
        ? ['*']
        : (() => { try { return JSON.parse(existing.scopes) as string[]; } catch { return [existing.scopes]; } })();

      // Return the new raw key EXACTLY ONCE
      return reply.status(201).send({
        id: newId,
        name: existing.name,
        key: rawKey,
        keyPrefix,
        scopes: parsedScopes,
        expiresAt: existing.expiresAt,
        createdAt: now,
        rotatedFrom: id,
      });
    }
  );
}
