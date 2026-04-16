<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { getAuth } from '$lib/stores/auth.svelte';
  import { getAdmin } from '$lib/stores/admin.svelte';

  let { children } = $props();

  const auth = getAuth();
  const admin = getAdmin();

  const navItems = [
    { href: '/admin', label: 'Overview', icon: '◈' },
    { href: '/admin/metrics', label: 'Metrics', icon: '∿' },
    { href: '/admin/logs', label: 'Logs', icon: '≡' },
    { href: '/admin/traces', label: 'Traces', icon: '⌥' },
    { href: '/admin/errors', label: 'Errors', icon: '⚑' },
    { href: '/admin/dashboards', label: 'Dashboards', icon: '▦' },
  ];

  function isActive(href: string): boolean {
    if (href === '/admin') return page.url.pathname === '/admin';
    return page.url.pathname.startsWith(href);
  }

  onMount(async () => {
    // Ensure base auth is initialised first
    if (!auth.isAuthenticated) {
      await auth.init();
    }
    if (!auth.isAuthenticated || auth.isAnonymous) {
      goto('/auth?mode=signin&next=/admin');
      return;
    }
    await admin.init();
    if (!admin.isAdmin) {
      goto('/');
    }
  });
</script>

<div class="min-h-screen bg-base-100 flex flex-col" data-theme="night">
  <!-- Admin header -->
  <header class="border-b border-base-content/10 flex items-center justify-between px-6 py-3">
    <div class="flex items-center gap-4">
      <a href="/" class="font-display text-lg font-bold tracking-tight">
        <span class="text-primary">LLM</span><span class="text-base-content/70">txt</span>
      </a>
      <span class="text-base-content/20 font-display text-sm">/</span>
      <span class="font-display text-sm text-warning font-semibold tracking-wide">ADMIN</span>
    </div>
    <div class="flex items-center gap-3">
      {#if admin.user}
        <span class="font-display text-xs text-base-content/40">{admin.user.email}</span>
      {/if}
      <a href="/dashboard" class="btn btn-ghost btn-xs font-display text-base-content/50">My Txt</a>
      <a href="/" class="btn btn-ghost btn-xs font-display text-base-content/50">Home</a>
    </div>
  </header>

  <div class="flex flex-1 min-h-0">
    <!-- Sidebar nav -->
    <nav class="w-48 border-r border-base-content/10 flex flex-col py-4 gap-1 px-2">
      {#each navItems as item (item.href)}
        <a
          href={item.href}
          class="flex items-center gap-2 px-3 py-2 rounded font-display text-xs tracking-wide transition-colors
            {isActive(item.href)
              ? 'bg-primary/10 text-primary font-semibold'
              : 'text-base-content/50 hover:text-base-content/80 hover:bg-base-content/5'}"
        >
          <span class="text-sm w-4 text-center">{item.icon}</span>
          {item.label}
        </a>
      {/each}
    </nav>

    <!-- Main content area -->
    <main class="flex-1 min-w-0 overflow-auto">
      {#if admin.loading}
        <div class="flex items-center justify-center h-64">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span class="font-display text-sm text-base-content/40 ml-3">Verifying admin access...</span>
        </div>
      {:else if admin.error}
        <div class="flex items-center justify-center h-64">
          <div class="text-center">
            <div class="text-4xl mb-4">⚑</div>
            <p class="font-display text-sm text-error mb-2">{admin.error}</p>
            <p class="font-display text-xs text-base-content/40">Admin access is restricted to configured admin emails.</p>
            <a href="/" class="btn btn-sm btn-ghost font-display mt-4">Go home</a>
          </div>
        </div>
      {:else if admin.isAdmin}
        {@render children()}
      {/if}
    </main>
  </div>
</div>
