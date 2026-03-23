/**
 * Compression, encoding, hashing, and token estimation.
 *
 * All portable primitives delegate to the Rust WASM module — single
 * source of truth, zero drift between TypeScript and Rust consumers.
 */
export {
  encodeBase62,
  decodeBase62,
  compress,
  decompress,
  generateId,
  hashContent,
  calculateTokens,
  calculateCompressionRatio,
} from './wasm.js';
