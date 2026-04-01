<script lang="ts">
  import type { DiffResult } from '$lib/types';

  let { diff }: { diff: DiffResult } = $props();

  let maxOldLine = $derived(Math.max(...diff.lines.filter(l => l.oldLine !== null).map(l => l.oldLine!), 1));
  let maxNewLine = $derived(Math.max(...diff.lines.filter(l => l.newLine !== null).map(l => l.newLine!), 1));
  let gutterWidth = $derived(Math.max(String(maxOldLine).length, String(maxNewLine).length));
</script>

<div class="rounded-lg border border-base-content/10 overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-2 bg-base-200/50 border-b border-base-content/10">
    <span class="font-display text-xs text-base-content/50">
      v{diff.fromVersion} &rarr; v{diff.toVersion}
    </span>
    <div class="flex gap-4 font-display text-xs">
      <span class="text-success">+{diff.addedLineCount} lines (+{diff.addedTokens} tok)</span>
      <span class="text-error">-{diff.removedLineCount} lines (-{diff.removedTokens} tok)</span>
    </div>
  </div>

  <!-- Diff lines -->
  <div class="overflow-x-auto">
    {#if diff.lines.length > 0}
      <table class="w-full text-sm leading-relaxed font-display border-collapse">
        <tbody>
          {#each diff.lines as line}
            <tr class="{line.type === 'removed' ? 'bg-error/8' : line.type === 'added' ? 'bg-success/8' : ''}">
              <!-- Old line number -->
              <td class="select-none text-right pr-1 pl-2 text-xs text-base-content/20 border-r border-base-content/5 w-0 whitespace-nowrap"
                  style="min-width: {gutterWidth + 1}ch">
                {#if line.oldLine !== null}
                  {line.oldLine}
                {/if}
              </td>
              <!-- New line number -->
              <td class="select-none text-right pr-2 pl-1 text-xs text-base-content/20 border-r border-base-content/5 w-0 whitespace-nowrap"
                  style="min-width: {gutterWidth + 1}ch">
                {#if line.newLine !== null}
                  {line.newLine}
                {/if}
              </td>
              <!-- Indicator -->
              <td class="select-none w-4 text-center text-xs {line.type === 'removed' ? 'text-error/60' : line.type === 'added' ? 'text-success/60' : 'text-base-content/10'}">
                {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
              </td>
              <!-- Content -->
              <td class="whitespace-pre-wrap break-all pr-4 {line.type === 'removed' ? 'text-error/80' : line.type === 'added' ? 'text-success/80' : 'text-base-content/70'}">
                {line.content}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="px-4 py-8 text-center text-base-content/30 font-display text-sm">No changes</div>
    {/if}
  </div>
</div>
