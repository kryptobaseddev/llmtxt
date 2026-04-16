# Self-Hosted Observability Stack — Deployment Runbook

> Last updated: 2026-04-16
> Stack: OTel Collector, Loki, Tempo, Prometheus, Grafana, GlitchTip
> Platform: Railway (private networking, persistent volumes)
> Cost: ~$5–15/month (Railway compute only — zero external SaaS)

---

## Environment Variable Reference Policy

All env vars that point to another Railway service MUST use Railway Reference
Variables.  Hardcoded URLs or hostnames are forbidden in `railway variables --set`
commands — they break silently when Railway rotates public domains on redeploy.

| Use case | Correct form |
|----------|-------------|
| Public URL (browser-accessible) | `https://${{Service.RAILWAY_PUBLIC_DOMAIN}}` |
| Internal endpoint (private network) | `http://${{Service.RAILWAY_PRIVATE_DOMAIN}}:<literal-port>` |
| Credential from another service | `${{Service.EXPOSED_VAR}}` e.g. `${{Postgres.DATABASE_URL}}` |
| Port for cross-service wiring | Always a literal number — never `${{Service.PORT}}` |

**PORT pitfall:** `${{OtelCollector.PORT}}` resolves to `13133` (the health-check
port), not `4318` (OTLP/HTTP).  Always use literal port constants.  See
[`docs/ops/CREDENTIALS.md` — PORT pitfall section](CREDENTIALS.md#port-pitfall--never-use-serviceport-for-protocol-specific-ports)
for details.

Note: `railway variables --kv` output shows the **resolved** value, not the raw
reference template.  The reference IS stored; Railway re-resolves it at every deploy.
Do not copy the resolved URL back into `--set` as a hardcoded literal.

---

## Overview

This runbook documents how to deploy and operate the LLMtxt self-hosted
observability stack. Every service runs inside the Railway project's private
network. No data leaves your Railway project to any external SaaS.

### Architecture

```
apps/backend
    │  OTLP/HTTP :4318
    ▼
OtelCollector ──────────────────────────────────┐
    │ traces (OTLP/gRPC :4317)                  │ metrics (prom scrape :8889)
    ▼                                           ▼
Tempo (trace storage)              Prometheus (metrics TSDB)
    │                                           │
    └──────────────────┬────────────────────────┘
                       │ (queries)
                    Grafana
                    (dashboards)

apps/backend
    │  pino-loki HTTP push
    ▼
Loki (log storage)
    │
Grafana (LogQL queries, linked to Tempo trace IDs)

apps/backend
    │  Sentry SDK (error envelope)
    ▼
GlitchTip (OSS Sentry-compatible, self-hosted)
```

---

## Step 1 — Prerequisites

- Railway CLI installed: `npm install -g @railway/cli`
- Logged in: `railway login`
- Project linked: `railway link` (select the llmtxt project)

---

## Step 2 — Create Persistent Volumes

Run once. Railway volumes survive service restarts and redeployments.

```bash
# From within the linked Railway project context:
railway volume create --name loki-data
railway volume create --name tempo-data
railway volume create --name prometheus-data
railway volume create --name grafana-data
railway volume create --name glitchtip-uploads
```

---

## Step 3 — Deploy Services

Deploy each observability service from its subfolder. The `railway up` command
builds the Dockerfile and deploys to Railway.

### 3a. Loki (deploy first — OTel Collector depends on it)

```bash
cd infra/observability/loki
railway up --service Loki
```

Set env vars in Railway dashboard for the Loki service:
- No env vars required. Loki runs with `auth_enabled: false` behind private networking.

### 3b. Tempo

```bash
cd infra/observability/tempo
railway up --service Tempo
```

No env vars required. Tempo accepts OTLP on private network only.

### 3c. OTel Collector (depends on Loki + Tempo)

```bash
cd infra/observability/otel-collector
railway up --service OtelCollector
```

Set env vars (Railway dashboard > OtelCollector service > Variables):
```
TEMPO_HOST=${{Tempo.RAILWAY_PRIVATE_DOMAIN}}
LOKI_HOST=${{Loki.RAILWAY_PRIVATE_DOMAIN}}
```

### 3d. Prometheus (depends on OTel Collector)

```bash
cd infra/observability/prometheus
railway up --service Prometheus
```

Set env vars (Railway dashboard > Prometheus service > Variables):
```
OTEL_COLLECTOR_HOST=${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}
TEMPO_HOST=${{Tempo.RAILWAY_PRIVATE_DOMAIN}}
LOKI_HOST=${{Loki.RAILWAY_PRIVATE_DOMAIN}}
```

### 3e. Grafana (depends on Loki + Tempo + Prometheus)

```bash
cd infra/observability/grafana
railway up --service Grafana
```

Set env vars (Railway dashboard > Grafana service > Variables):
```
GF_SECURITY_ADMIN_USER=admin
GF_SECURITY_ADMIN_PASSWORD=<strong password — use openssl rand -hex 16>
GF_SERVER_DOMAIN=${{RAILWAY_PUBLIC_DOMAIN}}
GF_SERVER_ROOT_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
GF_AUTH_ANONYMOUS_ENABLED=false
GF_FEATURE_TOGGLES_ENABLE=traceqlEditor
PROMETHEUS_HOST=${{Prometheus.RAILWAY_PRIVATE_DOMAIN}}
LOKI_HOST=${{Loki.RAILWAY_PRIVATE_DOMAIN}}
TEMPO_HOST=${{Tempo.RAILWAY_PRIVATE_DOMAIN}}
```

Assign a public domain to the Grafana service so you can access dashboards:
Railway dashboard > Grafana service > Settings > Generate Domain.

### 3f. GlitchTip (error tracking — requires Postgres + Redis addons)

First, add Railway addons to the project (if not already present):
```bash
# From Railway dashboard: add Postgres addon + Redis addon to the project.
# Both auto-generate connection env vars.
```

Deploy GlitchTip web service:
```bash
cd infra/observability/glitchtip
railway up --service GlitchTip
```

Set env vars (Railway dashboard > GlitchTip service > Variables):
```
SECRET_KEY=<openssl rand -hex 32>
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
GLITCHTIP_DOMAIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
DEFAULT_FROM_EMAIL=errors@yourdomain.com
ENABLE_USER_REGISTRATION=False
CELERY_WORKER_CONCURRENCY=2
```

Assign a public domain to GlitchTip: Railway dashboard > GlitchTip > Settings > Generate Domain.

Deploy the Celery worker (same image, different start command):
1. In Railway dashboard, duplicate the GlitchTip service.
2. Rename the duplicate to `GlitchTip-Worker`.
3. Override the start command:
   ```
   ./manage.py celery_worker
   ```
4. Redeploy.

Run database migrations (one-time, after first deploy):
```bash
railway run --service GlitchTip -- python manage.py migrate
railway run --service GlitchTip -- python manage.py createsuperuser
```

Create a GlitchTip project and copy the DSN:
1. Navigate to `https://<GlitchTip public domain>/`
2. Log in with the superuser credentials.
3. Create an Organization (e.g., "LLMtxt").
4. Create a Project (e.g., "backend", platform: "Node.js").
5. Copy the DSN — it looks like:
   `https://<key>@<GlitchTip domain>/api/<n>/envelope/`

---

## Step 4 — Wire Backend to Self-Hosted Stack

In Railway dashboard, go to the `llmtxt-api` (backend) service > Variables and
set:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}:4318
LOKI_HOST=${{Loki.RAILWAY_PRIVATE_DOMAIN}}
SENTRY_DSN=<paste GlitchTip DSN from step 3f>
```

Redeploy the backend service to pick up the new env vars.

Verify startup logs show:
```
[otel] OTel SDK started. Exporting traces to: http://<otel-collector-domain>:4318
[logger] Pino shipping logs to self-hosted Loki at <loki-domain>
[glitchtip] GlitchTip error tracking initialised (Sentry-compatible, self-hosted).
```

---

## Step 5 — Verify the Stack

### 5a. Send a test trace

```bash
curl -X POST https://api.llmtxt.my/v1/health
```

Then in Grafana: Explore > Tempo > Search > find the trace from `llmtxt-backend`.

### 5b. Send a test log

Check Grafana: Explore > Loki > query: `{app="llmtxt-backend"}`

### 5c. Check metrics

Check Grafana: Explore > Prometheus > query: `http_requests_total`

### 5d. Trigger a test error

```bash
curl https://api.llmtxt.my/_test/error  # (any 500 endpoint)
```

Then check GlitchTip dashboard for the captured exception.

### 5e. Open pre-provisioned dashboards

Grafana > Dashboards > LLMtxt folder:
- LLMtxt Backend Overview
- CRDT Activity
- Event Log Flow
- Agent Identity Usage

---

## Step 6 — Ongoing Operations

### Viewing logs

Grafana > Explore > Loki:
```logql
{app="llmtxt-backend"} | json | level = "error"
```

Correlate with traces:
```logql
{app="llmtxt-backend"} | json | trace_id = "<paste trace ID>"
```

### Viewing traces

Grafana > Explore > Tempo > Search or paste trace ID directly.

### Alerting (future)

Grafana supports alert rules natively. Recommended alerts:
- HTTP error rate > 1% for 5 minutes
- p99 latency > 2s for 5 minutes
- Node.js event loop lag > 500ms
- GlitchTip: new unresolved errors (via GlitchTip email/webhook alerts)

---

## Cost Analysis

All costs are Railway compute only. No external SaaS subscriptions.

| Service        | RAM     | CPU   | Railway Est. Cost |
|----------------|---------|-------|--------------------|
| OTel Collector | 256 MB  | 0.1   | ~$1/mo             |
| Loki           | 512 MB  | 0.25  | ~$2/mo             |
| Tempo          | 512 MB  | 0.25  | ~$2/mo             |
| Prometheus     | 256 MB  | 0.1   | ~$1/mo             |
| Grafana        | 256 MB  | 0.1   | ~$1/mo             |
| GlitchTip Web  | 512 MB  | 0.25  | ~$2/mo             |
| GlitchTip Wrkr | 256 MB  | 0.1   | ~$1/mo             |
| **Total**      |         |       | **~$10/mo**        |

Volume storage: ~$0.25/GB/month on Railway.
Estimated data at current scale: <5 GB/month → < $2/mo additional.

**Total ownership cost: ~$10–15/month** for full observability vs Grafana Cloud
Pro ($29/mo) + Sentry Team ($26/mo/developer) = $55+/month with data leaving
your infrastructure.

---

## Troubleshooting

### OTel Collector not receiving spans

1. Check `OTEL_EXPORTER_OTLP_ENDPOINT` is set in backend service.
2. Verify the backend and OTel Collector are in the same Railway project.
3. Check collector logs: `railway logs --service OtelCollector`

### Loki push failures (pino-loki transport errors in backend logs)

1. Confirm `LOKI_HOST` is set to the private domain (not a public URL).
2. Loki health: `railway run --service Loki -- wget -qO- http://localhost:3100/ready`

### GlitchTip not receiving errors

1. Verify `SENTRY_DSN` in backend service matches the GlitchTip project DSN exactly.
2. Confirm GlitchTip Celery worker is running (it processes the event queue).
3. Check: `railway logs --service GlitchTip`

### Grafana datasource "no data"

1. Verify all three private-domain env vars are set in Grafana service.
2. Grafana > Configuration > Data Sources > Test each source.
3. Private DNS resolves on Railway's internal network only — not accessible from browser directly.

---

## Security Notes

- Grafana is the only service with a public Railway domain. All others are private.
- GlitchTip requires a public domain so the backend can submit error envelopes.
  Alternatively, route GlitchTip behind the OTel Collector (advanced).
- Loki, Tempo, Prometheus run without authentication on the private network.
  Do not expose their ports publicly.
- Set `GF_AUTH_ANONYMOUS_ENABLED=false` (default in our config) and use a strong
  Grafana admin password.
- Rotate `GF_SECURITY_ADMIN_PASSWORD` and `GLITCHTIP_SECRET_KEY` periodically.
