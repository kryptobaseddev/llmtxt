# Service Level Objectives (SLOs)

**Service**: api.llmtxt.my  
**Version**: 1.0.0  
**Last updated**: 2026-04-18  

---

## What is an SLO?

A Service Level Objective is a target reliability goal. If the service falls
below the target — the **error budget** is burning — alerts fire and on-call
engineers are paged.

LLMtxt uses SLOs to ensure agents are never silently blocked by a degraded API.

---

## Latency targets

| Endpoint | p50 target | p95 target | p99 target |
|----------|-----------|-----------|-----------|
| `GET /api/v1/documents/:slug/sections` (P0) | < 50 ms | < 200 ms | < 500 ms |
| `GET /api/v1/documents/:slug` (P0) | < 75 ms | < 300 ms | < 750 ms |
| Write endpoints — POST/PUT/PATCH (P1) | < 150 ms | < 500 ms | < 1500 ms |
| Auth endpoints — `/api/auth/*` (P1) | < 100 ms | < 400 ms | < 1000 ms |

An alert fires when the **p95 latency** for any endpoint class exceeds its
target for more than **5 consecutive minutes**.

---

## Availability target

**99.5% availability** over a rolling 30-day window.

| Budget | Value |
|--------|-------|
| Monthly downtime allowance | 3.65 hours |
| Weekly downtime allowance | ~50 minutes |

Availability is measured as the fraction of requests that do **not** return
a 5xx HTTP status code. Client errors (4xx) are not counted as failures.

**Authenticated endpoints** must also stay below **1% error rate over any
10-minute window** — a tighter constraint that fires faster than the
availability budget alert.

---

## Error budget

When the service has errors, the error budget burns. Two burn-rate alerts
fire to warn before the monthly budget is exhausted:

| Alert | Threshold | Meaning |
|-------|-----------|---------|
| Warning | 18% error rate over 1 hour | 5% of monthly budget would be consumed in 1 hour |
| Critical | 36% error rate over 1 hour | 10% of monthly budget would be consumed in 1 hour |

The thresholds come from the [Google SRE Workbook multi-burn-rate formula](https://sre.google/workbook/alerting-on-slos/).

---

## Weekly SLO report

Every Monday at 09:00 UTC, a GitHub Actions workflow queries the Prometheus
metrics endpoint and posts a summary to the `#llmtxt-slo-reports` Slack channel.
The report includes:

- 7-day p50/p95/p99 per endpoint class
- SLO MET / MISSED status
- Error budget consumed for the week
- Link to the Grafana dashboard

---

## Where to look

| Resource | Location |
|----------|----------|
| Full SLO definition with error budget math | `ops/SLO.md` |
| Prometheus recording rules | `ops/prometheus/rules/sli.yml` |
| Alert rules | `ops/prometheus/alerts/slo.yml` |
| Alertmanager routing | `ops/alertmanager/routes.yml` |
| Grafana dashboard | `ops/grafana/dashboards/slo.json` |
| Weekly report workflow | `.github/workflows/slo-report.yml` |
| Incident runbook | `ops/RUNBOOK.md` |

---

## Changing the SLOs

All alert routing and rule changes are stored in version control under `ops/`
and **require a PR review** before merging (enforced via CODEOWNERS). If you
want to tighten or loosen a target, open a PR with the change to `ops/SLO.md`
and the corresponding `ops/prometheus/alerts/slo.yml` rule.
