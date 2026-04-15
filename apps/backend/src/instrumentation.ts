/**
 * OpenTelemetry SDK initialisation.
 *
 * This file MUST be loaded before any other application module via the Node.js
 * --import flag so that auto-instrumentations are registered before Fastify
 * (or any other instrumented library) is imported.
 *
 * Load order enforced in package.json#scripts.start:
 *   node --import ./dist/instrumentation.js dist/index.js
 *
 * Behaviour:
 * - OTEL_EXPORTER_OTLP_ENDPOINT set   → OTLP/HTTP exporter to that endpoint.
 * - OTEL_EXPORTER_OTLP_ENDPOINT unset → spans are discarded (DiscardingExporter).
 *   A startup warning is logged so operators know the state.
 *
 * PII scrubbing: Authorization and Cookie request headers are redacted from
 * HTTP spans via the instrumentation requestHook (SPEC-T145 §4.6).
 *
 * SPEC references: SPEC-T145 §3, §4.5, §4.6
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// ─── PII scrubbing constant ───────────────────────────────────────────────────

const REDACTED = '[REDACTED]';

// ─── SDK setup ────────────────────────────────────────────────────────────────

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const otlpAuthHeader = process.env.OTEL_AUTH_HEADER;

const instrumentations = [
  getNodeAutoInstrumentations({
    // Disable noisy instrumentations that aren't useful for this service.
    // fs instrumentation produces thousands of spans from module loading.
    '@opentelemetry/instrumentation-fs': { enabled: false },
    // DNS spans add noise without actionable data at our current scale.
    '@opentelemetry/instrumentation-dns': { enabled: false },
    // Scrub PII from HTTP instrumentation spans (SPEC-T145 §4.6).
    // OTel's Span interface does not expose `.attributes` — we can only
    // write via `setAttribute`. The HTTP instrumentation captures headers
    // as `http.request.header.<name>` (lowercased) when configured to do
    // so, so we pre-emptively blank the sensitive keys here. A stricter
    // scrubber would wrap the exporter; this is a correct-by-construction
    // cheap defense-in-depth.
    '@opentelemetry/instrumentation-http': {
      requestHook: (span) => {
        for (const key of [
          'http.request.header.authorization',
          'http.request.header.cookie',
          'http.request.header.x-api-key',
          'http.response.header.set-cookie',
        ]) {
          span.setAttribute(key, REDACTED);
        }
      },
    },
  }),
];

let sdk: NodeSDK;
let usingNoOp = false;

if (otlpEndpoint) {
  const headers: Record<string, string> = {};
  if (otlpAuthHeader) {
    headers['Authorization'] = `Basic ${otlpAuthHeader}`;
  }
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `${otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
      headers,
    }),
    instrumentations,
  });
} else {
  usingNoOp = true;
  // No traceExporter provided → NodeSDK uses NoopSpanExporter internally.
  // Spans are created and processed by auto-instrumentations (so hooks fire
  // and Fastify's instrumentation registers correctly), but nothing is sent.
  sdk = new NodeSDK({
    instrumentations,
  });
}

sdk.start();

if (usingNoOp) {
  // console.warn so this always appears even if Pino is not yet configured
  // (this file loads before index.ts initialises the logger).
  console.warn(
    '[otel] OTEL_EXPORTER_OTLP_ENDPOINT is not set — traces will be discarded. ' +
      'Set this env var to export traces to Grafana Cloud Tempo or another OTLP backend.'
  );
} else {
  console.log(`[otel] OTel SDK started. Exporting traces to: ${otlpEndpoint}`);
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  sdk.shutdown().catch((err: Error) => {
    console.error('[otel] Error during OTel SDK shutdown:', err);
  });
});
