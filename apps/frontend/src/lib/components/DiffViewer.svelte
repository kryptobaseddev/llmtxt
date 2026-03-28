<script lang="ts">
  import type { DiffResult } from '$lib/types';

  let { diff }: { diff: DiffResult } = $props();

  interface DiffLine {
    type: 'added' | 'removed' | 'context';
    content: string;
    lineNum: number | null;
  }

  let lines = $derived<DiffLine[]>(() => {
    const result: DiffLine[] = [];
    let lineNum = 1;

    for (const line of diff.removedLines) {
      result.push({ type: 'removed', content: line, lineNum });
      lineNum++;
    }
    for (const line of diff.addedLines) {
      result.push({ type: 'added', content: line, lineNum: null });
    }

    return result;
  });
</script>

<div class="rounded-lg border border-base-content/10 overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-2 bg-base-200/50 border-b border-base-content/10">
    <span class="font-display text-xs text-base-content/50">
      v{diff.fromVersion} &rarr; v{diff.toVersion}
    </span>
    <div class="flex gap-4 font-display text-xs">
      <span class="text-success">+{diff.addedLines.length} lines (+{diff.addedTokens} tokens)</span>
      <span class="text-error">-{diff.removedLines.length} lines (-{diff.removedTokens} tokens)</span>
    </div>
  </div>

  <!-- Diff lines -->
  <div class="overflow-x-auto">
    <pre class="text-sm leading-relaxed"><code>{#if diff.removedLines.length > 0 || diff.addedLines.length > 0}{#each diff.removedLines as line}<div class="diff-removed px-4 py-0.5"><span class="inline-block w-6 text-right text-base-content/20 select-none mr-3 font-display text-xs">-</span><span class="text-error/80">{line}</span></div>{/each}{#each diff.addedLines as line}<div class="diff-added px-4 py-0.5"><span class="inline-block w-6 text-right text-base-content/20 select-none mr-3 font-display text-xs">+</span><span class="text-success/80">{line}</span></div>{/each}{:else}<div class="px-4 py-8 text-center text-base-content/30 font-display text-sm">No changes</div>{/if}</code></pre>
  </div>
</div>
