# ops/RUNBOOK.md — LLMtxt Backend Observability & Operations

**Last updated**: 2026-04-15  
**Epic**: T145 (Observability Stack)  
**Audience**: On-call engineers, deployment automation

---

## Quick Reference: Observability Endpoints & Dashboards

| Component | Endpoint | Auth | Purpose |
|-----------|----------|------|---------|
| Liveness | `GET /api/health` | None | Simple 200 = running (no I/O, <50ms) |
| Readiness | `GET /api/ready` | None | DB connection check (SELECT 1 on SQLite/Postgres) |
| Metrics | `GET /api/metrics` | Bearer token | Prometheus text format; http_request_duration_seconds, http_requests_total, domain counters |
| Traces | Grafana Cloud Tempo | UI login | Distributed trace lookups by trace ID |
| Logs | Grafana Cloud Loki | UI login | Structured logs, queryable by trace_id |
| Errors | Sentry | UI login | Symbolicated stack traces, alerting |
| Alerts | Grafana Cloud | UI login | Error rate rule (>5% over 5min) |

---

## Environment Variables — Observability Stack

**All required for production; unset in dev falls back to no-op or stdout.**

| Variable | Required | Default | Controls |
|----------|----------|---------|----------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Yes (prod) | Unset = no-op | OpenTelemetry trace export HTTP endpoint (e.g., Grafana Cloud Tempo OTLP URL) |
| `OTEL_AUTH_HEADER` | Yes (prod) | Unset = no auth | Base64 `instanceId:apiToken` for Grafana Cloud OTLP authentication |
| `LOKI_HOST` | Yes (prod) | Unset = stdout | Grafana Cloud Loki push URL (e.g., `https://logs-prod-us-central1.grafana.net/loki/api/v1/push`) |
| `LOKI_USER` | Yes (prod) | Unset = stdout | Grafana Cloud Loki user ID (numeric) |
| `LOKI_PASSWORD` | Yes (prod) | Unset = stdout | Grafana Cloud Loki API token |
| `SENTRY_DSN` | Yes (prod) | Unset = no-op | Sentry project DSN for error tracking |
| `METRICS_TOKEN` | No | Unset = public | Static bearer token for `GET /api/metrics` auth; if unset, `/api/metrics` is public |
| `NODE_ENV` | No | `development` | Controls log level (debug in dev, info in prod) |

---

## Playbook: First 5 Minutes When Something Breaks

**Goal**: Determine if the issue is a deployment, database, or code problem.

1. **Verify liveness**:
   ```bash
   curl -i https://api.llmtxt.my/api/health
   ```
   - Expected: HTTP 200 in < 50ms, body `{ "status": "ok", "version": "...", "ts": "..." }`
   - If failed: service is not running or networking is broken.

2. **Check readiness**:
   ```bash
   curl -i https://api.llmtxt.my/api/ready
   ```
   - Expected: HTTP 200, body `{ "status": "available" }`
   - If 503: database is unreachable or migration failed at startup.

3. **Review Railway deployment status**:
   - Login to Railway dashboard: `railway.app`
   - Select `llmtxt-api` service
   - Check **Deployments** tab: is the latest deploy green (✓) or red (✗)?
   - If red: click the deploy row to see logs and error message.

4. **Check recent git commits**:
   ```bash
   git log --oneline -5 origin/main
   ```
   - Confirm that the commit causing the issue is recent (last few hours).

5. **Review CI status**:
   - Go to GitHub: `github.com/kryptobaseddev/llmtxt/actions`
   - Check the latest `main` branch run.
   - Confirm `migration-check` job (T190) passed. If not, a database migration is blocking deploy.

6. **If still unclear**: escalate to the on-call database or infrastructure engineer; attach the next sections' outputs.

---

## Incident Playbooks

### Scenario 1: Health Check Failing (`/api/health` → 5xx or timeout)

**Indicates**: Service crashed or extremely slow startup.

**Steps**:
1. Grab recent logs from Railway:
   ```bash
   railway logs <deploy-id> --tail 100 | grep -i error
   ```
2. Look for `Error`, `panic`, `FATAL`, `FST_ERR_*` (Fastify init errors).
3. If you see migration errors (e.g., `duplicate table`, `schema mismatch`):
   - Check `docs/spec/SPEC-T145-observability-stack.md` (migrations must not auto-recover).
   - Contact database team; manual remediation may be needed.
4. If you see OTel or Sentry init warnings (e.g., `OTEL_EXPORTER_OTLP_ENDPOINT not set`):
   - Confirm Railway secrets are synced; redeploy may be needed.

**Rollback decision**:
- If the latest commit introduced a hard migration (new column, constraint), it likely cannot be rolled back without manual data cleanup.
- If the latest commit is app-only (no schema changes), rollback is safe:
  ```bash
  railway redeploy <prior-deploy-id>
  ```

---

### Scenario 2: Readiness Check Failing (`/api/ready` → 503)

**Indicates**: Database connection or startup migration failed.

**Steps**:
1. Confirm database is running:
   - For SQLite (current): check Railway volume usage (`railway logs` should show DB path; if volume is full, `VACUUM` is blocked).
   - For Postgres (future): check Rails database service is alive.
2. Grab the full startup log:
   ```bash
   railway logs <deploy-id> --tail 200 | head -100
   ```
3. Look for:
   - `Error: SQLITE_CANTOPEN` (file not found; volume unmounted).
   - `Error: SQLITE_IOERR` (I/O error; volume full or corrupted).
   - Migration error (e.g., `drizzle-kit` generated bad SQL).

4. If migration is the culprit:
   - Check `docs/migrations/` for the problematic `.sql` file (timestamps correspond to Railway logs).
   - Consult `check-migrations.sh` (T190) — if a PR bypassed it, the CI job must be enforced.
   - Manual rollback: restore database from backup, or re-run migrations with data repair.

---

### Scenario 3: 5xx Spike in Metrics

**Indicates**: Code error, resource exhaustion, or transient infrastructure issue.

**Steps**:
1. Get a sample of the error rate:
   ```bash
   curl -H "Authorization: Bearer $METRICS_TOKEN" \
     https://api.llmtxt.my/api/metrics | grep http_requests_total
   ```
   Look for buckets with `status_code="500"`. Spike in a single endpoint (e.g., `route="POST /api/v1/documents"`) is usually app logic. Uniform spike across all endpoints is often a shared resource (DB, cache, auth service).

2. Check logs for that endpoint in Grafana Cloud Loki:
   ```
   app="llmtxt-backend" AND route="POST /api/v1/documents" AND level="error"
   ```
   (Requires Loki credentials and a login to Grafana Cloud.)

3. Grab the trace ID from a failing request:
   - Look in the Loki log record for `trace_id` field.
   - Go to Grafana Cloud Tempo and search for that trace ID (see next section).

4. If Sentry is configured:
   - Check Sentry dashboard for recent errors; most recent errors are listed first.
   - Click on an error to see the full stack trace (must have source maps uploaded by CI).

---

### Scenario 4: Webhook Delivery Failures

**Indicates**: Outgoing HTTP requests from the service to external webhooks are failing.

**Steps**:
1. Query metrics for webhook delivery results:
   ```bash
   curl -H "Authorization: Bearer $METRICS_TOKEN" \
     https://api.llmtxt.my/api/metrics | grep llmtxt_webhook_delivery_total
   ```
   Example output:
   ```
   llmtxt_webhook_delivery_total{result="success"} 427
   llmtxt_webhook_delivery_total{result="failure"} 12
   ```

2. Find failing webhook events in logs:
   ```
   app="llmtxt-backend" AND level="error" AND "webhook"
   ```
   (Loki query in Grafana Cloud.)

3. Check trace ID from the log:
   - Traces for webhook deliveries should include a child span for the outgoing HTTP request.
   - Look for error details: `ECONNREFUSED` (target unreachable), `ETIMEDOUT` (slow target), or HTTP 4xx/5xx from target.

4. If a specific webhook is repeatedly failing:
   - Check if the external service is down (use `curl` from your laptop to test).
   - Check if the webhook delivery timeout is too short (Railway may need to increase the task timeout).

---

### Scenario 5: Volume Disk Full

**Indicates**: SQLite WAL file or data.db is consuming all available space.

**Steps**:
1. Check Railway volume usage:
   - Railway dashboard → llmtxt-api service → **Volume** tab.
   - If usage is >95%: immediate action required.

2. Determine the culprit:
   ```bash
   railway ssh  # SSH into the container
   ls -lh /var/lib/llmtxt/  # or wherever data.db is mounted
   ```

3. Clean up:
   - If `data.db-wal` is huge (>1 GB): the WAL file is not being checkpointed.
   - Run a VACUUM via a maintenance connection (one-off task):
     ```bash
     railway run sqlite3 /var/lib/llmtxt/data.db "VACUUM;"
     ```
   - After VACUUM, WAL file should shrink dramatically.

4. Prevent recurrence:
   - Check if a long-running transaction is holding the WAL open.
   - Review recent migrations: if a migration added a large index without `PRAGMA synchronous=OFF`, it can cause WAL bloat.

---

## How To: Trace a Request End-to-End

### Step 1: Get the Trace ID

**From an HTTP response header** (if instrumentation is working):
- Every HTTP response includes a `traceparent` header (W3C Trace Context).
- Example: `traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`
- The trace ID is the middle segment: `4bf92f3577b34da6a3ce929d0e0e4736`

**From a log entry**:
- In Loki (Grafana Cloud), search for the request:
  ```
  app="llmtxt-backend" AND route="POST /api/v1/documents" AND status="500"
  ```
- Click a log record. The `trace_id` field will be shown (e.g., `trace_id: "4bf92f3577b34da6a3ce929d0e0e4736"`).

**From a Sentry error**:
- Open Sentry dashboard → select the event → scroll to "Tags" → `trace_id` tag.

### Step 2: Look Up the Trace in Tempo

1. Go to **Grafana Cloud** → **Explore** → **Tempo** data source.
2. Paste the trace ID in the search box.
3. Click **Run query**. The full trace appears as a tree:
   - Root span: the HTTP handler (e.g., `HTTP POST /api/v1/documents`).
   - Child spans: DB queries, middleware, OTel auto-instrumentation.
   - Each span shows: duration, status (OK, Error), attributes.

4. **Interpret the trace**:
   - A span marked red (Error) indicates that step failed.
   - Look at the span's `http.status_code` or exception details.
   - Check if a child span has a longer duration than expected (e.g., a query taking 10s instead of 100ms).

---

## How To: Query Logs by Trace ID

1. Go to **Grafana Cloud** → **Explore** → **Loki** data source.
2. Use the LogQL query:
   ```
   {app="llmtxt-backend"} | trace_id="<trace-id>"
   ```
   Replace `<trace-id>` with the trace ID from the previous section (e.g., `4bf92f3577b34da6a3ce929d0e0e4736`).

3. Click **Run query**. All log records for that trace appear, sorted by timestamp.
   - Each record includes `level` (info, warn, error), `message`, and context fields.
   - If a record is marked error, it will have an `err` field with the error message.

4. **Correlate with the trace**:
   - A log error at timestamp T should correspond to a span error in Tempo at the same time.
   - Use this to pinpoint the exact operation that failed.

---

## How To: Interpret /api/metrics

**Fetch the metrics endpoint**:
```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.llmtxt.my/api/metrics
```

**Key metrics**:

| Metric | Labels | What it means |
|--------|--------|---------------|
| `http_request_duration_seconds` | method, route, status_code | Histogram: request latency in seconds; includes p50, p95, p99 quantiles |
| `http_requests_total` | method, route, status_code | Counter: cumulative request count; 5xx indicates errors |
| `llmtxt_document_created_total` | None | Counter: successful document creations |
| `llmtxt_document_state_transition_total` | from_state, to_state | Counter: state machine transitions |
| `llmtxt_webhook_delivery_total` | result | Counter: successful and failed webhook deliveries |

**Example interpretation**:
```
http_request_duration_seconds_bucket{method="POST",route="/api/v1/documents",status_code="200",le="0.1"} 142
http_request_duration_seconds_bucket{method="POST",route="/api/v1/documents",status_code="200",le="0.5"} 185
http_request_duration_seconds_bucket{method="POST",route="/api/v1/documents",status_code="200",le="1.0"} 187
http_requests_total{method="POST",route="/api/v1/documents",status_code="500"} 3
```
- 142 requests completed in < 100ms (good).
- 3 requests failed with 500 (bad); this is a 1.6% error rate if total is ~187.

---

## How To: Find a Sentry Event by Request/Trace ID

1. Go to **Sentry** → your `llmtxt-backend` project.
2. Click **Issues** or **Events**.
3. Use the search box:
   - Search by trace ID: `trace_id:"4bf92f3577b34da6a3ce929d0e0e4736"`
   - Or search by request path: `request.url:"/api/v1/documents"`
4. Click the event to open the detail view.
5. **Sections**:
   - **Stack Trace**: The error's call stack (source-mapped if CI uploaded source maps on the release).
   - **Breadcrumbs**: Recent log-like events leading up to the error.
   - **Tags**: Metadata like `environment`, `release`, `trace_id`.
   - **Request**: HTTP method, URL, headers (PII redacted).

---

## Alert: Error Rate > 5% Over 5 Minutes

**Alert definition** (Grafana Cloud Prometheus rules):
```
rate(http_requests_total{status_code=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
```

**How to silence it** (if it's a false positive):
1. Go to **Grafana Cloud** → **Alerting** → **Alert rules**.
2. Find the rule: `Error rate > 5% over 5 minutes` (or similar name).
3. Click the rule.
4. Click **Silence** (or **Create Silence**).
5. Set a duration (e.g., 15 minutes) and confirm.
6. Once silenced, the alert will not fire again until the silence expires.

**Investigate if the alert fires**:
- The alert fires when >5% of requests in any 5-minute window return 5xx.
- Immediately check `/api/metrics` and Sentry (see scenarios above).
- If the spike is isolated (e.g., a single bad release), rollback. If it's sustained, escalate to the team.

---

## Environment Variable Rotation (Credential Management)

**Rotating `METRICS_TOKEN`**:
1. Generate a new token (any random string, e.g., `head -c 32 /dev/urandom | base64`).
2. In Railway dashboard:
   - Set `METRICS_TOKEN_NEW` to the new token.
   - Deploy (redeploy the current commit).
   - Verify `/api/metrics` still works with the new token: `curl -H "Authorization: Bearer $METRICS_TOKEN_NEW" ...`
3. Once verified, delete the old token from your local env and update all monitoring scrapers (Prometheus, Grafana agents) to use the new token.
4. Remove `METRICS_TOKEN_NEW` and set `METRICS_TOKEN` to the actual value.

**Rotating `SENTRY_DSN`**:
1. In Sentry, generate a new DSN (Project Settings → Client Keys).
2. In Railway, update `SENTRY_DSN` to the new value.
3. Redeploy.
4. Verify: trigger a test error in the app (e.g., a manually thrown exception in a test endpoint) and confirm it appears in Sentry within 60 seconds.
5. Delete the old DSN key from Sentry.

**Rotating `OTEL_EXPORTER_OTLP_ENDPOINT` and `LOKI_*` credentials**:
- Same pattern: set new values in Railway, redeploy, verify.
- For Grafana Cloud credentials, generate new API tokens in Organization Settings.
- Old credentials can be revoked once the new ones are verified.

---

## CI Release Checklist (Sentry Source Maps)

Before every release tagged on `main`:

1. **Verify CI includes source-map upload**:
   - Workflow: `.github/workflows/release.yml`
   - Must include a step that runs `@sentry/cli sourcemaps upload` after TypeScript build.
   - If `SENTRY_AUTH_TOKEN` is absent, the step must warn (not fail).

2. **After deploy, trigger a test error**:
   - Hit an endpoint that throws (or add a `/test-error` endpoint for QA).
   - Check Sentry dashboard within 60 seconds; the stack trace must be symbolicated (readable function names, source line numbers).

3. **If stack trace is minified** (function names are `a`, `b`, etc.):
   - Source maps were not uploaded by CI.
   - Check the release workflow logs; the `@sentry/cli` step may have failed silently.
   - Re-run the workflow with `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` secrets confirmed.

---

## Monitoring Dashboards (Grafana Cloud)

**Current setup**:
- Grafana Cloud dashboards are not yet provisioned (T214, requires owner action).
- For now, use the **Explore** view:
  - **Tempo** for traces (search by trace ID).
  - **Loki** for logs (search by `trace_id` or other fields).
  - **Prometheus** for metrics (query examples: `rate(http_requests_total{status_code="500"}[5m])`).

**Future**: Once T214 is complete, a dedicated dashboard will be available in Grafana Cloud for:
- Request latency (p50, p95, p99).
- Error rate by endpoint.
- Webhook delivery success rate.
- Document state transitions.

---

## Additional Resources

- **Specification**: `docs/spec/SPEC-T145-observability-stack.md` — full technical spec.
- **ADR**: `docs/adr/ADR-T145-observability-stack.md` — architecture decisions and trade-offs.
- **Sentry docs**: https://docs.sentry.io/
- **Grafana Cloud docs**: https://grafana.com/docs/grafana-cloud/
- **OpenTelemetry**: https://opentelemetry.io/docs/
