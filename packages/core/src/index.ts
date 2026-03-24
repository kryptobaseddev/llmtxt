/**
 * @packageDocumentation
 * Core primitives for LLM agent content workflows.
 * Compression, validation, progressive disclosure, signed URLs, and caching.
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
} from './compression.js';

export type { DiffResult } from './compression.js';

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

// ── Client ─────────────────────────────────────────────────────
export { createClient } from './client.js';
export type { LlmtxtClientConfig, UploadResult, FetchResult } from './client.js';

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
} from './types.js';
