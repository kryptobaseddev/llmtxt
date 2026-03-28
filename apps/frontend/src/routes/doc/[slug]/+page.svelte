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

  let doc = $derived(data.doc);
  let overview = $derived(data.overview);
  let versions = $derived(data.versions);
  let approvalsData = $derived(data.approvals);
  let contributorsData = $derived(data.contributors);
  let state = $derived<DocumentState>((doc?.state as DocumentState) || 'DRAFT');
  let isEditable = $derived(state === 'DRAFT' || state === 'REVIEW');

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

  async function copySlug() {
    await navigator.clipboard.writeText(`${window.location.origin}/doc/${data.slug}`);
    copied = true;
    setTimeout(() => { copied = false; }, 2000);
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
          {#if isEditable}
            <a href="/doc/{data.slug}/edit" class="btn btn-primary btn-sm font-display text-xs">
              Edit
            </a>
          {/if}
        </div>
      </div>

      <!-- Stats bar -->
      <div class="flex flex-wrap gap-6 mb-6 px-4 py-3 rounded-lg bg-base-200/30 border border-base-content/5">
        <div>
          <span class="text-xs text-base-content/30 font-display">tokens</span>
          <div class="mt-0.5">
            <TokenCount tokens={doc.tokenCount} size="sm" />
          </div>
        </div>
        <div>
          <span class="text-xs text-base-content/30 font-display">size</span>
          <p class="font-display text-sm mt-0.5">{(doc.originalSize / 1024).toFixed(1)} KB</p>
        </div>
        <div>
          <span class="text-xs text-base-content/30 font-display">compression</span>
          <p class="font-display text-sm mt-0.5">{doc.compressionRatio?.toFixed(1) ?? '-'}x</p>
        </div>
        <div>
          <span class="text-xs text-base-content/30 font-display">created</span>
          <p class="font-display text-sm mt-0.5">{formatDate(doc.createdAt)}</p>
        </div>
        <div>
          <span class="text-xs text-base-content/30 font-display">views</span>
          <p class="font-display text-sm mt-0.5">{doc.accessCount}</p>
        </div>
      </div>

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
              class="tab font-display text-xs {activeTab === 'content' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'content'}
            >Content</button>
            <button
              role="tab"
              class="tab font-display text-xs {activeTab === 'overview' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'overview'}
            >Overview</button>
            <button
              role="tab"
              class="tab font-display text-xs {activeTab === 'versions' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'versions'}
            >Versions{versions ? ` (${versions.totalVersions})` : ''}</button>
            <button
              role="tab"
              class="tab font-display text-xs {activeTab === 'contributors' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'contributors'}
            >Contributors</button>
            <button
              role="tab"
              class="tab font-display text-xs {activeTab === 'approvals' ? 'tab-active' : ''}"
              onclick={() => activeTab = 'approvals'}
            >Approvals</button>
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
                <VersionTimeline
                  versions={versions.versions}
                  onSelect={handleSelectVersion}
                />

                <!-- Diff tool -->
                <div class="border-t border-base-content/5 pt-6">
                  <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider mb-4">
                    Compare versions
                  </h3>
                  <div class="flex items-center gap-3 mb-4">
                    <label class="flex items-center gap-2">
                      <span class="font-display text-xs text-base-content/50">from</span>
                      <input
                        type="number"
                        class="input input-bordered input-sm w-20 font-display text-sm"
                        bind:value={diffFrom}
                        min={1}
                      />
                    </label>
                    <span class="text-base-content/20">&rarr;</span>
                    <label class="flex items-center gap-2">
                      <span class="font-display text-xs text-base-content/50">to</span>
                      <input
                        type="number"
                        class="input input-bordered input-sm w-20 font-display text-sm"
                        bind:value={diffTo}
                        min={1}
                      />
                    </label>
                    <button
                      class="btn btn-sm btn-primary font-display"
                      onclick={loadDiff}
                      disabled={loadingDiff || diffFrom === diffTo}
                    >
                      {#if loadingDiff}
                        <span class="loading loading-spinner loading-xs"></span>
                      {:else}
                        Diff
                      {/if}
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
