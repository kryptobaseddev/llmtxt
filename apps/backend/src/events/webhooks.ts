/**
 * Webhook delivery worker.
 *
 * Listens on the event bus and delivers matching events to registered webhook
 * endpoints via HTTP POST. Delivery is fire-and-forget from the perspective
 * of the request handler — events are never awaited on the hot path.
 *
 * Delivery guarantees:
 * - At-least-once delivery with up to 3 retries per event.
 * - Exponential back-off: 1 s, 2 s, 4 s.
 * - Webhook is automatically disabled after 10 consecutive failures.
 *
 * Signature:
 * - Each delivery includes an `X-LLMtxt-Signature` header containing
 *   `sha256=<hex HMAC-SHA256 of the JSON body>` using the webhook secret.
 * - Recipients should verify this header before processing events.
 *
 * Security:
 * - Only HTTPS URLs are allowed in production (NODE_ENV=production).
 * - The secret is stored in plaintext in the DB; treat it as a symmetric key.
 */
import { signWebhookPayload } from 'llmtxt';
import { eventBus, type DocumentEvent } from './bus.js';
import { db } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_FAILURE_COUNT = 10;
const DELIVERY_TIMEOUT_MS = 10_000;

// ── HMAC signature ────────────────────────────────────────────────────────────

/**
 * Compute HMAC-SHA256 signature for a payload.
 *
 * Delegates to crates/llmtxt-core::crypto::sign_webhook_payload via the
 * llmtxt WASM binding. Returns `sha256=<hex>`.
 */
function computeSignature(secret: string, payload: string): string {
  return signWebhookPayload(secret, payload);
}

// ── Delivery ─────────────────────────────────────────────────────────────────

/** Attempt to deliver a single event to a single webhook URL. Returns true on success. */
async function attemptDelivery(url: string, secret: string, payload: string): Promise<boolean> {
  const signature = computeSignature(secret, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'llmtxt-webhook/1.0',
        'X-LLMtxt-Signature': signature,
        'X-LLMtxt-Event': JSON.parse(payload).type ?? 'unknown',
      },
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

/** Deliver an event to a webhook with retries and back-off. Updates failure count in DB. */
async function deliverWithRetry(
  webhookId: string,
  url: string,
  secret: string,
  failureCount: number,
  payload: string,
): Promise<void> {
  let success = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise(res => setTimeout(res, INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1)));
    }
    success = await attemptDelivery(url, secret, payload);
    if (success) break;
  }

  const now = Date.now();
  if (success) {
    // Reset failure counter on success.
    await db
      .update(webhooks)
      .set({ failureCount: 0, lastDeliveryAt: now, lastSuccessAt: now })
      .where(eq(webhooks.id, webhookId));
  } else {
    const newFailureCount = failureCount + 1;
    const shouldDisable = newFailureCount >= MAX_FAILURE_COUNT;
    await db
      .update(webhooks)
      .set({
        failureCount: newFailureCount,
        lastDeliveryAt: now,
        ...(shouldDisable ? { active: false } : {}),
      })
      .where(eq(webhooks.id, webhookId));
  }
}

// ── Worker initialisation ────────────────────────────────────────────────────

/**
 * Start the webhook delivery worker.
 *
 * Call once at server startup. The worker attaches a single listener to the
 * event bus and fans out to all matching webhooks for each event.
 */
export function startWebhookWorker(): void {
  eventBus.on('document', (event: DocumentEvent) => {
    // Fire-and-forget — never await on the event-bus listener.
    void dispatchToWebhooks(event);
  });
}

/** Fetch matching webhooks and dispatch the event to each one asynchronously. */
async function dispatchToWebhooks(event: DocumentEvent): Promise<void> {
  try {
    // Fetch all active webhooks. We use two queries — one for slug-scoped
    // and one for user-wide — to keep the SQL simple with SQLite.
    const allActive = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.active, true));

    if (allActive.length === 0) return;

    const payload = JSON.stringify({
      ...event,
      delivered_at: Date.now(),
    });

    const deliveryPromises: Promise<void>[] = [];

    for (const hook of allActive) {
      // Scope check: null documentSlug means "all documents for this user".
      if (hook.documentSlug !== null && hook.documentSlug !== event.slug) {
        continue;
      }

      // Event filter check: empty array or '[]' means subscribe to all.
      let subscribedEvents: string[] = [];
      try {
        subscribedEvents = JSON.parse(hook.events) as string[];
      } catch {
        subscribedEvents = [];
      }
      if (subscribedEvents.length > 0 && !subscribedEvents.includes(event.type)) {
        continue;
      }

      deliveryPromises.push(
        deliverWithRetry(hook.id, hook.url, hook.secret, hook.failureCount, payload),
      );
    }

    await Promise.allSettled(deliveryPromises);
  } catch {
    // Never throw from the event bus listener — it would propagate to EventEmitter
    // and potentially crash the process.
  }
}
