/**
 * Consensus and approval workflow evaluation.
 *
 * Pure types and functions for multi-agent review/approval workflows.
 * No storage, no side effects -- just evaluation logic.
 */

// ── Types ──────────────────────────────────────────────────────

/** Status of an individual review. */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'STALE';

/** A single review from an agent. */
export interface Review {
  /** Agent that submitted the review. */
  reviewerId: string;
  /** Current status of this review. */
  status: ApprovalStatus;
  /** Timestamp of the review action (ms since epoch). */
  timestamp: number;
  /** Reason or comment provided with the review. */
  reason?: string;
  /** Version number the review applies to (`STALE` if document changed since). */
  atVersion: number;
}

/** Policy governing how approvals are evaluated. */
export interface ApprovalPolicy {
  /** Minimum number of approvals required (absolute count).
   *  Ignored when `requiredPercentage` is set (> 0). */
  requiredCount: number;
  /** If true, all allowed reviewers must approve (overrides count/percentage). */
  requireUnanimous: boolean;
  /** Agent IDs allowed to review. Empty means anyone can review. */
  allowedReviewerIds: string[];
  /** Auto-expire reviews older than this (ms). 0 means no timeout. */
  timeoutMs: number;
  /** Percentage of effective reviewers required (0-100). 0 means use requiredCount.
   *  When > 0, threshold = ceil(percentage * effectiveReviewerCount / 100). */
  requiredPercentage?: number;
}

/** Result of evaluating reviews against a policy. */
export interface ApprovalResult {
  /** Whether the approval threshold is met. */
  approved: boolean;
  /** Reviewers that have approved. */
  approvedBy: string[];
  /** Reviewers that have rejected. */
  rejectedBy: string[];
  /** Reviewers that are still pending. */
  pendingFrom: string[];
  /** Reviewers whose reviews are stale (document changed since). */
  staleFrom: string[];
  /** Human-readable summary of the evaluation. */
  reason: string;
}

// ── Defaults ───────────────────────────────────────────────────

/** Default approval policy: 1 approval, no timeout. */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  requiredCount: 1,
  requireUnanimous: false,
  allowedReviewerIds: [],
  timeoutMs: 0,
  requiredPercentage: 0,
};

// ── Evaluation ─────────────────────────────────────────────────

/**
 * Evaluate reviews against an approval policy.
 *
 * Filters out stale and timed-out reviews, then checks whether the
 * remaining approvals meet the policy threshold.
 *
 * @param reviews - All reviews submitted for the document.
 * @param policy - The approval policy to evaluate against.
 * @param currentVersion - Current document version (reviews for older versions are stale).
 * @param now - Current timestamp (ms since epoch). Defaults to `Date.now()`.
 * @returns The approval evaluation result.
 */
export function evaluateApprovals(
  reviews: Review[],
  policy: ApprovalPolicy,
  currentVersion: number,
  now?: number,
): ApprovalResult {
  const timestamp = now ?? Date.now();

  const approvedBy: string[] = [];
  const rejectedBy: string[] = [];
  const pendingFrom: string[] = [];
  const staleFrom: string[] = [];

  // Determine effective reviewers
  const effectiveReviewers = policy.allowedReviewerIds.length > 0
    ? policy.allowedReviewerIds
    : [...new Set(reviews.map(r => r.reviewerId))];

  const reviewMap = new Map<string, Review>();
  for (const review of reviews) {
    // Keep latest review per reviewer
    const existing = reviewMap.get(review.reviewerId);
    if (!existing || review.timestamp > existing.timestamp) {
      reviewMap.set(review.reviewerId, review);
    }
  }

  for (const reviewerId of effectiveReviewers) {
    const review = reviewMap.get(reviewerId);
    if (!review) {
      pendingFrom.push(reviewerId);
      continue;
    }

    // Mark stale if review was for an older version
    if (review.atVersion < currentVersion) {
      staleFrom.push(reviewerId);
      continue;
    }

    // Mark stale if review timed out
    if (policy.timeoutMs > 0 && (timestamp - review.timestamp) > policy.timeoutMs) {
      staleFrom.push(reviewerId);
      continue;
    }

    if (review.status === 'APPROVED') {
      approvedBy.push(reviewerId);
    } else if (review.status === 'REJECTED') {
      rejectedBy.push(reviewerId);
    } else if (review.status === 'STALE') {
      staleFrom.push(reviewerId);
    } else {
      pendingFrom.push(reviewerId);
    }
  }

  // Evaluate threshold
  let approved: boolean;
  let reason: string;

  if (rejectedBy.length > 0) {
    approved = false;
    reason = `Rejected by ${rejectedBy.join(', ')}`;
  } else if (policy.requireUnanimous) {
    approved = approvedBy.length === effectiveReviewers.length && pendingFrom.length === 0 && staleFrom.length === 0;
    reason = approved
      ? `Unanimous approval (${approvedBy.length}/${effectiveReviewers.length})`
      : `Awaiting unanimous approval (${approvedBy.length}/${effectiveReviewers.length})`;
  } else {
    // Compute effective threshold: percentage overrides count when > 0
    const threshold = (policy.requiredPercentage && policy.requiredPercentage > 0)
      ? Math.ceil(Math.min(policy.requiredPercentage, 100) / 100 * effectiveReviewers.length)
      : policy.requiredCount;
    approved = approvedBy.length >= threshold;
    const thresholdLabel = (policy.requiredPercentage && policy.requiredPercentage > 0)
      ? `${policy.requiredPercentage}% = ${threshold}`
      : `${threshold}`;
    reason = approved
      ? `Approved (${approvedBy.length}/${thresholdLabel} required)`
      : `Needs ${threshold - approvedBy.length} more approval(s) (${approvedBy.length}/${thresholdLabel} required)`;
  }

  return { approved, approvedBy, rejectedBy, pendingFrom, staleFrom, reason };
}

/**
 * Mark reviews as stale when a document version changes.
 *
 * Returns a new array with updated review statuses. Does not mutate input.
 *
 * @param reviews - Current reviews.
 * @param currentVersion - The new document version.
 * @returns Reviews with outdated entries marked as STALE.
 */
export function markStaleReviews(reviews: Review[], currentVersion: number): Review[] {
  return reviews.map(review =>
    review.atVersion < currentVersion && review.status !== 'STALE'
      ? { ...review, status: 'STALE' as const }
      : review,
  );
}
