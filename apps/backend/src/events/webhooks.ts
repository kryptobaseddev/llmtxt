/**
 * Webhook delivery worker — hardened (T165).
 *
 * Listens on the event bus and delivers matching events to registered webhook
 * endpoints via HTTP POST. Delivery is fire-and-forget from the perspective
 * of the request handler — events are never awaited on the hot path.
 *
 * Delivery guarantees (T165):
 * - At-least-once delivery with up to MAX_RETRIES attempts per event.
 * - Exponential back-off: INITIAL_BACKOFF_MS * 2^attempt, capped at MAX_BACKOFF_MS.
 * - After all retries exhausted, event written to webhook_dlq (dead-letter queue).
 * - Every attempt (success or failure) writes a row to webhook_deliveries.
 * - X-Llmtxt-Event-Id is stable across all retry attempts for the same event.
 *
 * Signature:
 * - Each delivery includes an `X-LLMtxt-Signature` header containing
 *   `sha256=<hex HMAC-SHA256 of the JSON body>` using the webhook secret.
 * - Recipients should verify this header before processing events.
 *
 * Tracing:
 * - Each delivery includes W3C Trace Context headers (traceparent, tracestate)
 *   to enable correlation with the span that triggered the event.
 *
 * Circuit breaker (T165):
 * - In-process sliding window tracks failure ratio per webhook.
 * - If failure rate > 50% over 5m with >= 4 calls, webhook disabled immediately.
 *
 * Security:
 * - Only HTTPS URLs are allowed in production (NODE_ENV=production).
 * - The secret is stored in plaintext in the DB; treat it as a symmetric key.
 */
import { signWebhookPayload, generateId } from 'llmtxt';
import { context, propagation } from '@opentelemetry/api';
import { eventBus, type DocumentEvent } from './bus.js';
import { db } from '../db/index.js';
import { webhooks, webhookDeliveries, webhookDlq } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { webhookDeliveryTotal } from '../middleware/metrics.js';
import { shutdownCoordinator } from '../lib/shutdown.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of delivery attempts (1 initial + 9 retries = 10 total). */
const MAX_RETRIES = 9;
/** First retry delay: 10 seconds. */
const INITIAL_BACKOFF_MS = 10_000;
/** Hard ceiling on backoff delay: 1 hour. */
const MAX_BACKOFF_MS = 3_600_000;
/** Consecutive failure count that triggers auto-disable. */
const MAX_FAILURE_COUNT = 10;
/** HTTP timeout per delivery attempt. */
const DELIVERY_TIMEOUT_MS = 10_000;

// ── Circuit-breaker constants ─────────────────────────────────────────────────

const CB_WINDOW_MS = 5 * 60_000; // 5 minutes
const CB_FAILURE_RATE_THRESHOLD = 0.5; // 50 %
const CB_MIN_CALLS = 4;

// ── Circuit-breaker state ─────────────────────────────────────────────────────

interface CbRecord {
  successes: number[];
  failures: number[];
}

const _cbState = new Map<string, CbRecord>();

function cbRecord(webhookId: string): CbRecord {
  let rec = _cbState.get(webhookId);
  if (!rec) {
    rec = { successes: [], failures: [] };
    _cbState.set(webhookId, rec);
  }
  return rec;
}

/**
 * Record a delivery outcome. Returns true if the circuit should trip.
 */
function cbObserve(webhookId: string, success: boolean): boolean {
  const now = Date.now();
  const cutoff = now - CB_WINDOW_MS;
  const rec = cbRecord(webhookId);

  rec.successes = rec.successes.filter(t => t > cutoff);
  rec.failures = rec.failures.filter(t => t > cutoff);

  if (success) {
    rec.successes.push(now);
  } else {
    rec.failures.push(now);
  }

  const total = rec.successes.length + rec.failures.length;
  if (total < CB_MIN_CALLS) return false;

  return rec.failures.length / total > CB_FAILURE_RATE_THRESHOLD;
}

/** Clear circuit-breaker state for a webhook (used when webhook is re-enabled). */
export function cbReset(webhookId: string): void {
  _cbState.delete(webhookId);
}

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

// ── Single-attempt delivery ───────────────────────────────────────────────────

interface AttemptResult {
  success: boolean;
  responseStatus: number | null;
  reason: 'ok' | 'http_error' | 'timeout' | 'network_error';
}

/**
 * Make one HTTP POST to the webhook URL. Never throws — returns structured result.
 */
async function singleAttempt(
  url: string,
  secret: string,
  payload: string,
  eventId: string,
  eventType: string,
): Promise<AttemptResult> {
  const signature = computeSignature(secret, payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'llmtxt-webhook/1.0',
      'X-LLMtxt-Signature': signature,
      'X-LLMtxt-Event': eventType,
      // Stable across all retry attempts — enables idempotent receivers.
      'X-Llmtxt-Event-Id': eventId,
    };

    // Inject W3C Trace Context headers (traceparent, tracestate).
    propagation.inject(context.active(), headers);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      return { success: true, responseStatus: response.status, reason: 'ok' };
    }
    return { success: false, responseStatus: response.status, reason: 'http_error' };
  } catch (err: unknown) {
    clearTimeout(timer);
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('abort'));
    return { success: false, responseStatus: null, reason: isAbort ? 'timeout' : 'network_error' };
  }
}

// ── Delivery log writer ───────────────────────────────────────────────────────

async function writeDeliveryLog(
  webhookId: string,
  eventId: string,
  attemptNum: number,
  result: AttemptResult,
  durationMs: number,
): Promise<string> {
  const id = generateId();
  await db.insert(webhookDeliveries).values({
    id,
    webhookId,
    eventId,
    attemptNum,
    status: result.success ? 'success' : result.reason === 'timeout' ? 'timeout' : 'failed',
    responseStatus: result.responseStatus ?? null,
    durationMs,
    createdAt: Date.now(),
  });
  return id;
}

// ── DLQ writer ────────────────────────────────────────────────────────────────

async function writeToDlq(
  webhookId: string,
  eventId: string,
  failedDeliveryId: string,
  reason: string,
  payload: string,
): Promise<void> {
  await db.insert(webhookDlq).values({
    id: generateId(),
    webhookId,
    failedDeliveryId,
    eventId,
    reason,
    payload,
    capturedAt: Date.now(),
    replayedAt: null,
  });
}

// ── Retry loop ────────────────────────────────────────────────────────────────

/**
 * Deliver an event to one webhook with exponential-backoff retries.
 *
 * - Generates a stable eventId once for all attempts.
 * - Writes a webhook_deliveries row after every attempt.
 * - On exhaustion, writes to webhook_dlq (no silent drops).
 * - Evaluates circuit-breaker and disables webhook if tripped.
 */
async function deliverWithRetry(
  webhookId: string,
  url: string,
  secret: string,
  failureCount: number,
  payload: string,
  eventType: string = 'unknown',
): Promise<void> {
  // One stable ID for all retry attempts of the same event.
  const eventId = randomUUID();
  let lastDeliveryId = '';
  let lastReason = 'unknown';
  let success = false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      await new Promise<void>(res => setTimeout(res, delay));
    }

    const startMs = Date.now();
    const result = await singleAttempt(url, secret, payload, eventId, eventType);
    const durationMs = Date.now() - startMs;

    lastDeliveryId = await writeDeliveryLog(webhookId, eventId, attempt, result, durationMs);
    lastReason = result.reason;

    const shouldTrip = cbObserve(webhookId, result.success);

    if (result.success) {
      success = true;
      break;
    }

    if (shouldTrip) {
      console.warn(`[webhook] circuit-breaker tripped for ${webhookId} (${url})`);
      await db
        .update(webhooks)
        .set({ failureCount: MAX_FAILURE_COUNT, active: false, lastDeliveryAt: Date.now() })
        .where(eq(webhooks.id, webhookId));
      webhookDeliveryTotal.inc({ event_type: eventType, result: 'circuit_open' });
      await writeToDlq(webhookId, eventId, lastDeliveryId, 'circuit_breaker', payload);
      return;
    }
  }

  const now = Date.now();

  if (success) {
    await db
      .update(webhooks)
      .set({ failureCount: 0, lastDeliveryAt: now, lastSuccessAt: now })
      .where(eq(webhooks.id, webhookId));
    webhookDeliveryTotal.inc({ event_type: eventType, result: 'delivered' });
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
    webhookDeliveryTotal.inc({ event_type: eventType, result: 'failed' });

    // Write to dead-letter queue — event must not be silently dropped.
    await writeToDlq(webhookId, eventId, lastDeliveryId, lastReason, payload);
  }
}

// ── Worker initialisation ────────────────────────────────────────────────────

/** Track in-flight delivery promises so drain can await them (T092 AC5). */
const _pendingDeliveries = new Set<Promise<void>>();

/**
 * Start the webhook delivery worker.
 *
 * Call once at server startup. The worker attaches a single listener to the
 * event bus and fans out to all matching webhooks for each event.
 */
export function startWebhookWorker(): void {
  eventBus.on('document', (event: DocumentEvent) => {
    // Fire-and-forget — never await on the event-bus listener.
    const p = dispatchToWebhooks(event);
    _pendingDeliveries.add(p);
    void p.finally(() => _pendingDeliveries.delete(p));
  });

  // Register drain hook: wait for all in-flight deliveries (T092 AC5).
  shutdownCoordinator.registerDrainHook('webhook-deliveries', async () => {
    if (_pendingDeliveries.size === 0) return;
    console.log(`[shutdown] waiting for ${_pendingDeliveries.size} webhook delivery promises`);
    await Promise.allSettled(Array.from(_pendingDeliveries));
    console.log('[shutdown] webhook deliveries flushed');
  });
}

/** Fetch matching webhooks and dispatch the event to each one asynchronously. */
async function dispatchToWebhooks(event: DocumentEvent): Promise<void> {
  try {
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
        deliverWithRetry(hook.id, hook.url, hook.secret, hook.failureCount, payload, event.type),
      );
    }

    await Promise.allSettled(deliveryPromises);
  } catch {
    // Never throw from the event bus listener — it would propagate to EventEmitter
    // and potentially crash the process.
  }
}

// ── Re-queue from DLQ (admin replay) ─────────────────────────────────────────

/**
 * Re-attempt delivery of a single DLQ entry.
 *
 * Called from POST /webhooks/:id/dlq/:entryId/replay.
 * Uses the stored payload verbatim (stable event ID is preserved).
 * On success, marks the DLQ entry as replayed.
 */
export async function replayDlqEntry(
  dlqEntryId: string,
): Promise<{ success: boolean; responseStatus: number | null }> {
  const [entry] = await db
    .select()
    .from(webhookDlq)
    .where(eq(webhookDlq.id, dlqEntryId))
    .limit(1);

  if (!entry) return { success: false, responseStatus: null };

  const [hook] = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, entry.webhookId))
    .limit(1);

  if (!hook) return { success: false, responseStatus: null };

  let parsedType = 'unknown';
  try {
    parsedType = ((JSON.parse(entry.payload) as Record<string, unknown>).type as string) ?? 'unknown';
  } catch { /* ignore */ }

  const startMs = Date.now();
  const result = await singleAttempt(hook.url, hook.secret, entry.payload, entry.eventId, parsedType);
  const durationMs = Date.now() - startMs;

  // Record the replay attempt (attemptNum = -1 = manual replay).
  const deliveryId = await writeDeliveryLog(entry.webhookId, entry.eventId, -1, result, durationMs);

  if (result.success) {
    await db
      .update(webhookDlq)
      .set({ replayedAt: Date.now() })
      .where(eq(webhookDlq.id, dlqEntryId));

    await db
      .update(webhooks)
      .set({ failureCount: 0, lastDeliveryAt: Date.now(), lastSuccessAt: Date.now() })
      .where(eq(webhooks.id, entry.webhookId));
  } else {
    console.warn(
      `[webhook] DLQ replay failed for entry ${dlqEntryId}: ${result.reason} (delivery ${deliveryId})`,
    );
  }

  return { success: result.success, responseStatus: result.responseStatus };
}
