/**
 * Webhook CRUD routes.
 *
 * Registered under /api prefix. All routes require authentication.
 *
 * POST   /webhooks              — Register a new webhook
 * GET    /webhooks              — List caller's webhooks
 * DELETE /webhooks/:id          — Remove a webhook
 * POST   /webhooks/:id/test     — Send a synthetic test event
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { generateId, signWebhookPayload } from 'llmtxt';
import { requireAuth } from '../middleware/auth.js';

// ── Validation schemas ────────────────────────────────────────────────────────

const VALID_EVENT_TYPES = [
  'version.created',
  'state.changed',
  'approval.submitted',
  'approval.rejected',
  'document.created',
  'document.locked',
  'document.archived',
  'contributor.updated',
] as const;

const createWebhookSchema = z.object({
  /** HTTPS callback URL. HTTP is only allowed in development. */
  url: z
    .string()
    .url()
    .refine(
      (url) => {
        if (process.env.NODE_ENV === 'production') {
          return url.startsWith('https://');
        }
        return true;
      },
      { message: 'Webhook URL must use HTTPS in production' },
    ),
  /**
   * Optional HMAC signing secret. If omitted, one is generated automatically.
   * Min 16 chars for sufficient entropy.
   */
  secret: z.string().min(16).max(256).optional(),
  /**
   * Event types to subscribe to. Empty array or omitted = all events.
   */
  events: z.array(z.enum(VALID_EVENT_TYPES)).optional().default([]),
  /**
   * Scope to a specific document slug. Null/omitted = all documents owned by
   * the caller.
   */
  documentSlug: z.string().min(1).max(20).optional().nullable(),
});

// ── Route registration ────────────────────────────────────────────────────────

/** Register webhook CRUD routes. All routes require authentication. */
export async function webhookRoutes(app: FastifyInstance) {
  /**
   * POST /webhooks
   *
   * Register a new webhook endpoint. Returns the generated signing secret
   * in the response — this is the only time it is returned in plaintext.
   */
  app.post(
    '/webhooks',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const bodyResult = createWebhookSchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          error: 'Invalid request body',
          details: bodyResult.error.issues,
        });
      }

      const { url, events, documentSlug } = bodyResult.data;
      const secret = bodyResult.data.secret ?? randomBytes(32).toString('hex');
      const now = Date.now();
      const id = generateId();

      await db.insert(webhooks).values({
        id,
        userId: request.user!.id,
        url,
        secret,
        events: JSON.stringify(events),
        documentSlug: documentSlug ?? null,
        active: true,
        failureCount: 0,
        createdAt: now,
      });

      return reply.status(201).send({
        id,
        url,
        events,
        documentSlug: documentSlug ?? null,
        active: true,
        secret, // Only returned on creation.
        createdAt: now,
      });
    },
  );

  /**
   * GET /webhooks
   *
   * List all webhooks owned by the authenticated user.
   * Secrets are never returned in list responses.
   */
  app.get(
    '/webhooks',
    { preHandler: [requireAuth] },
    async (request) => {
      const rows = await db
        .select({
          id: webhooks.id,
          url: webhooks.url,
          events: webhooks.events,
          documentSlug: webhooks.documentSlug,
          active: webhooks.active,
          failureCount: webhooks.failureCount,
          lastDeliveryAt: webhooks.lastDeliveryAt,
          lastSuccessAt: webhooks.lastSuccessAt,
          createdAt: webhooks.createdAt,
        })
        .from(webhooks)
        .where(eq(webhooks.userId, request.user!.id));

      return {
        webhooks: rows.map((row: any) => ({
          ...row,
          events: (() => {
            try {
              return JSON.parse(row.events) as string[];
            } catch {
              return [];
            }
          })(),
        })),
        total: rows.length,
      };
    },
  );

  /**
   * DELETE /webhooks/:id
   *
   * Remove a webhook. Only the owner can delete their own webhooks.
   */
  app.delete<{ Params: { id: string } }>(
    '/webhooks/:id',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await db
        .select({ id: webhooks.id, userId: webhooks.userId })
        .from(webhooks)
        .where(eq(webhooks.id, id))
        .limit(1);

      if (!existing.length) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }

      if (existing[0].userId !== request.user!.id) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You do not own this webhook' });
      }

      await db.delete(webhooks).where(eq(webhooks.id, id));

      return reply.status(204).send();
    },
  );

  /**
   * POST /webhooks/:id/test
   *
   * Send a synthetic `document.created` test event to the webhook URL.
   * Useful for verifying the endpoint is reachable and the signature logic
   * is correct on the recipient side.
   *
   * Returns 200 with delivery result; does NOT increment failure count.
   */
  app.post<{ Params: { id: string } }>(
    '/webhooks/:id/test',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      const existing = await db
        .select()
        .from(webhooks)
        .where(and(
          eq(webhooks.id, id),
          eq(webhooks.userId, request.user!.id),
        ))
        .limit(1);

      if (!existing.length) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }

      const hook = existing[0];
      const testPayload = JSON.stringify({
        type: 'document.created',
        slug: 'test000',
        documentId: 'test-document-id',
        timestamp: Date.now(),
        actor: request.user!.id,
        data: { tokenCount: 42, format: 'text' },
        delivered_at: Date.now(),
        test: true,
      });

      const signature = signWebhookPayload(hook.secret, testPayload);

      let success = false;
      let statusCode: number | null = null;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const response = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'llmtxt-webhook/1.0',
            'X-LLMtxt-Signature': signature,
            'X-LLMtxt-Event': 'document.created',
          },
          body: testPayload,
          signal: controller.signal,
        });
        clearTimeout(timer);
        success = response.ok;
        statusCode = response.status;
      } catch {
        success = false;
      }

      return reply.status(200).send({
        id,
        url: hook.url,
        success,
        statusCode,
        signature,
      });
    },
  );
}
