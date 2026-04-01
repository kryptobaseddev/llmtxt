<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { getAuth } from '$lib/stores/auth.svelte';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import FormatBadge from '$lib/components/FormatBadge.svelte';

  const auth = getAuth();

  let docs = $state<any[]>([]);
  let loading = $state(true);
  let error = $state('');
  let searchQuery = $state('');
  let sortField = $state<'slug' | 'createdAt' | 'tokenCount' | 'accessCount'>('createdAt');
  let sortAsc = $state(false);

  let filteredDocs = $derived(() => {
    let result = docs;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d =>
        d.slug.toLowerCase().includes(q) ||
        (d.format || '').toLowerCase().includes(q) ||
        (d.state || '').toLowerCase().includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      if (typeof av === 'string') return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortAsc ? av - bv : bv - av;
    });
    return result;
  });

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      sortAsc = !sortAsc;
    } else {
      sortField = field;
      sortAsc = false;
    }
  }

  function sortIndicator(field: typeof sortField): string {
    if (sortField !== field) return '';
    return sortAsc ? ' ↑' : ' ↓';
  }

  onMount(async () => {
    if (!auth.isAuthenticated || auth.isAnonymous) {
      goto('/auth?mode=signup');
      return;
    }
    try {
      const result = await api.getMyDocuments();
      docs = result.documents ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load documents';
    } finally {
      loading = false;
    }
  });

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
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

    {#if loading}
      <div class="text-center py-16">
        <span class="loading loading-spinner loading-md text-primary"></span>
      </div>
    {:else if error}
      <div class="alert alert-error text-sm font-display">{error}</div>
    {:else if docs.length === 0}
      <div class="rounded-lg border border-base-content/10 p-8 text-center">
        <p class="text-base-content/40 font-display text-sm">No documents yet.</p>
        <p class="text-base-content/25 font-display text-xs mt-2">Create and share documents from the editor.</p>
        <a href="/" class="btn btn-primary btn-sm font-display mt-4">Create your first document</a>
      </div>
    {:else}
      <!-- Search -->
      <div class="mb-4">
        <input
          type="text"
          class="input input-bordered input-sm w-full max-w-xs font-display text-sm"
          placeholder="Search by slug, format, state..."
          bind:value={searchQuery}
        />
      </div>

      <div class="overflow-x-auto">
        <table class="table table-sm">
          <thead>
            <tr class="font-display text-xs text-base-content/40 uppercase tracking-wider">
              <th class="cursor-pointer select-none" onclick={() => toggleSort('slug')}>slug{sortIndicator('slug')}</th>
              <th>format</th>
              <th class="cursor-pointer select-none" onclick={() => toggleSort('tokenCount')}>tokens{sortIndicator('tokenCount')}</th>
              <th>size</th>
              <th class="hidden md:table-cell">state</th>
              <th class="hidden md:table-cell cursor-pointer select-none" onclick={() => toggleSort('createdAt')}>created{sortIndicator('createdAt')}</th>
              <th class="hidden md:table-cell cursor-pointer select-none" onclick={() => toggleSort('accessCount')}>views{sortIndicator('accessCount')}</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredDocs() as doc (doc.id)}
              <tr class="hover cursor-pointer" onclick={() => goto(`/doc/${doc.slug}`)}>
                <td class="font-display text-sm text-primary">{doc.slug}</td>
                <td><FormatBadge format={doc.format || 'text'} /></td>
                <td class="font-display text-xs text-base-content/60">{doc.tokenCount}</td>
                <td class="font-display text-xs text-base-content/60">{formatSize(doc.originalSize)}</td>
                <td class="hidden md:table-cell"><StateBadge state={doc.state || 'DRAFT'} /></td>
                <td class="hidden md:table-cell font-display text-xs text-base-content/40">{formatDate(doc.createdAt)}</td>
                <td class="hidden md:table-cell font-display text-xs text-base-content/40">{doc.accessCount}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-base-content/30 font-display mt-4">
        {filteredDocs().length}{filteredDocs().length !== docs.length ? ` of ${docs.length}` : ''} document{docs.length === 1 ? '' : 's'}
      </p>
    {/if}
  {:else}
    <div class="text-center py-16">
      <p class="text-base-content/40 font-display">Redirecting to sign in...</p>
    </div>
  {/if}
</div>
