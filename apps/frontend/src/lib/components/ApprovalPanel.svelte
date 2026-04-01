<script lang="ts">
  import type { Review, Consensus, DocumentState } from '$lib/types';

  let { reviews, consensus, docState, currentVersion, onApprove, onReject, onTransition }: {
    reviews: Review[];
    consensus: Consensus | null;
    docState: DocumentState;
    currentVersion: number;
    onApprove?: (comment: string) => void;
    onReject?: (comment: string) => void;
    onTransition?: (target: DocumentState, reason?: string) => Promise<void>;
  } = $props();

  let comment = $state('');
  let submitting = $state(false);
  let transitionReason = $state('');
  let transitionTarget = $state<DocumentState | null>(null);
  let transitioning = $state(false);

  let canVote = $derived(docState === 'REVIEW');
  let approvedCount = $derived(consensus?.approvedBy.length ?? 0);
  let rejectedCount = $derived(consensus?.rejectedBy.length ?? 0);
  let pendingCount = $derived(consensus?.pendingFrom.length ?? 0);
  let totalReviews = $derived(reviews.length);

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function handleApprove() {
    submitting = true;
    try {
      await onApprove?.(comment);
      comment = '';
    } finally {
      submitting = false;
    }
  }

  async function handleReject() {
    if (!comment.trim()) return;
    submitting = true;
    try {
      await onReject?.(comment);
      comment = '';
    } finally {
      submitting = false;
    }
  }

  async function handleTransition() {
    if (!transitionTarget) return;
    transitioning = true;
    try {
      await onTransition?.(transitionTarget, transitionReason || undefined);
      transitionTarget = null;
      transitionReason = '';
    } finally {
      transitioning = false;
    }
  }
</script>

<div class="space-y-4">
  <!-- Consensus status -->
  {#if consensus}
    <div class="p-4 rounded-lg bg-base-200/50">
      <div class="flex items-center gap-2 mb-2">
        {#if consensus.approved}
          <span class="badge badge-success badge-sm font-display">APPROVED</span>
        {:else if rejectedCount > 0}
          <span class="badge badge-error badge-sm font-display">REJECTED</span>
        {:else}
          <span class="badge badge-warning badge-sm font-display">PENDING</span>
        {/if}
        <span class="badge badge-ghost badge-sm font-display">{docState}</span>
      </div>
      <p class="text-xs font-display text-base-content/50 mb-2">{consensus.reason}</p>
      <div class="flex gap-4 text-xs font-display text-base-content/50">
        <span class="text-success">{approvedCount} approved</span>
        <span class="text-error">{rejectedCount} rejected</span>
        <span>{pendingCount} pending</span>
        {#if (consensus?.staleFrom?.length ?? 0) > 0}
          <span class="text-warning">{consensus?.staleFrom?.length} stale</span>
        {/if}
      </div>
    </div>
  {/if}

  <!-- State-aware action area -->
  {#if docState === 'DRAFT'}
    <div class="p-4 rounded-lg border border-warning/20 bg-warning/5">
      <p class="text-sm font-display text-base-content/60 mb-3">
        This document is in <span class="text-warning font-bold">DRAFT</span>. Submit it for review to enable voting.
      </p>
      {#if transitionTarget === 'REVIEW'}
        <input
          type="text"
          class="input input-bordered input-sm w-full font-display text-sm mb-2"
          placeholder="Reason for review (optional)"
          bind:value={transitionReason}
        />
        <div class="flex gap-2">
          <button class="btn btn-warning btn-sm font-display" onclick={handleTransition} disabled={transitioning}>
            {#if transitioning}<span class="loading loading-spinner loading-xs"></span>{:else}Confirm{/if}
          </button>
          <button class="btn btn-ghost btn-sm font-display" onclick={() => transitionTarget = null}>Cancel</button>
        </div>
      {:else}
        <button class="btn btn-warning btn-sm font-display" onclick={() => transitionTarget = 'REVIEW'}>
          Submit for Review
        </button>
      {/if}
    </div>

  {:else if canVote}
    <!-- Voting UI -->
    <div class="space-y-3">
      <p class="text-xs font-display text-base-content/40">
        Reviewing <span class="text-primary font-bold">v{currentVersion}</span> — your vote applies to this version. If the document is edited, your vote becomes stale.
      </p>
      <textarea
        class="textarea textarea-bordered w-full font-display text-sm"
        placeholder="Comment (required for rejection)"
        rows={2}
        bind:value={comment}
      ></textarea>
      <div class="flex gap-2">
        <button
          class="btn btn-success btn-sm font-display"
          onclick={handleApprove}
          disabled={submitting}
        >
          {#if submitting}<span class="loading loading-spinner loading-xs"></span>{:else}Approve v{currentVersion}{/if}
        </button>
        <button
          class="btn btn-error btn-sm btn-outline font-display"
          onclick={handleReject}
          disabled={submitting || !comment.trim()}
        >
          Reject
        </button>
      </div>
    </div>

    <!-- Send back to draft option -->
    {#if rejectedCount > 0}
      <div class="p-3 rounded-lg border border-error/20 bg-error/5">
        <p class="text-xs font-display text-base-content/50 mb-2">
          This document has rejections. Send it back to DRAFT for revisions?
        </p>
        {#if transitionTarget === 'DRAFT'}
          <input
            type="text"
            class="input input-bordered input-sm w-full font-display text-sm mb-2"
            placeholder="Reason for sending back (optional)"
            bind:value={transitionReason}
          />
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm font-display" onclick={handleTransition} disabled={transitioning}>
              {#if transitioning}<span class="loading loading-spinner loading-xs"></span>{:else}Send Back{/if}
            </button>
            <button class="btn btn-ghost btn-sm font-display text-xs" onclick={() => transitionTarget = null}>Cancel</button>
          </div>
        {:else}
          <button class="btn btn-ghost btn-sm font-display" onclick={() => transitionTarget = 'DRAFT'}>
            Back to Draft
          </button>
        {/if}
      </div>
    {/if}

  {:else if docState === 'LOCKED'}
    <div class="p-3 rounded-lg bg-info/5 border border-info/20">
      <p class="text-xs font-display text-base-content/50">
        This document is <span class="text-info font-bold">LOCKED</span> — consensus was reached. No further voting.
      </p>
    </div>

  {:else if docState === 'ARCHIVED'}
    <div class="p-3 rounded-lg bg-base-200/30 border border-base-content/5">
      <p class="text-xs font-display text-base-content/40">
        This document is <span class="font-bold">ARCHIVED</span>.
      </p>
    </div>
  {/if}

  <!-- Review history -->
  <div class="space-y-2">
    <h4 class="font-display text-xs text-base-content/40 uppercase tracking-wider">
      Reviews ({totalReviews})
    </h4>
    {#each reviews as review (review.id)}
      <div class="flex items-start gap-3 py-2 border-b border-base-content/5 last:border-0">
        <span class="badge {review.status === 'APPROVED' ? 'badge-success' : 'badge-error'} badge-xs mt-1"></span>
        <div class="flex-1">
          <div class="flex items-baseline justify-between">
            <span class="font-display text-xs">{review.reviewerId.slice(0, 8)}</span>
            <div class="flex items-center gap-2">
              <span class="text-xs text-base-content/20">v{review.atVersion}</span>
              <span class="text-xs text-base-content/30">{formatDate(review.timestamp)}</span>
            </div>
          </div>
          {#if review.reason}
            <p class="text-sm text-base-content/60 mt-0.5">{review.reason}</p>
          {/if}
        </div>
      </div>
    {/each}

    {#if reviews.length === 0}
      <p class="text-sm text-base-content/40 text-center py-4">
        No reviews yet
      </p>
    {/if}
  </div>
</div>
