<script lang="ts">
  import type { DocumentFormat } from '$lib/types';

  let { format }: { format: DocumentFormat } = $props();

  const config: Record<string, { class: string; icon: string }> = {
    json: { class: 'badge-secondary', icon: '{ }' },
    markdown: { class: 'badge-accent', icon: 'MD' },
    text: { class: 'badge-neutral', icon: 'TXT' },
    code: { class: 'badge-primary', icon: '</>' },
  };

  let badge = $derived(config[format] || config.text);
</script>

<span class="badge {badge.class} badge-sm font-display text-xs tracking-wider">
  {badge.icon}
</span>
