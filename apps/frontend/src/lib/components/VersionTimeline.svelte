<script lang="ts">
  import type { Version } from '$lib/types';

  let { versions, onSelect }: {
    versions: Version[];
    onSelect?: (version: Version) => void;
  } = $props();

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  }
</script>

<div class="space-y-0">
  {#each versions as version, i (version.versionNumber)}
    <button
      class="w-full text-left group"
      onclick={() => onSelect?.(version)}
      type="button"
    >
      <div class="flex gap-4">
        <!-- Timeline line -->
        <div class="flex flex-col items-center">
          <div class="w-3 h-3 rounded-full {i === 0 ? 'bg-primary' : 'bg-base-content/20'} ring-2 ring-base-100 z-10"></div>
          {#if i < versions.length - 1}
            <div class="w-px flex-1 bg-base-content/10"></div>
          {/if}
        </div>

        <!-- Content -->
        <div class="pb-6 flex-1 -mt-0.5">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-display text-sm {i === 0 ? 'text-primary' : 'text-base-content/70'}">
              v{version.versionNumber}
            </span>
            <span class="text-xs text-base-content/40 font-display">
              {formatDate(version.createdAt)}
            </span>
          </div>

          {#if version.changelog}
            <p class="text-sm text-base-content/60 mt-1 group-hover:text-base-content/80 transition-colors">
              {version.changelog}
            </p>
          {/if}

          <div class="flex items-center gap-3 mt-1.5 text-xs text-base-content/40">
            {#if version.createdBy}
              <span class="font-display">{version.createdBy}</span>
            {/if}
            <span class="font-display">~{formatTokens(version.tokenCount)} tokens</span>
          </div>
        </div>
      </div>
    </button>
  {/each}

  {#if versions.length === 0}
    <p class="text-sm text-base-content/40 font-display text-center py-8">
      No version history
    </p>
  {/if}
</div>
