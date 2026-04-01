/** Re-export compression, hashing, encoding, and diff utilities from the llmtxt SDK. */
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
} from 'llmtxt';

export type { DiffResult, StructuredDiffLine, StructuredDiffResult } from 'llmtxt';
