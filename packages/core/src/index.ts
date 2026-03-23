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
} from './compression.js';

// ── Validation ──────────────────────────────────────────────────
export {
  validateJson,
  validateText,
  detectFormat,
  validateContent,
  autoValidate,
} from './validation.js';

export type {
  ValidationResult,
  ValidationError,
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

// ── Signed URLs ─────────────────────────────────────────────────
export {
  computeSignature,
  generateSignedUrl,
  verifySignedUrl,
  generateTimedUrl,
} from './signed-url.js';

export type {
  SignedUrlParams,
  SignedUrlConfig,
  VerifyResult,
} from './signed-url.js';
