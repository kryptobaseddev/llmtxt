# Self-Hosted Observability Stack

Six Railway services that replace all external paid SaaS observability.
All data stays in your Railway project's private network.

| Service        | Image                                        | Port(s)             | Purpose                      |
|----------------|----------------------------------------------|---------------------|------------------------------|
| OtelCollector  | otel/opentelemetry-collector-contrib:0.99.0  | 4317, 4318, 8888-89 | OTLP receiver, fan-out       |
| Loki           | grafana/loki:2.9.6                           | 3100                | Log storage (LogQL)          |
| Tempo          | grafana/tempo:2.4.1                          | 3200, 4317, 4318    | Trace storage (TraceQL)      |
| Prometheus     | prom/prometheus:v2.51.2                      | 9090                | Metrics TSDB                 |
| Grafana        | grafana/grafana:10.4.2                       | 3000                | Dashboards (public)          |
| GlitchTip      | glitchtip/glitchtip:v4.0                     | 8000                | OSS error tracking (public)  |

## Quick Deploy

See `docs/ops/observability-runbook.md` for the complete step-by-step guide.

```
infra/observability/
  otel-collector/
    Dockerfile
    otel-collector-config.yaml
    railway.toml
  loki/
    Dockerfile
    loki-config.yaml
    railway.toml
  tempo/
    Dockerfile
    tempo.yaml
    railway.toml
  prometheus/
    Dockerfile
    prometheus.yml
    railway.toml
  grafana/
    Dockerfile
    railway.toml
    provisioning/
      datasources/datasources.yaml   ← auto-wires Loki, Tempo, Prometheus
      dashboards/dashboards.yaml     ← loads dashboard JSONs from /dashboards
    dashboards/
      backend-overview.json          ← HTTP rates, latency, memory, error logs
      crdt-activity.json             ← CRDT ops, merge errors, compaction
      event-log-flow.json            ← domain events, webhook delivery
      agent-identity-usage.json      ← agent auth, presence, signature logs
  glitchtip/
    Dockerfile
    railway.toml
```

## Env Vars (copy into Railway dashboard per service)

### apps/backend (llmtxt-api)

| Variable                      | Value (Railway Reference)                         |
|-------------------------------|---------------------------------------------------|
| OTEL_EXPORTER_OTLP_ENDPOINT   | `http://${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}:4318` |
| LOKI_HOST                     | `${{Loki.RAILWAY_PRIVATE_DOMAIN}}`                |
| SENTRY_DSN                    | paste from GlitchTip project settings             |

### OtelCollector

| Variable   | Value                                    |
|------------|------------------------------------------|
| TEMPO_HOST | `${{Tempo.RAILWAY_PRIVATE_DOMAIN}}`      |
| LOKI_HOST  | `${{Loki.RAILWAY_PRIVATE_DOMAIN}}`       |

### Prometheus

| Variable             | Value                                         |
|----------------------|-----------------------------------------------|
| OTEL_COLLECTOR_HOST  | `${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}`   |
| TEMPO_HOST           | `${{Tempo.RAILWAY_PRIVATE_DOMAIN}}`           |
| LOKI_HOST            | `${{Loki.RAILWAY_PRIVATE_DOMAIN}}`            |

### Grafana

| Variable                    | Value                                       |
|-----------------------------|---------------------------------------------|
| GF_SECURITY_ADMIN_USER      | `admin`                                     |
| GF_SECURITY_ADMIN_PASSWORD  | (generate with `openssl rand -hex 16`)      |
| GF_SERVER_DOMAIN            | `${{RAILWAY_PUBLIC_DOMAIN}}`                |
| GF_SERVER_ROOT_URL          | `https://${{RAILWAY_PUBLIC_DOMAIN}}`        |
| GF_AUTH_ANONYMOUS_ENABLED   | `false`                                     |
| GF_FEATURE_TOGGLES_ENABLE   | `traceqlEditor`                             |
| PROMETHEUS_HOST             | `${{Prometheus.RAILWAY_PRIVATE_DOMAIN}}`    |
| LOKI_HOST                   | `${{Loki.RAILWAY_PRIVATE_DOMAIN}}`          |
| TEMPO_HOST                  | `${{Tempo.RAILWAY_PRIVATE_DOMAIN}}`         |

### GlitchTip

| Variable                     | Value                                         |
|------------------------------|-----------------------------------------------|
| SECRET_KEY                   | (generate with `openssl rand -hex 32`)        |
| DATABASE_URL                 | `${{Postgres.DATABASE_URL}}`                  |
| REDIS_URL                    | `${{Redis.REDIS_URL}}`                        |
| GLITCHTIP_DOMAIN             | `https://${{RAILWAY_PUBLIC_DOMAIN}}`          |
| DEFAULT_FROM_EMAIL           | `errors@yourdomain.com`                       |
| ENABLE_USER_REGISTRATION     | `False`                                       |
| CELERY_WORKER_CONCURRENCY    | `2`                                           |

## Cost

~$10–15/month total (Railway compute). No external SaaS fees.
See `docs/ops/observability-runbook.md` for breakdown.
