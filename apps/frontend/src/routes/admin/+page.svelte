<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  const admin = getAdmin();
  const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.llmtxt.my';

  interface ServiceHealth {
    name: string;
    status: 'healthy' | 'degraded' | 'unknown';
    publicUrl: string | null;
    lastChecked: string;
  }

  let services = $state<ServiceHealth[]>([]);
  let servicesLoading = $state(true);
  let servicesError = $state<string | null>(null);
  let lastRefresh = $state<Date | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchServices() {
    try {
      const res = await fetch(`${API_BASE}/v1/admin/services`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      services = data.services ?? [];
      lastRefresh = new Date();
      servicesError = null;
    } catch (e) {
      servicesError = e instanceof Error ? e.message : 'Failed to fetch services';
    } finally {
      servicesLoading = false;
    }
  }

  onMount(() => {
    fetchServices();
    refreshInterval = setInterval(fetchServices, 30_000);
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  function statusColor(status: ServiceHealth['status']): string {
    switch (status) {
      case 'healthy': return 'text-success';
      case 'degraded': return 'text-error';
      default: return 'text-base-content/30';
    }
  }

  function statusDot(status: ServiceHealth['status']): string {
    switch (status) {
      case 'healthy': return 'bg-success';
      case 'degraded': return 'bg-error animate-pulse';
      default: return 'bg-base-content/20';
    }
  }

  function formatChecked(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  }

  let healthySvc = $derived(services.filter(s => s.status === 'healthy').length);
  let degradedSvc = $derived(services.filter(s => s.status === 'degraded').length);
  let unknownSvc = $derived(services.filter(s => s.status === 'unknown').length);
</script>

<svelte:head>
  <title>Admin Overview — llmtxt.my</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-xl font-bold tracking-tight">Overview</h1>
      <p class="font-display text-xs text-base-content/40 mt-1">
        Railway service health — refreshes every 30s
        {#if lastRefresh}
          · last at {formatChecked(lastRefresh.toISOString())}
        {/if}
      </p>
    </div>
    <button
      class="btn btn-ghost btn-xs font-display"
      onclick={fetchServices}
      disabled={servicesLoading}
    >
      {servicesLoading ? 'Loading...' : 'Refresh'}
    </button>
  </div>

  <!-- Summary counters -->
  <div class="grid grid-cols-3 gap-4 mb-6">
    <div class="rounded-lg border border-base-content/10 p-4 text-center">
      <div class="text-2xl font-display font-bold text-success">{healthySvc}</div>
      <div class="font-display text-xs text-base-content/40 mt-1">Healthy</div>
    </div>
    <div class="rounded-lg border border-base-content/10 p-4 text-center">
      <div class="text-2xl font-display font-bold text-error">{degradedSvc}</div>
      <div class="font-display text-xs text-base-content/40 mt-1">Degraded</div>
    </div>
    <div class="rounded-lg border border-base-content/10 p-4 text-center">
      <div class="text-2xl font-display font-bold text-base-content/30">{unknownSvc}</div>
      <div class="font-display text-xs text-base-content/40 mt-1">Unknown</div>
    </div>
  </div>

  <!-- Service health grid -->
  {#if servicesLoading && services.length === 0}
    <div class="text-center py-12">
      <span class="loading loading-spinner loading-md text-primary"></span>
    </div>
  {:else if servicesError}
    <div class="alert alert-error text-sm font-display">{servicesError}</div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {#each services as svc (svc.name)}
        <div class="rounded-lg border border-base-content/10 p-4 flex items-start gap-3">
          <div class="mt-1 w-2.5 h-2.5 rounded-full flex-shrink-0 {statusDot(svc.status)}"></div>
          <div class="min-w-0 flex-1">
            <div class="font-display text-sm font-semibold text-base-content/80 truncate">{svc.name}</div>
            <div class="font-display text-xs {statusColor(svc.status)} mt-0.5">{svc.status}</div>
            {#if svc.publicUrl}
              <a
                href={svc.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="font-display text-xs text-primary/60 hover:text-primary truncate block mt-1"
              >
                {svc.publicUrl}
              </a>
            {/if}
            <div class="font-display text-xs text-base-content/25 mt-1">
              checked {formatChecked(svc.lastChecked)}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Observability tool quick links -->
  {#if admin.config}
    <div class="mt-8">
      <h2 class="font-display text-sm font-semibold text-base-content/60 mb-3 uppercase tracking-wider">Observability Tools</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {#if admin.config.grafana}
          <a href="/admin/dashboards" class="rounded-lg border border-base-content/10 p-3 text-center hover:border-primary/30 transition-colors">
            <div class="font-display text-xs font-semibold text-orange-400 mb-1">Grafana</div>
            <div class="font-display text-xs text-base-content/40">Dashboards</div>
          </a>
        {/if}
        <a href="/admin/metrics" class="rounded-lg border border-base-content/10 p-3 text-center hover:border-primary/30 transition-colors">
          <div class="font-display text-xs font-semibold text-blue-400 mb-1">Prometheus</div>
          <div class="font-display text-xs text-base-content/40">Metrics</div>
        </a>
        <a href="/admin/logs" class="rounded-lg border border-base-content/10 p-3 text-center hover:border-primary/30 transition-colors">
          <div class="font-display text-xs font-semibold text-yellow-400 mb-1">Loki</div>
          <div class="font-display text-xs text-base-content/40">Logs</div>
        </a>
        <a href="/admin/traces" class="rounded-lg border border-base-content/10 p-3 text-center hover:border-primary/30 transition-colors">
          <div class="font-display text-xs font-semibold text-purple-400 mb-1">Tempo</div>
          <div class="font-display text-xs text-base-content/40">Traces</div>
        </a>
        {#if admin.config.glitchtip}
          <a href="/admin/errors" class="rounded-lg border border-base-content/10 p-3 text-center hover:border-primary/30 transition-colors">
            <div class="font-display text-xs font-semibold text-red-400 mb-1">GlitchTip</div>
            <div class="font-display text-xs text-base-content/40">Errors</div>
          </a>
        {/if}
      </div>
    </div>
  {/if}
</div>
