# SPEC-T145: Observability Stack

**Status**: Approved (with HITL decisions pending)
**Date**: 2026-04-15
**Epic**: T145
**RFC 2119 compliance**: This specification uses MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY per RFC 2119.

---

## 1. Scope

This specification governs the production observability stack for `apps/backend`. It covers:
- OpenTelemetry distributed tracing.
- Sentry error tracking with source-map symbolication.
- Structured Pino logging with Loki transport.
- Prometheus metrics via prom-client.
- Health check endpoints.
- PII scrubbing policy.
- CI source-map upload.
- A runbook (`ops/RUNBOOK.md`).

---

## 2. Definitions

- **Trace**: A distributed trace consisting of one or more spans representing a request across service boundaries.
- **Span**: A named, timed unit of work within a trace.
- **Trace context**: The `traceparent` and `tracestate` W3C headers carrying trace ID and span ID.
- **OTel**: OpenTelemetry.
- **Loki**: Grafana Loki log aggregation system.
- **Prometheus text format**: The exposition format defined at https://prometheus.io/docs/instrumenting/exposition_formats/.

---

## 3. Instrumentation Initialisation

3.1. A file `apps/backend/src/instrumentation.ts` MUST exist and MUST be loaded before any other application module.

3.2. The start command in `package.json` and in the Railway/Docker deployment MUST use `node --import ./dist/instrumentation.js ./dist/index.js` (or equivalent ESM loader pattern) to ensure OTel SDK is active before Fastify initialises.

3.3. The OTel SDK MUST be configured with `@opentelemetry/auto-instrumentations-node`, which MUST instrument at minimum: Node.js HTTP server, Fastify routes, and outgoing HTTP requests.

3.4. The OTel SDK MUST export traces via OTLP/HTTP to the endpoint configured in `OTEL_EXPORTER_OTLP_ENDPOINT`. If this environment variable is unset, the SDK MUST use a no-op exporter (traces are discarded) and MUST log a warning at startup.

3.5. Sentry MUST be initialised in `instrumentation.ts` using the DSN from `SENTRY_DSN`. If `SENTRY_DSN` is unset, Sentry MUST be initialised in no-op mode and MUST log a warning.

---

## 4. Distributed Tracing Requirements

4.1. Every incoming HTTP request to the Fastify server MUST be associated with a trace span.

4.2. The OTel SDK MUST extract W3C Trace Context (`traceparent` / `tracestate`) headers from incoming requests and attach the incoming trace context as the parent span.

4.3. For POST /api/v1/documents and equivalent legacy endpoints, the resulting trace MUST include at minimum:
  - One span for the HTTP handler.
  - At least one child span for each DB query executed during the request.

4.4. Outgoing webhook delivery requests (in `apps/backend/src/events/webhooks.ts`) MUST inject `traceparent` and `tracestate` headers using `@opentelemetry/api`'s `propagation.inject()`.

4.5. Span attributes MUST conform to OTel semantic conventions for HTTP spans (`http.method`, `http.route`, `http.status_code`, `http.url`).

4.6. Span attributes MUST NOT include raw request body content, password values, API key values (beyond the `llmtxt_` prefix), or cookie header values.

---

## 5. Structured Logging Requirements

5.1. The Fastify instance MUST be configured with an explicit Pino logger instance rather than `logger: true`.

5.2. In production (`NODE_ENV=production`), the Pino logger MUST use `pino-loki` as a transport, shipping logs to the endpoint configured by `LOKI_HOST`, `LOKI_USER`, and `LOKI_PASSWORD`. If these variables are unset, the logger MUST fall back to stdout and MUST log a warning.

5.3. Every log record MUST include the fields `app: "llmtxt-backend"` and `env: <NODE_ENV>` as static labels.

5.4. When an active OTel span exists for the current request, every log record emitted within that request's context MUST include `trace_id` and `span_id` string fields, injected from `@opentelemetry/api`'s active context.

5.5. Log level in production MUST be `info`. Log level in development MUST be `debug`.

5.6. The following fields MUST be redacted (replaced with the literal string `[REDACTED]`) before any log record is shipped:
  - The value of the `Authorization` header.
  - The value of the `Cookie` header.
  - Any field named `password` at any depth in the logged object.
  - Any field named `key_hash` or `key_prefix` (beyond the known `llmtxt_` prefix portion).

5.7. Document content (the body of stored llms.txt files) MUST NOT appear in any log record. Log the document `slug` or `id` only.

---

## 6. Error Tracking Requirements

6.1. The Fastify `setErrorHandler` MUST call `Sentry.captureException(error)` for any error that results in an HTTP 5xx response.

6.2. Sentry events MUST include the `environment` tag set to `process.env.NODE_ENV`.

6.3. Sentry events MUST NOT include raw request body content or any field identified in section 5.6 as requiring redaction.

6.4. The CI release workflow (`.github/workflows/release.yml`) MUST include a step that uploads source maps to Sentry on every tagged release using `@sentry/cli sourcemaps upload` or equivalent. This step MUST run after the TypeScript build step and MUST NOT fail silently.

6.5. The source map upload step MUST be gated on the `SENTRY_AUTH_TOKEN` secret being present; if the secret is absent, the step MUST be skipped with an explicit warning, not failed.

---

## 7. Metrics Requirements

7.1. `prom-client` MUST be initialised with the default registry.

7.2. A Fastify plugin (using `fastify-metrics` or a custom implementation) MUST record the following metrics for every HTTP request:
  - `http_request_duration_seconds`: histogram, labels `method`, `route`, `status_code`.
  - `http_requests_total`: counter, labels `method`, `route`, `status_code`.

7.3. The following domain event counters MUST be registered and incremented at the appropriate points in application code:
  - `llmtxt_document_created_total`: incremented when a document is created successfully.
  - `llmtxt_document_approval_submitted_total`: incremented when an approval vote is submitted.
  - `llmtxt_document_state_transition_total`: counter with labels `from_state`, `to_state`.
  - `llmtxt_version_created_total`: incremented when a new document version is created.
  - `llmtxt_webhook_delivery_total`: counter with label `result` (`success` or `failure`).

7.4. A `GET /api/metrics` route MUST be registered in the Fastify application.

7.5. The `/api/metrics` route MUST return a valid Prometheus text format response with `Content-Type: text/plain; version=0.0.4; charset=utf-8`.

7.6. If the environment variable `METRICS_TOKEN` is set, the `/api/metrics` route MUST require a `Authorization: Bearer <METRICS_TOKEN>` header and MUST return 401 if the header is absent or the token does not match.

7.7. If `METRICS_TOKEN` is unset, the `/api/metrics` route MAY be publicly accessible (acceptable for local development).

7.8. The `/api/metrics` route MUST be exempt from rate limiting.

---

## 8. Health Check Requirements

8.1. A `GET /api/health` route MUST be registered and MUST return HTTP 200 with body `{ "status": "ok", "version": "<package version>", "ts": "<ISO timestamp>" }`.

8.2. The `/api/health` route MUST NOT perform any I/O (no DB query, no external call). It MUST respond in under 50ms under normal conditions.

8.3. A `GET /api/ready` route MUST be registered and MUST return HTTP 200 when the database connection is alive (verified by executing `SELECT 1`), and MUST return HTTP 503 with body `{ "status": "unavailable", "reason": "<description>" }` if the query fails.

8.4. Both `/api/health` and `/api/ready` MUST be exempt from authentication and rate limiting.

8.5. The Railway deployment configuration MUST be updated to use `/api/health` as the health check endpoint.

---

## 9. W3C Trace Context Propagation Requirements

9.1. Incoming HTTP requests carrying a `traceparent` header MUST have that context extracted and used as the parent span context for the request's trace.

9.2. Outgoing HTTP requests made by the webhook delivery worker MUST carry a `traceparent` header injected from the current active span context.

9.3. The `traceparent` header format MUST conform to W3C Trace Context Level 1 (version 00).

---

## 10. Runbook Requirements

10.1. A file `ops/RUNBOOK.md` MUST be created.

10.2. The runbook MUST document:
  - How to look up all spans for a given request ID (trace ID) in Grafana Cloud Tempo.
  - How to query logs for a given `trace_id` in Grafana Cloud Loki.
  - How to navigate to the `/api/metrics` endpoint and interpret key metrics.
  - How to find a Sentry event for a given request (using the Sentry UI).
  - The alert rule for error rate > 5% over 5 minutes (how to view and silence it).

10.3. The runbook MUST include the Railway environment variable names required for the observability stack (without actual values).

---

## 11. Alerting Requirements

11.1. An alert rule MUST be configured in the chosen metrics backend (Grafana Cloud or Prometheus Alertmanager) that fires when the error rate for any HTTP endpoint exceeds 5% over a 5-minute window.

11.2. The alert rule definition MUST be committed to the repository as a configuration file in `ops/alerts/` (Grafana alert JSON or Prometheus rule YAML as appropriate).

11.3. The alert MUST fire within 5 minutes of the condition being met.

---

## 12. Acceptance Criteria (from epic T145)

12.1. `GET /api/metrics` on `api.llmtxt.my` returns a valid Prometheus text format response with at least `http_request_duration_seconds` and `http_requests_total`.

12.2. A Sentry project for `llmtxt-backend` is configured; a manually triggered test error appears in the Sentry dashboard within 60 seconds.

12.3. OTel traces for `POST /api/v1/documents` include a span for the HTTP handler and at least one DB query child span; traces are exported to the configured backend.

12.4. Pino log output in production includes `trace_id` and `span_id` fields; logs are queryable by `trace_id` in the configured log backend.

12.5. An alert rule fires within 5 minutes when the error rate for any HTTP endpoint exceeds 5% over 5 minutes.

12.6. `ops/RUNBOOK.md` documents how to access traces, logs, and metrics for a given request ID.

12.7. CI release workflow uploads source maps to Sentry on every tagged release so stack traces are symbolicated.

---

## 13. Non-Requirements

- Frontend RUM (Real User Monitoring) is out of scope.
- Full APM agent licensing beyond OpenTelemetry is out of scope.
- Building a custom Grafana dashboard is out of scope (use Grafana Cloud's built-in explore view).
- PostgreSQL readiness checks in `/api/ready` (only SQLite is checked in this epic; PostgreSQL mode will need its own ready check).
- OpenTelemetry metrics (OTel metrics API) — `prom-client` is the chosen metrics library.
