<script lang="ts">
  import type { DiffResult } from '$lib/types';

  let { diff }: { diff: DiffResult } = $props();

  // Compute gutter width from max line numbers present
  let maxOldLine = $derived(
    diff.lines.reduce((m, l) => (l.oldLine !== null ? Math.max(m, l.oldLine) : m), 1)
  );
  let maxNewLine = $derived(
    diff.lines.reduce((m, l) => (l.newLine !== null ? Math.max(m, l.newLine) : m), 1)
  );
  let gutterCh = $derived(Math.max(String(maxOldLine).length, String(maxNewLine).length) + 1);

  // Group consecutive context/changed lines for collapsible context blocks (GitHub-style)
  // Here we just render all lines — no collapse — for maximum readability.
</script>

<div class="rounded-lg border border-base-content/10 overflow-hidden font-display text-sm" role="region" aria-label="Diff viewer">
  <!-- Header bar -->
  <div class="flex items-center justify-between px-4 py-2 bg-base-200/60 border-b border-base-content/10">
    <span class="text-xs text-base-content/50">
      v{diff.fromVersion}
      <span class="mx-1 text-base-content/20">&rarr;</span>
      v{diff.toVersion}
    </span>
    <div class="flex items-center gap-4 text-xs">
      <span class="text-success font-semibold">
        +{diff.addedLineCount}
        <span class="text-success/50 font-normal hidden sm:inline">(+{diff.addedTokens} tok)</span>
      </span>
      <span class="text-error font-semibold">
        -{diff.removedLineCount}
        <span class="text-error/50 font-normal hidden sm:inline">(-{diff.removedTokens} tok)</span>
      </span>
    </div>
  </div>

  <!-- Diff lines -->
  <div class="overflow-x-auto">
    {#if diff.lines.length > 0}
      <table
        class="w-full text-xs leading-6 border-collapse"
        aria-label="Diff lines"
      >
        <tbody>
          {#each diff.lines as line, i (i)}
            {@const isAdded = line.type === 'added'}
            {@const isRemoved = line.type === 'removed'}
            {@const isContext = line.type === 'context'}
            <tr
              class="{isAdded ? 'diff-added' : isRemoved ? 'diff-removed' : 'diff-context'}"
            >
              <!-- Old line number gutter -->
              <td
                class="select-none text-right pr-1 pl-2 text-base-content/30 w-0 whitespace-nowrap border-r border-base-content/8 tabular-nums"
                style="min-width: {gutterCh}ch"
                aria-label="Old line {line.oldLine ?? ''}"
              >
                {#if line.oldLine !== null}
                  <span class="{isRemoved ? 'text-error/70' : ''}">{line.oldLine}</span>
                {/if}
              </td>

              <!-- New line number gutter -->
              <td
                class="select-none text-right pr-2 pl-1 text-base-content/30 w-0 whitespace-nowrap border-r border-base-content/8 tabular-nums"
                style="min-width: {gutterCh}ch"
                aria-label="New line {line.newLine ?? ''}"
              >
                {#if line.newLine !== null}
                  <span class="{isAdded ? 'text-success/70' : ''}">{line.newLine}</span>
                {/if}
              </td>

              <!-- Type indicator (+/-/ ) -->
              <td
                class="select-none w-5 text-center font-bold {isRemoved
                  ? 'text-error'
                  : isAdded
                    ? 'text-success'
                    : 'text-base-content/20'}"
                aria-hidden="true"
              >
                {isRemoved ? '-' : isAdded ? '+' : ' '}
              </td>

              <!-- Line content -->
              <td
                class="whitespace-pre-wrap break-all pr-4 py-0.5 {isRemoved
                  ? 'text-error/90'
                  : isAdded
                    ? 'text-success/90'
                    : 'text-base-content/70'}"
              >
                {line.content}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <div class="px-4 py-10 text-center text-base-content/30 text-sm" role="status">
        No changes between v{diff.fromVersion} and v{diff.toVersion}.
      </div>
    {/if}
  </div>
</div>

<style>
  /* Stronger row colouring for removed/added lines */
  .diff-removed {
    background: oklch(var(--er) / 0.12);
    border-left: 3px solid oklch(var(--er) / 0.6);
  }

  .diff-added {
    background: oklch(var(--su) / 0.12);
    border-left: 3px solid oklch(var(--su) / 0.6);
  }

  .diff-context {
    background: transparent;
    border-left: 3px solid transparent;
  }

  /* Reduce visual noise on gutter borders */
  td {
    border-color: oklch(var(--bc) / 0.06);
  }
</style>
