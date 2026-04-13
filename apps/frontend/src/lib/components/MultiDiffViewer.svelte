<script lang="ts">
  import { api } from '$lib/api/client';
  import type { MultiDiffResult, MultiDiffLine, Version } from '$lib/types';

  let {
    slug,
    versions,
  }: {
    slug: string;
    versions: Version[];
  } = $props();

  // Version selection state — 2 to 5 versions allowed
  let selected = $state<Set<number>>(new Set());

  // Fetch / display state
  let loading = $state(false);
  let error = $state<string | null>(null);
  let result = $state<MultiDiffResult | null>(null);

  // Track which divergent lines are expanded to show all variants
  let expanded = $state<Set<number>>(new Set());

  // Sorted list of available version numbers (descending so newest first)
  let sortedVersions = $derived(
    [...versions].sort((a, b) => b.versionNumber - a.versionNumber)
  );

  // Derived flags
  let selectedCount = $derived(selected.size);
  let canCompare = $derived(selectedCount >= 2 && selectedCount <= 5);

  // Label for the version numbers that produced the current result
  let resultLabel = $derived(
    result ? `v${result.versions.join(', v')}` : ''
  );

  function toggleVersion(num: number): void {
    const next = new Set(selected);
    if (next.has(num)) {
      next.delete(num);
    } else if (next.size < 5) {
      next.add(num);
    }
    selected = next;
    // Clear stale result when selection changes
    result = null;
    error = null;
    expanded = new Set();
  }

  async function compare(): Promise<void> {
    if (!canCompare) return;
    const nums = [...selected].sort((a, b) => a - b);
    loading = true;
    error = null;
    result = null;
    expanded = new Set();
    try {
      result = await api.getMultiDiff(slug, nums);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load multi-diff';
    } finally {
      loading = false;
    }
  }

  function toggleExpanded(lineNumber: number): void {
    const next = new Set(expanded);
    if (next.has(lineNumber)) {
      next.delete(lineNumber);
    } else {
      next.add(lineNumber);
    }
    expanded = next;
  }

  // Map from versionIndex to actual version number using result.versions array
  function versionLabel(result: MultiDiffResult, versionIndex: number): string {
    const num = result.versions[versionIndex];
    return num !== undefined ? `v${num}` : `v?`;
  }

  function formatPct(pct: number): string {
    return pct % 1 === 0 ? `${pct}%` : `${pct.toFixed(1)}%`;
  }
</script>

<div class="space-y-4">
  <!-- Version selector -->
  <div class="rounded-lg border border-base-content/10 bg-base-200/20 p-4">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
      <div>
        <h3 class="font-display text-xs font-bold text-base-content/70 uppercase tracking-wider">
          Multi-Version Comparison
        </h3>
        <p class="font-display text-xs text-base-content/30 mt-0.5">
          Select 2–5 versions to compare
          {#if selectedCount > 0}
            <span class="text-primary">({selectedCount} selected)</span>
          {/if}
        </p>
      </div>
      <button
        class="btn btn-sm btn-primary font-display shrink-0"
        onclick={compare}
        disabled={!canCompare || loading}
      >
        {#if loading}
          <span class="loading loading-spinner loading-xs"></span>
          Comparing...
        {:else}
          Compare Selected
        {/if}
      </button>
    </div>

    <!-- Version checkboxes -->
    <div class="flex flex-wrap gap-2">
      {#each sortedVersions as ver (ver.versionNumber)}
        {@const isSelected = selected.has(ver.versionNumber)}
        {@const isDisabled = !isSelected && selectedCount >= 5}
        <button
          class="flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-display text-xs transition-colors
            {isSelected
              ? 'border-primary bg-primary/15 text-primary'
              : isDisabled
                ? 'border-base-content/5 bg-base-200/30 text-base-content/20 cursor-not-allowed'
                : 'border-base-content/10 bg-base-200/30 text-base-content/50 hover:border-base-content/30'}"
          onclick={() => toggleVersion(ver.versionNumber)}
          disabled={isDisabled}
          aria-pressed={isSelected}
          title={isDisabled ? 'Maximum 5 versions' : `v${ver.versionNumber}`}
        >
          <span class="w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0
            {isSelected ? 'border-primary bg-primary' : 'border-base-content/20'}">
            {#if isSelected}
              <svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5 text-primary-content" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clip-rule="evenodd" />
              </svg>
            {/if}
          </span>
          v{ver.versionNumber}
        </button>
      {/each}
    </div>
  </div>

  <!-- Error state -->
  {#if error}
    <div class="alert alert-error text-xs font-display">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      {error}
    </div>
  {/if}

  <!-- Results -->
  {#if result}
    <div class="rounded-lg border border-base-content/10 overflow-hidden">
      <!-- Stats header -->
      <div class="px-4 py-3 bg-base-200/40 border-b border-base-content/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-display text-xs text-base-content/40">
            {resultLabel}
          </span>
          <span class="text-base-content/10">|</span>
          <span class="font-display text-xs font-bold text-base-content/70">
            {formatPct(result.stats.consensusPercentage)} consensus
          </span>
          <span class="font-display text-xs text-base-content/40">
            ({result.stats.consensusLines}/{result.stats.totalLines} lines agree)
          </span>
        </div>
        <div class="flex gap-3 font-display text-xs">
          <span class="text-base-content/50">{result.stats.consensusLines} consensus</span>
          <span class="text-warning/80">{result.stats.divergentLines} divergent</span>
          {#if result.stats.totalLines - result.stats.consensusLines - result.stats.divergentLines > 0}
            <span class="text-info/80">{result.stats.totalLines - result.stats.consensusLines - result.stats.divergentLines} inserted</span>
          {/if}
        </div>
      </div>

      <!-- Consensus bar -->
      <div class="h-1 bg-base-300/50">
        <div
          class="h-full bg-success/60 transition-all"
          style="width: {Math.min(result.stats.consensusPercentage, 100)}%"
        ></div>
      </div>

      <!-- Line table -->
      <div class="overflow-x-auto">
        {#if result.lines.length > 0}
          <table class="w-full text-xs leading-relaxed font-display border-collapse">
            <tbody>
              {#each result.lines as line (line.lineNumber)}
                {@const isDivergent = line.type === 'divergent'}
                {@const isInsertion = line.type === 'insertion'}
                {@const isOpen = expanded.has(line.lineNumber)}
                <!-- Primary row -->
                <tr
                  class="group {isDivergent
                    ? 'bg-warning/6 hover:bg-warning/10'
                    : isInsertion
                      ? 'bg-info/6 hover:bg-info/10'
                      : 'hover:bg-base-200/30'}"
                  onclick={isDivergent ? () => toggleExpanded(line.lineNumber) : undefined}
                  style={isDivergent ? 'cursor: pointer' : ''}
                >
                  <!-- Line number gutter -->
                  <td class="select-none text-right pr-2 pl-3 text-base-content/20 border-r border-base-content/5 w-0 whitespace-nowrap"
                      style="min-width: 4ch">
                    {line.lineNumber}
                  </td>

                  <!-- Line type indicator -->
                  <td class="select-none w-5 text-center {isDivergent
                    ? 'text-warning/60'
                    : isInsertion
                      ? 'text-info/60'
                      : 'text-base-content/10'}">
                    {#if isDivergent}
                      <!-- divergent: lightning bolt -->
                      <svg xmlns="http://www.w3.org/2000/svg" class="inline w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    {:else if isInsertion}
                      <!-- insertion: plus icon -->
                      <svg xmlns="http://www.w3.org/2000/svg" class="inline w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                      </svg>
                    {/if}
                  </td>

                  <!-- Content -->
                  <td class="whitespace-pre-wrap break-all pr-2 py-0.5
                    {isDivergent
                      ? 'text-warning/90'
                      : isInsertion
                        ? 'text-info/90'
                        : 'text-base-content/70'}">
                    {line.content || ' '}
                  </td>

                  <!-- Agreement badge + expand toggle -->
                  <td class="select-none text-right pr-3 whitespace-nowrap w-0">
                    <div class="flex items-center justify-end gap-1.5">
                      {#if isInsertion}
                        <!-- Insertion badge: show which version inserted this line -->
                        <span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-info/15 text-info/80">
                          {line.variants[0] ? versionLabel(result, line.variants[0].versionIndex) : '+'}
                        </span>
                      {:else}
                        <span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold
                          {line.agreement === line.total
                            ? 'bg-success/15 text-success/80'
                            : line.agreement >= line.total / 2
                              ? 'bg-warning/15 text-warning/80'
                              : 'bg-error/15 text-error/70'}">
                          {line.agreement}/{line.total}
                        </span>
                      {/if}
                      {#if isDivergent}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="w-3 h-3 text-base-content/20 transition-transform {isOpen ? 'rotate-180' : ''}"
                          fill="none" viewBox="0 0 24 24" stroke="currentColor"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      {/if}
                    </div>
                  </td>
                </tr>

                <!-- Expanded variants row (divergent only) -->
                {#if isDivergent && isOpen}
                  <tr>
                    <td colspan="4" class="p-0">
                      <div class="ml-6 border-l-2 border-warning/20 bg-base-200/30 py-1">
                        {#each line.variants as variant (variant.versionIndex)}
                          <div class="flex items-start gap-2 px-3 py-0.5 text-xs font-display">
                            <span class="shrink-0 text-primary/60 font-bold w-8 text-right">
                              {versionLabel(result, variant.versionIndex)}
                            </span>
                            <span class="whitespace-pre-wrap break-all text-base-content/60">
                              {#if variant.content}{variant.content}{:else}<em class="text-base-content/30">(empty)</em>{/if}
                            </span>
                          </div>
                        {/each}
                      </div>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        {:else}
          <div class="px-4 py-10 text-center font-display text-sm text-base-content/30">
            No lines to display
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Empty state before any comparison -->
  {#if !result && !loading && !error}
    <div class="rounded-lg border border-dashed border-base-content/10 px-6 py-10 text-center">
      <p class="font-display text-sm text-base-content/30">
        {#if versions.length < 2}
          This document only has one version — nothing to compare yet.
        {:else}
          Select 2–5 versions above and click <span class="text-base-content/50">Compare Selected</span>.
        {/if}
      </p>
    </div>
  {/if}
</div>
