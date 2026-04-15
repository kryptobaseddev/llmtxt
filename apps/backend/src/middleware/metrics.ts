/**
 * Prometheus metrics middleware for LLMtxt backend.
 *
 * Registers prom-client default registry metrics and attaches Fastify hooks
 * that record per-request HTTP duration and request count with method, route,
 * and status_code labels.
 *
 * Domain event counters (document, approval, version, webhook) are exported
 * from this module and must be imported and incremented at the relevant call
 * sites in route handlers.
 *
 * SPEC references: SPEC-T145 §7.1–7.3
 */
import { register, Histogram, Counter, collectDefaultMetrics } from 'prom-client';
import type { FastifyInstance } from 'fastify';

// ─── Default metrics (process, GC, event loop, etc.) ───────────��─────────────

// prom-client collects default metrics (process CPU, memory, GC, event loop
// lag) unless disabled. We want these for free.
// Calling collectDefaultMetrics is idempotent, but only safe to call once.
// We guard with a module-level flag so the middleware can be registered in
// tests without double-registration errors.
let defaultMetricsStarted = false;

export function ensureDefaultMetrics(): void {
  if (!defaultMetricsStarted) {
    collectDefaultMetrics({ register });
    defaultMetricsStarted = true;
  }
}

// ─── HTTP request metrics ─────────────────────────────────────────────��───────

/**
 * HTTP request duration histogram (seconds).
 * Labels: method, route, status_code.
 * SPEC-T145 §7.2
 */
export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

/**
 * HTTP requests total counter.
 * Labels: method, route, status_code.
 * SPEC-T145 §7.2
 */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

// ─── Domain event counters (SPEC-T145 §7.3) ──────────────────────────────���───

/** Incremented when a document is created successfully. */
export const documentCreatedTotal = new Counter({
  name: 'llmtxt_document_created_total',
  help: 'Total number of documents created',
  registers: [register],
});

/** Incremented when an approval vote is submitted. */
export const documentApprovalSubmittedTotal = new Counter({
  name: 'llmtxt_document_approval_submitted_total',
  help: 'Total number of document approval votes submitted',
  registers: [register],
});

/** Incremented on every document lifecycle state transition. */
export const documentStateTransitionTotal = new Counter({
  name: 'llmtxt_document_state_transition_total',
  help: 'Total number of document state transitions',
  labelNames: ['from_state', 'to_state'] as const,
  registers: [register],
});

/** Incremented when a new document version is created. */
export const versionCreatedTotal = new Counter({
  name: 'llmtxt_version_created_total',
  help: 'Total number of document versions created',
  registers: [register],
});

/** Incremented on every webhook delivery attempt. */
export const webhookDeliveryTotal = new Counter({
  name: 'llmtxt_webhook_delivery_total',
  help: 'Total number of webhook delivery attempts',
  labelNames: ['result'] as const,
  registers: [register],
});

// ─── Fastify plugin ─────────────────────────────────���────────────────────────���

/**
 * Register per-request HTTP metrics hooks on the Fastify instance.
 *
 * Attaches an onRequest hook to start a timer and an onResponse hook to
 * record the duration and increment the request counter. The /api/metrics
 * route itself is excluded from metrics to avoid self-referential noise.
 *
 * Call this once during application setup, after plugin registration and
 * before route registration.
 */
export async function registerMetrics(app: FastifyInstance): Promise<void> {
  ensureDefaultMetrics();

  app.addHook('onRequest', async (request, _reply) => {
    // Store a high-res start time on the request so onResponse can compute
    // elapsed time without a closure allocation per request.
    (request as RequestWithTimer)._metricsStart = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const start = (request as RequestWithTimer)._metricsStart;
    if (start === undefined) return;

    // Skip the /api/metrics route itself — no self-referential metrics.
    const url = request.url.split('?')[0];
    if (url === '/api/metrics' || url === '/metrics') return;

    const durationNs = process.hrtime.bigint() - start;
    const durationS = Number(durationNs) / 1e9;

    // Use the matched route pattern if available (avoids high cardinality from
    // IDs in paths like /api/documents/:slug). Falls back to the raw URL when
    // no route was matched (e.g. 404).
    const route = request.routeOptions?.url ?? url;
    const method = request.method;
    const statusCode = String(reply.statusCode);

    httpRequestDurationSeconds.observe({ method, route, status_code: statusCode }, durationS);
    httpRequestsTotal.inc({ method, route, status_code: statusCode });
  });
}

// ─── Internal types ─────────────────────────────────────────────────────��─────

interface RequestWithTimer {
  _metricsStart?: bigint;
}

// Re-export the registry for use in the /api/metrics route handler.
export { register as metricsRegistry };
