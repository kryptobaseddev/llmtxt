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

// ── W3: BFT Consensus ──────────────────────────────────────────
export type {
  BFTApprovalStatus,
  SignedApprovalEnvelope,
  BFTApprovalResponse,
  BFTStatusResponse,
  ChainVerificationResponse,
} from './bft.js';
export {
  bftQuorum,
  buildApprovalCanonicalPayload,
  signApproval,
  submitSignedApproval,
  getBFTStatus,
  verifyApprovalChain,
} from './bft.js';

// ── W3: Scratchpad Messaging ──────────────────────────────────
export type { ScratchpadMessage, SendScratchpadOptions, ReadScratchpadOptions } from './scratchpad.js';
export { sendScratchpad, readScratchpad, onScratchpadMessage } from './scratchpad.js';

// ── W3: A2A Agent-to-Agent Messaging ─────────────────────────
export type {
  A2AEnvelope,
  BuildA2AOptions,
  InboxDeliveryResponse,
  InboxMessage,
  InboxPollResponse,
} from './a2a.js';
export {
  A2AMessage,
  buildA2AMessage,
  sendToInbox,
  pollInbox,
  onDirectMessage,
} from './a2a.js';
