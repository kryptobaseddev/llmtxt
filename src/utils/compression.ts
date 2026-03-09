// Base62 encoding + deflate compression utilities
import { promisify } from 'util';
import { deflate, inflate } from 'zlib';
import { createHash, randomUUID } from 'crypto';

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

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

/**
 * Compress data using Node.js zlib deflate
 * @param data - String data to compress
 * @returns Promise<Buffer> - Compressed data
 */
export async function compress(data: string): Promise<Buffer> {
  return deflateAsync(Buffer.from(data, 'utf-8'));
}

/**
 * Decompress data using Node.js zlib inflate
 * @param data - Buffer containing compressed data
 * @returns Promise<string> - Decompressed string
 */
export async function decompress(data: Buffer): Promise<string> {
  const decompressed = await inflateAsync(data);
  return decompressed.toString('utf-8');
}

/**
 * Generate a base62 encoded UUID (8 characters)
 * @returns string - 8-character base62 ID
 */
export function generateId(): string {
  const uuid = randomUUID();
  // Use first 16 chars of UUID (without dashes) for better uniqueness
  const hex = uuid.replace(/-/g, '').substring(0, 16);
  const num = parseInt(hex, 16);
  // Convert to base62 and pad to 8 chars
  const base62 = encodeBase62(num);
  return base62.padStart(8, '0').substring(0, 8);
}

/**
 * Generate SHA-256 hash of content
 * @param data - String data to hash
 * @returns string - Hex-encoded SHA-256 hash
 */
export function hashContent(data: string): string {
  return createHash('sha256').update(data, 'utf-8').digest('hex');
}

/**
 * Calculate estimated token count
 * Simple estimation: characters / 4 (approximate for English text)
 * @param text - Text to estimate tokens for
 * @returns number - Estimated token count
 */
export function calculateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate compression ratio
 * @param originalSize - Original size in bytes
 * @param compressedSize - Compressed size in bytes
 * @returns number - Compression ratio (e.g., 2.5 means 2.5:1 compression)
 */
export function calculateCompressionRatio(originalSize: number, compressedSize: number): number {
  if (compressedSize === 0) return 1;
  return parseFloat((originalSize / compressedSize).toFixed(2));
}
