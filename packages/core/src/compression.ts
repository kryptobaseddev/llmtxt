/**
 * Compression, encoding, hashing, and token estimation utilities.
 *
 * Uses only Node.js built-ins (zlib, crypto). Zero external dependencies.
 */
import { promisify } from 'node:util';
import { deflate, inflate } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// ── Base62 ──────────────────────────────────────────────────────

/**
 * Encode a non-negative integer into a base62 string.
 *
 * @remarks
 * Uses the character set `0-9A-Za-z` (62 characters). The encoding is
 * big-endian: the most-significant digit appears first. Zero encodes to
 * the string `"0"`.
 *
 * @param num - The non-negative integer to encode.
 * @returns The base62-encoded string representation.
 *
 * @example
 * ```ts
 * encodeBase62(0);   // "0"
 * encodeBase62(61);  // "z"
 * encodeBase62(62);  // "10"
 * ```
 */
export function encodeBase62(num: number): string {
  if (num === 0) return '0';
  let result = '';
  let n = num;
  while (n > 0) {
    result = BASE62[n % 62] + result;
    n = Math.floor(n / 62);
  }
  return result;
}

/**
 * Decode a base62-encoded string back into a non-negative integer.
 *
 * @remarks
 * Inverse of {@link encodeBase62}. Each character is mapped through the
 * `0-9A-Za-z` alphabet. Invalid characters will produce incorrect results
 * (no runtime validation is performed).
 *
 * @param str - The base62-encoded string to decode.
 * @returns The decoded non-negative integer.
 *
 * @example
 * ```ts
 * decodeBase62("0");  // 0
 * decodeBase62("z");  // 61
 * decodeBase62("10"); // 62
 * ```
 */
export function decodeBase62(str: string): number {
  let result = 0;
  for (const char of str) {
    result = result * 62 + BASE62.indexOf(char);
  }
  return result;
}

// ── Compression ─────────────────────────────────────────────────

/**
 * Compress a UTF-8 string using deflate.
 *
 * @remarks
 * Wraps Node.js `zlib.deflate` in a promise-based API. The input is
 * encoded as UTF-8 before compression.
 *
 * @param data - The UTF-8 string to compress.
 * @returns A promise that resolves to the deflate-compressed buffer.
 *
 * @example
 * ```ts
 * const compressed = await compress('Hello, world!');
 * ```
 */
export async function compress(data: string): Promise<Buffer> {
  return deflateAsync(Buffer.from(data, 'utf-8'));
}

/**
 * Decompress a deflate-compressed buffer back to a UTF-8 string.
 *
 * @remarks
 * Wraps Node.js `zlib.inflate` in a promise-based API. The decompressed
 * bytes are decoded as UTF-8.
 *
 * @param data - The deflate-compressed buffer to decompress.
 * @returns A promise that resolves to the decompressed UTF-8 string.
 *
 * @example
 * ```ts
 * const original = await decompress(compressedBuffer);
 * ```
 */
export async function decompress(data: Buffer): Promise<string> {
  const decompressed = await inflateAsync(data);
  return decompressed.toString('utf-8');
}

// ── ID Generation ───────────────────────────────────────────────

/**
 * Generate a base62-encoded 8-character ID from a UUID.
 *
 * @remarks
 * Creates a cryptographically random UUID via `crypto.randomUUID`, takes
 * the first 16 hex characters, converts the resulting integer to base62,
 * and pads/truncates to exactly 8 characters. Suitable for short,
 * collision-resistant document slugs.
 *
 * @returns An 8-character base62-encoded identifier string.
 *
 * @example
 * ```ts
 * const id = generateId(); // e.g. "xK9mP2nQ"
 * ```
 */
export function generateId(): string {
  const uuid = randomUUID();
  const hex = uuid.replace(/-/g, '').substring(0, 16);
  const num = parseInt(hex, 16);
  const base62 = encodeBase62(num);
  return base62.padStart(8, '0').substring(0, 8);
}

// ── Hashing ─────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hash of a string, returned as a hex digest.
 *
 * @remarks
 * Uses the Node.js `crypto.createHash` API. The input string is treated
 * as UTF-8. Useful for content-addressable storage and cache keys.
 *
 * @param data - The UTF-8 string to hash.
 * @returns The lowercase hex-encoded SHA-256 digest.
 *
 * @example
 * ```ts
 * hashContent('hello'); // "2cf24dba5fb0a30e..."
 * ```
 */
export function hashContent(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

// ── Token Estimation ────────────────────────────────────────────

/**
 * Estimate the token count of a string using the ~4 chars/token heuristic.
 *
 * @remarks
 * This is a fast approximation suitable for cost estimation and budget
 * tracking. For precise counts, use a tokenizer such as tiktoken.
 *
 * @param text - The text whose token count is to be estimated.
 * @returns The estimated number of tokens (rounded up).
 *
 * @example
 * ```ts
 * calculateTokens('Hello, world!'); // 4
 * ```
 */
export function calculateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Compression Ratio ───────────────────────────────────────────

/**
 * Calculate the compression ratio between original and compressed sizes.
 *
 * @remarks
 * Returns the ratio as a float rounded to two decimal places. A ratio of
 * 2.5 means the original was 2.5 times larger than the compressed output
 * (2.5:1 compression). Returns 1 when the compressed size is zero to
 * avoid division-by-zero errors.
 *
 * @param originalSize - The size of the original content in bytes.
 * @param compressedSize - The size of the compressed content in bytes.
 * @returns The compression ratio (original / compressed), rounded to two decimals.
 *
 * @example
 * ```ts
 * calculateCompressionRatio(1000, 400); // 2.5
 * ```
 */
export function calculateCompressionRatio(
  originalSize: number,
  compressedSize: number,
): number {
  if (compressedSize === 0) return 1;
  return parseFloat((originalSize / compressedSize).toFixed(2));
}
