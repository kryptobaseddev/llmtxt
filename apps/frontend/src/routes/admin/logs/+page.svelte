<script lang="ts">
  import { onMount } from 'svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  const admin = getAdmin();

  let grafanaUrl = $state<string | null>(null);
  let ready = $state(false);

  // Loki Explore URL with default query for llmtxt-api service
  function lokiExploreUrl(baseUrl: string): string {
    const lokiQuery = encodeURIComponent(JSON.stringify({
      datasource: 'loki',
      queries: [{ refId: 'A', expr: '{service_name="llmtxt-api"}' }],
      range: { from: 'now-1h', to: 'now' },
    }));
    return `${baseUrl}/explore?schemaVersion=1&panes={"a":{"datasource":"loki","queries":[{"refId":"A","expr":"{service_name=\\"llmtxt-api\\"}"}],"range":{"from":"now-1h","to":"now"}}}&orgId=1`;
  }

  onMount(() => {
    const check = setInterval(() => {
      if (!admin.loading) {
        clearInterval(check);
        grafanaUrl = admin.config?.grafana ?? null;
        ready = true;
      }
    }, 100);
  });

  // Service filter options
  const SERVICE_LABELS = [
    'llmtxt-api',
    'llmtxt-frontend',
    'llmtxt-docs',
    'grafana',
    'prometheus',
    'loki',
    'otel-collector',
    'glitchtip',
  ];
  let selectedService = $state('llmtxt-api');
  let selectedLevel = $state('');
  let timeRange = $state('now-1h');

  function buildExploreUrl(): string {
    if (!grafanaUrl) return '#';
    const levelFilter = selectedLevel ? ` | json | level=\`${selectedLevel}\`` : '';
    const expr = `{service_name="${selectedService}"}${levelFilter}`;
    return `${grafanaUrl}/explore?schemaVersion=1&panes={"a":{"datasource":"loki","queries":[{"refId":"A","expr":${JSON.stringify(expr)}}],"range":{"from":"${timeRange}","to":"now"}}}&orgId=1`;
  }
</script>

<svelte:head>
  <title>Admin Logs — llmtxt.my</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-xl font-bold tracking-tight">Logs</h1>
      <p class="font-display text-xs text-base-content/40 mt-1">Loki log explorer via Grafana Explore</p>
    </div>
    {#if grafanaUrl}
      <a
        href={buildExploreUrl()}
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-ghost btn-xs font-display"
      >
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
      <div class="text-3xl mb-3">≡</div>
      <p class="font-display text-sm text-base-content/50 mb-1">Grafana not configured</p>
      <p class="font-display text-xs text-base-content/30">Set <code class="text-primary">GRAFANA_PUBLIC_URL</code> on the backend service to enable log viewing.</p>
    </div>
  {:else}
    <!-- Filter bar -->
    <div class="flex flex-wrap gap-3 mb-4">
      <select
        class="select select-bordered select-xs font-display"
        bind:value={selectedService}
      >
        {#each SERVICE_LABELS as svc (svc)}
          <option value={svc}>{svc}</option>
        {/each}
      </select>

      <select class="select select-bordered select-xs font-display" bind:value={selectedLevel}>
        <option value="">All levels</option>
        <option value="error">error</option>
        <option value="warn">warn</option>
        <option value="info">info</option>
        <option value="debug">debug</option>
      </select>

      <select class="select select-bordered select-xs font-display" bind:value={timeRange}>
        <option value="now-15m">Last 15m</option>
        <option value="now-1h">Last 1h</option>
        <option value="now-6h">Last 6h</option>
        <option value="now-24h">Last 24h</option>
        <option value="now-7d">Last 7d</option>
      </select>

      <a
        href={buildExploreUrl()}
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-primary btn-xs font-display"
      >
        Open logs in Grafana
      </a>
    </div>

    <!-- Grafana Explore iframe -->
    <div class="rounded-lg border border-base-content/10 overflow-hidden" style="height: 700px;">
      <iframe
        src={buildExploreUrl()}
        title="Loki Log Explorer"
        class="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
    </div>
    <p class="font-display text-xs text-base-content/25 mt-2">
      Grafana Explore embedded with Loki datasource.
      If the iframe is blocked by CSP, <a href={buildExploreUrl()} target="_blank" rel="noopener noreferrer" class="text-primary">open it directly</a>.
    </p>
  {/if}
</div>
