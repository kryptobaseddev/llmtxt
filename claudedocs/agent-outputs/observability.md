# Observability Stack — Implementation Report

**Date**: 2026-04-16
**Tasks completed**: T202, T205, T213
**Pre-existing (already done)**: T200 (OTel), T206 (prom-client), T208 (domain counters), T210 (health routes), T212 (W3C trace context), T214 (alert rule), T215 (runbook)

## What Was Implemented

### C1: Sentry + Pino + pino-loki (commit 16c7958)

**`apps/backend/src/instrumentation.ts`** (updated)
- Added `import * as Sentry from '@sentry/node'`
- `Sentry.init({ dsn: SENTRY_DSN })` when env var is set; startup warning + skip when unset
- `beforeSend` hook scrubs `Authorization`, `Cookie`, `x-api-key` headers and `password` body fields before any event reaches Sentry
- Exports `Sentry` singleton so index.ts can import the already-initialised instance

**`apps/backend/src/index.ts`** (updated)
- Imports `@sentry/node` (reads the singleton initialised by instrumentation.ts)
- Fastify now constructed with explicit `pinoLogger` instance instead of `logger: true`
- `setErrorHandler`: calls `Sentry.captureException(err, { tags: { route, method } })` for any 5xx response
- Added `registerObservabilityHooks(app)` call after `registerMetrics`

**`apps/backend/src/lib/logger.ts`** (new)
- Pino logger exported as `FastifyBaseLogger`
- When `LOKI_HOST` is set: multi-transport (pino-loki + pino/file stdout); `batching: true, interval: 5`
- When unset: plain JSON to stdout; startup warn logged
- Redacts `req.headers.authorization`, `req.headers.cookie`, `req.headers["x-api-key"]`, `res.headers["set-cookie"]`, `*.password`, `*.token`

**`apps/backend/src/middleware/observability.ts`** (new)
- `registerObservabilityHooks(app)`: `onRequest` hook that injects `trace_id` and `span_id` from the active OTel span context into a Pino child logger on `request.log`
- No-op when OTel is in no-op mode (invalid span context → fields omitted)

**Dependencies added to `apps/backend/package.json`**:
- `@sentry/node ^10.48.0`
- `pino ^10.3.1`
- `pino-loki ^3.0.0`
- `@sentry/cli ^3.3.5` (devDep)
- `@types/pino` (devDep)

### C2: Sentry source-map CI workflow (commit 9d29afc)

**`.github/workflows/release-backend.yml`** (new)
- Triggers on `backend-v*` tags
- Builds TypeScript with `sourceMap: true` (temporary `tsconfig.build.json`)
- Uploads `dist/` source maps via `sentry-cli sourcemaps upload` with release tagged as `llmtxt-backend@${VERSION}`
- Steps requiring secrets (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) are gated on `env.HAS_SENTRY_AUTH == 'true'` — gracefully skips with `::warning::` when secrets are absent
- Creates GitHub release on success

## Env Vars Required (from RUNBOOK.md)

| Var | Purpose | Required |
|-----|---------|----------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel trace export destination | No (no-op if absent) |
| `OTEL_AUTH_HEADER` | Base64 auth for OTLP endpoint | No |
| `SENTRY_DSN` | Sentry project DSN | No (disabled if absent) |
| `LOKI_HOST` | Grafana Loki push API host | No (stdout if absent) |
| `LOKI_USER` | Loki basic-auth username | No |
| `LOKI_PASSWORD` | Loki basic-auth password | No |
| `METRICS_TOKEN` | Bearer token for /api/metrics | No (open if absent) |
| `SENTRY_AUTH_TOKEN` | Sentry CLI auth (CI only) | No (upload skipped) |
| `SENTRY_ORG` | Sentry org slug (CI only) | No |
| `SENTRY_PROJECT` | Sentry project slug (CI only) | No |

## Verification

- `pnpm --filter backend run lint` — 0 warnings
- `pnpm exec tsc --noEmit` — 0 errors
- `pnpm --filter backend test` — 84/84 pass
- Both commits pushed to `origin/main` (16c7958, 9d29afc)

## Status

| Task | Status | Notes |
|------|--------|-------|
| T200 | pre-existing done | OTel SDK + instrumentation.ts |
| T202 | done (this session) | Sentry error tracking |
| T205 | done (this session) | Pino + pino-loki + OTel correlation |
| T206 | pre-existing done | prom-client /api/metrics |
| T208 | pre-existing done | Domain event counters |
| T210 | pre-existing done | /api/health + /api/ready |
| T212 | pre-existing done | W3C Trace Context in webhooks |
| T213 | done (this session) | Sentry source-map CI workflow |
| T214 | pre-existing done | Error-rate alert rule |
| T215 | pre-existing done | ops/RUNBOOK.md |
