/**
 * Content classification — TypeScript adapter over Rust WASM classify_content_wasm.
 *
 * All classification logic lives in Rust (SSoT: `crates/llmtxt-core/src/classify/`).
 * This module is a thin adapter responsible for:
 *   1. Input normalization (`string` | `Uint8Array` | `Buffer` → `Uint8Array`)
 *   2. Calling `wasmModule.classify_content_wasm(bytes)`
 *   3. Parsing the JSON result
 *   4. Providing the backward-compat helper `detectFormatFromClassification`
 *
 * @module classify
 */

import * as wasmModule from '../wasm/llmtxt_core.js';

/**
 * Result of {@link classifyContent}.
 *
 * Mirrors `ClassificationResult` from `crates/llmtxt-core/src/classify/types.rs`.
 */
export interface ClassificationResult {
  /** IANA MIME type, e.g. `"application/pdf"`, `"text/markdown"`, `"image/png"`. */
  mimeType: string;

  /** Coarse content category. */
  category: 'binary' | 'text' | 'structured' | 'unknown';

  /**
   * Specific content format.
   *
   * Binary: `'pdf'` | `'png'` | `'jpeg'` | `'gif'` | `'webp'` | `'avif'` | `'svg'` |
   *         `'mp4'` | `'webm'` | `'mp3'` | `'wav'` | `'ogg'` | `'zip'`
   *
   * Text:   `'markdown'` | `'json'` | `'javascript'` | `'typescript'` | `'python'` |
   *         `'rust'` | `'go'` | `'plainText'`
   *
   * Fallback: `'unknown'`
   */
  format:
    | 'pdf' | 'png' | 'jpeg' | 'gif' | 'webp' | 'avif' | 'svg'
    | 'mp4' | 'webm' | 'mp3' | 'wav' | 'ogg' | 'zip'
    | 'markdown' | 'json' | 'javascript' | 'typescript' | 'python'
    | 'rust' | 'go' | 'plainText'
    | 'unknown';

  /** Classification confidence in `[0.0, 1.0]`. See Rust spec for semantics. */
  confidence: number;

  /**
   * Whether useful text content can be extracted from this format.
   * `true` for text formats and PDF; `false` for images, audio, video, zip.
   */
  isExtractable: boolean;
}

/**
 * Classify the content of `input` using a three-layer pipeline:
 * magic-byte detection → text/binary gate → heuristic text analysis.
 *
 * All classification logic runs in Rust WASM (SSoT: `crates/llmtxt-core/src/classify/`).
 * This function is a thin adapter that normalises inputs and maps enum variants.
 *
 * @param input - Raw content as a `string`, `Uint8Array`, or `Buffer`.
 *   - `string`: encoded to UTF-8 bytes before classification.
 *   - `Uint8Array` / `Buffer`: passed directly (no copy if already Uint8Array).
 *
 * @returns A {@link ClassificationResult} describing the detected content type.
 *
 * @throws {Error} if the WASM module returns a serialization error (should not occur
 *   in practice — the Rust code catches all errors and returns a valid JSON string).
 *
 * @example
 * ```ts
 * import { classifyContent } from 'llmtxt';
 *
 * const result = classifyContent('# Hello\n\nMarkdown content.');
 * console.log(result.format);      // 'markdown'
 * console.log(result.mimeType);    // 'text/markdown'
 * console.log(result.confidence);  // 0.8
 *
 * const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
 * const pdfResult = classifyContent(pdfBytes);
 * console.log(pdfResult.format);   // 'pdf'
 * console.log(pdfResult.confidence); // 1.0
 * ```
 */
export function classifyContent(input: string | Uint8Array | Buffer): ClassificationResult {
  // Normalize to Uint8Array
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (Buffer.isBuffer(input)) {
    // Buffer is a Uint8Array subtype in Node.js — works without special handling
    bytes = input;
  } else {
    bytes = input;
  }

  // Call WASM
  const json = wasmModule.classify_content_wasm(bytes);

  // Parse result
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error(`classifyContent: WASM returned invalid JSON: ${json}`);
  }

  // Check for WASM-level serialization error
  if (raw.error) {
    throw new Error(`classifyContent: WASM serialization error: ${String(raw.error)}`);
  }

  return {
    mimeType:      typeof raw.mimeType === 'string' ? raw.mimeType : 'application/octet-stream',
    category:      (raw.category as ClassificationResult['category']) ?? 'unknown',
    format:        (raw.format as ClassificationResult['format']) ?? 'unknown',
    confidence:    typeof raw.confidence === 'number' ? raw.confidence : 0.0,
    isExtractable: typeof raw.isExtractable === 'boolean' ? raw.isExtractable : false,
  };
}

/**
 * Map a {@link ClassificationResult} to the legacy four-value format string.
 *
 * Used internally by the `detectDocumentFormat` back-compat reroute (T828).
 * External callers should use `classifyContent` directly for new code.
 *
 * @internal
 */
export function detectFormatFromClassification(
  result: ClassificationResult,
): 'json' | 'markdown' | 'code' | 'text' {
  if (result.format === 'json') return 'json';
  if (result.format === 'markdown') return 'markdown';
  if (['javascript', 'typescript', 'python', 'rust', 'go'].includes(result.format)) {
    return 'code';
  }
  return 'text';
}
