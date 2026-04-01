<script lang="ts">
  import type { Review, Consensus, DocumentState } from '$lib/types';

  let { reviews, consensus, docState, onApprove, onReject }: {
    reviews: Review[];
    consensus: Consensus | null;
    docState: DocumentState;
    onApprove?: (comment: string) => void;
    onReject?: (comment: string) => void;
  } = $props();

  let comment = $state('');
  let submitting = $state(false);

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
</script>

<div class="space-y-4">
  {#if consensus}
    <div class="flex items-center gap-4 p-4 rounded-lg bg-base-200/50">
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-2">
          {#if consensus.approved}
            <span class="badge badge-success badge-sm font-display">APPROVED</span>
          {:else if rejectedCount > 0}
            <span class="badge badge-error badge-sm font-display">REJECTED</span>
          {:else}
            <span class="badge badge-warning badge-sm font-display">PENDING</span>
          {/if}
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
    </div>
  {/if}

  {#if canVote}
    <div class="space-y-3">
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
          {#if submitting}<span class="loading loading-spinner loading-xs"></span>{:else}Approve{/if}
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
  {:else if docState === 'DRAFT'}
    <div class="p-3 rounded-lg bg-base-200/30 border border-base-content/5">
      <p class="text-xs font-display text-base-content/40">
        Voting is available when the document is in <span class="text-warning font-bold">REVIEW</span> state. Transition from DRAFT to REVIEW to enable approvals.
      </p>
    </div>
  {:else if docState === 'LOCKED' || docState === 'ARCHIVED'}
    <div class="p-3 rounded-lg bg-base-200/30 border border-base-content/5">
      <p class="text-xs font-display text-base-content/40">
        This document is <span class="font-bold">{docState}</span> and no longer accepting votes.
      </p>
    </div>
  {/if}

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
            <span class="text-xs text-base-content/30">{formatDate(review.timestamp)}</span>
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
