<script lang="ts">
  import { onMount } from 'svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  const admin = getAdmin();

  let glitchtipUrl = $state<string | null>(null);
  let ready = $state(false);

  onMount(() => {
    const check = setInterval(() => {
      if (!admin.loading) {
        clearInterval(check);
        glitchtipUrl = admin.config?.glitchtip ?? null;
        ready = true;
      }
    }, 100);
  });
</script>

<svelte:head>
  <title>Admin Errors — llmtxt.my</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="font-display text-xl font-bold tracking-tight">Errors</h1>
      <p class="font-display text-xs text-base-content/40 mt-1">GlitchTip error tracking — unresolved issues</p>
    </div>
    {#if glitchtipUrl}
      <a href={glitchtipUrl} target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-xs font-display">
        Open GlitchTip
      </a>
    {/if}
  </div>

  {#if !ready}
    <div class="text-center py-12">
      <span class="loading loading-spinner loading-sm text-primary"></span>
    </div>
  {:else if !glitchtipUrl}
    <div class="rounded-lg border border-base-content/10 p-8 text-center">
      <div class="text-3xl mb-3">⚑</div>
      <p class="font-display text-sm text-base-content/50 mb-1">GlitchTip not configured</p>
      <p class="font-display text-xs text-base-content/30">Set <code class="text-primary">GLITCHTIP_PUBLIC_URL</code> on the backend service to enable error tracking.</p>
    </div>
  {:else}
    <!-- GlitchTip embed -->
    <div class="rounded-lg border border-base-content/10 overflow-hidden" style="height: 750px;">
      <iframe
        src={glitchtipUrl}
        title="GlitchTip Error Tracker"
        class="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
      ></iframe>
    </div>
    <p class="font-display text-xs text-base-content/25 mt-2">
      GlitchTip embedded. If the iframe is blocked,
      <a href={glitchtipUrl} target="_blank" rel="noopener noreferrer" class="text-primary">open it directly</a>.
    </p>
  {/if}
</div>
