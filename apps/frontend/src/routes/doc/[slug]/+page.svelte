<script lang="ts">
  import { api } from '$lib/api/client';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import FormatBadge from '$lib/components/FormatBadge.svelte';
  import TokenCount from '$lib/components/TokenCount.svelte';
  import SectionNav from '$lib/components/SectionNav.svelte';
  import VersionTimeline from '$lib/components/VersionTimeline.svelte';
  import ContributorTable from '$lib/components/ContributorTable.svelte';
  import ApprovalPanel from '$lib/components/ApprovalPanel.svelte';
  import DiffViewer from '$lib/components/DiffViewer.svelte';
  import type { DocumentState, DiffResult, OverviewSection, Version } from '$lib/types';

  let { data } = $props();

  let activeTab = $state<'content' | 'overview' | 'versions' | 'contributors' | 'approvals'>('content');
  let rawContent = $state<string | null>(null);
  let loadingContent = $state(false);
  let activeSection = $state<string | undefined>(undefined);
  let copied = $state(false);
  let diffResult = $state<DiffResult | null>(null);
  let diffFrom = $state(1);
  let diffTo = $state(2);
  let loadingDiff = $state(false);

  // Multi-version comparison
  let selectedVersions = $state<Set<number>>(new Set());
  let comparisonData = $state<Array<{ versionNumber: number; content: string; changelog: string | null }>>([]);
  let loadingComparison = $state(false);
  let comparisonBase = $state(1);

  function toggleVersion(num: number) {
    const next = new Set(selectedVersions);
    if (next.has(num)) {
      next.delete(num);
    } else if (next.size < 5) {
      next.add(num);
    }
    selectedVersions = next;
  }

  async function loadComparison() {
    const nums = [...selectedVersions].sort((a, b) => a - b);
    if (nums.length < 2) return;
    loadingComparison = true;
    try {
      const result = await api.getBatchVersions(data.slug, nums);
      comparisonData = result.versions ?? [];
      comparisonBase = nums[0];
    } catch {
      comparisonData = [];
    } finally {
      loadingComparison = false;
    }
  }

  let doc = $derived(data.doc);
  let overview = $derived(data.overview);
  let versions = $derived(data.versions);
  let approvalsData = $derived(data.approvals);
  let contributorsData = $derived(data.contributors);
  let state = $derived<DocumentState>((doc?.state as DocumentState) || 'DRAFT');
  let isEditable = $derived(state === 'DRAFT' || state === 'REVIEW');
  let docShareUrl = $derived(`${window.location.origin}/doc/${data.slug}`);

  async function loadContent() {
    if (rawContent !== null) return;
    loadingContent = true;
    try {
      const raw = await api.getRawContent(data.slug);
      rawContent = typeof raw === 'string' ? raw : raw?.content ?? JSON.stringify(raw, null, 2);
    } catch {
      rawContent = '// Failed to load content';
    } finally {
      loadingContent = false;
    }
  }

  async function loadSection(section: OverviewSection) {
    activeSection = section.title;
    loadingContent = true;
    try {
      const result = await api.getSection(data.slug, section.title);
      rawContent = result?.content ?? '';
    } catch {
      rawContent = `// Failed to load section: ${section.title}`;
    } finally {
      loadingContent = false;
    }
  }

  async function loadDiff() {
    loadingDiff = true;
    diffResult = null;
    try {
      const result = await api.getDiff(data.slug, diffFrom, diffTo);
      diffResult = result;
    } catch {
      diffResult = null;
    } finally {
      loadingDiff = false;
    }
  }

  async function handleApprove(comment: string) {
    try {
      await api.approve(data.slug, comment || undefined);
      const updated = await api.getApprovals(data.slug);
      data.approvals = updated;
    } catch (e) {
      console.error('Approve failed:', e);
    }
  }

  async function handleReject(comment: string) {
    try {
      await api.reject(data.slug, comment);
      const updated = await api.getApprovals(data.slug);
      data.approvals = updated;
    } catch (e) {
      console.error('Reject failed:', e);
    }
  }

  let showSharePanel = $state(false);

  async function copySlug() {
    try {
      await navigator.clipboard.writeText(docShareUrl);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Fallback: select the URL from the share panel
      showSharePanel = true;
    }
  }

  function handleSelectVersion(version: Version) {
    diffTo = version.versionNumber;
    if (version.versionNumber > 1) {
      diffFrom = version.versionNumber - 1;
    }
  }

  // Load content when tab becomes active
  $effect(() => {
    if (activeTab === 'content' && rawContent === null) {
      loadContent();
    }
  });

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<svelte:head>
  <title>{data.slug} - llmtxt.my</title>
</svelte:head>

<div class="animate-fade-in">
  {#if !doc}
    <div class="container mx-auto px-4 py-16 text-center">
      <h1 class="font-display text-2xl text-base-content/40 mb-2">Document not found</h1>
      <p class="text-sm text-base-content/30">The slug <code class="font-display text-primary">{data.slug}</code> does not exist.</p>
      <a href="/" class="btn btn-primary btn-sm mt-6 font-display">Back home</a>
    </div>
  {:else}
    <div class="container mx-auto px-4 py-6">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div class="flex items-center gap-3">
          <h1 class="font-display text-xl tracking-tight">{data.slug}</h1>
          <FormatBadge format={doc.format || 'text'} />
          <StateBadge {state} />
        </div>
        <div class="flex items-center gap-2">
          <button class="btn btn-ghost btn-sm font-display text-xs" onclick={copySlug}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
          <button
            class="btn btn-ghost btn-sm font-display text-xs"
            onclick={() => showSharePanel = !showSharePanel}
          >
            Share
          </button>
          {#if isEditable}
            <a href="/doc/{data.slug}/edit" class="btn btn-primary btn-sm font-display text-xs">
              Edit
            </a>
          {/if}
        </div>
      </div>

      <!-- Stats bar — compact on mobile -->
      <div class="flex flex-wrap gap-3 md:gap-6 mb-6 px-3 md:px-4 py-2 md:py-3 rounded-lg bg-base-200/30 border border-base-content/5 text-xs font-display">
        <div>
          <span class="text-base-content/30 hidden md:inline">tokens </span>
          <span class="text-base-content/30 md:hidden">tok </span>
          <span class="text-base-content/60">{doc.tokenCount}</span>
        </div>
        <div>
          <span class="text-base-content/30">size </span>
          <span class="text-base-content/60">{(doc.originalSize / 1024).toFixed(1)}KB</span>
        </div>
        <div>
          <span class="text-base-content/30 hidden md:inline">compression </span>
          <span class="text-base-content/30 md:hidden">ratio </span>
          <span class="text-base-content/60">{doc.compressionRatio?.toFixed(1) ?? '-'}x</span>
        </div>
        <div class="hidden md:block">
          <span class="text-base-content/30">created </span>
          <span class="text-base-content/60">{formatDate(doc.createdAt)}</span>
        </div>
        <div>
          <span class="text-base-content/30 hidden md:inline">views </span>
          <span class="text-base-content/60">{doc.accessCount}</span>
        </div>
      </div>

      <!-- Share panel -->
      {#if showSharePanel}
        <div class="mb-6 p-4 rounded-lg bg-base-200/30 border border-base-content/10 animate-fade-in">
          <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div class="flex-1 min-w-0 space-y-2">
              <p class="font-display text-xs text-base-content/40 uppercase tracking-wider">Shareable link</p>
              <div class="flex items-center gap-1 bg-base-300/50 rounded px-3 py-2">
                <input
                  type="text"
                  readonly
                  value={docShareUrl}
                  class="flex-1 bg-transparent text-sm font-display text-base-content/70 outline-none select-all min-w-0"
                  onclick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button class="btn btn-ghost btn-xs font-display shrink-0" onclick={copySlug}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div class="shrink-0">
              <img
                src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data={encodeURIComponent(docShareUrl)}&bgcolor=1a1b2e&color=58c7f3&format=svg"
                alt="QR code"
                width="100"
                height="100"
                class="rounded"
              />
            </div>
          </div>
        </div>
      {/if}

      <!-- Tabs + Content layout -->
      <div class="flex flex-col lg:flex-row gap-6">
        <!-- Sidebar: section nav (only on content/overview) -->
        {#if overview?.sections?.length && (activeTab === 'content' || activeTab === 'overview')}
          <aside class="lg:w-56 shrink-0 order-2 lg:order-1">
            <div class="lg:sticky lg:top-20">
              <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider mb-3 px-3">
                Sections
              </h3>
              <SectionNav
                sections={overview.sections}
                {activeSection}
                onSelect={loadSection}
              />
            </div>
          </aside>
        {/if}

        <!-- Main content area -->
        <div class="flex-1 min-w-0 order-1 lg:order-2">
          <!-- Tab bar -->
          <div role="tablist" class="tabs tabs-bordered mb-6">
            <button
              role="tab"
              class="tab font-display text-xs gap-1.5 {activeTab === 'content' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'content'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span class="hidden md:inline">Content</span>
            </button>
            <button
              role="tab"
              class="tab font-display text-xs gap-1.5 {activeTab === 'overview' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'overview'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7" /></svg>
              <span class="hidden md:inline">Overview</span>
            </button>
            <button
              role="tab"
              class="tab font-display text-xs gap-1.5 {activeTab === 'versions' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'versions'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {#if versions}<span class="text-base-content/40">({versions.totalVersions})</span>{/if}
              <span class="hidden md:inline">Versions</span>
            </button>
            <button
              role="tab"
              class="tab font-display text-xs gap-1.5 {activeTab === 'contributors' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'contributors'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              {#if contributorsData?.contributors?.length}<span class="text-base-content/40">({contributorsData.contributors.length})</span>{/if}
              <span class="hidden md:inline">Contributors</span>
            </button>
            <button
              role="tab"
              class="tab font-display text-xs gap-1.5 {activeTab === 'approvals' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'approvals'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {#if approvalsData?.consensus}
                <span class="text-base-content/40">({approvalsData.consensus.approvedBy.length}/{approvalsData.consensus.rejectedBy.length}/{approvalsData.reviews.length})</span>
              {/if}
              <span class="hidden md:inline">Approvals</span>
            </button>
          </div>

          <!-- Tab panels -->
          {#if activeTab === 'content'}
            <div class="rounded-lg border border-base-content/10 overflow-hidden">
              {#if loadingContent}
                <div class="p-8 text-center">
                  <span class="loading loading-spinner loading-md text-primary"></span>
                </div>
              {:else if rawContent !== null}
                <div class="overflow-x-auto">
                  <pre class="p-4 text-sm leading-relaxed font-display whitespace-pre-wrap break-words"><code>{rawContent}</code></pre>
                </div>
              {/if}
            </div>

          {:else if activeTab === 'overview'}
            {#if overview}
              <div class="space-y-4">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div class="p-3 rounded-lg bg-base-200/30 border border-base-content/5">
                    <p class="text-xs text-base-content/30 font-display">format</p>
                    <p class="font-display text-sm mt-1">{overview.format}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-base-200/30 border border-base-content/5">
                    <p class="text-xs text-base-content/30 font-display">lines</p>
                    <p class="font-display text-sm mt-1">{overview.lineCount}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-base-200/30 border border-base-content/5">
                    <p class="text-xs text-base-content/30 font-display">tokens</p>
                    <p class="font-display text-sm mt-1">{overview.tokenCount}</p>
                  </div>
                  <div class="p-3 rounded-lg bg-base-200/30 border border-base-content/5">
                    <p class="text-xs text-base-content/30 font-display">sections</p>
                    <p class="font-display text-sm mt-1">{overview.sections?.length ?? 0}</p>
                  </div>
                </div>

                <!-- Section table -->
                {#if overview.sections?.length}
                  <div class="overflow-x-auto">
                    <table class="table table-sm">
                      <thead>
                        <tr class="font-display text-xs text-base-content/40 uppercase tracking-wider">
                          <th>section</th>
                          <th>type</th>
                          <th>lines</th>
                          <th>tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each overview.sections as section}
                          <tr
                            class="hover cursor-pointer"
                            onclick={() => loadSection(section)}
                          >
                            <td class="font-display text-sm" style="padding-left: {0.5 + (section.depth - 1) * 1}rem">
                              {section.title}
                            </td>
                            <td class="text-xs text-base-content/40">{section.type}</td>
                            <td class="font-display text-xs text-base-content/50">{section.startLine}-{section.endLine}</td>
                            <td>
                              <TokenCount tokens={section.tokenCount} size="sm" />
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {/if}
              </div>
            {:else}
              <p class="text-sm text-base-content/40 font-display text-center py-8">
                Overview not available
              </p>
            {/if}

          {:else if activeTab === 'versions'}
            <div class="space-y-6">
              {#if versions?.versions?.length}
                <!-- Version list with selection checkboxes -->
                <div>
                  <div class="flex items-center justify-between mb-3">
                    <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider">
                      Select versions to compare (max 5)
                    </h3>
                    {#if selectedVersions.size >= 2}
                      <button class="btn btn-sm btn-primary font-display" onclick={loadComparison} disabled={loadingComparison}>
                        {#if loadingComparison}
                          <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                          Compare ({selectedVersions.size})
                        {/if}
                      </button>
                    {/if}
                  </div>
                  <div class="space-y-1">
                    {#each versions.versions as ver (ver.versionNumber)}
                      <button
                        class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-base-200/50 transition-colors text-left {selectedVersions.has(ver.versionNumber) ? 'bg-primary/10 border border-primary/20' : 'border border-transparent'}"
                        onclick={() => toggleVersion(ver.versionNumber)}
                      >
                        <input type="checkbox" class="checkbox checkbox-xs checkbox-primary" checked={selectedVersions.has(ver.versionNumber)} />
                        <span class="font-display text-sm text-primary font-bold">v{ver.versionNumber}</span>
                        <span class="text-xs text-base-content/50 flex-1 truncate">{ver.changelog ?? ''}</span>
                        <span class="text-xs text-base-content/30 font-display shrink-0">{ver.tokenCount} tok</span>
                      </button>
                    {/each}
                  </div>
                </div>

                <!-- Multi-version comparison view -->
                {#if comparisonData.length >= 2}
                  <div class="border-t border-base-content/5 pt-6">
                    <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider mb-4">
                      Side-by-side comparison (base: v{comparisonBase})
                    </h3>
                    <div class="grid gap-4" style="grid-template-columns: repeat({Math.min(comparisonData.length, 3)}, 1fr);">
                      {#each comparisonData as ver (ver.versionNumber)}
                        <div class="rounded-lg border {ver.versionNumber === comparisonBase ? 'border-primary/30 bg-primary/5' : 'border-base-content/10'}">
                          <div class="px-3 py-2 border-b border-base-content/10 flex items-center justify-between">
                            <span class="font-display text-xs font-bold {ver.versionNumber === comparisonBase ? 'text-primary' : ''}">
                              v{ver.versionNumber}
                              {#if ver.versionNumber === comparisonBase}
                                <span class="text-base-content/30 font-normal">(base)</span>
                              {/if}
                            </span>
                            <span class="text-xs text-base-content/30">{ver.changelog}</span>
                          </div>
                          <pre class="p-3 text-xs font-display leading-relaxed whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">{ver.content}</pre>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                <!-- Pairwise diff tool -->
                <div class="border-t border-base-content/5 pt-6">
                  <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider mb-4">
                    Pairwise diff
                  </h3>
                  <div class="flex items-center gap-3 mb-4">
                    <label class="flex items-center gap-2">
                      <span class="font-display text-xs text-base-content/50">from</span>
                      <input type="number" class="input input-bordered input-sm w-20 font-display text-sm" bind:value={diffFrom} min={1} />
                    </label>
                    <span class="text-base-content/20">&rarr;</span>
                    <label class="flex items-center gap-2">
                      <span class="font-display text-xs text-base-content/50">to</span>
                      <input type="number" class="input input-bordered input-sm w-20 font-display text-sm" bind:value={diffTo} min={1} />
                    </label>
                    <button class="btn btn-sm btn-primary font-display" onclick={loadDiff} disabled={loadingDiff || diffFrom === diffTo}>
                      {#if loadingDiff}<span class="loading loading-spinner loading-xs"></span>{:else}Diff{/if}
                    </button>
                  </div>
                  {#if diffResult}
                    <DiffViewer diff={diffResult} />
                  {/if}
                </div>
              {:else}
                <p class="text-sm text-base-content/40 font-display text-center py-8">
                  No version history
                </p>
              {/if}
            </div>

          {:else if activeTab === 'contributors'}
            <ContributorTable contributors={contributorsData?.contributors ?? []} />

          {:else if activeTab === 'approvals'}
            <ApprovalPanel
              reviews={approvalsData?.reviews ?? []}
              consensus={approvalsData?.consensus ?? null}
              docState={state}
              onApprove={handleApprove}
              onReject={handleReject}
            />
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
