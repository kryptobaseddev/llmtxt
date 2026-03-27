// Re-export compression utilities from llmtxt.
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
} from 'llmtxt';

export type { DiffResult } from 'llmtxt';
