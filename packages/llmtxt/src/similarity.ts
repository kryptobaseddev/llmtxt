/**
 * Lightweight content similarity using n-gram fingerprinting.
 *
 * All similarity primitives are now backed by crates/llmtxt-core via WASM
 * (SSoT enforcement, T111/T121). This file re-exports the WASM-backed
 * implementations from wasm.ts to preserve the public API surface.
 *
 * Note: `cosine_similarity` lives in semantic.rs (from Wave A, T116).
 * This module covers Jaccard/MinHash/ranking variants.
 *
 * @module similarity
 */

export type { SimilarityRankResult } from './wasm.js';

export {
  contentSimilarity,
  extractNgrams,
  extractWordShingles,
  fingerprintSimilarity,
  jaccardSimilarity,
  minHashFingerprint,
  rankBySimilarity,
} from './wasm.js';

// textSimilarity delegates to jaccardSimilarity (n-gram based) for backward compat.
export { jaccardSimilarity as textSimilarity } from './wasm.js';
