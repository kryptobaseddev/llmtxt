<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  const admin = getAdmin();
  const API_BASE = import.meta.env.VITE_API_BASE || 'https://api.llmtxt.my';

  interface GlitchTipIssue {
    id: string;
    title: string;
    culprit: string | null;
    level: string;
    status: string;
    count: number;
    userCount: number;
    firstSeen: string;
    lastSeen: string;
    permalink: string | null;
  }

  let glitchtipUrl = $state<string | null>(null);
  let useProxy = $state(false);
  let ready = $state(false);
  let issues = $state<GlitchTipIssue[]>([]);
  let issuesLoading = $state(false);
  let issuesError = $state<string | null>(null);
  let lastRefresh = $state<Date | null>(null);
  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchIssues() {
    if (!useProxy) return;
    issuesLoading = true;
    issuesError = null;
    try {
      const res = await fetch(`${API_BASE}/v1/admin/errors/issues?limit=50`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      issues = (data.issues ?? []).map((i: Record<string, unknown>) => ({
        id: String(i.id ?? ''),
        title: String(i.title ?? i.culprit ?? 'Unknown error'),
        culprit: i.culprit ? String(i.culprit) : null,
        level: String(i.level ?? 'error'),
        status: String(i.status ?? 'unresolved'),
        count: Number(i.count ?? 0),
        userCount: Number(i.userCount ?? i.user_count ?? 0),
        firstSeen: String(i.firstSeen ?? i.first_seen ?? ''),
        lastSeen: String(i.lastSeen ?? i.last_seen ?? ''),
        permalink: i.permalink ? String(i.permalink) : null,
      }));
      lastRefresh = new Date();
    } catch (e) {
      issuesError = e instanceof Error ? e.message : 'Failed to fetch issues';
    } finally {
      issuesLoading = false;
    }
  }

  onMount(() => {
    const check = setInterval(() => {
      if (!admin.loading) {
        clearInterval(check);
        glitchtipUrl = admin.config?.glitchtip ?? null;
        useProxy = admin.config?.glitchtipProxy ?? false;
        ready = true;
        if (useProxy) {
          fetchIssues();
          refreshInterval = setInterval(fetchIssues, 60_000);
        }
      }
    }, 100);
  });

  onDestroy(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  function levelColor(level: string): string {
    switch (level.toLowerCase()) {
      case 'fatal': return 'text-error font-bold';
      case 'error': return 'text-error';
      case 'warning': return 'text-warning';
      case 'info': return 'text-info';
      default: return 'text-base-content/50';
    }
  }

  function levelBadge(level: string): string {
    switch (level.toLowerCase()) {
      case 'fatal': return 'badge-error';
      case 'error': return 'badge-error badge-outline';
      case 'warning': return 'badge-warning badge-outline';
      case 'info': return 'badge-info badge-outline';
      default: return 'badge-ghost';
    }
  }

  function formatDate(iso: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return iso;
    }
  }
</script>

<svelte:head>
  <title>Admin Errors — llmtxt.my</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-xl font-bold tracking-tight">Errors</h1>
      <p class="font-display text-xs text-base-content/40 mt-1">
        GlitchTip error tracking — unresolved issues
        {#if lastRefresh}
          · last at {lastRefresh.toLocaleTimeString()}
        {/if}
      </p>
    </div>
    <div class="flex gap-2">
      {#if glitchtipUrl}
        <a href={glitchtipUrl} target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs font-display">
          Open GlitchTip
        </a>
      {/if}
      {#if useProxy}
        <button
          class="btn btn-ghost btn-xs font-display"
          onclick={fetchIssues}
          disabled={issuesLoading}
        >
          {issuesLoading ? 'Loading...' : 'Refresh'}
        </button>
      {/if}
    </div>
  </div>

  {#if !ready}
    <div class="text-center py-12">
      <span class="loading loading-spinner loading-sm text-primary"></span>
    </div>
  {:else if !glitchtipUrl && !useProxy}
    <div class="rounded-lg border border-base-content/10 p-8 text-center">
      <div class="text-3xl mb-3">!</div>
      <p class="font-display text-sm text-base-content/50 mb-1">GlitchTip not configured</p>
      <p class="font-display text-xs text-base-content/30">Set <code class="text-primary">GLITCHTIP_PUBLIC_URL</code> on the backend service to enable error tracking.</p>
    </div>
  {:else if useProxy}
    <!-- Native table view via GlitchTip REST API proxy -->
    {#if issuesLoading && issues.length === 0}
      <div class="text-center py-12">
        <span class="loading loading-spinner loading-md text-primary"></span>
      </div>
    {:else if issuesError}
      <div class="alert alert-error text-sm font-display mb-4">
        <span>{issuesError}</span>
        {#if glitchtipUrl}
          <a href={glitchtipUrl} target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-ghost">Open GlitchTip directly</a>
        {/if}
      </div>
    {:else if issues.length === 0}
      <div class="rounded-lg border border-base-content/10 p-8 text-center">
        <div class="text-3xl mb-3">✓</div>
        <p class="font-display text-sm text-base-content/50">No unresolved issues</p>
      </div>
    {:else}
      <div class="overflow-x-auto rounded-lg border border-base-content/10">
        <table class="table table-sm w-full font-display">
          <thead>
            <tr class="text-xs text-base-content/40 border-base-content/10">
              <th class="font-display">Level</th>
              <th class="font-display">Error</th>
              <th class="font-display">Count</th>
              <th class="font-display">First Seen</th>
              <th class="font-display">Last Seen</th>
              <th class="font-display"></th>
            </tr>
          </thead>
          <tbody>
            {#each issues as issue (issue.id)}
              <tr class="hover border-base-content/5">
                <td>
                  <span class="badge badge-xs {levelBadge(issue.level)}">{issue.level}</span>
                </td>
                <td class="max-w-xs">
                  <div class="font-semibold text-xs {levelColor(issue.level)} truncate" title={issue.title}>
                    {issue.title}
                  </div>
                  {#if issue.culprit}
                    <div class="text-xs text-base-content/30 truncate">{issue.culprit}</div>
                  {/if}
                </td>
                <td class="text-xs text-base-content/60">{issue.count}</td>
                <td class="text-xs text-base-content/40">{formatDate(issue.firstSeen)}</td>
                <td class="text-xs text-base-content/40">{formatDate(issue.lastSeen)}</td>
                <td>
                  {#if issue.permalink || glitchtipUrl}
                    <a
                      href={issue.permalink ?? `${glitchtipUrl}/issues/${issue.id}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-xs text-primary/60 hover:text-primary"
                    >
                      View
                    </a>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="font-display text-xs text-base-content/25 mt-2">
        Showing {issues.length} issues via GlitchTip API.
        <a href={glitchtipUrl ?? '#'} target="_blank" rel="noopener noreferrer" class="text-primary">Open GlitchTip</a> for full management.
      </p>
    {/if}
  {:else}
    <!-- Fallback: direct link (iframe blocked by X-Frame-Options: DENY) -->
    <div class="rounded-lg border border-base-content/10 p-8 text-center">
      <div class="text-3xl mb-3">!</div>
      <p class="font-display text-sm text-base-content/50 mb-2">GlitchTip API proxy not available</p>
      <p class="font-display text-xs text-base-content/30 mb-4">
        Set <code class="text-primary">GLITCHTIP_API_TOKEN</code> on the backend to enable native issue display.
      </p>
      {#if glitchtipUrl}
        <a href={glitchtipUrl} target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-primary font-display">
          Open GlitchTip
        </a>
      {/if}
    </div>
  {/if}
</div>
