/**
 * Observability smoke test (T307.10)
 *
 * Validates that the self-hosted observability stack endpoints are reachable
 * and accepting data. This test is skipped unless OBSERVABILITY_SMOKE=1 is
 * set — it requires the full Railway stack to be deployed.
 *
 * What it checks:
 *   - OTel Collector accepts an OTLP/HTTP span and returns 200
 *   - Loki accepts a log push and returns 204
 *   - Loki returns the log that was just pushed
 *   - Prometheus /-/healthy returns 200
 *   - Grafana /api/health returns 200
 *   - GlitchTip /_health/ returns 200
 *   - OTel Collector health extension (port 13133) returns 200
 *
 * Run with:
 *   OBSERVABILITY_SMOKE=1 \
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://<otel-host>:4318 \
 *   LOKI_HOST=<loki-private-domain> \
 *   PROMETHEUS_HOST=<prom-private-domain> \
 *   GRAFANA_HOST=<grafana-private-domain> \
 *   GLITCHTIP_HOST=<glitchtip-private-domain> \
 *   node --import tsx/esm --test src/__tests__/observability-smoke.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const SKIP = !process.env.OBSERVABILITY_SMOKE;

const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const lokiHost = process.env.LOKI_HOST;
const prometheusHost = process.env.PROMETHEUS_HOST;
const grafanaHost = process.env.GRAFANA_HOST;
const glitchtipHost = process.env.GLITCHTIP_HOST;

describe('Observability smoke tests (requires OBSERVABILITY_SMOKE=1)', { skip: SKIP }, () => {
  before(() => {
    if (!otelEndpoint) throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT not set');
    if (!lokiHost) throw new Error('LOKI_HOST not set');
  });

  it('OTel Collector accepts a test OTLP span', async () => {
    // Minimal OTLP/JSON trace payload — one span.
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'llmtxt-smoke-test' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'smoke-test', version: '1.0.0' },
              spans: [
                {
                  traceId: '00000000000000000000000000000001',
                  spanId: '0000000000000001',
                  name: 'smoke-test-span',
                  kind: 1, // SPAN_KIND_INTERNAL
                  startTimeUnixNano: String(Date.now() * 1_000_000),
                  endTimeUnixNano: String((Date.now() + 10) * 1_000_000),
                  status: { code: 1 }, // STATUS_CODE_OK
                },
              ],
            },
          ],
        },
      ],
    };

    const base = otelEndpoint!.replace(/\/$/, '');
    const response = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // OTel Collector returns 200 on success.
    assert.strictEqual(response.status, 200, `Expected 200 from OTel Collector, got ${response.status}`);
  });

  it('Loki accepts a test log push', async () => {
    const nowNs = String(Date.now() * 1_000_000);
    const payload = {
      streams: [
        {
          stream: { app: 'llmtxt-backend', level: 'info', env: 'smoke-test' },
          values: [[nowNs, JSON.stringify({ msg: 'smoke test log entry', level: 'info' })]],
        },
      ],
    };

    const response = await fetch(`http://${lokiHost}:3100/loki/api/v1/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Loki returns 204 No Content on successful push.
    assert.strictEqual(response.status, 204, `Expected 204 from Loki push, got ${response.status}`);
  });

  it('Loki returns logs for the smoke test stream', async () => {
    // Give Loki 2 seconds to index the log we just pushed.
    await new Promise((r) => setTimeout(r, 2000));

    const end = Date.now() * 1_000_000;
    const start = end - 60_000 * 1_000_000; // 1 minute ago
    const query = encodeURIComponent('{app="llmtxt-backend", env="smoke-test"}');
    const url = `http://${lokiHost}:3100/loki/api/v1/query_range?query=${query}&start=${start}&end=${end}&limit=1`;

    const response = await fetch(url);
    assert.strictEqual(response.status, 200, `Expected 200 from Loki query, got ${response.status}`);

    const body = (await response.json()) as {
      data?: { result?: unknown[] };
    };
    assert.ok(
      Array.isArray(body.data?.result) && body.data!.result!.length > 0,
      'Expected at least one log stream result from Loki'
    );
  });

  it('Prometheus /-/healthy returns 200', async () => {
    if (!prometheusHost) {
      console.warn('PROMETHEUS_HOST not set — skipping Prometheus health check');
      return;
    }
    const response = await fetch(`http://${prometheusHost}:9090/-/healthy`);
    assert.strictEqual(response.status, 200, `Expected 200 from Prometheus, got ${response.status}`);
  });

  it('Grafana /api/health returns 200 with database ok', async () => {
    if (!grafanaHost) {
      console.warn('GRAFANA_HOST not set — skipping Grafana health check');
      return;
    }
    const response = await fetch(`http://${grafanaHost}:3000/api/health`);
    assert.strictEqual(response.status, 200, `Expected 200 from Grafana, got ${response.status}`);
    const body = (await response.json()) as { database?: string };
    assert.strictEqual(body.database, 'ok', 'Grafana database health should be ok');
  });

  it('GlitchTip /_health/ returns 200', async () => {
    if (!glitchtipHost) {
      console.warn('GLITCHTIP_HOST not set — skipping GlitchTip health check');
      return;
    }
    const response = await fetch(`http://${glitchtipHost}:8000/_health/`);
    assert.strictEqual(response.status, 200, `Expected 200 from GlitchTip, got ${response.status}`);
  });

  it('OTel Collector health extension returns 200', async () => {
    if (!otelEndpoint) return;
    // The collector health_check extension listens on port 13133.
    const url = new URL(otelEndpoint!);
    const collectorHost = url.hostname;
    const response = await fetch(`http://${collectorHost}:13133/`);
    assert.strictEqual(response.status, 200, `Expected 200 from OTel Collector health, got ${response.status}`);
  });
});
