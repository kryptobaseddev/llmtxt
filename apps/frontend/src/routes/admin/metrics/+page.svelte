<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  const admin = getAdmin();

  interface MetricResult {
    label: string;
    value: string;
    unit: string;
    query: string;
  }

  let metrics = $state<MetricResult[]>([]);
  let metricsLoading = $state(true);
  let metricsError = $state<string | null>(null);
  let prometheusUrl = $state<string | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let lastRefresh = $state<Date | null>(null);

  // Key Prometheus queries
  const QUERIES: Array<{ label: string; query: string; unit: string }> = [
    { label: 'Request Rate', query: 'sum(rate(http_requests_total[1m]))', unit: 'req/s' },
    { label: 'p50 Latency', query: 'histogram_quantile(0.50, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))', unit: 's' },
    { label: 'p95 Latency', query: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))', unit: 's' },
    { label: 'p99 Latency', query: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[1m])) by (le))', unit: 's' },
    { label: 'Error Rate (5xx)', query: 'sum(rate(http_requests_total{status=~"5.."}[1m]))', unit: 'req/s' },
    { label: 'Error Rate (4xx)', query: 'sum(rate(http_requests_total{status=~"4.."}[1m]))', unit: 'req/s' },
  ];

  async function queryPrometheus(url: string, query: string): Promise<string> {
    const params = new URLSearchParams({ query });
    const res = await fetch(`${url}/api/v1/query?${params}`, { credentials: 'omit' });
    if (!res.ok) throw new Error(`Prometheus ${res.status}`);
    const data = await res.json();
    const result = data?.data?.result?.[0];
    if (!result) return 'no data';
    const val = parseFloat(result.value?.[1] ?? 'NaN');
    if (isNaN(val)) return 'no data';
    return val.toFixed(4);
  }

  async function fetchMetrics() {
    if (!prometheusUrl) return;
    metricsLoading = true;
    try {
      const results = await Promise.allSettled(
        QUERIES.map(async (q) => {
          const value = await queryPrometheus(prometheusUrl!, q.query);
          return { label: q.label, value, unit: q.unit, query: q.query } satisfies MetricResult;
        })
      );
      metrics = results.map((r, i) =>
        r.status === 'fulfilled'
          ? r.value
          : { label: QUERIES[i].label, value: 'error', unit: QUERIES[i].unit, query: QUERIES[i].query }
      );
      lastRefresh = new Date();
      metricsError = null;
    } catch (e) {
      metricsError = e instanceof Error ? e.message : 'Failed to fetch metrics';
    } finally {
      metricsLoading = false;
    }
  }

  onMount(() => {
    // Wait for admin config to be ready
    const check = setInterval(() => {
      if (!admin.loading) {
        clearInterval(check);
        prometheusUrl = admin.config?.prometheus ?? null;
        if (prometheusUrl) {
          fetchMetrics();
          refreshInterval = setInterval(fetchMetrics, 30_000);
        } else {
          metricsLoading = false;
          metricsError = null;
        }
      }
    }, 100);
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  function metricColor(label: string, value: string): string {
    if (value === 'error' || value === 'no data') return 'text-base-content/30';
    const num = parseFloat(value);
    if (isNaN(num)) return 'text-base-content/30';
    if (label.includes('Error')) return num > 0 ? 'text-error' : 'text-success';
    return 'text-primary';
  }
</script>

<svelte:head>
  <title>Admin Metrics — llmtxt.my</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-xl font-bold tracking-tight">Metrics</h1>
      <p class="font-display text-xs text-base-content/40 mt-1">
        Prometheus instant query snapshot — refreshes every 30s
        {#if lastRefresh}
          · last at {lastRefresh.toLocaleTimeString()}
        {/if}
      </p>
    </div>
    <div class="flex gap-2">
      {#if prometheusUrl}
        <a
          href="{prometheusUrl}/graph"
          target="_blank"
          rel="noopener noreferrer"
          class="btn btn-ghost btn-xs font-display"
        >
          Open Prometheus
        </a>
      {/if}
      <button
        class="btn btn-ghost btn-xs font-display"
        onclick={fetchMetrics}
        disabled={metricsLoading || !prometheusUrl}
      >
        {metricsLoading ? 'Loading...' : 'Refresh'}
      </button>
    </div>
  </div>

  {#if !prometheusUrl}
    <div class="rounded-lg border border-base-content/10 p-8 text-center">
      <div class="text-3xl mb-3">∿</div>
      <p class="font-display text-sm text-base-content/50 mb-1">Prometheus not configured</p>
      <p class="font-display text-xs text-base-content/30">Set <code class="text-primary">PROMETHEUS_PUBLIC_URL</code> on the backend service to enable metrics.</p>
    </div>
  {:else}
    <!-- Key metric tiles -->
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
      {#each metrics as m (m.label)}
        <div class="rounded-lg border border-base-content/10 p-4">
          <div class="font-display text-xs text-base-content/40 mb-2">{m.label}</div>
          <div class="font-display text-2xl font-bold {metricColor(m.label, m.value)}">
            {m.value}
          </div>
          <div class="font-display text-xs text-base-content/25 mt-1">{m.unit}</div>
        </div>
      {/each}
    </div>

    <!-- Embed Prometheus expression browser -->
    <div class="mb-4">
      <h2 class="font-display text-sm font-semibold text-base-content/60 mb-3">Expression Browser</h2>
      <div class="rounded-lg border border-base-content/10 overflow-hidden" style="height: 600px;">
        <iframe
          src="{prometheusUrl}/graph"
          title="Prometheus Expression Browser"
          class="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      </div>
      <p class="font-display text-xs text-base-content/25 mt-2">
        Prometheus UI embedded. If the iframe is blocked, <a href="{prometheusUrl}/graph" target="_blank" rel="noopener noreferrer" class="text-primary">open it directly</a>.
      </p>
    </div>
  {/if}
</div>
