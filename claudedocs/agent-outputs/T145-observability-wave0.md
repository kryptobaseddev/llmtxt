# T145 Observability Wave 0 — Implementation Report

**Date**: 2026-04-15
**Tasks shipped**: T210, T200, T206
**Status**: complete

---

## T210 — /api/health + /api/ready (commit 68f2fca)

**Files created/modified:**
- `apps/backend/src/routes/health.ts` (new)
- `apps/backend/src/index.ts` (register healthRoutes at /api prefix, early in startup)
- `apps/backend/src/middleware/rate-limit.ts` (extend allowList to /api/ready + /api/metrics)

**Contract verified (Fastify inject):**
- `GET /api/health` → 200 `{ status:"ok", version:"1.0.0", ts:"<ISO>" }` — no I/O
- `GET /api/ready` → 200 when DB alive (SELECT 1 via Drizzle), 503 + reason when DB unavailable
- Both routes: `rateLimit: false` in route config + added to allowList

**Regression: 67/67 tests pass, lint clean (0 warnings)**

---

## T200 — OTel SDK install + instrumentation.ts (commit 2b63d16)

**Packages added to apps/backend/package.json:**
- `@opentelemetry/api@^1.9.1`
- `@opentelemetry/auto-instrumentations-node@^0.72.0`
- `@opentelemetry/exporter-trace-otlp-http@^0.214.0`
- `@opentelemetry/sdk-node@^0.214.0`

**Files created/modified:**
- `apps/backend/src/instrumentation.ts` (new)
- `apps/backend/package.json` (start script: `node --import ./dist/instrumentation.js dist/index.js`)

**Behaviour:**
- `OTEL_EXPORTER_OTLP_ENDPOINT` unset → no-op NodeSDK (no traceExporter), console.warn at startup
- `OTEL_EXPORTER_OTLP_ENDPOINT` set → OTLPTraceExporter with optional `Authorization: Basic <OTEL_AUTH_HEADER>`
- Auto-instrumentations: http, fastify (via auto-instrumentations-node); fs + dns disabled (noisy)
- PII scrubbing: requestHook on http instrumentation redacts Authorization/Cookie/password attributes
- SIGTERM handler calls sdk.shutdown()

**Startup test (no OTLP endpoint):**
```
[otel] OTEL_EXPORTER_OTLP_ENDPOINT is not set — traces will be discarded.
```

**Regression: 67/67 tests pass, lint clean**

---

## T206 — prom-client /api/metrics (commit fd2a51e)

**Packages added:**
- `prom-client@^15.x`

**Files created/modified:**
- `apps/backend/src/middleware/metrics.ts` (new) — registry, counters, histogram, registerMetrics()
- `apps/backend/src/routes/health.ts` (extended) — added GET /metrics route
- `apps/backend/src/index.ts` (registerMetrics call after rate limiting)

**Metrics registered:**
- `http_request_duration_seconds` histogram (method, route, status_code)
- `http_requests_total` counter (method, route, status_code)
- `llmtxt_document_created_total` counter
- `llmtxt_document_approval_submitted_total` counter
- `llmtxt_document_state_transition_total` counter (from_state, to_state)
- `llmtxt_version_created_total` counter
- `llmtxt_webhook_delivery_total` counter (result: success|failure)
- prom-client default metrics (process CPU, memory, GC, event loop lag)

**Auth contract verified (Fastify inject):**
- `METRICS_TOKEN` unset → GET /api/metrics returns 200, `Content-Type: text/plain; version=0.0.4; charset=utf-8`
- `METRICS_TOKEN=test` + no bearer → 401
- `METRICS_TOKEN=test` + `Authorization: Bearer test` → 200 Prometheus text
- `METRICS_TOKEN=test` + wrong bearer → 401
- Route exempt from rate limiting via `rateLimit: false`

**Regression: 67/67 tests pass, lint clean**

---

## Summary

| Task | Commit | Tests | Lint | Status |
|------|--------|-------|------|--------|
| T210 | 68f2fca | 67/67 | clean | done |
| T200 | 2b63d16 | 67/67 | clean | done |
| T206 | fd2a51e | 67/67 | clean | done |

All commits pushed to origin/main.
