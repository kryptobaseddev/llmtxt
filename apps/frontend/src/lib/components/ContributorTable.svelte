<script lang="ts">
  import type { Contributor } from '$lib/types';

  let { contributors }: { contributors: Contributor[] } = $props();

  let maxTokens = $derived(
    contributors.length > 0
      ? Math.max(...contributors.map(c => Math.abs(c.netTokens)), 1)
      : 1
  );

  function formatTokens(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}k`;
    return `${abs}`;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function barWidth(tokens: number): string {
    return `${Math.max((Math.abs(tokens) / maxTokens) * 100, 3)}%`;
  }

  // Shorten agent IDs for display — first 12 chars is enough to distinguish
  function shortId(id: string): string {
    return id.length > 12 ? id.slice(0, 12) + '…' : id;
  }

  let sortedContributors = $derived(
    [...contributors].sort((a, b) => b.versionsAuthored - a.versionsAuthored)
  );
</script>

<div>
  {#if sortedContributors.length === 0}
    <div class="py-12 text-center">
      <p class="font-display text-sm text-base-content/40">No contributors yet.</p>
      <p class="font-display text-xs text-base-content/25 mt-1">
        The first contributor appears when a version is written.
      </p>
    </div>
  {:else}
    <div class="overflow-x-auto rounded-lg border border-base-content/10">
      <table class="table table-sm w-full" aria-label="Contributors">
        <thead>
          <tr class="font-display text-xs text-base-content/40 uppercase tracking-wider">
            <th scope="col" class="w-8 text-right">#</th>
            <th scope="col">agent</th>
            <th scope="col" class="w-20 text-right">patches</th>
            <th scope="col" class="w-40">impact</th>
            <th scope="col" class="w-24 text-right">net tokens</th>
            <th scope="col" class="w-32 text-right hidden md:table-cell">last active</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedContributors as contributor, rank (contributor.id)}
            <tr class="hover">
              <td class="text-right font-display text-xs text-base-content/25">{rank + 1}</td>
              <td>
                <div class="flex flex-col">
                  <span
                    class="font-display text-sm text-base-content/80"
                    title={contributor.agentId}
                  >
                    {shortId(contributor.agentId)}
                  </span>
                  <span class="font-display text-xs text-base-content/30 hidden sm:inline">
                    {contributor.versionsAuthored === 1 ? '1 version' : `${contributor.versionsAuthored} versions`}
                  </span>
                </div>
              </td>
              <td class="text-right font-display text-sm font-semibold text-base-content/70">
                {contributor.versionsAuthored}
              </td>
              <td>
                <div class="flex items-center gap-2">
                  <div
                    class="h-2 rounded-full transition-all {contributor.netTokens >= 0 ? 'bg-success/70' : 'bg-error/70'}"
                    style="width: {barWidth(contributor.netTokens)}"
                    role="img"
                    aria-label="{contributor.netTokens >= 0 ? 'Added' : 'Removed'} {formatTokens(contributor.netTokens)} tokens"
                  ></div>
                </div>
              </td>
              <td
                class="text-right font-display text-sm {contributor.netTokens >= 0 ? 'text-success' : 'text-error'}"
              >
                {contributor.netTokens >= 0 ? '+' : '-'}{formatTokens(contributor.netTokens)}
              </td>
              <td class="text-right font-display text-xs text-base-content/40 hidden md:table-cell">
                {formatDate(contributor.lastContribution)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Summary line -->
    <p class="mt-3 font-display text-xs text-base-content/25 text-right">
      {sortedContributors.length} contributor{sortedContributors.length === 1 ? '' : 's'} total
    </p>
  {/if}
</div>
