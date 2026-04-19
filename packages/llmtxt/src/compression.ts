/**
 * Compression, encoding, hashing, and token estimation.
 *
 * All portable primitives delegate to the Rust WASM module — single
 * source of truth, zero drift between TypeScript and Rust consumers.
 *
 * ### Compression codec (T708 — zstd migration)
 *
 * - **compress** now writes **zstd** (RFC 8478, level 3).
 * - **decompress** auto-detects the codec from magic bytes:
 *   - `0xFD 0x2F 0xB5 0x28` → zstd (new writes)
 *   - `0x78 __` → zlib/deflate (legacy rows — backward compatible)
 * - **zstdCompressBytes** / **zstdDecompressBytes** operate on raw binary
 *   data (blobs, CRDT snapshots) without string coercion.
 */
export {
  encodeBase62,
  decodeBase62,
  compress,
  decompress,
  zstdCompressBytes,
  zstdDecompressBytes,
  generateId,
  hashContent,
  hashBlob,
  calculateTokens,
  calculateCompressionRatio,
  computeDiff,
  structuredDiff,
} from './wasm.js';

export type { DiffResult, StructuredDiffLine, StructuredDiffResult } from './wasm.js';
