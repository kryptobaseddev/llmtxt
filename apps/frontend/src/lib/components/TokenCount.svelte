<script lang="ts">
  let { tokens, originalTokens, size = 'md' }: {
    tokens: number;
    originalTokens?: number;
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  let formatted = $derived(
    tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
  );

  let savings = $derived(
    originalTokens && originalTokens > tokens
      ? Math.round(((originalTokens - tokens) / originalTokens) * 100)
      : null
  );

  let sizeClasses = $derived({
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg',
  }[size]);
</script>

<span class="inline-flex items-center gap-1.5 font-display {sizeClasses}">
  <span class="opacity-50">~</span>
  <span>{formatted}</span>
  <span class="opacity-50">tokens</span>
  {#if savings}
    <span class="text-success text-xs">(-{savings}%)</span>
  {/if}
</span>
