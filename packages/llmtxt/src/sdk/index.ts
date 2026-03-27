/**
 * llmtxt SDK: collaborative document primitives.
 *
 * Import from `llmtxt/sdk` for the full SDK surface, or import individual
 * types from the main `llmtxt` package.
 */

// ── Document ──────────────────────────────────────────────────
export { LlmtxtDocument } from './document.js';
export type { LlmtxtDocumentOptions, CreateVersionOptions } from './document.js';

// ── Storage Adapter ───────────────────────────────────────────
export type { StorageAdapter } from './storage-adapter.js';

// ── Lifecycle ──────────────────────────────────────────────────
export type { DocumentState, StateTransition, TransitionResult } from './lifecycle.js';
export {
  DOCUMENT_STATES,
  isValidTransition,
  validateTransition,
  isEditable,
  isTerminal,
} from './lifecycle.js';

// ── Versions ───────────────────────────────────────────────────
export type {
  VersionEntry,
  ReconstructionResult,
  PatchValidationResult,
  VersionDiffSummary,
} from './versions.js';
export {
  reconstructVersion,
  validatePatchApplies,
  squashPatches,
  computeReversePatch,
  diffVersions,
} from './versions.js';

// ── Attribution ────────────────────────────────────────────────
export type { VersionAttribution, ContributorSummary } from './attribution.js';
export { attributeVersion, buildContributorSummary } from './attribution.js';

// ── Consensus ──────────────────────────────────────────────────
export type { ApprovalStatus, Review, ApprovalPolicy, ApprovalResult } from './consensus.js';
export { DEFAULT_APPROVAL_POLICY, evaluateApprovals, markStaleReviews } from './consensus.js';

// ── Storage ────────────────────────────────────────────────────
export type {
  StorageType,
  CompressionMethod,
  ContentRef,
  StorageMetadata,
} from './storage.js';
export {
  inlineRef,
  objectStoreRef,
  versionStorageKey,
  shouldUseObjectStore,
} from './storage.js';

// ── Retrieval ──────────────────────────────────────────────────
export type { PlannedSection, RetrievalPlan, RetrievalOptions } from './retrieval.js';
export { planRetrieval, estimateRetrievalCost } from './retrieval.js';
