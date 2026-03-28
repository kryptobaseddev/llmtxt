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
      onApprove?.(comment);
      comment = '';
    } finally {
      submitting = false;
    }
  }

  async function handleReject() {
    if (!comment.trim()) return;
    submitting = true;
    try {
      onReject?.(comment);
      comment = '';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="space-y-4">
  <!-- Consensus status -->
  {#if consensus}
    <div class="flex items-center gap-4 p-4 rounded-lg bg-base-200/50">
      <div class="flex-1">
        <div class="flex items-center gap-2 mb-2">
          {#if consensus.approved}
            <span class="badge badge-success badge-sm font-display">APPROVED</span>
          {:else if consensus.rejected}
            <span class="badge badge-error badge-sm font-display">REJECTED</span>
          {:else}
            <span class="badge badge-warning badge-sm font-display">PENDING</span>
          {/if}
        </div>
        <div class="flex gap-4 text-xs font-display text-base-content/50">
          <span class="text-success">{consensus.approvedCount} approved</span>
          <span class="text-error">{consensus.rejectedCount} rejected</span>
          <span>{consensus.requiredCount} required</span>
        </div>
      </div>

      <!-- Progress ring -->
      <div class="radial-progress text-primary text-xs font-display"
           style="--value:{Math.min(Math.round((consensus.approvedCount / Math.max(consensus.requiredCount, 1)) * 100), 100)}; --size:3rem; --thickness:3px;"
           role="progressbar">
        {consensus.approvedCount}/{consensus.requiredCount}
      </div>
    </div>
  {/if}

  <!-- Vote form -->
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
          Approve
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
  {/if}

  <!-- Review history -->
  <div class="space-y-2">
    <h4 class="font-display text-xs text-base-content/40 uppercase tracking-wider">
      Reviews
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
