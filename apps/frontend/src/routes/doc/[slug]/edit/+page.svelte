<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client';
  import StateBadge from '$lib/components/StateBadge.svelte';
  import type { DocumentState } from '$lib/types';

  let { data } = $props();

  let originalContent = $derived(data.originalContent);
  let modified = $state('');
  let initialized = $state(false);

  $effect(() => {
    if (!initialized && originalContent) {
      modified = originalContent;
      initialized = true;
    }
  });
  let changelog = $state('');
  let submitting = $state(false);
  let error = $state('');

  let state = $derived<DocumentState>((data.doc?.state as DocumentState) || 'DRAFT');
  let isEditable = $derived(state === 'DRAFT' || state === 'REVIEW');

  let hasChanges = $derived(modified !== originalContent);

  // Compute a simple line diff for preview
  let diffLines = $derived(() => {
    if (!hasChanges) return [];

    const oldLines = originalContent.split('\n');
    const newLines = modified.split('\n');
    const result: Array<{ type: 'added' | 'removed' | 'context'; content: string }> = [];

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;

      if (oldLine === newLine) {
        result.push({ type: 'context', content: oldLine ?? '' });
      } else {
        if (oldLine !== undefined) {
          result.push({ type: 'removed', content: oldLine });
        }
        if (newLine !== undefined) {
          result.push({ type: 'added', content: newLine });
        }
      }
    }

    return result;
  });

  async function handleSubmit() {
    if (!hasChanges || !changelog.trim()) return;
    submitting = true;
    error = '';

    try {
      await api.updateDocument(data.slug, modified, changelog);
      goto(`/doc/${data.slug}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Update failed';
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Edit {data.slug} - llmtxt.my</title>
</svelte:head>

<div class="animate-fade-in container mx-auto px-4 py-6">
  {#if !data.doc}
    <div class="text-center py-16">
      <h1 class="font-display text-2xl text-base-content/40 mb-2">Document not found</h1>
      <a href="/" class="btn btn-primary btn-sm mt-4 font-display">Back home</a>
    </div>
  {:else if !isEditable}
    <div class="text-center py-16">
      <h1 class="font-display text-xl text-base-content/40 mb-2">Document is not editable</h1>
      <p class="text-sm text-base-content/30 mb-4">
        This document is in <StateBadge {state} /> state and cannot be modified.
      </p>
      <a href="/doc/{data.slug}" class="btn btn-primary btn-sm font-display">View document</a>
    </div>
  {:else}
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-3">
        <a href="/doc/{data.slug}" class="btn btn-ghost btn-sm btn-square" aria-label="Back to document">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
          </svg>
        </a>
        <h1 class="font-display text-lg">Editing <span class="text-primary">{data.slug}</span></h1>
        <StateBadge {state} />
      </div>
    </div>

    <!-- Editor layout -->
    <div class="grid lg:grid-cols-2 gap-4 mb-6">
      <!-- Current content (read-only) -->
      <div>
        <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider mb-2">Current</h3>
        <div class="rounded-lg border border-base-content/10 overflow-hidden">
          <pre class="p-4 text-sm leading-relaxed font-display whitespace-pre-wrap break-words min-h-[300px] max-h-[60vh] overflow-y-auto"><code>{originalContent}</code></pre>
        </div>
      </div>

      <!-- Modified content -->
      <div>
        <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider mb-2">Modified</h3>
        <textarea
          class="textarea textarea-bordered w-full font-display text-sm leading-relaxed min-h-[300px] max-h-[60vh]"
          bind:value={modified}
          spellcheck="false"
        ></textarea>
      </div>
    </div>

    <!-- Diff preview -->
    {#if hasChanges}
      <div class="mb-6">
        <h3 class="font-display text-xs text-base-content/30 uppercase tracking-wider mb-2">Diff preview</h3>
        <div class="rounded-lg border border-base-content/10 overflow-hidden max-h-[300px] overflow-y-auto">
          <pre class="text-sm leading-relaxed"><code>{#each diffLines() as line}<div class="{line.type === 'added' ? 'diff-added' : line.type === 'removed' ? 'diff-removed' : 'diff-context'} px-4 py-0.5"><span class="inline-block w-4 text-right text-base-content/20 select-none mr-3 font-display text-xs">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span><span class="{line.type === 'added' ? 'text-success/80' : line.type === 'removed' ? 'text-error/80' : ''}">{line.content}</span></div>{/each}</code></pre>
        </div>
      </div>
    {/if}

    <!-- Submit form -->
    <div class="max-w-lg">
      <label class="form-control w-full mb-4">
        <div class="label">
          <span class="label-text font-display text-xs">Changelog</span>
          <span class="label-text-alt font-display text-xs text-base-content/30">Required</span>
        </div>
        <input
          type="text"
          class="input input-bordered w-full font-display text-sm"
          placeholder="Describe what changed..."
          bind:value={changelog}
        />
      </label>

      {#if error}
        <div class="alert alert-error text-sm font-display mb-4">
          <span>{error}</span>
        </div>
      {/if}

      <div class="flex gap-2">
        <button
          class="btn btn-primary font-display"
          onclick={handleSubmit}
          disabled={submitting || !hasChanges || !changelog.trim()}
        >
          {#if submitting}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            Submit patch
          {/if}
        </button>
        <a href="/doc/{data.slug}" class="btn btn-ghost font-display">
          Cancel
        </a>
      </div>
    </div>
  {/if}
</div>
