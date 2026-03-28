<script lang="ts">
  import type { OverviewSection } from '$lib/types';

  let { sections, activeSection, onSelect }: {
    sections: OverviewSection[];
    activeSection?: string;
    onSelect?: (section: OverviewSection) => void;
  } = $props();

  function formatTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
  }
</script>

<nav class="space-y-0.5" aria-label="Section navigation">
  {#each sections as section (section.title + section.startLine)}
    <button
      class="w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors
        {activeSection === section.title
          ? 'bg-primary/10 text-primary'
          : 'text-base-content/60 hover:text-base-content hover:bg-base-content/5'}"
      style="padding-left: {0.75 + (section.depth - 1) * 0.75}rem"
      onclick={() => onSelect?.(section)}
      type="button"
    >
      <div class="flex items-baseline justify-between gap-2">
        <span class="font-display text-xs truncate">{section.title}</span>
        <span class="font-display text-xs text-base-content/30 shrink-0">
          {formatTokens(section.tokenCount)}
        </span>
      </div>
    </button>
  {/each}

  {#if sections.length === 0}
    <p class="text-xs text-base-content/30 font-display px-3 py-4 text-center">
      No sections detected
    </p>
  {/if}
</nav>
