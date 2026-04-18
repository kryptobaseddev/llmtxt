/**
 * llmtxt SDK: collaborative document primitives.
 *
 * Import from `llmtxt/sdk` for the full SDK surface, or import individual
 * types from the main `llmtxt` package.
 */
export { LlmtxtDocument } from './document.js';
export type { LlmtxtDocumentOptions, CreateVersionOptions } from './document.js';
export type { StorageAdapter } from './storage-adapter.js';
export type { DocumentState, StateTransition, TransitionResult } from './lifecycle.js';
export { DOCUMENT_STATES, isValidTransition, validateTransition, isEditable, isTerminal, } from './lifecycle.js';
export type { VersionEntry, ReconstructionResult, PatchValidationResult, VersionDiffSummary, } from './versions.js';
export { reconstructVersion, validatePatchApplies, squashPatches, computeReversePatch, diffVersions, } from './versions.js';
export type { VersionAttribution, ContributorSummary } from './attribution.js';
export { attributeVersion, buildContributorSummary } from './attribution.js';
export type { ApprovalStatus, Review, ApprovalPolicy, ApprovalResult } from './consensus.js';
export { DEFAULT_APPROVAL_POLICY, evaluateApprovals, markStaleReviews } from './consensus.js';
export type { StorageType, CompressionMethod, ContentRef, StorageMetadata, } from './storage.js';
export { inlineRef, objectStoreRef, versionStorageKey, shouldUseObjectStore, } from './storage.js';
export type { PlannedSection, RetrievalPlan, RetrievalOptions } from './retrieval.js';
export { planRetrieval, estimateRetrievalCost } from './retrieval.js';
export type { BFTApprovalStatus, SignedApprovalEnvelope, BFTApprovalResponse, BFTStatusResponse, ChainVerificationResponse, } from './bft.js';
export { bftQuorum, buildApprovalCanonicalPayload, signApproval, submitSignedApproval, getBFTStatus, verifyApprovalChain, } from './bft.js';
export type { ScratchpadMessage, SendScratchpadOptions, ReadScratchpadOptions } from './scratchpad.js';
export { sendScratchpad, readScratchpad, onScratchpadMessage } from './scratchpad.js';
export type { A2AEnvelope, BuildA2AOptions, InboxDeliveryResponse, InboxMessage, InboxPollResponse, } from './a2a.js';
export { A2AMessage, buildA2AMessage, sendToInbox, pollInbox, onDirectMessage, } from './a2a.js';
export type { ContributionReceipt, AgentSessionOptions } from './session.js';
export { AgentSession, AgentSessionError, AgentSessionState } from './session.js';
//# sourceMappingURL=index.d.ts.map