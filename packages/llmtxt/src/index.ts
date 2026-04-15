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

// ── Multi-way Diff, Cherry-Pick Merge, & 3-Way Merge ──────────
export { multiWayDiff, cherryPickMerge, threeWayMerge } from './patch.js';
export type {
  MultiDiffVariant,
  MultiDiffLine,
  MultiDiffStats,
  MultiDiffResult,
  CherryPickProvenance,
  CherryPickStats,
  CherryPickResult,
  Conflict,
  MergeStats,
  ThreeWayMergeResult,
} from './patch.js';

// ── RBAC ────────────────────────────────────────────────────────
export { roleHasPermission, rolePermissions } from './wasm.js';
export { ROLE_PERMISSIONS } from './types.js';
export type { DocumentRole, OrgRole, Permission } from './types.js';

// ── Slug Generation ────────────────────────────────────────────
export { slugify } from './wasm.js';

// ── Vector Normalization ─────────────────────────────────────────
export { l2Normalize } from './wasm.js';

// ── Webhook Signing ─────────────────────────────────────────────
export { signWebhookPayload } from './wasm.js';

// ── Cosine Similarity ────────────────────────────────────────────
export { cosineSimilarity } from './wasm.js';

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

// ── Similarity (WASM-backed, T121) ─────────────────────────────
export {
  contentSimilarity,
  extractNgrams,
  extractWordShingles,
  fingerprintSimilarity,
  jaccardSimilarity,
  minHashFingerprint,
  rankBySimilarity,
  textSimilarity,
} from './similarity.js';

export type { SimilarityRankResult } from './wasm.js';

// ── Knowledge Graph (WASM-backed, T122) ────────────────────────
export {
  buildGraph,
  extractDirectives,
  extractMentions,
  extractTags,
  topAgents,
  topTopics,
} from './graph.js';

export type {
  GraphEdge,
  GraphNode,
  GraphStats,
  KnowledgeGraph,
  MessageInput,
} from './graph.js';

// ── Format Detection & Content Checks (WASM-backed, T123) ──────
export {
  containsBinaryContent,
  detectFormat,
  findOverlongLine,
} from './wasm.js';

// ── Types ───────────────────────────────────────────────────────
export type {
  ContentFormat,
  DocumentEvent,
  DocumentEventType,
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
