/**
 * API key generation and verification utilities.
 *
 * Key format: llmtxt_<43 chars base64url>
 *   - 32 cryptographically random bytes → base64url → 43 chars
 *   - Total key length: 7 (prefix) + 43 = 50 chars
 *
 * The raw key is NEVER stored. Only the SHA-256 hex digest is persisted.
 * The display prefix ("llmtxt_" + first 8 random chars) lets users
 * identify which key is which without exposing the secret.
 *
 * SHA-256 hashing delegates to crates/llmtxt-core via the llmtxt WASM binding,
 * keeping the crypto primitive in the Rust SSoT.
 */
import { randomBytes } from 'node:crypto';
import { hashContent } from 'llmtxt';

const KEY_PREFIX = 'llmtxt_';

/**
 * Generate a new API key.
 *
 * @returns An object containing:
 *   - `rawKey`: the full key string (return to user ONCE, never store)
 *   - `keyHash`: SHA-256 hex digest to persist in the database
 *   - `keyPrefix`: display prefix for the database (first 8 random chars)
 */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const randomPart = randomBytes(32).toString('base64url');
  const rawKey = `${KEY_PREFIX}${randomPart}`;
  const keyHash = hashApiKey(rawKey);
  // Display prefix: "llmtxt_" + first 8 chars of the random part
  const keyPrefix = `${KEY_PREFIX}${randomPart.slice(0, 8)}`;

  return { rawKey, keyHash, keyPrefix };
}

/**
 * Hash a raw API key using SHA-256.
 *
 * Delegates to crates/llmtxt-core::hash_content via the llmtxt WASM binding.
 * Used both at creation time (to derive the stored hash) and at
 * authentication time (to look up the key by hash).
 *
 * @param rawKey - The full key string including the "llmtxt_" prefix
 * @returns Hex-encoded SHA-256 digest
 */
export function hashApiKey(rawKey: string): string {
  return hashContent(rawKey);
}

/**
 * Check whether a raw key string looks like an LLMtxt API key.
 * Used to quickly reject obviously wrong Bearer tokens before hashing.
 */
export function isApiKeyFormat(token: string): boolean {
  return token.startsWith(KEY_PREFIX) && token.length === 50;
}
