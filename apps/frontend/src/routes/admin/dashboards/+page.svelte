<script lang="ts">
  import { onMount } from 'svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  const admin = getAdmin();

  let grafanaUrl = $state<string | null>(null);
  let ready = $state(false);

  // Curated dashboard list with UID slugs matching provisioned JSON files
  const DASHBOARDS = [
    {
      uid: 'llmtxt-backend-overview',
      title: 'Backend Overview',
      description: 'HTTP req/s, latency p50/p95/p99, error rate, 4xx/5xx breakdown',
      color: 'text-blue-400',
    },
    {
      uid: 'llmtxt-crdt-activity',
      title: 'CRDT Activity',
      description: 'CRDT ops/sec per document, WebSocket connections, advisory lock waits',
      color: 'text-purple-400',
    },
    {
      uid: 'llmtxt-event-log',
      title: 'Event Log Flow',
      description: 'Events/sec, hash chain lag, compaction stats',
      color: 'text-yellow-400',
    },
    {
      uid: 'llmtxt-multi-agent',
      title: 'Multi-Agent',
      description: 'Presence count, lease contention, A2A message rate, BFT quorum progress',
      color: 'text-green-400',
    },
    {
      uid: 'llmtxt-database',
      title: 'Database + Redis',
      description: 'PG connection pool, query latency, Redis memory, stream depth',
      color: 'text-orange-400',
    },
    {
      uid: 'llmtxt-infrastructure',
      title: 'Infrastructure',
      description: 'Railway service uptime, container restarts, build success rate',
      color: 'text-red-400',
    },
    {
      uid: 'llmtxt-agent-identity-usage',
      title: 'Agent Identity Usage',
      description: 'Existing agent-identity-usage dashboard',
      color: 'text-cyan-400',
    },
  ];

  let selectedDashboard = $state<string | null>(null);
  let embedSrc = $derived.by(() => {
    if (!grafanaUrl || !selectedDashboard) return '';
    return `${grafanaUrl}/d/${selectedDashboard}?kiosk=tv&theme=dark&orgId=1`;
  });

  onMount(() => {
    const check = setInterval(() => {
      if (!admin.loading) {
        clearInterval(check);
        grafanaUrl = admin.config?.grafana ?? null;
        ready = true;
        // Default to backend overview
        if (grafanaUrl) selectedDashboard = 'llmtxt-backend-overview';
      }
    }, 100);
  });
</script>

<svelte:head>
  <title>Admin Dashboards — llmtxt.my</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-xl font-bold tracking-tight">Dashboards</h1>
      <p class="font-display text-xs text-base-content/40 mt-1">Grafana dashboards embedded in kiosk mode</p>
    </div>
    {#if grafanaUrl && selectedDashboard}
      <a
        href="{grafanaUrl}/d/{selectedDashboard}"
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
      <div class="text-3xl mb-3">▦</div>
      <p class="font-display text-sm text-base-content/50 mb-1">Grafana not configured</p>
      <p class="font-display text-xs text-base-content/30">Set <code class="text-primary">GRAFANA_PUBLIC_URL</code> on the backend service to enable dashboard viewing.</p>
    </div>
  {:else}
    <div class="flex gap-4">
      <!-- Dashboard list sidebar -->
      <div class="w-56 flex-shrink-0">
        <div class="font-display text-xs text-base-content/40 uppercase tracking-wider mb-2">Select Dashboard</div>
        <div class="flex flex-col gap-1">
          {#each DASHBOARDS as dash (dash.uid)}
            <button
              class="text-left px-3 py-2 rounded font-display text-xs transition-colors
                {selectedDashboard === dash.uid
                  ? 'bg-primary/10 border border-primary/30 text-base-content/90'
                  : 'border border-transparent text-base-content/50 hover:text-base-content/80 hover:bg-base-content/5'}"
              onclick={() => { selectedDashboard = dash.uid; }}
            >
              <div class="font-semibold {dash.color}">{dash.title}</div>
              <div class="text-base-content/30 text-xs mt-0.5 leading-tight">{dash.description}</div>
            </button>
          {/each}
        </div>
        <div class="mt-4 pt-4 border-t border-base-content/10">
          <a
            href="{grafanaUrl}/dashboards"
            target="_blank"
            rel="noopener noreferrer"
            class="font-display text-xs text-primary/60 hover:text-primary"
          >
            Browse all dashboards →
          </a>
        </div>
      </div>

      <!-- Iframe panel -->
      <div class="flex-1 min-w-0">
        {#if embedSrc}
          <div class="rounded-lg border border-base-content/10 overflow-hidden" style="height: 700px;">
            <iframe
              src={embedSrc}
              title="Grafana Dashboard"
              class="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            ></iframe>
          </div>
          <p class="font-display text-xs text-base-content/25 mt-2">
            Grafana kiosk mode embedded.
            If blocked by CSP/X-Frame-Options, <a href="{grafanaUrl}/d/{selectedDashboard}" target="_blank" rel="noopener noreferrer" class="text-primary">open it directly</a>.
          </p>
        {:else}
          <div class="rounded-lg border border-base-content/10 flex items-center justify-center" style="height: 700px;">
            <p class="font-display text-sm text-base-content/30">Select a dashboard from the list</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
