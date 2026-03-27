/**
 * Document lifecycle state machine.
 *
 * Defines the allowed states for collaborative documents and validates
 * transitions between them. All functions are pure -- no side effects,
 * no storage calls.
 */

// ── States ─────────────────────────────────────────────────────

/** Lifecycle state of a collaborative document. */
export type DocumentState = 'DRAFT' | 'REVIEW' | 'LOCKED' | 'ARCHIVED';

/** All valid document states in lifecycle order. */
export const DOCUMENT_STATES: readonly DocumentState[] = [
  'DRAFT',
  'REVIEW',
  'LOCKED',
  'ARCHIVED',
] as const;

// ── Transition Rules ───────────────────────────────────────────

/**
 * Allowed forward transitions.
 *
 * DRAFT can go to REVIEW or directly to LOCKED (skip review).
 * REVIEW can go to LOCKED or back to DRAFT (reopen for edits).
 * LOCKED can go to ARCHIVED.
 * ARCHIVED is terminal.
 */
const ALLOWED_TRANSITIONS: Record<DocumentState, readonly DocumentState[]> = {
  DRAFT: ['REVIEW', 'LOCKED'],
  REVIEW: ['DRAFT', 'LOCKED'],
  LOCKED: ['ARCHIVED'],
  ARCHIVED: [],
};

// ── Transition Metadata ────────────────────────────────────────

/** Record of a lifecycle state change. */
export interface StateTransition {
  /** State before the transition. */
  from: DocumentState;
  /** State after the transition. */
  to: DocumentState;
  /** Agent that initiated the transition. */
  changedBy: string;
  /** Timestamp of the transition (ms since epoch). */
  changedAt: number;
  /** Human-readable reason for the transition. */
  reason?: string;
  /** Document version number at the time of transition. */
  atVersion: number;
}

// ── Validation ─────────────────────────────────────────────────

/**
 * Check whether a state transition is allowed.
 *
 * @param from - Current document state.
 * @param to - Target document state.
 * @returns `true` if the transition is permitted by the lifecycle rules.
 */
export function isValidTransition(from: DocumentState, to: DocumentState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Result of attempting a state transition. */
export interface TransitionResult {
  /** Whether the transition is allowed. */
  valid: boolean;
  /** Human-readable explanation when invalid. */
  reason?: string;
  /** The allowed targets from the current state (for error context). */
  allowedTargets: readonly DocumentState[];
}

/**
 * Validate a proposed state transition with a detailed result.
 *
 * @param from - Current document state.
 * @param to - Target document state.
 * @returns A result object indicating validity and allowed alternatives.
 */
export function validateTransition(from: DocumentState, to: DocumentState): TransitionResult {
  const allowedTargets = ALLOWED_TRANSITIONS[from];

  if (from === to) {
    return { valid: false, reason: `Document is already in ${from} state`, allowedTargets };
  }

  if (!allowedTargets.includes(to)) {
    return {
      valid: false,
      reason: `Cannot transition from ${from} to ${to}. Allowed: ${allowedTargets.join(', ') || 'none (terminal state)'}`,
      allowedTargets,
    };
  }

  return { valid: true, allowedTargets };
}

/**
 * Check whether a document state allows content modifications.
 *
 * @param state - Current document state.
 * @returns `true` if new versions can be created in this state.
 */
export function isEditable(state: DocumentState): boolean {
  return state === 'DRAFT' || state === 'REVIEW';
}

/**
 * Check whether a document state is terminal (no further transitions).
 *
 * @param state - Current document state.
 * @returns `true` if the state has no outgoing transitions.
 */
export function isTerminal(state: DocumentState): boolean {
  return ALLOWED_TRANSITIONS[state].length === 0;
}
