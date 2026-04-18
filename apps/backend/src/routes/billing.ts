/**
 * Billing routes — usage, Stripe checkout, webhook handler.
 *
 * Routes:
 *   GET  /api/me/usage              — current period usage + tier limits
 *   GET  /api/me/subscription       — subscription status
 *   POST /api/billing/checkout      — create Stripe checkout session
 *   POST /api/billing/portal        — create Stripe billing portal session
 *   POST /api/billing/webhook       — Stripe webhook handler (no auth)
 *   GET  /api/v1/admin/subscriptions — admin view of all subscriptions
 *
 * Security:
 *   - Stripe keys NEVER committed — env vars only.
 *   - Webhook signature verified via stripe.webhooks.constructEvent.
 *   - Idempotent webhook processing via stripe_events dedup table.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import Stripe from 'stripe';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { subscriptions, stripeEvents, users } from '../db/schema-pg.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import {
  getMonthlyUsage,
  getUserSubscription,
  getUserDocumentCount,
  isEffectiveTier,
  getTierLimits,
} from '../lib/usage.js';
import { generateId } from '../utils/compression.js';

// ── Stripe singleton ─────────────────────────────────────────────────────────

/**
 * Lazily-constructed Stripe client.
 *
 * Returns null when STRIPE_SECRET_KEY is not configured (dev / test mode
 * without a real Stripe account). Routes will return 503 in that case.
 */
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2026-03-25.dahlia' });
}

const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? '';
const ENTERPRISE_PRICE_ID = process.env.STRIPE_ENTERPRISE_PRICE_ID ?? '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? '';
const APP_URL = process.env.APP_URL ?? 'https://www.llmtxt.my';

// ── Route handler ────────────────────────────────────────────────────────────

export async function billingRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /api/me/usage ──────────────────────────────────────────────────────

  app.get(
    '/me/usage',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const [sub, monthly, docCount] = await Promise.all([
        getUserSubscription(userId),
        getMonthlyUsage(userId),
        getUserDocumentCount(userId),
      ]);

      const effectiveTier = isEffectiveTier(sub);
      const limits = getTierLimits(effectiveTier);

      const periodStart = new Date();
      periodStart.setUTCDate(1);
      periodStart.setUTCHours(0, 0, 0, 0);

      const periodEnd = new Date(periodStart);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

      return reply.send({
        tier: effectiveTier,
        status: sub.status,
        period: {
          start: periodStart.toISOString().split('T')[0],
          end: periodEnd.toISOString().split('T')[0],
        },
        usage: {
          api_calls: {
            used: monthly.api_calls,
            limit: limits.max_api_calls_per_month ?? null,
          },
          crdt_ops: {
            used: monthly.crdt_ops,
            limit: limits.max_crdt_ops_per_month ?? null,
          },
          documents: {
            used: docCount,
            limit: limits.max_documents ?? null,
          },
          storage_bytes: {
            used: monthly.bytes_ingested,
            limit: limits.max_storage_bytes ?? null,
          },
        },
        upgrade_url: `${APP_URL}/pricing`,
      });
    }
  );

  // ── GET /api/me/subscription ───────────────────────────────────────────────

  app.get(
    '/me/subscription',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.id;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
      const sub = await getUserSubscription(userId);
      const effectiveTier = isEffectiveTier(sub);

      return reply.send({
        tier: effectiveTier,
        status: sub.status,
        stripe_customer_id: sub.stripeCustomerId,
        current_period_start: sub.currentPeriodStart,
        current_period_end: sub.currentPeriodEnd,
        grace_period_end: sub.gracePeriodEnd,
        upgrade_url: effectiveTier === 'free' ? `${APP_URL}/pricing` : null,
        manage_url: sub.stripeCustomerId ? '/api/billing/portal' : null,
      });
    }
  );

  // ── POST /api/billing/checkout ─────────────────────────────────────────────

  app.post(
    '/billing/checkout',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const stripe = getStripe();
      if (!stripe) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'Stripe is not configured on this server.',
        });
      }

      const body = request.body as {
        tier?: string;
        success_url?: string;
        cancel_url?: string;
      } | null;

      const tier = body?.tier ?? 'pro';
      const successUrl = body?.success_url ?? `${APP_URL}/billing?upgraded=1`;
      const cancelUrl = body?.cancel_url ?? `${APP_URL}/pricing`;

      if (!['pro', 'enterprise'].includes(tier)) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'tier must be "pro" or "enterprise"',
        });
      }

      const priceId = tier === 'enterprise' ? ENTERPRISE_PRICE_ID : PRO_PRICE_ID;
      if (!priceId) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: `Stripe Price ID for tier "${tier}" is not configured.`,
        });
      }

      const userId = request.user?.id;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
      const sub = await getUserSubscription(userId);

      // Re-use existing Stripe customer ID if available.
      const customerParams: Stripe.Checkout.SessionCreateParams = sub.stripeCustomerId
        ? { customer: sub.stripeCustomerId }
        : { customer_email: request.user?.email ?? undefined };

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        ...customerParams,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId, tier },
        subscription_data: { metadata: { userId, tier } },
        allow_promotion_codes: true,
      });

      return reply.send({ checkout_url: session.url });
    }
  );

  // ── POST /api/billing/portal ───────────────────────────────────────────────

  app.post(
    '/billing/portal',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const stripe = getStripe();
      if (!stripe) {
        return reply.status(503).send({ error: 'Stripe not configured' });
      }

      const userId = request.user?.id;
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
      const sub = await getUserSubscription(userId);

      if (!sub.stripeCustomerId) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'No Stripe customer account found. Upgrade first.',
          upgrade_url: `${APP_URL}/pricing`,
        });
      }

      const returnUrl = (request.body as { return_url?: string } | null)?.return_url
        ?? `${APP_URL}/billing`;

      const session = await stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: returnUrl,
      });

      return reply.send({ portal_url: session.url });
    }
  );

  // ── POST /api/billing/webhook ──────────────────────────────────────────────
  //
  // No user auth — Stripe sends events directly. Signature is verified
  // via stripe.webhooks.constructEvent using STRIPE_WEBHOOK_SECRET.
  // All events are idempotent via the stripe_events dedup table.
  //
  // The webhook handler is registered in its own scoped plugin so it can
  // override the content-type parser for application/json → Buffer without
  // affecting the other billing routes that need parsed JSON bodies.

  await app.register(async (webhookScope) => {
    // Parse the raw body as a Buffer so we can verify Stripe's signature.
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => {
        done(null, body as Buffer);
      }
    );

    webhookScope.post(
      '/billing/webhook',
      {},
      async (request: FastifyRequest, reply: FastifyReply) => {
      const stripe = getStripe();
      if (!stripe) {
        return reply.status(503).send({ error: 'Stripe not configured' });
      }

      if (!WEBHOOK_SECRET) {
        app.log.error('[billing] STRIPE_WEBHOOK_SECRET not set — webhook rejected');
        return reply.status(500).send({ error: 'Webhook secret not configured' });
      }

      const sig = request.headers['stripe-signature'];
      if (!sig) {
        return reply.status(400).send({ error: 'Missing stripe-signature header' });
      }

      // request.body is the raw Buffer (parsed by our content-type parser above).
      const rawBody = request.body as Buffer | string | null;
      if (!rawBody) {
        return reply.status(400).send({ error: 'Could not read raw body' });
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(rawBody, sig as string, WEBHOOK_SECRET);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        app.log.warn({ err }, `[billing] Stripe webhook signature verification failed: ${msg}`);
        return reply.status(400).send({ error: `Webhook signature invalid: ${msg}` });
      }

      // Idempotency check — ignore already-processed events.
      try {
        await db.insert(stripeEvents).values({
          stripeEventId: event.id,
          eventType: event.type,
        });
      } catch {
        // PRIMARY KEY violation = duplicate event, discard silently.
        app.log.info({ eventId: event.id }, '[billing] Stripe event already processed, skipping');
        return reply.status(200).send({ received: true, duplicate: true });
      }

      app.log.info({ eventId: event.id, type: event.type }, '[billing] Processing Stripe event');

      try {
        await handleStripeEvent(event, app);
      } catch (err) {
        app.log.error({ err, eventId: event.id }, '[billing] Error handling Stripe event');
        // Return 200 to prevent Stripe from retrying (we've already deduped).
        // The error is logged; manual investigation required.
        return reply.status(200).send({ received: true, error: 'Handler failed' });
      }

      return reply.status(200).send({ received: true });
    });
  }); // end webhook scoped plugin

  // ── GET /api/v1/admin/subscriptions ───────────────────────────────────────

  app.get(
    '/admin/subscriptions',
    { preHandler: [requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { limit?: string; offset?: string; tier?: string };
      const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
      const offset = parseInt(query.offset ?? '0', 10);

      const rows = await db
        .select({
          id: subscriptions.id,
          userId: subscriptions.userId,
          tier: subscriptions.tier,
          status: subscriptions.status,
          stripeCustomerId: subscriptions.stripeCustomerId,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          gracePeriodEnd: subscriptions.gracePeriodEnd,
          createdAt: subscriptions.createdAt,
          userEmail: users.email,
          userName: users.name,
        })
        .from(subscriptions)
        .leftJoin(users, eq(subscriptions.userId, users.id))
        .where(query.tier ? eq(subscriptions.tier, query.tier) : undefined)
        .orderBy(desc(subscriptions.createdAt))
        .limit(limit)
        .offset(offset);

      // Simple MRR estimate
      const mrr = rows.reduce((acc: number, row: typeof rows[number]) => {
        if (row.status !== 'active' && row.status !== 'trialing') return acc;
        if (row.tier === 'pro') return acc + 19;
        if (row.tier === 'enterprise') return acc + 199;
        return acc;
      }, 0);

      return reply.send({
        subscriptions: rows,
        pagination: { limit, offset, count: rows.length },
        mrr_usd: mrr,
      });
    }
  );
}

// ── Period extraction helpers ────────────────────────────────────────────────

/**
 * Extract current period start from a Stripe Subscription.
 *
 * In Stripe API v2026+, the top-level current_period_start is removed.
 * We read from the first subscription item if available, falling back to null.
 */
/** Stripe API v2026 removed top-level current_period_* — read from first item. */
interface StripeLegacyPeriod {
  current_period_start?: number;
  current_period_end?: number;
}

function extractPeriodStart(sub: Stripe.Subscription): Date | null {
  const legacy = sub as unknown as StripeLegacyPeriod;
  const ts: number | undefined =
    legacy.current_period_start ??
    sub.items?.data?.[0]?.current_period_start;
  return ts ? new Date(ts * 1000) : null;
}

function extractPeriodEnd(sub: Stripe.Subscription): Date | null {
  const legacy = sub as unknown as StripeLegacyPeriod;
  const ts: number | undefined =
    legacy.current_period_end ??
    sub.items?.data?.[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

// ── Stripe event handler ─────────────────────────────────────────────────────

/**
 * Process a verified Stripe event and update the subscriptions table.
 *
 * Handles:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_failed
 *   - invoice.payment_succeeded
 */
async function handleStripeEvent(event: Stripe.Event, app: FastifyInstance): Promise<void> {
  switch (event.type) {

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const stripeSub = event.data.object as Stripe.Subscription;
      const userId = stripeSub.metadata?.userId;
      if (!userId) {
        app.log.warn({ stripeSub }, '[billing] subscription event missing userId in metadata');
        return;
      }

      const tier = stripeSub.metadata?.tier ?? 'pro';
      const status = mapStripeStatus(stripeSub.status);

      await db
        .insert(subscriptions)
        .values({
          id: generateId(),
          userId,
          tier,
          status,
          stripeCustomerId: stripeSub.customer as string,
          stripeSubscriptionId: stripeSub.id,
          currentPeriodStart: extractPeriodStart(stripeSub),
          currentPeriodEnd: extractPeriodEnd(stripeSub),
          gracePeriodEnd: null,
        })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: {
            tier,
            status,
            stripeCustomerId: stripeSub.customer as string,
            stripeSubscriptionId: stripeSub.id,
            currentPeriodStart: extractPeriodStart(stripeSub),
            currentPeriodEnd: extractPeriodEnd(stripeSub),
            gracePeriodEnd: null,
            updatedAt: new Date(),
          },
        });

      app.log.info({ userId, tier, status }, '[billing] Subscription upserted');
      break;
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as Stripe.Subscription;
      const userId = stripeSub.metadata?.userId;
      if (!userId) return;

      await db
        .update(subscriptions)
        .set({ tier: 'free', status: 'canceled', updatedAt: new Date() })
        .where(eq(subscriptions.userId, userId));

      app.log.info({ userId }, '[billing] Subscription canceled → downgraded to free');
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      if (!customerId) return;

      // Grace period: 7 days from now before limits are enforced at Free tier.
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setUTCDate(gracePeriodEnd.getUTCDate() + 7);

      await db
        .update(subscriptions)
        .set({ status: 'past_due', gracePeriodEnd, updatedAt: new Date() })
        .where(eq(subscriptions.stripeCustomerId, customerId));

      app.log.warn({ customerId }, '[billing] Payment failed — grace period started');
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      if (!customerId) return;

      await db
        .update(subscriptions)
        .set({ status: 'active', gracePeriodEnd: null, updatedAt: new Date() })
        .where(eq(subscriptions.stripeCustomerId, customerId));

      app.log.info({ customerId }, '[billing] Payment succeeded — subscription restored to active');
      break;
    }

    default:
      app.log.debug({ type: event.type }, '[billing] Unhandled Stripe event type (ignored)');
  }
}

/**
 * Map a Stripe subscription status string to our internal status.
 */
function mapStripeStatus(stripeStatus: Stripe.Subscription['status']): string {
  switch (stripeStatus) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired': return 'canceled';
    case 'incomplete': return 'past_due';
    default: return 'active';
  }
}
