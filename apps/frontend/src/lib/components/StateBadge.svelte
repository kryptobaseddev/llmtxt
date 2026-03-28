<script lang="ts">
  import type { DocumentState } from '$lib/types';

  let { state }: { state: DocumentState } = $props();

  const config: Record<DocumentState, { class: string; label: string }> = {
    DRAFT: { class: 'badge-info', label: 'DRAFT' },
    REVIEW: { class: 'badge-warning', label: 'REVIEW' },
    LOCKED: { class: 'badge-success', label: 'LOCKED' },
    ARCHIVED: { class: 'badge-ghost', label: 'ARCHIVED' },
  };

  let badge = $derived(config[state] || config.DRAFT);
</script>

<span class="badge {badge.class} badge-sm font-display text-xs tracking-wider gap-1">
  {#if state === 'LOCKED'}
    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
    </svg>
  {/if}
  {badge.label}
</span>
