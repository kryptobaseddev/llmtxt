# ADR-T145: Observability Stack

**Status**: Accepted (with open decisions flagged for HITL)
**Date**: 2026-04-15
**Epic**: T145
**Deciders**: RCASD Team Lead (LOOM), Orchestrator

---

## Context

The backend has no observability. Failures go undetected until users report them. There is no alerting, no trace correlation, no structured log shipping, no error tracking with symbolicated stack traces, and no metrics endpoint.

The orchestrator has locked the following technology choices:
- OpenTelemetry (OTel) for vendor-neutral distributed tracing.
- Sentry for error tracking with source-map uploads.
- Pino + pino-loki for structured logs shipped to Loki.
- prom-client for Prometheus-compatible metrics at `/metrics`.

---

## Open Decisions (HITL Required Before Implementation)

### OD-1: OTel Collector Topology

**Question**: Should the backend export traces directly to Grafana Cloud's OTLP endpoint, or should we run an OpenTelemetry Collector sidecar on Railway first?

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| Direct export to Grafana Cloud | Simpler setup, zero extra services | Couples app to one backend; retries must be handled in SDK |
| OTel Collector sidecar on Railway | Backend is backend-agnostic; collector handles retries, batching, fan-out | Extra Railway service; operational complexity; free tier may not cover it |

**Recommendation**: Direct export for now (simpler, free tier sufficient for a single service). Add collector sidecar when fan-out to multiple backends is needed.

**HITL required**: User must provide `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_AUTH_HEADER` (Grafana Cloud OTLP credentials) or equivalent.

---

### OD-2: Sentry — Capture 4xx or 5xx Only?

**Question**: Should Sentry capture all 4xx responses as events, or only 5xx?

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| 5xx only | Low noise; 4xx are usually client errors | Misses cases where 4xx indicates a server bug (e.g., 422 from a schema mismatch) |
| 4xx + 5xx | Higher coverage | Quota burn from bot traffic (400s, 404s are common from scanners) |
| 5xx + specific 4xx (422, 409 conflicts) | Balanced | More configuration |

**Recommendation**: Capture 5xx only by default. Revisit when Sentry quota usage is understood.

**HITL required**: User must create a Sentry project named `llmtxt-backend` and provide `SENTRY_DSN`.

---

### OD-3: /metrics Endpoint — Auth Required?

**Question**: Should `GET /metrics` require authentication (e.g., a bearer token) or be publicly accessible?

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| Public (no auth) | Standard Prometheus scraping; no scraper config needed | Exposes internal metrics to the public internet |
| Auth required (bearer token) | Hides internal metrics | Requires scraper configuration; adds complexity |

**Recommendation**: Require a static bearer token (`METRICS_TOKEN` env var). If `METRICS_TOKEN` is unset, fall back to public (for local dev). This is the standard pattern for Railway-hosted Prometheus endpoints where a reverse proxy is not in front.

**HITL required**: None — implementation decision resolved here.

---

### OD-4: PII Scrubbing Policy

**Question**: What fields must be redacted before they appear in logs, traces, and Sentry events?

**Proposed policy** (MUST be confirmed by user before implementation):

| Field | Location | Treatment |
|-------|----------|-----------|
| `Authorization` header | Logs, OTel spans | Redact to `[REDACTED]` |
| `Cookie` header | Logs, OTel spans | Redact to `[REDACTED]` |
| `password` field | Request body, logs | Redact to `[REDACTED]` |
| `email` field | OTel span attributes | Hash (SHA-256 first 8 chars) or omit |
| `email` field | Pino logs (app-level) | Keep (logs are internal, not shipped to third parties except Loki — confirm OK) |
| API key values | Logs, OTel spans | Redact to `[REDACTED]` (only prefix `llmtxt_...` is safe to log) |
| User IDs | Logs, OTel spans | Keep (not PII, needed for correlation) |
| Document content | Logs, OTel spans | Never log; only log slug/ID |

**HITL required**: User must confirm the email-in-logs policy and whether Loki is considered internal-only.

---

## Architecture Decision

### Tracing

- OTel SDK initialises in `apps/backend/src/instrumentation.ts`, loaded before any other module via Node `--import` flag in the start script.
- `@opentelemetry/auto-instrumentations-node` instruments HTTP (incoming/outgoing), Fastify route handlers, and SQLite queries automatically.
- Traces export via OTLP/HTTP to Grafana Cloud Tempo (or configured backend).
- W3C Trace Context headers are accepted on all incoming requests and injected on outgoing webhook deliveries.

### Logging

- Fastify is reconfigured to use a Pino instance with `pino-loki` transport (worker thread) for production.
- Every log record in production includes `trace_id` and `span_id` fields (injected from the active OTel span context).
- Log level is `info` in production, `debug` in development.

### Error Tracking

- Sentry initialised in `instrumentation.ts`.
- Fastify `setErrorHandler` calls `Sentry.captureException` for 5xx responses.
- CI release workflow uploads source maps to Sentry using `@sentry/cli`.

### Metrics

- `prom-client` default registry + `fastify-metrics` plugin for automatic HTTP metrics.
- Custom domain counters registered at module load.
- `GET /api/metrics` returns Prometheus text format (note: `/api/metrics` not `/metrics` to stay within the API prefix; Railway can scrape `/api/metrics`).
- Protected by `METRICS_TOKEN` bearer token when env var is set.

### Health Checks

- `GET /api/health` — always 200, no DB required. Response time < 50ms.
- `GET /api/ready` — runs `SELECT 1` on DB connection, returns 503 if it fails.

---

## Component Diagram

```
apps/backend
│
├── src/instrumentation.ts          ← OTel SDK init + Sentry init (loaded first)
├── src/index.ts                    ← Fastify init, registers Pino with Loki transport
│   ├── middleware/observability.ts ← Pino trace-correlation hook, metrics plugin
│   └── routes/health.ts            ← /api/health + /api/ready + /api/metrics
│
└── Railway start command:
    node --import ./dist/instrumentation.js ./dist/index.js

External:
  OTLP/HTTP ──► Grafana Cloud Tempo (traces)
  pino-loki ──► Grafana Cloud Loki  (logs)
  prom-client ◄── Prometheus scraper via /api/metrics
  Sentry SDK ──► Sentry cloud (errors)
```

---

## Consequences

**Positive**:
- Full observability: every request is traceable from HTTP handler to DB query.
- Alerts can fire within 5 minutes of an error rate spike.
- Stack traces in Sentry are symbolicated (readable, not minified).
- Logs and traces are correlated by `trace_id`.

**Negative / Trade-offs**:
- ~5 new production dependencies.
- OTel SDK adds ~50–100ms cold-start overhead (acceptable for a long-running server).
- Pino-Loki transport runs in a worker thread — adds minor memory overhead.
- Grafana Cloud free tier limits: 10 GB logs/month, 50 GB traces/month. Sufficient for current traffic; monitor.

**Infrastructure credentials needed from user** (HITL flagged):
1. `OTEL_EXPORTER_OTLP_ENDPOINT` — Grafana Cloud OTLP endpoint.
2. `OTEL_AUTH_HEADER` — Base64-encoded `instanceId:apiToken` for Grafana Cloud.
3. `LOKI_HOST` — Grafana Cloud Loki push URL.
4. `LOKI_USER` — Grafana Cloud Loki user ID.
5. `LOKI_PASSWORD` — Grafana Cloud Loki API token.
6. `SENTRY_DSN` — from new Sentry project `llmtxt-backend`.
7. `METRICS_TOKEN` — static token for `/api/metrics` auth (generate locally, set in Railway).

---

## Alternatives Considered

| Alternative | Rejected reason |
|-------------|-----------------|
| Datadog APM | Cost; free tier too restrictive for traces |
| New Relic | Vendor lock-in; OTel is the chosen standard |
| Elastic APM | Self-hosted complexity; OTel covers the need |
| `winston` instead of Pino | Pino is already in use via Fastify; no reason to switch |
| Grafana Agent instead of pino-loki | Heavier; requires a sidecar process |
