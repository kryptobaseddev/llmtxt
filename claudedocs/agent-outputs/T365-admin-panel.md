# T365 — Unified Admin Panel

**Date**: 2026-04-16
**Status**: complete
**Build verification**: frontend 0 errors, backend tsc 0 errors

---

## What Was Built

### Backend (C1)

#### `apps/backend/src/middleware/admin.ts`
New middleware. Admin access is determined by the `ADMIN_EMAILS` env var (comma-separated email list). No schema migration required — avoids adding a role column to the users table.

- `requireAdmin(request, reply)` — Fastify preHandler: 401 if unauthenticated, 403 if not admin
- `isAdminEmail(email)` — utility predicate for non-protected use

#### `apps/backend/src/routes/admin.ts`
Three read-only endpoints registered at `/api/v1/admin/*`:

| Route | Returns |
|-------|---------|
| `GET /api/v1/admin/me` | `{ id, email, name, isAdmin }` — auth check |
| `GET /api/v1/admin/services` | `{ services: ServiceHealth[], cached }` — Railway health grid |
| `GET /api/v1/admin/config` | `{ grafana, prometheus, glitchtip, loki, tempo }` — public tool URLs |

The `/admin/services` endpoint calls Railway GraphQL API (`RAILWAY_TOKEN` + `RAILWAY_PROJECT_ID` env vars) with a 30s server-side cache. Falls back to a stub list of 11 services when Railway is not configured.

#### `apps/backend/src/index.ts`
Registered `adminRoutes` at `/api/v1` prefix, after the existing v1Routes registration.

---

### Frontend (C2 + C3)

#### Route structure created

```
apps/frontend/src/routes/admin/
  +layout.svelte           — Admin shell: sidebar nav, auth guard, admin identity check
  +page.svelte             — Overview: service health grid + observability quick links
  metrics/+page.svelte     — Prometheus: instant query tiles + iframe expression browser
  logs/+page.svelte        — Loki: filter bar (service/level/time) + Grafana Explore iframe
  traces/+page.svelte      — Tempo: trace ID search + service filter + Grafana Explore iframe
  errors/+page.svelte      — GlitchTip: full iframe embed
  dashboards/+page.svelte  — Grafana: dashboard picker sidebar + kiosk iframe
```

#### `apps/frontend/src/lib/stores/admin.svelte.ts`
Svelte 5 runes store. Initialised once in `/admin/+layout.svelte`.

- `getAdmin()` — returns reactive `{ user, config, loading, error, isAdmin, init(), reset() }`
- Fetches `GET /v1/admin/me` and `GET /v1/admin/config` in parallel

#### Auth guard
`/admin/+layout.svelte` redirects to `/auth?mode=signin&next=/admin` if not logged in, and to `/` if logged in but not admin (403 from `/admin/me`).

#### `apps/frontend/src/routes/+layout.svelte`
Added Admin nav link (visible only for admin users). Uses a fire-and-forget `checkAdminAccess()` call after auth init — does not block page load for non-admin users.

---

### Panel Data Sources

| Panel | Data Source | Strategy |
|-------|------------|----------|
| Overview | `GET /api/v1/admin/services` (backend → Railway GraphQL) | Polling 30s |
| Metrics | Prometheus `/api/v1/query` direct + iframe `/graph` | Polling 30s |
| Logs | Grafana Explore (`/explore?datasource=loki`) | iframe |
| Traces | Grafana Explore (`/explore?datasource=tempo`) | iframe |
| Errors | GlitchTip root URL | iframe |
| Dashboards | Grafana `/d/{uid}?kiosk=tv&theme=dark` | iframe |

---

### Grafana Dashboards (C4)

Six provisioned dashboard JSON files in `infra/observability/grafana/dashboards/`:

| File | UID | Status |
|------|-----|--------|
| `backend-overview.json` | `llmtxt-backend-overview` | pre-existing |
| `crdt-activity.json` | `llmtxt-crdt-activity` | pre-existing |
| `event-log-flow.json` | `llmtxt-event-log` | pre-existing |
| `agent-identity-usage.json` | `llmtxt-agent-identity-usage` | pre-existing |
| `multi-agent.json` | `llmtxt-multi-agent` | **new** — presence, lease, A2A, BFT |
| `database-redis.json` | `llmtxt-database` | **new** — PG pool, query latency, Redis |
| `infrastructure.json` | `llmtxt-infrastructure` | **new** — uptime, heap, GC, event loop lag |

All new files use the same provisioning path (`/var/lib/grafana/dashboards`) already configured in `infra/observability/grafana/provisioning/dashboards/dashboards.yaml`. No provisioning config changes needed.

---

## Owner Action List

### Required before production

1. **Set `ADMIN_EMAILS` env var on `llmtxt-api` Railway service.**
   ```
   ADMIN_EMAILS=keatonhoskins@gmail.com
   ```
   Without this, all admin requests return 403 ("Admin access not configured").

2. **Set `RAILWAY_TOKEN` + `RAILWAY_PROJECT_ID` on `llmtxt-api`** for live service health.
   Get token from Railway account settings. Project ID is in the project URL.
   Without these, service health shows a stub list with `status: unknown`.

3. **Set `GRAFANA_PUBLIC_URL` on `llmtxt-api`** (e.g. `https://grafana.railway.app`).
   Enables all Grafana-based panels (dashboards, logs explore, traces explore).

4. **Set `PROMETHEUS_PUBLIC_URL` on `llmtxt-api`** (e.g. `https://prometheus.railway.app`).
   Enables the metrics instant query tiles.

5. **Set `GLITCHTIP_PUBLIC_URL` on `llmtxt-api`** (e.g. `https://glitchtip.railway.app`).
   Enables the GlitchTip error iframe.

### Content-Security-Policy considerations (may block iframes)

The backend's CSP (`apps/backend/src/middleware/security.ts`) may need `frame-ancestors` updated for Grafana/GlitchTip to embed correctly. More critically, if Grafana and GlitchTip are served from Railway private domains with `X-Frame-Options: DENY` or `SAMEORIGIN` headers, the iframes will be blocked by the browser.

**Fix if iframes are blocked:**
- On Grafana: set `allow_embedding = true` in Grafana config (`GF_SECURITY_ALLOW_EMBEDDING=true` env var)
- On GlitchTip: check if it supports iframe embedding; if not, use the "open directly" fallback links provided in each panel
- The admin panel already provides "Open in Grafana" / "Open directly" fallback links on every panel

### Optional: Grafana SSO

For seamless iframe embedding without re-login, configure Grafana to trust the same auth session (e.g. shared cookie domain or Grafana OAuth with your existing email provider). This is not required — the panel provides direct-open fallback links.

---

## Build Verification

```
pnpm --filter frontend run build      → ✓ built in 3.36s, 0 errors
pnpm --filter @llmtxt/backend run build → ✓ (tsc 0 errors)
```

Pre-existing a11y warnings in `+page.svelte` and `doc/[slug]/+page.svelte` are unchanged from before this feature.

---

## Files Changed

**New files:**
- `apps/backend/src/middleware/admin.ts`
- `apps/backend/src/routes/admin.ts`
- `apps/frontend/src/lib/stores/admin.svelte.ts`
- `apps/frontend/src/routes/admin/+layout.svelte`
- `apps/frontend/src/routes/admin/+page.svelte`
- `apps/frontend/src/routes/admin/metrics/+page.svelte`
- `apps/frontend/src/routes/admin/logs/+page.svelte`
- `apps/frontend/src/routes/admin/traces/+page.svelte`
- `apps/frontend/src/routes/admin/errors/+page.svelte`
- `apps/frontend/src/routes/admin/dashboards/+page.svelte`
- `infra/observability/grafana/dashboards/multi-agent.json`
- `infra/observability/grafana/dashboards/database-redis.json`
- `infra/observability/grafana/dashboards/infrastructure.json`

**Modified files:**
- `apps/backend/src/index.ts` — register adminRoutes at /api/v1
- `apps/frontend/src/routes/+layout.svelte` — Admin nav link for admin users
