<script lang="ts">
  import { goto } from '$app/navigation';
  import { getAuth } from '$lib/stores/auth.svelte';
  import { onMount } from 'svelte';

  const auth = getAuth();

  onMount(() => {
    if (!auth.isAuthenticated || auth.isAnonymous) {
      goto('/auth?mode=signup');
    }
  });
</script>

<svelte:head>
  <title>My Txt - llmtxt.my</title>
</svelte:head>

<div class="animate-fade-in container mx-auto px-4 py-8">
  {#if auth.isAuthenticated && !auth.isAnonymous}
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="font-display text-2xl font-bold tracking-tight">My Txt</h1>
        <p class="text-sm text-base-content/40 font-display mt-1">{auth.session.user?.email}</p>
      </div>
      <a href="/" class="btn btn-primary btn-sm font-display">New document</a>
    </div>

    <div class="rounded-lg border border-base-content/10 p-8 text-center">
      <p class="text-base-content/40 font-display text-sm">Your documents will appear here.</p>
      <p class="text-base-content/25 font-display text-xs mt-2">Create and share documents from the editor to see them listed.</p>
    </div>
  {:else}
    <div class="text-center py-16">
      <p class="text-base-content/40 font-display">Redirecting to sign in...</p>
    </div>
  {/if}
</div>
