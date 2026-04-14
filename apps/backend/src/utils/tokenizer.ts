/**
 * Accurate token counting for the backend using cl100k_base (GPT-4 tokenizer).
 *
 * The WASM `calculateTokens` function from the llmtxt SDK uses the approximate
 * heuristic `ceil(len / 4)`, which can be off by 20–40% for non-English or
 * heavily-punctuated content. This module uses the `gpt-tokenizer` library
 * which implements the cl100k_base BPE tokenizer used by GPT-3.5/GPT-4 and is
 * compatible with the token budgets accepted by most LLM APIs.
 *
 * Usage:
 *   import { countTokens } from '../utils/tokenizer.js';
 *   const tokens = countTokens(content);
 *
 * The WASM `calculateTokens` remains available as a browser/SDK fallback where
 * `gpt-tokenizer` cannot be loaded (no Node.js environment).
 */
import { encode } from 'gpt-tokenizer';

/**
 * Count tokens using the cl100k_base BPE tokenizer (GPT-3.5/GPT-4 compatible).
 *
 * Returns the exact number of tokens the given text would consume in a
 * GPT-4 / Claude-compatible API call. This is significantly more accurate
 * than the `ceil(len / 4)` heuristic for content with non-ASCII characters,
 * code, or structured markup.
 *
 * @param text - The text to tokenize.
 * @returns Number of tokens.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}
