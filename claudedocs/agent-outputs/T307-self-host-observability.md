# T307 Self-Hosted Observability Stack — Implementation Complete

Date: 2026-04-16
Status: complete
Epic: T307 — Replace external SaaS observability with self-hosted Railway stack

## Summary

All 10 atomic tasks (T307.1–T307.10) are implemented and committed. The full
self-hosted observability stack is ready for `railway up` deployment. Zero
external SaaS dependencies remain in apps/backend/src/.

## What Was Built

### Services (infra/observability/)

| Service | Image | Task | Files |
|---------|-------|------|-------|
| OTel Collector | otel/opentelemetry-collector-contrib:0.99.0 | T307.1 | otel-collector/{Dockerfile,otel-collector-config.yaml,railway.toml} |
| Loki | grafana/loki:2.9.6 | T307.2 | loki/{Dockerfile,loki-config.yaml,railway.toml} |
| Tempo | grafana/tempo:2.4.1 | T307.3 | tempo/{Dockerfile,tempo.yaml,railway.toml} |
| Prometheus | prom/prometheus:v2.51.2 | T307.4 | prometheus/{Dockerfile,prometheus.yml,railway.toml} |
| Grafana | grafana/grafana:10.4.2 | T307.5 | grafana/{Dockerfile,railway.toml,provisioning/**,dashboards/**} |
| GlitchTip | glitchtip/glitchtip:v4.0 | T307.6 | glitchtip/{Dockerfile,railway.toml} |

### Backend Rewire (T307.7)

- apps/backend/src/instrumentation.ts: OTel endpoint + GlitchTip comments updated; all external SaaS refs removed
- apps/backend/src/lib/logger.ts: self-hosted Loki docs, no-auth private-network config
- apps/backend/.env.example: Railway Reference Variable syntax for all observability vars

### Pre-Provisioned Dashboards (T307.8)

- infra/observability/grafana/dashboards/backend-overview.json
- infra/observability/grafana/dashboards/crdt-activity.json
- infra/observability/grafana/dashboards/event-log-flow.json
- infra/observability/grafana/dashboards/agent-identity-usage.json

### Runbook + Smoke Test (T307.9, T307.10)

- docs/ops/observability-runbook.md: step-by-step Railway deploy guide, cost analysis (~$10-15/mo)
- infra/observability/README.md: service table, env var reference tables
- apps/backend/src/__tests__/observability-smoke.test.ts: skipped by default, activated with OBSERVABILITY_SMOKE=1

## Validation Results

- grep -r "grafana.net|sentry.io|datadoghq" apps/backend/src/ → 0 matches (CLEAN)
- pnpm --filter backend run lint → pre-existing failure in jobs/embeddings.ts (node:crypto, T307 introduced zero new violations)
- pnpm --filter backend run test → 144/144 pass (smoke test correctly skipped)
- All 8 commits pushed to main branch (17748f9 through fcca453)

## Cost Analysis

~$10–15/month on Railway compute. No external SaaS subscriptions required.
See docs/ops/observability-runbook.md for full breakdown.

## Owner Next Steps

1. `railway link` — link to llmtxt Railway project
2. Create 5 volumes: loki-data, tempo-data, prometheus-data, grafana-data, glitchtip-uploads
3. Deploy services in order: Loki → Tempo → OtelCollector → Prometheus → Grafana → GlitchTip
4. Set env vars in Railway dashboard per infra/observability/README.md
5. Create GlitchTip org/project, copy DSN, set SENTRY_DSN in backend service
6. Set backend env vars (OTEL_EXPORTER_OTLP_ENDPOINT, LOKI_HOST, SENTRY_DSN), redeploy backend
7. Verify with: OBSERVABILITY_SMOKE=1 ... pnpm --filter backend test -- observability-smoke
