# T145 Research: Observability Stack (Pino→Loki, OpenTelemetry, Sentry, Metrics)

**Date**: 2026-04-15
**Epic**: T145
**Author**: RCASD Team Lead (LOOM)

---

## 1. Problem Statement

Without observability, failures at 3am go undetected until a user complains. Latency regressions are invisible. The 2026-04-15 outage (T144) was caught by a user, not an alert. This epic delivers:

1. **Structured logs** (Pino) shipped to Loki for queryability.
2. **Distributed traces** (OpenTelemetry) with span correlation into logs.
3. **Error tracking** (Sentry) with source-map symbolication.
4. **Metrics** (prom-client) at `/metrics` for Prometheus scraping and alerting.
5. **Health endpoints** (`/api/health`, `/api/ready`) for Railway uptime checks.

This advances Guiding Star properties 6 (Lose nothing on failure — failures are surfaced) and 7 (Not impede others — latency regressions are visible).

---

## 2. What Exists Today

### Logging

`apps/backend/src/index.ts` creates a Fastify instance with `logger: true`. This uses Fastify's built-in Pino logger with default configuration. No structured fields beyond what Fastify emits. No log shipping. No trace correlation.

### Error handling

A `setErrorHandler` in `index.ts` calls `app.log.error(error)` and returns a generic JSON error. No Sentry integration.

### Health check

No `/api/health` or `/api/ready` endpoint exists today.

### Metrics

No Prometheus endpoint. No request latency histograms. No domain event counters.

### Tracing

No OpenTelemetry instrumentation. No trace/span IDs in logs.

---

## 3. Technology Choices (Locked by Orchestrator)

| Concern | Package | Notes |
|---------|---------|-------|
| Traces | `@opentelemetry/api`, `@opentelemetry/sdk-node` | Vendor-neutral |
| Auto-instrumentation | `@opentelemetry/auto-instrumentations-node` | Instruments http, fastify, sqlite3 |
| Trace export | `@opentelemetry/exporter-trace-otlp-http` | OTLP/HTTP to collector or Grafana Cloud |
| Metrics | `prom-client` | `/metrics` endpoint, Prometheus format |
| Fastify metrics | `fastify-metrics` | Hooks into Fastify request lifecycle |
| Error tracking | `@sentry/node` | Node.js SDK, free tier |
| Log shipping | `pino-loki` | Pino transport for Loki |
| Log correlation | `@opentelemetry/api` | Inject trace_id + span_id into Pino child logger |
| Health | Custom Fastify routes | Simple GET /api/health + /api/ready |

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  apps/backend (Node.js / Fastify)                       │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  OTel SDK (sdk-node)                             │   │
│  │  - HTTP handler spans (auto-instrumented)        │   │
│  │  - DB query spans (better-sqlite3 auto-instr.)   │   │
│  │  - W3C Trace Context propagation (incoming req)  │   │
│  │  - W3C Trace Context injection (outgoing webhook)│   │
│  └─────────────────┬────────────────────────────────┘   │
│                    │ OTLP/HTTP                           │
│  ┌─────────────────▼───────────┐                        │
│  │  Pino logger                │                        │
│  │  + trace_id / span_id fields│──── pino-loki ────────►│ Grafana Loki
│  └─────────────────────────────┘                        │
│                                                         │
│  ┌─────────────────────────────┐                        │
│  │  prom-client                │                        │
│  │  - http_request_duration_s  │                        │
│  │  - http_requests_total      │                        │
│  │  - domain event counters    │◄── GET /metrics ───────│ Prometheus scraper
│  └─────────────────────────────┘                        │
│                                                         │
│  ┌─────────────────────────────┐                        │
│  │  @sentry/node               │──── HTTPS ────────────►│ Sentry cloud
│  │  - captureException (5xx)   │                        │
│  │  - source map uploads CI    │                        │
│  └─────────────────────────────┘                        │
└─────────────────────────────────────────────────────────┘
         │ OTLP/HTTP traces
         ▼
  ┌──────────────────────────────────────────────────────┐
  │  Option A: Grafana Cloud (free tier)                 │
  │    - Grafana Cloud Traces (Tempo)                    │
  │    - Grafana Cloud Logs (Loki)                       │
  │    - Grafana Cloud Metrics (Prometheus)              │
  │                                                      │
  │  Option B: OTel Collector sidecar on Railway         │
  │    - collector → Grafana Cloud / Datadog / other     │
  └──────────────────────────────────────────────────────┘
```

**Direct export vs Collector sidecar**: See Consensus section (open decision OD-1).

---

## 5. Pino → Loki Integration

`pino-loki` is a Pino transport that ships log lines to Loki's push API. It runs in a worker thread so it does not block the event loop.

Configuration:
```ts
import { build } from 'pino-loki';
const transport = build({
  host: process.env.LOKI_HOST,          // e.g. https://logs-prod-xxx.grafana.net
  basicAuth: {
    username: process.env.LOKI_USER,
    password: process.env.LOKI_PASSWORD,
  },
  labels: { app: 'llmtxt-backend', env: process.env.NODE_ENV },
  interval: 5,                           // batch flush interval seconds
  timeout: 10000,
});
```

The Pino logger instance passed to Fastify MUST be the one configured with this transport, OR the transport MUST be attached via `pino.multistream`.

Trace correlation: After OTel SDK initialises and a span is active, inject `trace_id` and `span_id` into each Pino log record using `@opentelemetry/api`'s `context.active()` + `trace.getSpan()`.

---

## 6. OpenTelemetry Setup

OTel SDK MUST be initialised before Fastify starts (i.e., in a separate `instrumentation.ts` file loaded via `--require` or `--import` flag in the Node start command, or at the top of `index.ts` before any other imports).

```ts
// instrumentation.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: { Authorization: `Basic ${process.env.OTEL_AUTH_HEADER}` },
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});
sdk.start();
```

W3C Trace Context (`traceparent` / `tracestate` headers) is handled automatically by `@opentelemetry/auto-instrumentations-node` for incoming HTTP requests. For outgoing webhook deliveries, the webhook worker MUST inject the `traceparent` header using `propagation.inject()`.

---

## 7. Sentry Setup

```ts
import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,  // 10% of transactions (OTel is primary tracing)
});
```

Sentry is attached to the Fastify error handler. The `setErrorHandler` in `index.ts` MUST call `Sentry.captureException(error)` for 5xx errors.

See open decision OD-2 for whether 4xx errors are also captured.

Source maps: the CI release workflow (`release.yml`) MUST upload source maps to Sentry on every tagged release using `@sentry/cli` or the Sentry webpack/rollup plugin.

---

## 8. Metrics (/metrics endpoint)

`prom-client` exposes a default registry. `fastify-metrics` hooks into Fastify's request lifecycle to record:
- `http_request_duration_seconds` — histogram by method, route, status code.
- `http_requests_total` — counter by method, route, status code.

Additional domain event counters (custom):
- `llmtxt_document_created_total`
- `llmtxt_document_approval_submitted_total`
- `llmtxt_document_state_transition_total` (labels: from_state, to_state)
- `llmtxt_version_created_total`
- `llmtxt_webhook_delivery_total` (labels: status: success|failure)

The `/metrics` endpoint MUST return Prometheus text format (`Content-Type: text/plain; version=0.0.4`).

See open decision OD-3 for auth on `/metrics`.

---

## 9. Health Endpoints

`GET /api/health` — always returns 200 `{ status: "ok", version: "...", ts: "..." }`. Used by Railway's health check. Must respond in < 50ms.

`GET /api/ready` — returns 200 when DB connection and any other critical deps are ready, 503 otherwise. Runs a `SELECT 1` on the SQLite connection. Used by load balancers.

Both endpoints MUST be exempt from rate limiting and MUST NOT require authentication.

---

## 10. PII Scrubbing

See open decision OD-4. At minimum:
- `Authorization` header values MUST be redacted in Pino logs and OTel span attributes.
- `password` fields in request bodies MUST be redacted.
- `email` fields MUST be truncated or hashed before appearing in trace span attributes.
- Cookie values MUST be redacted.

---

## 11. External References

- OpenTelemetry Node.js SDK: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- `@opentelemetry/sdk-node`: https://www.npmjs.com/package/@opentelemetry/sdk-node
- `@opentelemetry/auto-instrumentations-node`: https://www.npmjs.com/package/@opentelemetry/auto-instrumentations-node
- `@opentelemetry/exporter-trace-otlp-http`: https://www.npmjs.com/package/@opentelemetry/exporter-trace-otlp-http
- Sentry Node.js docs: https://docs.sentry.io/platforms/javascript/guides/node/
- `prom-client`: https://github.com/siimon/prom-client
- `fastify-metrics`: https://github.com/avivkeller/fastify-metrics (or `@fastify/metrics` when stable)
- `pino-loki`: https://github.com/Julien-R44/pino-loki
- Grafana Cloud free tier: https://grafana.com/pricing/ (10GB logs/month, 50GB traces/month free)
- W3C Trace Context: https://www.w3.org/TR/trace-context/
- Prometheus text format: https://prometheus.io/docs/instrumenting/exposition_formats/

---

## 12. Refactor Opportunities (Noted, Not in Scope)

- The Fastify `logger: true` in `index.ts` should be replaced with a structured Pino instance passed explicitly — this is required for the Loki transport and trace correlation. This is in scope as part of T145.
- The `setErrorHandler` in `index.ts` is the right injection point for Sentry — minimal refactor needed.
- The webhook delivery worker in `events/webhooks.ts` is the right place to inject `traceparent` headers. This will be a small addition in the webhook task.
