/* tslint:disable */
/* eslint-disable */

/**
 * Result of computing a line-based diff between two texts.
 */
export class DiffResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Number of lines added in the new text.
     */
    readonly added_lines: number;
    /**
     * Estimated tokens added.
     */
    readonly added_tokens: number;
    /**
     * Number of lines removed from the old text.
     */
    readonly removed_lines: number;
    /**
     * Estimated tokens removed.
     */
    readonly removed_tokens: number;
}

/**
 * Calculate the compression ratio (original / compressed), rounded to 2 decimals.
 * Returns 1.0 when `compressed_size` is 0.
 */
export function calculate_compression_ratio(original_size: number, compressed_size: number): number;

/**
 * Estimate token count using the ~4 chars/token heuristic.
 */
export function calculate_tokens(text: string): number;

/**
 * Compress a UTF-8 string using zlib-wrapped deflate (RFC 1950).
 *
 * Matches Node.js `zlib.deflate` output for backward compatibility
 * with existing stored data.
 *
 * # Errors
 * Returns an error string if compression fails.
 */
export function compress(data: string): Uint8Array;

/**
 * Compute a line-based diff between two texts.
 *
 * Uses a hash-based LCS (Longest Common Subsequence) approach for
 * O(n*m) comparison where n and m are line counts. Returns counts
 * of added/removed lines and estimated token impact.
 */
export function compute_diff(old_text: string, new_text: string): DiffResult;

/**
 * Compute the HMAC-SHA256 signature for org-scoped signed URL parameters.
 * Includes `org_id` in the HMAC payload for organization-level access control.
 * Returns the first 32 hex characters (128 bits) by default.
 */
export function compute_org_signature(slug: string, agent_id: string, conversation_id: string, org_id: string, expires_at: number, secret: string): string;

/**
 * Compute org-scoped HMAC-SHA256 signature with configurable output length.
 */
export function compute_org_signature_with_length(slug: string, agent_id: string, conversation_id: string, org_id: string, expires_at: number, secret: string, sig_length: number): string;

/**
 * Compute the HMAC-SHA256 signature for signed URL parameters.
 * Returns the first 16 hex characters of the digest (64 bits).
 * For longer signatures, use [`compute_signature_with_length`].
 */
export function compute_signature(slug: string, agent_id: string, conversation_id: string, expires_at: number, secret: string): string;

/**
 * Compute the HMAC-SHA256 signature with configurable output length.
 *
 * `sig_length` controls how many hex characters to return (max 64).
 * Use 16 for short-lived URLs (backward compat), 32 for long-lived URLs (128 bits).
 */
export function compute_signature_with_length(slug: string, agent_id: string, conversation_id: string, expires_at: number, secret: string, sig_length: number): string;

/**
 * Decode a base62-encoded string back into an integer.
 */
export function decode_base62(s: string): bigint;

/**
 * Decompress zlib-wrapped deflate bytes back to a UTF-8 string.
 *
 * Matches Node.js `zlib.inflate` for backward compatibility.
 *
 * # Errors
 * Returns an error string if decompression or UTF-8 conversion fails.
 */
export function decompress(data: Uint8Array): string;

/**
 * Derive a per-agent signing key from their API key.
 * Uses `HMAC-SHA256(api_key, "llmtxt-signing")`.
 */
export function derive_signing_key(api_key: string): string;

/**
 * Encode a non-negative integer into a base62 string.
 *
 * Uses the alphabet `0-9A-Za-z`. Zero encodes to `"0"`.
 */
export function encode_base62(num: bigint): string;

/**
 * Generate an 8-character base62 ID from a UUID v4.
 */
export function generate_id(): string;

/**
 * Compute the SHA-256 hash of a UTF-8 string, returned as lowercase hex.
 */
export function hash_content(data: string): string;

/**
 * Check whether a timestamp (milliseconds) has expired.
 * Returns false for 0 (no expiration).
 *
 * Uses `js_sys::Date::now()` in WASM, `std::time::SystemTime` natively.
 */
export function is_expired(expires_at_ms: number): boolean;

/**
 * Compute character-level n-gram Jaccard similarity between two texts.
 * Returns 0.0 (no overlap) to 1.0 (identical). Default n=3.
 *
 * Suitable for finding similar messages without vector embeddings.
 */
export function text_similarity(a: string, b: string): number;

/**
 * Compute n-gram Jaccard similarity with configurable gram size.
 */
export function text_similarity_ngram(a: string, b: string, n: number): number;
