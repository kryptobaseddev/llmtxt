/**
 * @packageDocumentation
 * Primitives and SDK for LLM agent content workflows.
 * Compression, validation, progressive disclosure, signed URLs, caching,
 * collaborative document lifecycle, versioning, and retrieval planning.
 * Provider-agnostic. Only external dependency: zod.
 */

// ── Compression & Encoding ──────────────────────────────────────
export {
  encodeBase62,
  decodeBase62,
  compress,
  decompress,
  generateId,
  hashContent,
  calculateTokens,
  calculateCompressionRatio,
  computeDiff,
  structuredDiff,
} from './compression.js';

export type { DiffResult, StructuredDiffLine, StructuredDiffResult } from './compression.js';

// ── Validation ──────────────────────────────────────────────────
export {
  validateJson,
  validateText,
  detectFormat,
  validateContent,
  autoValidate,
  DEFAULT_MAX_CONTENT_BYTES,
  DEFAULT_MAX_LINE_BYTES,
} from './validation.js';

export type {
  ValidationResult,
  ValidationError,
  ValidateContentOptions,
} from './validation.js';

// ── Schemas ─────────────────────────────────────────────────────
export {
  jsonFormatSchema,
  textFormatSchema,
  markdownFormatSchema,
  promptMessageSchema,
  promptV1Schema,
  predefinedSchemas,
  isPredefinedSchema,
  getPredefinedSchema,
  compressRequestSchema,
  decompressRequestSchema,
  searchRequestSchema,
} from './schemas.js';

export type {
  PredefinedSchemaName,
  JsonFormat,
  TextFormat,
  MarkdownFormat,
  PromptV1,
  PromptMessage,
  CompressRequest,
  DecompressRequest,
  SearchRequest,
} from './schemas.js';

// ── Progressive Disclosure ──────────────────────────────────────
export {
  getLineRange,
  searchContent,
  detectDocumentFormat,
  generateOverview,
  queryJsonPath,
  getSection,
} from './disclosure.js';

export type {
  Section,
  DocumentOverview,
  SearchResult,
  LineRangeResult,
} from './disclosure.js';

// ── Cache ───────────────────────────────────────────────────────
export { LRUCache } from './cache.js';

export type {
  CacheStats,
  LRUCacheOptions,
} from './cache.js';

// ── Signed URLs & Security ──────────────────────────────────────
export {
  computeSignature,
  computeSignatureWithLength,
  computeOrgSignature,
  computeOrgSignatureWithLength,
  generateSignedUrl,
  generateOrgSignedUrl,
  verifySignedUrl,
  verifyOrgSignedUrl,
  generateTimedUrl,
  deriveSigningKey,
  isExpired,
} from './signed-url.js';

export type {
  SignedUrlParams,
  OrgSignedUrlParams,
  SignedUrlConfig,
  VerifyResult,
} from './signed-url.js';

// ── Patching ───────────────────────────────────────────────────
export { createPatch, applyPatch, reconstructVersion, squashPatchesWasm } from './patch.js';

// ── Multi-way Diff & Cherry-Pick Merge ─────────────────────────
export { multiWayDiff, cherryPickMerge } from './patch.js';
export type {
  MultiDiffVariant,
  MultiDiffLine,
  MultiDiffStats,
  MultiDiffResult,
  CherryPickProvenance,
  CherryPickStats,
  CherryPickResult,
} from './patch.js';

// ── Semantic Diff & Consensus ───────────────────────────────────
export { semanticDiff, semanticConsensus } from './wasm.js';
export type {
  SectionAlignment,
  SectionSimilarity,
  SemanticChange,
  SemanticDiffResult,
  ReviewCluster,
  SemanticConsensusResult,
} from './wasm.js';

// ── Snapshot Compression ───────────────────────────────────────
export {
  compressSnapshot,
  decompressSnapshot,
  compressSessionData,
  decompressSessionData,
  snapshotSummary,
} from './snapshot.js';

export type {
  SnapshotMeta,
  CompressedSnapshot,
  SnapshotOptions,
} from './snapshot.js';

// ── Client ─────────────────────────────────────────────────────
export { createClient } from './client.js';
export type {
  LlmtxtClientConfig,
  UploadResult,
  FetchResult,
  ReshareResult,
  ResignResult,
  AttachmentVersionResult,
} from './client.js';

// ── Similarity ─────────────────────────────────────────────────
export {
  extractNgrams,
  extractWordShingles,
  jaccardSimilarity,
  textSimilarity,
  contentSimilarity,
  minHashFingerprint,
  fingerprintSimilarity,
  rankBySimilarity,
} from './similarity.js';

// ── Knowledge Graph ────────────────────────────────────────────
export {
  extractMentions,
  extractTags,
  extractDirectives,
  buildGraph,
  topTopics,
  topAgents,
} from './graph.js';

export type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  MessageInput,
} from './graph.js';

// ── Types ───────────────────────────────────────────────────────
export type {
  ContentFormat,
  DocumentMeta,
  VersionMeta,
  VersionSummary,
  VersionDiff,
  LlmtxtRef,
  AttachmentOptions,
  AttachmentAccessMode,
  AttachmentSharingMode,
  AttachmentReshareOptions,
  AttachmentVersionOptions,
} from './types.js';

// ── SDK Types (re-exported for convenience) ────────────────────
export type { StorageAdapter } from './sdk/storage-adapter.js';
export type { LlmtxtDocumentOptions, CreateVersionOptions } from './sdk/document.js';
export { LlmtxtDocument } from './sdk/document.js';

export type {
  DocumentState,
  StateTransition,
  TransitionResult,
} from './sdk/lifecycle.js';

export type {
  VersionEntry,
  ReconstructionResult,
  PatchValidationResult,
  VersionDiffSummary,
} from './sdk/versions.js';

export type {
  ApprovalStatus,
  Review,
  ApprovalPolicy,
  ApprovalResult,
} from './sdk/consensus.js';

export type {
  VersionAttribution,
  ContributorSummary,
} from './sdk/attribution.js';

export type {
  StorageType,
  CompressionMethod,
  ContentRef,
  StorageMetadata,
} from './sdk/storage.js';

export type {
  PlannedSection,
  RetrievalPlan,
  RetrievalOptions,
} from './sdk/retrieval.js';
