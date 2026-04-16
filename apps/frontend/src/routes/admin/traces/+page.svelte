<script lang="ts">
  import { onMount } from 'svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  const admin = getAdmin();

  let grafanaUrl = $state<string | null>(null);
  let ready = $state(false);
  let traceId = $state('');
  let selectedService = $state('');
  let timeRange = $state('now-1h');

  const SERVICES = [
    '',
    'llmtxt-api',
    'llmtxt-frontend',
    'llmtxt-docs',
  ];

  onMount(() => {
    const check = setInterval(() => {
      if (!admin.loading) {
        clearInterval(check);
        grafanaUrl = admin.config?.grafana ?? null;
        ready = true;
      }
    }, 100);
  });

  function buildTempoUrl(): string {
    if (!grafanaUrl) return '#';
    if (traceId.trim()) {
      // Direct trace lookup
      return `${grafanaUrl}/explore?schemaVersion=1&panes={"a":{"datasource":"tempo","queries":[{"refId":"A","queryType":"traceql","query":"${encodeURIComponent(traceId.trim())}"}],"range":{"from":"${timeRange}","to":"now"}}}&orgId=1`;
    }
    // Service-based search
    const serviceFilter = selectedService
      ? `{.service.name="${selectedService}"}`
      : '{}';
    return `${grafanaUrl}/explore?schemaVersion=1&panes={"a":{"datasource":"tempo","queries":[{"refId":"A","queryType":"traceql","query":"${encodeURIComponent(serviceFilter)}"}],"range":{"from":"${timeRange}","to":"now"}}}&orgId=1`;
  }

  function iframeUrl(): string {
    if (!grafanaUrl) return '';
    // Default Tempo explore — no specific query
    const serviceFilter = selectedService
      ? `{.service.name="${selectedService}"}`
      : '{}';
    return `${grafanaUrl}/explore?schemaVersion=1&panes={"a":{"datasource":"tempo","queries":[{"refId":"A","queryType":"traceql","query":"${encodeURIComponent(serviceFilter)}"}],"range":{"from":"${timeRange}","to":"now"}}}&orgId=1`;
  }
</script>

<svelte:head>
  <title>Admin Traces — llmtxt.my</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-xl font-bold tracking-tight">Traces</h1>
      <p class="font-display text-xs text-base-content/40 mt-1">Tempo distributed traces via Grafana Explore</p>
    </div>
    {#if grafanaUrl}
      <a href={buildTempoUrl()} target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs font-display">
        Open in Grafana
      </a>
    {/if}
  </div>

  {#if !ready}
    <div class="text-center py-12">
      <span class="loading loading-spinner loading-sm text-primary"></span>
    </div>
  {:else if !grafanaUrl}
    <div class="rounded-lg border border-base-content/10 p-8 text-center">
      <div class="text-3xl mb-3">⌥</div>
      <p class="font-display text-sm text-base-content/50 mb-1">Grafana not configured</p>
      <p class="font-display text-xs text-base-content/30">Set <code class="text-primary">GRAFANA_PUBLIC_URL</code> on the backend service to enable trace viewing.</p>
    </div>
  {:else}
    <!-- Search controls -->
    <div class="flex flex-wrap gap-3 mb-4">
      <input
        type="text"
        class="input input-bordered input-xs font-display font-mono w-72"
        placeholder="Trace ID (e.g. 4bf92f3577b34da6)"
        bind:value={traceId}
      />
      <select class="select select-bordered select-xs font-display" bind:value={selectedService}>
        {#each SERVICES as svc (svc)}
          <option value={svc}>{svc || 'All services'}</option>
        {/each}
      </select>
      <select class="select select-bordered select-xs font-display" bind:value={timeRange}>
        <option value="now-15m">Last 15m</option>
        <option value="now-1h">Last 1h</option>
        <option value="now-6h">Last 6h</option>
        <option value="now-24h">Last 24h</option>
      </select>
      <a href={buildTempoUrl()} target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-xs font-display">
        Search traces
      </a>
    </div>

    <!-- Tempo embed via Grafana Explore -->
    <div class="rounded-lg border border-base-content/10 overflow-hidden" style="height: 700px;">
      <iframe
        src={iframeUrl()}
        title="Tempo Trace Explorer"
        class="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
    </div>
    <p class="font-display text-xs text-base-content/25 mt-2">
      Grafana Explore with Tempo datasource embedded.
      If blocked, <a href={buildTempoUrl()} target="_blank" rel="noopener noreferrer" class="text-primary">open it directly</a>.
    </p>
  {/if}
</div>
