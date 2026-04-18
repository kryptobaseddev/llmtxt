# LLMtxt Service Level Objectives

**Version**: 1.0.0  
**Last updated**: 2026-04-18  
**Epic**: T157 (Ops: SLO/SLI definition)  
**Owner**: Platform team  
**Review cadence**: Weekly (automated report via GitHub Actions)

---

## Overview

This document defines measurable Service Level Objectives (SLOs) for
`api.llmtxt.my`. SLOs establish the shared definition of acceptable performance
and reliability. When the error budget is burning too fast, alerts fire and
on-call engineers are paged.

**Guiding Star**: Never impede collaborating agents — without SLOs there is no
shared definition of "acceptable" and no automated signal to call attention to
regressions.

---

## Endpoint Classes

The API is grouped into four endpoint classes for SLO measurement:

| Class | Routes | Priority |
|-------|--------|----------|
| **sections** | `GET /api/v1/documents/:slug/sections` | P0 — primary read path |
| **documents** | `GET /api/v1/documents/:slug`, `GET /api/v1/documents` | P0 — document reads |
| **writes** | `POST /api/v1/documents`, `PUT /api/v1/documents/:slug`, `PATCH /api/v1/documents/:slug/*` | P1 — document writes |
| **auth** | `POST /api/auth/*`, `GET /api/auth/*` | P1 — authentication |
| **admin** | `GET /api/admin/*`, `POST /api/admin/*` | P2 — admin operations |

---

## Latency SLOs

### sections — `GET /api/v1/documents/:slug/sections` (P0)

This is the primary read path for agents fetching structured document content.

| Percentile | Target | Budget consumed if exceeded |
|------------|--------|----------------------------|
| p50 | < 50 ms | Degrades agent throughput |
| p95 | < 200 ms | Warning-level alert after 5 min |
| p99 | < 500 ms | Critical-level escalation |

### documents — document read endpoints (P0)

| Percentile | Target |
|------------|--------|
| p50 | < 75 ms |
| p95 | < 300 ms |
| p99 | < 750 ms |

### writes — document write endpoints (P1)

| Percentile | Target |
|------------|--------|
| p50 | < 150 ms |
| p95 | < 500 ms |
| p99 | < 1500 ms |

### auth — authentication endpoints (P1)

| Percentile | Target |
|------------|--------|
| p50 | < 100 ms |
| p95 | < 400 ms |
| p99 | < 1000 ms |

---

## Availability SLO

**Target**: 99.5% availability over a rolling 30-day window.

| Metric | Value |
|--------|-------|
| Availability target | 99.5% |
| Allowed downtime per month | 3.65 hours |
| Allowed downtime per week | ~50.4 minutes |
| Allowed downtime per day | ~7.2 minutes |

**Availability** is measured as:

```
availability = 1 - (error_rate_5xx / total_requests)
```

A request is counted as a failure when the HTTP response code is 5xx. 4xx
responses (client errors) are not counted as availability failures.

**Authenticated endpoints** have a stricter error budget: error rate must stay
below 1% over any 10-minute window (see alert rules in
`ops/prometheus/alerts/slo.yml`).

---

## Error Budget

### Monthly budget calculation

```
error_budget_minutes = (1 - availability_target) * 43800 minutes/month
                     = (1 - 0.995) * 43800
                     = 0.005 * 43800
                     = 219 minutes per month
                     ≈ 3.65 hours per month
```

### Error budget burn rate

The **burn rate** measures how fast the error budget is being consumed relative
to the allowable rate. A burn rate of 1.0 means the budget is being consumed
at exactly the rate that would exhaust it by end of month.

```
burn_rate = current_error_rate / error_budget_rate
          = current_error_rate / (1 - availability_target)
          = current_error_rate / 0.005
```

For example, if the current error rate is 1%:

```
burn_rate = 0.01 / 0.005 = 2.0
```

A burn rate of 2.0 means the budget will be exhausted in half a month (15 days)
rather than 30 days.

### Multi-burn-rate alert thresholds (Google SRE Workbook)

Following the Google SRE Workbook multi-window, multi-burn-rate approach:

| Severity | Burn Rate | Long Window | Short Window | Action |
|----------|-----------|-------------|--------------|--------|
| Warning | 5% of budget / 1 hr | 1 hour | 5 min | Page on-call |
| Critical | 10% of budget / 1 hr | 1 hour | 5 min | Immediate response |

**Burn-rate thresholds** (derived from the Google SRE workbook formula):

For a 99.5% availability target (budget = 0.5%):

```
# 5% of monthly budget consumed in 1 hour
# 1 month ≈ 720 hours
# 5% * 720 hours = 36 hours of budget
# Burn rate = 720 / (36 hours * budget_fraction)

warning_burn_rate  = (5% * 720) / 1  = 36  burn-rate multiplier over 1hr window
critical_burn_rate = (10% * 720) / 1 = 72  burn-rate multiplier over 1hr window

# In terms of error rate:
warning_error_rate  = warning_burn_rate  * (1 - 0.995) = 36  * 0.005 = 0.18  (18%)
critical_error_rate = critical_burn_rate * (1 - 0.995) = 72  * 0.005 = 0.36  (36%)
```

In practice for the 1-hour rolling window alert:

| Alert | Condition | Interpretation |
|-------|-----------|----------------|
| `SLOBurnRateWarning` | error_rate > 18% for 5 min within 1hr window | Burning 5% of monthly budget/hour |
| `SLOBurnRateCritical` | error_rate > 36% for 5 min within 1hr window | Burning 10% of monthly budget/hour |

See `ops/prometheus/alerts/slo.yml` for the Prometheus alert rule expressions.

---

## SLI Measurement

SLIs are measured using the `http_request_duration_seconds` histogram and
`http_requests_total` counter emitted by the Prom-client middleware in
`apps/backend/src/middleware/metrics.ts`.

The Prometheus metric labels are:

```
http_request_duration_seconds{method, route, status_code}
http_requests_total{method, route, status_code}
```

The `route` label uses the matched Fastify route pattern (e.g.,
`/api/v1/documents/:slug/sections`) to avoid high cardinality from IDs.

Recording rules in `ops/prometheus/rules/sli.yml` pre-compute per-class
p50/p95/p99 values for efficient dashboard and alert evaluation.

---

## Alerting

All alert rules are stored in version control under `ops/prometheus/alerts/` and
`ops/alertmanager/`. Changes to alert rules **require a PR review** before
merging (enforced via CODEOWNERS).

See:
- `ops/prometheus/alerts/slo.yml` — Prometheus alert rules
- `ops/alertmanager/routes.yml` — Alertmanager routing
- `ops/RUNBOOK.md` — Incident playbooks

---

## Weekly Review

A GitHub Actions workflow (`.github/workflows/slo-report.yml`) runs every Monday
at 09:00 UTC and:

1. Queries the Prometheus `/api/v1/query_range` endpoint.
2. Computes 7-day p50/p95/p99 and availability for each endpoint class.
3. Calculates error budget consumed and remaining.
4. Posts a Markdown summary to the configured Slack webhook (`SLO_WEBHOOK_URL`).

---

## References

- [Google SRE Workbook — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/)
- [Prometheus recording rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)
- `ops/prometheus/rules/sli.yml` — recording rules
- `ops/prometheus/alerts/slo.yml` — alert rules
- `ops/grafana/dashboards/slo.json` — Grafana dashboard
- `docs/ops/slo.md` — user-facing SLO summary
