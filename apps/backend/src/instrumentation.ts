/**
 * OpenTelemetry SDK + GlitchTip (Sentry-compatible) initialisation.
 *
 * This file MUST be loaded before any other application module via the Node.js
 * --import flag so that auto-instrumentations are registered before Fastify
 * (or any other instrumented library) is imported.
 *
 * Load order enforced in package.json#scripts.start:
 *   node --import ./dist/instrumentation.js dist/index.js
 *
 * OTel behaviour:
 * - OTEL_EXPORTER_OTLP_ENDPOINT set   → OTLP/HTTP exporter to that endpoint.
 *   In Railway production this is the private domain of the OTel Collector
 *   service: http://${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}:4318
 * - OTEL_EXPORTER_OTLP_ENDPOINT unset → spans are discarded (no-op exporter).
 *   A startup warning is logged so operators know the state.
 *
 * Error tracking behaviour (GlitchTip — OSS Sentry-compatible):
 * - SENTRY_DSN set   → Sentry SDK initialised pointing at self-hosted
 *   GlitchTip service on Railway. GlitchTip accepts the standard Sentry DSN
 *   wire protocol so no code changes are needed beyond pointing the DSN at the
 *   GlitchTip public domain.
 *   In Railway: SENTRY_DSN=${{GlitchTip.GLITCHTIP_PUBLIC_DSN}}
 * - SENTRY_DSN unset → Sentry.init is skipped; no crash, warning logged.
 *
 * PII scrubbing: Authorization and Cookie request headers are redacted from
 * HTTP spans via the instrumentation requestHook (SPEC-T145 §4.6).
 * GlitchTip also scrubs Authorization, Cookie, and password fields.
 *
 * All observability data stays within Railway private networking — no external
 * SaaS endpoints (Grafana Cloud, Sentry cloud, Datadog) are used.
 *
 * SPEC references: SPEC-T145 §3, §4.5, §4.6, §5.1–5.4
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import * as Sentry from '@sentry/node';

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
      'Set OTEL_EXPORTER_OTLP_ENDPOINT to the Railway private domain of the OTel Collector ' +
      'service, e.g. http://${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}:4318'
  );
} else {
  console.log(`[otel] OTel SDK started. Exporting traces to: ${otlpEndpoint}`);
}

// ─── GlitchTip initialisation (SPEC-T145 §5.1–5.4) ──────────────────────────
//
// GlitchTip is an OSS, self-hosted, Sentry-compatible error tracker.
// It accepts the standard Sentry DSN protocol — the @sentry/node SDK is used
// unchanged; only SENTRY_DSN points at the GlitchTip Railway service instead
// of Sentry cloud.
//
// In Railway, set:
//   SENTRY_DSN = ${{GlitchTip.GLITCHTIP_PUBLIC_DSN}}
//
// No data leaves your Railway project.

const sentryDsn = process.env.SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Trim auth headers and passwords before they reach GlitchTip.
    // beforeSend hook scrubs the request object in each event.
    beforeSend(event) {
      if (event.request?.headers) {
        for (const key of Object.keys(event.request.headers)) {
          if (/^(authorization|cookie|x-api-key)$/i.test(key)) {
            (event.request.headers as Record<string, string>)[key] = '[REDACTED]';
          }
        }
      }
      if (event.request?.data) {
        try {
          const data =
            typeof event.request.data === 'string'
              ? (JSON.parse(event.request.data) as Record<string, unknown>)
              : (event.request.data as Record<string, unknown>);
          if (data && typeof data === 'object' && 'password' in data) {
            data['password'] = '[REDACTED]';
          }
        } catch {
          // data is not JSON — leave as-is
        }
      }
      return event;
    },
  });
  console.log('[glitchtip] GlitchTip error tracking initialised (Sentry-compatible, self-hosted).');
} else {
  console.warn(
    '[glitchtip] SENTRY_DSN is not set — error tracking is disabled. ' +
      'Set SENTRY_DSN to the GlitchTip DSN from your self-hosted Railway service: ' +
      '${{GlitchTip.GLITCHTIP_PUBLIC_DSN}}'
  );
}

// Export Sentry so error handler in index.ts can call captureException.
export { Sentry };

// ─── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  sdk.shutdown().catch((err: Error) => {
    console.error('[otel] Error during OTel SDK shutdown:', err);
  });
});
