<script lang="ts">
  import type { Contributor } from '$lib/types';

  let { contributors }: { contributors: Contributor[] } = $props();

  let maxTokens = $derived(
    Math.max(...contributors.map(c => Math.abs(c.netTokens)), 1)
  );

  function formatTokens(n: number): string {
    const abs = Math.abs(n);
    return abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : `${abs}`;
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  function barWidth(tokens: number): string {
    return `${Math.max((Math.abs(tokens) / maxTokens) * 100, 4)}%`;
  }
</script>

<div class="overflow-x-auto">
  <table class="table table-sm">
    <thead>
      <tr class="font-display text-xs text-base-content/40 uppercase tracking-wider">
        <th>contributor</th>
        <th>patches</th>
        <th>impact</th>
        <th>net tokens</th>
        <th>last active</th>
      </tr>
    </thead>
    <tbody>
      {#each contributors as contributor (contributor.id)}
        <tr class="hover">
          <td class="font-display text-sm">
            {contributor.userId.slice(0, 8)}
          </td>
          <td class="font-display text-sm text-base-content/60">
            {contributor.patchCount}
          </td>
          <td>
            <div class="flex items-center gap-2">
              <div class="h-1.5 rounded-full {contributor.netTokens >= 0 ? 'bg-success' : 'bg-error'}" style="width: {barWidth(contributor.netTokens)}"></div>
            </div>
          </td>
          <td class="font-display text-sm {contributor.netTokens >= 0 ? 'text-success' : 'text-error'}">
            {contributor.netTokens >= 0 ? '+' : '-'}{formatTokens(contributor.netTokens)}
          </td>
          <td class="text-xs text-base-content/40">
            {formatDate(contributor.lastContributedAt)}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if contributors.length === 0}
    <p class="text-sm text-base-content/40 font-display text-center py-8">
      No contributors yet
    </p>
  {/if}
</div>
