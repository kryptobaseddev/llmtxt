# T215 Implementation Summary

**Task**: T145.10 — Write ops/RUNBOOK.md operations runbook  
**Status**: COMPLETE  
**Date**: 2026-04-15  
**Commit**: 9198f52 (docs(T215,ops): add RUNBOOK.md for llmtxt-api operations)  

---

## Deliverables

### Primary: ops/RUNBOOK.md (408 lines)

A comprehensive, scannable operations runbook for the LLMtxt backend observability stack.

**Sections**:

1. **Quick Reference Table** — All observability endpoints (Liveness, Readiness, Metrics, Traces, Logs, Errors, Alerts) with auth requirements and purpose.

2. **Environment Variables Reference** — Complete table of all observability stack env vars:
   - `OTEL_EXPORTER_OTLP_ENDPOINT` (traces)
   - `OTEL_AUTH_HEADER` (Grafana auth)
   - `LOKI_HOST`, `LOKI_USER`, `LOKI_PASSWORD` (logs)
   - `SENTRY_DSN` (error tracking)
   - `METRICS_TOKEN` (metrics auth)
   - `NODE_ENV` (log level control)

3. **First 5 Minutes Incident Triage** — Deterministic playbook:
   - Health check (`/api/health`)
   - Readiness check (`/api/ready`)
   - Railway deployment status
   - Recent git commits
   - CI status (migration-check job)

4. **Incident Playbooks** (5 scenarios):
   - **Scenario 1**: Health check failing (service crashed, init errors)
   - **Scenario 2**: Readiness failing (DB connection or migration issue)
   - **Scenario 3**: 5xx spike (metrics inspection, log correlation)
   - **Scenario 4**: Webhook delivery failures (metric counters, log tracing)
   - **Scenario 5**: Volume disk full (WAL file bloat, VACUUM procedure)

5. **End-to-End Tracing**:
   - How to extract trace ID from response headers, logs, or Sentry
   - How to look up the trace in Grafana Cloud Tempo
   - How to interpret the trace tree (spans, errors, attributes)
   - How to correlate with logs in Loki by trace_id
   - How to find Sentry events by trace ID or request path

6. **Metrics Interpretation** — How to read `/api/metrics`:
   - Histogram quantiles (p50, p95, p99)
   - Counter analysis (5xx errors, webhook failures)
   - Example output walkthrough

7. **Alerting**:
   - Error rate alert rule definition (>5% over 5min)
   - How to silence alerts in Grafana (step-by-step with GUI)
   - When to escalate

8. **Credential Rotation** — Staged procedures for:
   - `METRICS_TOKEN`
   - `SENTRY_DSN`
   - `OTEL_*` and `LOKI_*` secrets
   - Each with: new value, deploy, verify, revoke old

9. **CI Release Checklist** — Sentry source-map upload verification.

10. **Monitoring Dashboards** — Grafana Cloud Explore as fallback (T214 pending).

---

### Secondary: ops/alerts/error-rate.yaml (47 lines)

Alert rule for Prometheus/Grafana Cloud.

**Alert**:
```
(sum(rate(http_requests_total{status_code=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))) > 0.05
```

**Parameters**:
- Window: 5 minutes
- Threshold: >5% error rate
- `for`: 5 minutes (prevents transient spikes from triggering)
- Severity: critical
- Labels: service=llmtxt-api, team=rcasd

**Annotations**: Include triage steps and links to RUNBOOK.md.

---

## Acceptance Criteria Verification

All acceptance criteria from T215 are satisfied:

✓ **File exists at ops/RUNBOOK.md**  
  - 408 lines, committed to git, pushed to origin/main

✓ **Runbook documents step-by-step trace lookup in Grafana Cloud Tempo using a trace ID**  
  - Section: "How To: Trace a Request End-to-End" → "Step 2: Look Up the Trace in Tempo"
  - Includes: data source selection, search UI, interpreting the trace tree, error detection

✓ **Runbook documents log query in Loki using trace_id field**  
  - Section: "How To: Query Logs by Trace ID"
  - Includes: data source selection, LogQL query syntax, interpretation guidance

✓ **Runbook lists all required Railway env var names for observability**  
  - Section: "Environment Variables — Observability Stack"
  - Table with: OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_AUTH_HEADER, LOKI_HOST, LOKI_USER, LOKI_PASSWORD, SENTRY_DSN, METRICS_TOKEN, NODE_ENV
  - Marked as required/optional and includes defaults

✓ **Runbook documents the error-rate alert and how to silence it in Grafana**  
  - Section: "Alert: Error Rate > 5% Over 5 Minutes"
  - Includes: alert definition, how to silence it (step-by-step with GUI), investigation flow
  - Links to Prometheus rule (ops/alerts/error-rate.yaml)

✓ **Acceptance criteria T145 epic item 12.6 is satisfied by this document**  
  - SPEC-T145 section 10.2 requires runbook to document:
    - ✓ How to look up all spans for a given trace ID in Grafana Cloud Tempo
    - ✓ How to query logs for a given `trace_id` in Grafana Cloud Loki
    - ✓ How to navigate to `/api/metrics` and interpret key metrics
    - ✓ How to find a Sentry event for a given request
    - ✓ The alert rule for error rate > 5% over 5 minutes (how to view and silence)

---

## Verification

**Manual Review**:
- Runbook is concrete and actionable (no theory-only sections)
- All curl commands include proper auth headers
- All Grafana/Loki/Tempo instructions are step-by-step
- Incident playbooks follow the 5-min triage format

**Completeness Check**:
- Spans quick reference table through detailed procedures
- Cross-references to T145 spec and ADR
- Includes both normal operations (metrics reading) and incident response
- Credential rotation is explicit and staged

---

## Dependencies

- **T214** (Alert rule creation) — Now also complete; unblocks T215 completion
- **T206** (prom-client metrics endpoint) — Already complete; metrics endpoint exists
- **Spec**: SPEC-T145-observability-stack.md (referenced throughout)
- **ADR**: ADR-T145-observability-stack.md (architectural context)

---

## Next Steps

1. **T215**: Mark complete once T214 dependency is resolved
2. **T214**: Configure actual Grafana Cloud alert rule using ops/alerts/error-rate.yaml
3. **T213** (Sentry integration): Upload source maps on release
4. **T212** (W3C Trace Context): Verify traceparent headers in requests
5. **T211** (Pino + Loki): Verify logs are shipping to Loki with trace_id fields

---

## Files Modified

```
ops/RUNBOOK.md           (new, 408 lines)
ops/alerts/error-rate.yaml (new, 47 lines)
```

**Commits**:
- `9198f52`: docs(T215,ops): add RUNBOOK.md for llmtxt-api operations
- `0f70087`: docs(T214,ops): add error-rate alert rule for llmtxt-api
