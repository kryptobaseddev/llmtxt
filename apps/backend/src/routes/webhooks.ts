/**
 * Webhook CRUD and admin routes.
 *
 * Registered under /api prefix. All routes require authentication.
 *
 * POST   /webhooks                               — Register a new webhook
 * GET    /webhooks                               — List caller's webhooks
 * DELETE /webhooks/:id                           — Remove a webhook
 * POST   /webhooks/:id/test                      — Send a synthetic test event
 * GET    /webhooks/:id/deliveries                — Delivery history (last 50)
 * GET    /webhooks/:id/dlq                       — Dead-letter queue entries
 * POST   /webhooks/:id/dlq/:entryId/replay       — Replay a DLQ entry
 * POST   /webhooks/:id/enable                    — Re-enable a disabled webhook
 *
 * Wave D (T353.7): delegates to fastify.backendCore.* (WebhookOps).
 * T165: delivery history, DLQ, replay, re-enable handled directly via drizzle.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateId } from 'llmtxt';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db/index.js';
import { webhooks, webhookDeliveries, webhookDlq } from '../db/schema.js';
import type { WebhookDelivery, WebhookDlqEntry } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { replayDlqEntry, cbReset } from '../events/webhooks.js';

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

/** Register webhook CRUD and admin routes. All routes require authentication. */
export async function webhookRoutes(app: FastifyInstance) {
	/**
	 * POST /webhooks
	 *
	 * Register a new webhook endpoint.
	 */
	app.post('/webhooks', { preHandler: [requireAuth] }, async (request, reply) => {
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
	});

	/**
	 * GET /webhooks
	 *
	 * List all webhooks owned by the authenticated user.
	 * Secrets are never returned in list responses.
	 */
	app.get('/webhooks', { preHandler: [requireAuth] }, async (request) => {
		const webhookList = await app.backendCore.listWebhooks(request.user!.id);
		return {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			webhooks: webhookList.map((w: any) => ({
				id: w.id,
				url: w.url,
				events: w.events,
				active: w.enabled,
				createdAt: w.createdAt,
			})),
			total: webhookList.length,
		};
	});

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

	/**
	 * GET /webhooks/:id/deliveries
	 *
	 * Return the last 50 delivery attempts for this webhook (T165).
	 * Only the webhook owner may access this.
	 */
	app.get<{ Params: { id: string } }>(
		'/webhooks/:id/deliveries',
		{ preHandler: [requireAuth] },
		async (request, reply) => {
			const { id } = request.params;

			// Ownership check.
			const [hook] = await db
				.select({ id: webhooks.id, userId: webhooks.userId })
				.from(webhooks)
				.where(and(eq(webhooks.id, id), eq(webhooks.userId, request.user!.id)))
				.limit(1);

			if (!hook) {
				return reply.status(404).send({ error: 'Webhook not found' });
			}

			const rows = await db
				.select()
				.from(webhookDeliveries)
				.where(eq(webhookDeliveries.webhookId, id))
				.orderBy(desc(webhookDeliveries.createdAt))
				.limit(50);

			return reply.status(200).send({
				webhookId: id,
				deliveries: rows.map((r: WebhookDelivery) => ({
					id: r.id,
					eventId: r.eventId,
					attemptNum: r.attemptNum,
					status: r.status,
					responseStatus: r.responseStatus,
					durationMs: r.durationMs,
					createdAt: r.createdAt,
				})),
				total: rows.length,
			});
		},
	);

	/**
	 * GET /webhooks/:id/dlq
	 *
	 * Return dead-letter queue entries for this webhook (T165).
	 * Pass ?includeReplayed=true to include already-replayed entries.
	 */
	app.get<{ Params: { id: string }; Querystring: { includeReplayed?: string } }>(
		'/webhooks/:id/dlq',
		{ preHandler: [requireAuth] },
		async (request, reply) => {
			const { id } = request.params;
			const includeReplayed = request.query.includeReplayed === 'true';

			// Ownership check.
			const [hook] = await db
				.select({ id: webhooks.id, userId: webhooks.userId })
				.from(webhooks)
				.where(and(eq(webhooks.id, id), eq(webhooks.userId, request.user!.id)))
				.limit(1);

			if (!hook) {
				return reply.status(404).send({ error: 'Webhook not found' });
			}

			const allEntries = await db
				.select()
				.from(webhookDlq)
				.where(eq(webhookDlq.webhookId, id))
				.orderBy(desc(webhookDlq.capturedAt))
				.limit(100);

			const entries = includeReplayed
				? allEntries
				: allEntries.filter((e: WebhookDlqEntry) => e.replayedAt === null);

			return reply.status(200).send({
				webhookId: id,
				entries: entries.map((e: WebhookDlqEntry) => ({
					id: e.id,
					eventId: e.eventId,
					failedDeliveryId: e.failedDeliveryId,
					reason: e.reason,
					capturedAt: e.capturedAt,
					replayedAt: e.replayedAt,
				})),
				total: entries.length,
			});
		},
	);

	/**
	 * POST /webhooks/:id/dlq/:entryId/replay
	 *
	 * Re-attempt delivery of a dead-letter entry (T165).
	 * On success, marks the DLQ entry as replayed.
	 */
	app.post<{ Params: { id: string; entryId: string } }>(
		'/webhooks/:id/dlq/:entryId/replay',
		{ preHandler: [requireAuth] },
		async (request, reply) => {
			const { id, entryId } = request.params;

			// Ownership check.
			const [hook] = await db
				.select({ id: webhooks.id, userId: webhooks.userId })
				.from(webhooks)
				.where(and(eq(webhooks.id, id), eq(webhooks.userId, request.user!.id)))
				.limit(1);

			if (!hook) {
				return reply.status(404).send({ error: 'Webhook not found' });
			}

			// Ensure DLQ entry belongs to this webhook.
			const [entry] = await db
				.select({ id: webhookDlq.id, webhookId: webhookDlq.webhookId })
				.from(webhookDlq)
				.where(and(eq(webhookDlq.id, entryId), eq(webhookDlq.webhookId, id)))
				.limit(1);

			if (!entry) {
				return reply.status(404).send({ error: 'DLQ entry not found' });
			}

			const result = await replayDlqEntry(entryId);

			return reply.status(200).send({
				entryId,
				webhookId: id,
				success: result.success,
				statusCode: result.responseStatus,
			});
		},
	);

	/**
	 * POST /webhooks/:id/enable
	 *
	 * Re-enable a disabled webhook and reset the circuit-breaker window.
	 */
	app.post<{ Params: { id: string } }>(
		'/webhooks/:id/enable',
		{ preHandler: [requireAuth] },
		async (request, reply) => {
			const { id } = request.params;

			// Ownership check + fetch current state.
			const [hook] = await db
				.select()
				.from(webhooks)
				.where(and(eq(webhooks.id, id), eq(webhooks.userId, request.user!.id)))
				.limit(1);

			if (!hook) {
				return reply.status(404).send({ error: 'Webhook not found' });
			}

			// Re-enable and reset failure count.
			await db.update(webhooks).set({ active: true, failureCount: 0 }).where(eq(webhooks.id, id));

			// Clear in-process circuit-breaker window so it starts fresh.
			cbReset(id);

			return reply.status(200).send({
				id,
				active: true,
				failureCount: 0,
			});
		},
	);
}

// Keep generateId imported to avoid unused-import warning (used elsewhere in the module
// that originally created this file; retain for compat).
void generateId;
