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
 * @returns Compressed buffer
 */
export async function compress(data: string): Promise<Buffer> {
  return deflateAsync(Buffer.from(data, 'utf-8'));
}

/**
 * Decompress a deflate-compressed buffer back to a UTF-8 string.
 */
export async function decompress(data: Buffer): Promise<string> {
  const decompressed = await inflateAsync(data);
  return decompressed.toString('utf-8');
}

// ── ID Generation ───────────────────────────────────────────────

/**
 * Generate a base62-encoded 8-character ID from a UUID.
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
 * SHA-256 hash of a string, returned as hex.
 */
export function hashContent(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

// ── Token Estimation ────────────────────────────────────────────

/**
 * Estimate token count using the ~4 chars/token heuristic.
 * Suitable for quick estimates; use tiktoken for precision.
 */
export function calculateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Compression Ratio ───────────────────────────────────────────

/**
 * Calculate compression ratio (e.g. 2.5 means 2.5:1).
 */
export function calculateCompressionRatio(
  originalSize: number,
  compressedSize: number,
): number {
  if (compressedSize === 0) return 1;
  return parseFloat((originalSize / compressedSize).toFixed(2));
}
