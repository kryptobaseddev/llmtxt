/**
 * Webhook CRUD routes.
 *
 * Registered under /api prefix. All routes require authentication.
 *
 * POST   /webhooks              — Register a new webhook
 * GET    /webhooks              — List caller's webhooks
 * DELETE /webhooks/:id          — Remove a webhook
 * POST   /webhooks/:id/test     — Send a synthetic test event
 *
 * Wave D (T353.7): delegates to fastify.backendCore.* (WebhookOps).
 * HMAC signing key generation and test delivery remain in route layer.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateId } from 'llmtxt';
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
  secret: z.string().min(16).max(256).optional(),
  events: z.array(z.enum(VALID_EVENT_TYPES)).optional().default([]),
  documentSlug: z.string().min(1).max(20).optional().nullable(),
});

// ── Route registration ────────────────────────────────────────────────────────

/** Register webhook CRUD routes. All routes require authentication. */
export async function webhookRoutes(app: FastifyInstance) {
  /**
   * POST /webhooks
   *
   * Register a new webhook endpoint.
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

      const { url, events, secret: providedSecret } = bodyResult.data;

      const webhook = await app.backendCore.createWebhook({
        ownerId: request.user!.id,
        url,
        secret: providedSecret,
        events: events as string[],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = webhook as any;
      return reply.status(201).send({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.enabled,
        secret: w.secret, // Only returned on creation.
        createdAt: w.createdAt,
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
      const webhooks = await app.backendCore.listWebhooks(request.user!.id);
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        webhooks: webhooks.map((w: any) => ({
          id: w.id,
          url: w.url,
          events: w.events,
          active: w.enabled,
          createdAt: w.createdAt,
        })),
        total: webhooks.length,
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

      const deleted = await app.backendCore.deleteWebhook(id, request.user!.id);

      if (!deleted) {
        return reply.status(404).send({ error: 'Webhook not found or not owned by you' });
      }

      return reply.status(204).send();
    },
  );

  /**
   * POST /webhooks/:id/test
   *
   * Send a synthetic test delivery to the webhook URL.
   */
  app.post<{ Params: { id: string } }>(
    '/webhooks/:id/test',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;

      // Verify ownership first by listing user's webhooks
      const userWebhooks = await app.backendCore.listWebhooks(request.user!.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const owned = userWebhooks.find((w: any) => w.id === id);

      if (!owned) {
        return reply.status(404).send({ error: 'Webhook not found' });
      }

      const result = await app.backendCore.testWebhook(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = result as any;

      return reply.status(200).send({
        id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        url: (owned as any).url,
        success: r.delivered ?? false,
        statusCode: r.statusCode ?? null,
      });
    },
  );
}
