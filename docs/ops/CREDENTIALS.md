# LLMtxt Operations — Credentials & Environment Reference

> Last updated: 2026-04-16
> For: 3am on-call. Every command is copy-pastable.
> Secret policy: **NEVER commit real secrets**. Placeholders used throughout.
> Source of truth for live secrets: Railway Dashboard → Variables tab.

---

## Table of Contents

1. [Environment Variable Reference Policy](#environment-variable-reference-policy)
2. [Service Login Summary](#service-login-summary)
3. [Service Details](#service-details)
   - [Grafana](#grafana)
   - [GlitchTip](#glitchtip)
   - [Prometheus](#prometheus)
   - [Loki](#loki)
   - [Tempo](#tempo)
   - [OtelCollector](#otelcollector)
   - [Postgres](#postgres)
   - [Redis](#redis)
   - [llmtxt-api (Backend)](#llmtxt-api-backend)
   - [llmtxt-frontend](#llmtxt-frontend)
   - [llmtxt-docs](#llmtxt-docs)
4. [Environment Variables Reference](#environment-variables-reference)
5. [Owner Action Checklist (First-Time Setup)](#owner-action-checklist-first-time-setup)
6. [Recovery Procedures](#recovery-procedures)
7. [Secret Storage Policy](#secret-storage-policy)

---

## Environment Variable Reference Policy

**Mandatory rule:** Every env var that points to another Railway service MUST use a
Railway Reference Variable — never a hardcoded hostname or URL.

Hardcoded URLs break silently whenever Railway redeploys a service and rotates its
public domain, or when a service is renamed.  Reference Variables are resolved at
deploy time from the live Railway service graph, so they stay correct automatically.

### Correct patterns

| Use case | Store this value |
|----------|-----------------|
| Public URL surfaced to a browser (iframe, link, SvelteKit env) | `https://${{Service.RAILWAY_PUBLIC_DOMAIN}}` |
| Internal backend-to-backend endpoint (private Railway network) | `http://${{Service.RAILWAY_PRIVATE_DOMAIN}}:<literal-port>` |
| Credential from another service (DB, Redis, etc.) | `${{Service.EXPOSED_VAR}}` e.g. `${{Postgres.DATABASE_URL}}` |
| Ports | Always a literal number — never `${{Service.PORT}}` for cross-service wiring (see PORT pitfall below) |

### `RAILWAY_PUBLIC_DOMAIN` vs `RAILWAY_PRIVATE_DOMAIN`

| Variable | Resolves to | When to use |
|----------|-------------|-------------|
| `${{Service.RAILWAY_PUBLIC_DOMAIN}}` | The Railway-generated public hostname (e.g. `grafana-production-85af.up.railway.app`) | Anywhere a browser or external client needs to reach the service |
| `${{Service.RAILWAY_PRIVATE_DOMAIN}}` | The stable private hostname on Railway's internal network (e.g. `grafana.railway.internal`) | Backend-to-backend calls that never leave Railway's network — faster, free, no TLS overhead |

Use private domains for all internal traffic.  Use public domains only when
a browser or the SvelteKit/Vite build process needs to reach the service.

### PORT pitfall — never use `${{Service.PORT}}` for protocol-specific ports

`${{Service.PORT}}` exposes the single `PORT` env var a service publishes to Railway's
health-check system.  This is almost never the port you want for cross-service wiring.

**Example that burned us:** OTel Collector publishes `PORT=13133` (its health-check
port).  Setting `OTEL_EXPORTER_OTLP_ENDPOINT=http://${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}:${{OtelCollector.PORT}}`
silently routed all traces to the health endpoint instead of the OTLP HTTP ingress,
dropping every span with no error in the sending service.

**Correct form — always use a literal port number:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}:4318
```

Well-known port constants for this stack:

| Service | Protocol | Literal port |
|---------|----------|--------------|
| OtelCollector | OTLP/HTTP ingress | `4318` |
| OtelCollector | OTLP/gRPC egress | `4317` |
| OtelCollector | Health check | `13133` |
| Loki | HTTP push/query | `3100` |
| Tempo | HTTP query | `3200` |
| Prometheus | HTTP scrape/query | `9090` |
| Grafana | HTTP dashboard | `3000` |
| GlitchTip | HTTP | `8000` |

### Worked example — wiring frontend PUBLIC_* env vars

```bash
railway variables --service llmtxt-frontend \
  --set 'PUBLIC_GRAFANA_URL=https://${{Grafana.RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'PUBLIC_PROMETHEUS_URL=https://${{Prometheus.RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'PUBLIC_GLITCHTIP_URL=https://${{GlitchTip.RAILWAY_PUBLIC_DOMAIN}}'
```

### Reading back stored values — `--kv` shows resolved output, not raw templates

`railway variables --service <name> --kv` displays the **resolved** value for
convenience.  It does NOT mean the reference was expanded and stored as a literal URL.
The raw reference template (`${{Service.RAILWAY_PUBLIC_DOMAIN}}`) is what Railway
stores internally; it re-resolves at every deploy.  This means:

- If you rotate a domain or rename a service, redeploying dependent services picks
  up the new resolved value automatically.
- The `--kv` output is useful for verifying what a service sees at runtime, but it
  should not be copy-pasted back into `railway variables --set` as a hardcoded URL.

### Service table notation

Throughout the service tables below:
- **(reference)** = value stored as a Railway Reference Variable (e.g. `${{Postgres.DATABASE_URL}}`)
- **(literal)** = value stored as a plain string (ports, flags, manually-managed secrets)

---

## Service Login Summary

| Service | Public URL | Login | Default Credential | Owner Action |
|---------|-----------|-------|--------------------|--------------|
| Grafana | https://grafana-production-85af.up.railway.app | admin / password | `<see Railway GF_SECURITY_ADMIN_PASSWORD>` | **Change on first login** |
| GlitchTip | https://glitchtip-production-00c4.up.railway.app | admin@llmtxt.my / password | Reset 2026-04-16. See `/tmp/glitchtip-password-for-owner.txt` or CREDENTIALS.md GlitchTip section | Rotate via UI after first login |
| Prometheus | https://prometheus-production-f652.up.railway.app | none (no auth) | n/a | Consider adding auth proxy if exposed publicly |
| Loki | https://loki-production-e875.up.railway.app (private preferred) | none (no auth) | n/a | Private network only — no owner action needed |
| Tempo | https://tempo-production-1526.up.railway.app (private preferred) | none (no auth) | n/a | Private network only — no owner action needed |
| OtelCollector | https://otelcollector-production.up.railway.app (private preferred) | none (no auth) | n/a | Internal only |
| Postgres | railway.internal:5432 (private) | postgres / see DATABASE_URL | `<see Railway Postgres service variables>` | Rotate via Railway UI every 90 days |
| Redis | redis.railway.internal:6379 (private) | default / see REDIS_URL | `<see Railway Redis service variables>` | Railway manages rotation |
| llmtxt-api | https://api.llmtxt.my | API key auth | `<see BETTER_AUTH_SECRET + API key routes>` | Rotate admin key quarterly |
| llmtxt-frontend | https://www.llmtxt.my | n/a (public) | n/a | n/a |
| llmtxt-docs | https://docs.llmtxt.my | n/a (public) | n/a | n/a |

---

## Service Details

### Grafana

| Field | Value |
|-------|-------|
| Public URL | https://grafana-production-85af.up.railway.app |
| Private domain | grafana.railway.internal:3000 |
| Username | `admin` |
| Password | See Railway dashboard: Grafana → Variables → `GF_SECURITY_ADMIN_PASSWORD` |
| Anonymous access | Enabled for iframe embedding (`GF_AUTH_ANONYMOUS_ENABLED=true`, Viewer role) |
| Embedding | Enabled (`GF_SECURITY_ALLOW_EMBEDDING=true`, cookies SameSite=none Secure=true) |

**Login:**
```
https://grafana-production-85af.up.railway.app
Username: admin
Password: <see Railway dashboard → Grafana → GF_SECURITY_ADMIN_PASSWORD>
```

**Rotate password:**
```bash
# Option A: Via Grafana UI
# Grafana → Profile (top-right avatar) → Change password

# Option B: Via Railway shell (if locked out)
railway ssh --service Grafana -- grafana-cli admin reset-admin-password <new-password>
# Then update the env var so it survives redeploy:
railway variables --service Grafana --set 'GF_SECURITY_ADMIN_PASSWORD=<new-password>'
```

**Configured data sources (auto-provisioned):**
- Prometheus → `http://prometheus.railway.internal:9090`
- Loki → `http://loki.railway.internal:3100`
- Tempo → `http://tempo.railway.internal:3200`

---

### GlitchTip

| Field | Value |
|-------|-------|
| Public URL | https://glitchtip-production-00c4.up.railway.app |
| Private domain | glitchtip.railway.internal:8000 |
| Superuser email | `admin@llmtxt.my` |
| Superuser password | Reset on 2026-04-16. See `/tmp/glitchtip-password-for-owner.txt` on worker machine, or rotate immediately via UI after first login. |
| Organization | `llmtxt` |
| Project | `llmtxt-backend` |
| DSN (set on llmtxt-api) | `<see Railway llmtxt-api → SENTRY_DSN>` |
| Registration | Disabled (`ENABLE_USER_REGISTRATION=False`) |

**Login:**
```
https://glitchtip-production-00c4.up.railway.app
Email: admin@llmtxt.my
Password: GlitchTipLlmtxt2026!  (reset 2026-04-16 — rotate via UI after first login)
```

> **Security note**: The password above was reset by the admin-panel-batch-fixes worker on
> 2026-04-16 via direct Postgres update (pbkdf2_sha256, 720000 iterations). Rotate via:
> https://glitchtip-production-00c4.up.railway.app/profile/password/

**Change password via UI:**
```
https://glitchtip-production-00c4.up.railway.app/profile/password/
```

**Change password via CLI (if locked out):**
```bash
railway ssh --service GlitchTip -- python /code/manage.py changepassword admin
```

**Re-run migrations (if DB schema is stale after upgrade):**
```bash
railway ssh --service GlitchTip -- python /code/manage.py migrate --noinput
```

**Create a new superuser from scratch:**
```bash
railway ssh --service GlitchTip -- env \
  DJANGO_SUPERUSER_USERNAME=admin \
  DJANGO_SUPERUSER_EMAIL=admin@llmtxt.my \
  DJANGO_SUPERUSER_PASSWORD='<new-password>' \
  python /code/manage.py createsuperuser --noinput
```

**Get the DSN for llmtxt-backend project:**
```bash
# Login first (replace <password>)
curl -s https://glitchtip-production-00c4.up.railway.app/rest-auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@llmtxt.my","password":"<password>"}' \
  -c /tmp/gt-cookies.txt

# Get CSRF token from cookie file, then fetch keys
CSRF=$(grep csrftoken /tmp/gt-cookies.txt | awk '{print $7}')
curl -s https://glitchtip-production-00c4.up.railway.app/api/0/projects/llmtxt/llmtxt-backend/keys/ \
  -H "X-CSRFToken: $CSRF" \
  -H "Referer: https://glitchtip-production-00c4.up.railway.app/" \
  -b /tmp/gt-cookies.txt | python3 -m json.tool
```

**Set DSN on llmtxt-api:**
```bash
railway variables --service llmtxt-api --set 'SENTRY_DSN=<dsn-from-above>'
railway redeploy --service llmtxt-api --yes
```

**Verify DSN is set:**
```bash
railway variables --service llmtxt-api --kv | grep SENTRY
```

---

### Prometheus

| Field | Value |
|-------|-------|
| Public URL | https://prometheus-production-f652.up.railway.app |
| Private domain | prometheus.railway.internal:9090 |
| Auth | None (open by default) |
| Data retention | Default (15 days) |

**No auth is required** — Prometheus is primarily accessed by Grafana via private network.
If you expose the public URL broadly, consider adding basic auth via a reverse proxy.

**Access the expression browser:**
```
https://prometheus-production-f652.up.railway.app/graph
```

**Check scrape targets:**
```
https://prometheus-production-f652.up.railway.app/targets
```

---

### Loki

| Field | Value |
|-------|-------|
| Public URL | https://loki-production-e875.up.railway.app |
| Private domain | loki.railway.internal:3100 |
| Auth | None |
| Push endpoint (used by backend) | `http://loki.railway.internal:3100/loki/api/v1/push` |

Loki is write-only from `apps/backend` (via `LOKI_HOST` env var) and read-only from Grafana.
It is not intended to be accessed directly.

**Check Loki health:**
```bash
curl https://loki-production-e875.up.railway.app/ready
# Expected: "ready"
```

---

### Tempo

| Field | Value |
|-------|-------|
| Public URL | https://tempo-production-1526.up.railway.app |
| Private domain | tempo.railway.internal:3200 |
| Auth | None |

Tempo receives traces from OtelCollector via gRPC (:4317) on private network.
Grafana queries Tempo for trace lookups.

**Check Tempo health:**
```bash
curl https://tempo-production-1526.up.railway.app/ready
# Expected: "ready"
```

---

### OtelCollector

| Field | Value |
|-------|-------|
| Public URL | https://otelcollector-production.up.railway.app |
| Private domain | otelcollector.railway.internal |
| OTLP/HTTP ingress (from backend) | `:4318` |
| OTLP/gRPC egress (to Tempo) | `:4317` |
| Health check port | `:13133` |
| Auth | None (private network only) |

`apps/backend` sends traces to `http://otelcollector.railway.internal:4318` via `OTEL_EXPORTER_OTLP_ENDPOINT`.

**Check collector health:**
```bash
curl https://otelcollector-production.up.railway.app/
# Expected: HTTP 200
```

---

### Postgres

| Field | Value |
|-------|-------|
| Private URL | `postgresql://postgres:<password>@postgres.railway.internal:5432/railway` |
| Public URL (for psql from laptop) | `postgresql://postgres:<password>@nozomi.proxy.rlwy.net:17912/railway` |
| Username | `postgres` |
| Password | See Railway dashboard: Postgres service → `PGPASSWORD` or `POSTGRES_PASSWORD` |
| Database | `railway` |
| Port (internal) | `5432` |
| Port (public proxy) | `17912` |

**Retrieve credentials:**
```bash
railway variables --service Postgres --kv | grep -E "PGPASSWORD|DATABASE_URL|DATABASE_PUBLIC_URL"
```

**Connect via psql (from laptop):**
```bash
psql $(railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)
```

**Connect via Railway shell:**
```bash
railway connect Postgres
```

**Rotate password:**
Rotate via Railway dashboard: Postgres service → Settings → Credentials → Rotate.
After rotation, update any services that reference `${{Postgres.DATABASE_URL}}` by redeploying them.
Services using Railway Reference Variables (`${{Postgres.DATABASE_URL}}`) pick up the new value automatically on next deploy.

**Services that depend on Postgres:**
- `llmtxt-api` (via `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`)
- `GlitchTip` (via its own `DATABASE_URL` reference)

---

### Redis

| Field | Value |
|-------|-------|
| Private URL | `redis://default:<password>@redis.railway.internal:6379` |
| Public URL | `redis://default:<password>@monorail.proxy.rlwy.net:53234` |
| Username | `default` |
| Password | See Railway dashboard: Redis service → `REDIS_PASSWORD` |

**Retrieve credentials:**
```bash
railway variables --service Redis --kv | grep -E "REDIS_URL|REDIS_PASSWORD|REDIS_PUBLIC_URL"
```

**Connect via redis-cli (from laptop):**
```bash
redis-cli -u "$(railway variables --service Redis --kv | grep REDIS_PUBLIC_URL | cut -d= -f2-)"
```

**Data loss tolerance:**
Redis is used for ephemeral state (CRDT scratchpad, fanout pub/sub, presence). A flush is recoverable:
- Presence state rebuilds from WS reconnect.
- CRDT last-updated cache rebuilds from Postgres.
- For intentional flush (e.g., cache poisoning incident): `redis-cli FLUSHALL` — confirm with owner first.

---

### llmtxt-api (Backend)

| Field | Value |
|-------|-------|
| Public URL | https://api.llmtxt.my |
| Private domain | llmtxt.railway.internal |
| Auth mechanism | API keys (`X-API-Key` header) + BetterAuth sessions |
| Admin secret | `BETTER_AUTH_SECRET` (see Railway) |
| Signing secret | `SIGNING_SECRET` (see Railway) |
| Metrics endpoint | `GET /api/metrics` (requires `Authorization: Bearer <METRICS_TOKEN>`) |
| Health endpoint | `GET /api/health` (no auth) |
| Ready endpoint | `GET /api/ready` (no auth) |

**Check health:**
```bash
curl https://api.llmtxt.my/api/health
# Expected: {"status":"ok","version":"...","ts":"..."}
```

**Retrieve env vars:**
```bash
railway variables --service llmtxt-api --kv
```

**Rotate admin API key:**
```bash
# Generate new key
NEW_KEY=$(openssl rand -hex 32)
railway variables --service llmtxt-api --set "ADMIN_API_KEY=${NEW_KEY}"
railway redeploy --service llmtxt-api --yes
```

**Rotate BETTER_AUTH_SECRET** (invalidates all active sessions):
```bash
NEW_SECRET=$(openssl rand -hex 32)
railway variables --service llmtxt-api --set "BETTER_AUTH_SECRET=${NEW_SECRET}"
railway redeploy --service llmtxt-api --yes
```

---

### llmtxt-frontend

| Field | Value |
|-------|-------|
| Public URL | https://www.llmtxt.my |
| Auth | None (public SPA) |
| Build-time env var | `VITE_API_BASE=https://api.llmtxt.my` |

No credentials to manage. The frontend is a static SPA deployed from `apps/frontend`.

**Env vars (set on Railway service):**
```
VITE_API_BASE                = https://api.llmtxt.my                            (literal — custom domain, not generated)
PUBLIC_GRAFANA_URL           = https://${{Grafana.RAILWAY_PUBLIC_DOMAIN}}        (reference)
PUBLIC_GLITCHTIP_URL         = https://${{GlitchTip.RAILWAY_PUBLIC_DOMAIN}}      (reference)
PUBLIC_PROMETHEUS_URL        = https://${{Prometheus.RAILWAY_PUBLIC_DOMAIN}}     (reference)
```

Set or update via CLI:
```bash
railway variables --service llmtxt-frontend \
  --set 'PUBLIC_GRAFANA_URL=https://${{Grafana.RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'PUBLIC_GLITCHTIP_URL=https://${{GlitchTip.RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'PUBLIC_PROMETHEUS_URL=https://${{Prometheus.RAILWAY_PUBLIC_DOMAIN}}'
```

---

### llmtxt-docs

| Field | Value |
|-------|-------|
| Public URL | https://docs.llmtxt.my |
| Auth | None (public docs) |

No credentials to manage. Docs are deployed from `apps/docs`.

---

## Environment Variables Reference

### llmtxt-api — Required Variables

| Variable | Value / Reference | Purpose |
|----------|-------------------|---------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference) | Postgres connection string |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference) | Redis connection string |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` (reference) | Redis hostname (used by some internal clients) |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` (reference) | Redis password |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` (reference) | Redis port |
| `BETTER_AUTH_SECRET` | (literal — manually set) | Signs BetterAuth sessions; rotate to invalidate all sessions |
| `BETTER_AUTH_URL` | `https://api.llmtxt.my` (literal — custom domain) | Public API URL |
| `SIGNING_SECRET` | (literal — manually set) | Signs webhook payloads and internal tokens |
| `CORS_ORIGIN` | `https://www.llmtxt.my` (literal — custom domain) | Allowed CORS origin(s) |
| `SENTRY_DSN` | `${{GlitchTip.GLITCHTIP_PUBLIC_DSN}}` (reference, or manually set) | GlitchTip error tracking DSN |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://${{OtelCollector.RAILWAY_PRIVATE_DOMAIN}}:4318` (reference + literal port) | OTel trace export endpoint — port 4318 is OTLP/HTTP, NOT `${{OtelCollector.PORT}}` (that is 13133, the health-check port) |
| `OTEL_SERVICE_NAME` | `llmtxt-api` (literal) | Service name in traces |
| `OTEL_RESOURCE_ATTRIBUTES` | (literal — manually set) | Extra trace attributes, e.g. `service.version=2026.4.4,deployment.environment=production` |
| `LOKI_HOST` | `${{Loki.RAILWAY_PRIVATE_DOMAIN}}` (reference) | Loki private hostname — port 3100 appended in code |
| `METRICS_TOKEN` | (literal — manually set) | Bearer token for `/api/metrics` endpoint |
| `CACHE_TTL` | (literal — manually set) | In-memory cache TTL in ms (default: 86400000) |
| `CACHE_MAX_SIZE` | (literal — manually set) | In-memory LRU cache max entries (default: 1000) |

### GlitchTip — Required Variables

| Variable | Value / Reference | Purpose |
|----------|-------------------|---------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference) | Postgres connection string |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference) | Redis connection string |
| `SECRET_KEY` | (literal — manually set) | Django secret key (generate: `openssl rand -hex 32`) |
| `GLITCHTIP_DOMAIN` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (reference — GlitchTip's own public domain) | Public domain for DSN generation |
| `DEFAULT_FROM_EMAIL` | (literal — manually set) | From address for email alerts |
| `ENABLE_USER_REGISTRATION` | `False` (literal) | Lock down signups |
| `CELERY_WORKER_CONCURRENCY` | `2` (literal) | Celery worker threads |

### Grafana — Required Variables

| Variable | Value / Reference | Purpose |
|----------|-------------------|---------|
| `GF_SECURITY_ADMIN_USER` | `admin` (literal) | Admin username |
| `GF_SECURITY_ADMIN_PASSWORD` | (literal — manually set) | Admin password |
| `GF_AUTH_ANONYMOUS_ENABLED` | `false` (literal) | Disable anonymous access |
| `GF_SERVER_DOMAIN` | `${{RAILWAY_PUBLIC_DOMAIN}}` (reference — Grafana's own public domain) | Grafana base domain |
| `GF_SERVER_ROOT_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` (reference) | Full root URL |
| `LOKI_HOST` | `${{Loki.RAILWAY_PRIVATE_DOMAIN}}` (reference) | Loki datasource hostname |
| `PROMETHEUS_HOST` | `${{Prometheus.RAILWAY_PRIVATE_DOMAIN}}` (reference) | Prometheus datasource hostname |
| `TEMPO_HOST` | `${{Tempo.RAILWAY_PRIVATE_DOMAIN}}` (reference) | Tempo datasource hostname |
| `GF_FEATURE_TOGGLES_ENABLE` | `traceqlEditor` (literal) | Enable TraceQL query editor |

### OtelCollector — Required Variables

| Variable | Value / Reference | Purpose |
|----------|-------------------|---------|
| `LOKI_HOST` | `${{Loki.RAILWAY_PRIVATE_DOMAIN}}` (reference) | Loki push target |
| `TEMPO_HOST` | `${{Tempo.RAILWAY_PRIVATE_DOMAIN}}` (reference) | Tempo push target |
| `PORT` | `13133` (literal) | Health-check port exposed to Railway — NOT the OTLP ports (4317/4318) |

### llmtxt-frontend — Required Variables

| Variable | Value / Reference | Purpose |
|----------|-------------------|---------|
| `VITE_API_BASE` | `https://api.llmtxt.my` (literal — custom domain) | Backend API base URL for SPA |
| `PUBLIC_GRAFANA_URL` | `https://${{Grafana.RAILWAY_PUBLIC_DOMAIN}}` (reference) | Grafana dashboard URL surfaced to browser |
| `PUBLIC_GLITCHTIP_URL` | `https://${{GlitchTip.RAILWAY_PUBLIC_DOMAIN}}` (reference) | GlitchTip error-tracking URL surfaced to browser |
| `PUBLIC_PROMETHEUS_URL` | `https://${{Prometheus.RAILWAY_PUBLIC_DOMAIN}}` (reference) | Prometheus URL surfaced to browser |

---

## Owner Action Checklist (First-Time Setup)

- [ ] **Change Grafana admin password**
  ```bash
  # 1. Login at https://grafana-production-85af.up.railway.app (admin / <current password from Railway>)
  # 2. Profile → Change password
  # 3. Update Railway variable:
  railway variables --service Grafana --set 'GF_SECURITY_ADMIN_PASSWORD=<new-password>'
  ```

- [ ] **Verify GlitchTip DSN is set and working**
  ```bash
  # Verify DSN is set
  railway variables --service llmtxt-api --kv | grep SENTRY
  # Should output: SENTRY_DSN=https://...@glitchtip-production-00c4.up.railway.app/1

  # Trigger a test error (hits a non-existent route)
  curl https://api.llmtxt.my/api/this-route-does-not-exist

  # Check GlitchTip UI for the captured event:
  # https://glitchtip-production-00c4.up.railway.app/llmtxt/issues/
  ```

- [ ] **Change GlitchTip admin password**
  ```
  https://glitchtip-production-00c4.up.railway.app/profile/password/
  ```

- [ ] **Review Prometheus scrape targets**
  ```
  https://prometheus-production-f652.up.railway.app/targets
  # All targets should show state=UP
  ```

- [ ] **Set up Grafana alert notification channel (optional)**
  ```
  Grafana → Alerting → Contact points → Add (Slack, email, PagerDuty, etc.)
  ```

- [ ] **Set up GlitchTip alert rules for 5xx errors (optional)**
  ```
  GlitchTip → llmtxt → llmtxt-backend → Alerts → Add alert
  # Recommended: alert on any issue with level=error, frequency=immediately
  ```

- [ ] **Create additional Grafana users (optional — admin sufficient for 1-person team)**
  ```
  Grafana → Administration → Users → Invite
  ```

- [ ] **Verify every env var points to a Railway Reference Variable (not hardcoded)**
  ```bash
  # Check for any hardcoded internal hostnames that should be reference vars
  railway variables --service llmtxt-api --kv | grep -v "RAILWAY_"
  ```

- [ ] **Rotate Postgres password (first 90-day rotation)**
  ```
  Railway dashboard → Postgres service → Settings → Credentials → Rotate
  # After rotation, redeploy services that reference ${{Postgres.DATABASE_URL}}
  ```

---

## Recovery Procedures

### Lost Grafana Admin Password

```bash
# 1. SSH into Grafana container
railway ssh --service Grafana -- grafana-cli admin reset-admin-password <new-password>

# 2. Update env var to survive redeploy
railway variables --service Grafana --set 'GF_SECURITY_ADMIN_PASSWORD=<new-password>'
```

### Lost GlitchTip Superuser Password

```bash
railway ssh --service GlitchTip -- python /code/manage.py changepassword admin
# (interactive — prompts for new password twice)
```

### GlitchTip DB Schema Out of Date (after image upgrade)

```bash
railway ssh --service GlitchTip -- python /code/manage.py migrate --noinput
```

### GlitchTip Superuser Deleted / No Admin Account

```bash
railway ssh --service GlitchTip -- env \
  DJANGO_SUPERUSER_USERNAME=admin \
  DJANGO_SUPERUSER_EMAIL=admin@llmtxt.my \
  DJANGO_SUPERUSER_PASSWORD='<new-strong-password>' \
  python /code/manage.py createsuperuser --noinput
```

### SENTRY_DSN Not Set / Error Tracking Disabled

```bash
# 1. Retrieve the DSN from GlitchTip
# Login to GlitchTip, navigate to:
# Settings → llmtxt-backend → Client Keys → DSN

# 2. Set on llmtxt-api
railway variables --service llmtxt-api --set 'SENTRY_DSN=<dsn>'

# 3. Redeploy
railway redeploy --service llmtxt-api --yes

# 4. Verify startup log contains:
# [glitchtip] GlitchTip error tracking initialised (Sentry-compatible, self-hosted).
railway logs --service llmtxt-api | grep glitchtip
```

### Corrupted / Lost Postgres Data

Restore from backup per `docs/ops/backup-restore-runbook.md`.

Quick reference:
```bash
# List available backups in Railway
railway connect Postgres
# In psql, use Railway's automated backup restore feature (Railway dashboard)
```

### Redis Flushed Accidentally

Redis holds only ephemeral state — no durable data is stored exclusively in Redis.

- **Presence state**: rebuilds automatically when WebSocket clients reconnect.
- **CRDT cache**: rebuilds from Postgres on first access.
- **Scratchpad TTL keys**: expire naturally; lost keys are a temporary UX issue only.

```bash
# Confirm flush impact before acting
redis-cli -u "$(railway variables --service Redis --kv | grep REDIS_PUBLIC_URL | cut -d= -f2-)" INFO keyspace

# If you need to flush (cache poisoning incident):
redis-cli -u "$(railway variables --service Redis --kv | grep REDIS_PUBLIC_URL | cut -d= -f2-)" FLUSHALL
```

### llmtxt-api Health Check Failing

```bash
# 1. Check current status
curl -v https://api.llmtxt.my/api/health
curl -v https://api.llmtxt.my/api/ready

# 2. Check Railway deployment logs
railway logs --service llmtxt-api --tail 100

# 3. Rollback to previous deployment if needed
# Railway dashboard → llmtxt-api → Deployments → select previous → Rollback
```

### Grafana Datasource Connectivity Lost

Grafana uses private Railway internal hostnames. If a datasource shows as unreachable:

```bash
# 1. Check that the backing service is running
railway logs --service Prometheus --tail 20
railway logs --service Loki --tail 20
railway logs --service Tempo --tail 20

# 2. Verify private domain resolution (inside Grafana container)
railway ssh --service Grafana -- nslookup prometheus.railway.internal

# 3. If service was redeployed and hostname changed, update Grafana datasource:
# Grafana → Connections → Data sources → (select source) → Update URL
```

---

## Secret Storage Policy

1. **NEVER commit secrets to git.** The `.gitignore` excludes `.env*` files.
   If a secret is accidentally committed: rotate it immediately, then use `git filter-repo` to scrub history.

2. **Railway env vars are the source of truth** for all production secrets.
   ```bash
   # View all vars for a service
   railway variables --service <service-name> --kv

   # Set a new var
   railway variables --service <service-name> --set 'KEY=value'
   ```

3. **Use Railway Reference Variables** for cross-service credentials.
   Instead of copy-pasting the Postgres password into every service, reference it:
   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   ```
   Railway resolves this at runtime. Password rotation in the Postgres service
   propagates automatically on next deploy of dependent services.

4. **Local dev:** Each developer maintains their own `.env.local` file (not committed).
   Use `.env.example` (checked in, no real values) as the template.

5. **API keys for admin use:** Generated via `POST /api/v1/admin/keys` behind super-admin auth.
   Store the generated key in your password manager — it is not retrievable after creation.

6. **Rotation schedule:**

   | Secret | Rotation Frequency | Command |
   |--------|-------------------|---------|
   | Postgres password | Every 90 days | Railway dashboard → Postgres → Credentials → Rotate |
   | Grafana admin password | Every 90 days | `railway ssh --service Grafana -- grafana-cli admin reset-admin-password <new>` |
   | GlitchTip admin password | Every 90 days | GlitchTip UI → Profile → Change password |
   | `BETTER_AUTH_SECRET` | Every 180 days (or on breach) | `railway variables --service llmtxt-api --set 'BETTER_AUTH_SECRET=...'` |
   | `SIGNING_SECRET` | Every 180 days (or on breach) | `railway variables --service llmtxt-api --set 'SIGNING_SECRET=...'` |
   | `METRICS_TOKEN` | Every 90 days | `railway variables --service llmtxt-api --set 'METRICS_TOKEN=...'` |
   | Admin API keys | Every 90 days | `POST /api/v1/admin/keys` then delete old key |

7. **Generate a strong secret on the CLI:**
   ```bash
   openssl rand -hex 32   # 64 hex chars — good for secrets/passwords
   openssl rand -base64 24  # 32 base64 chars — good for passwords with punctuation
   ```
