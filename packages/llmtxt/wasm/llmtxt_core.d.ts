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
 * Lifecycle state of a collaborative document.
 *
 * Matches the TypeScript `DocumentState` type exactly.
 */
export enum DocumentState {
    Draft = 0,
    Review = 1,
    Locked = 2,
    Archived = 3,
}

/**
 * Apply a unified diff patch to an original string.
 * Returns the updated string on success, or an error if the patch is invalid
 * or fails to apply cleanly.
 */
export function apply_patch(original: string, patch_text: string): string;

/**
 * Compare multiple versions against a base version in a single call.
 *
 * `version_numbers` is a JSON array of version numbers to compare: `[1, 3, 5, 8]`.
 * Each is reconstructed from the patch chain and diffed against `base_version`.
 * Returns a JSON array of diff results.
 *
 * This avoids N separate WASM calls and parses the patches JSON once.
 */
export function batch_diff_versions(base: string, patches_json: string, base_version: number, version_numbers_json: string): string;

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
 * WASM binding for [`cherry_pick_merge`].
 *
 * Takes base content, a JSON versions map, and a JSON selection spec.
 * Returns a JSON-serialised `CherryPickResult` on success, or
 * `{"error": "<message>"}` on failure.
 */
export function cherry_pick_merge_wasm(base: string, versions_json: string, selection_json: string): string;

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
 * Compute which markdown sections were modified between two document versions.
 *
 * Returns a JSON array of section heading names that changed.
 * Detects added, removed, and modified sections.
 */
export function compute_sections_modified(old_content: string, new_content: string): string;

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
 * Compute cosine similarity between two embedding vectors supplied as JSON arrays.
 *
 * WASM entry point for [`cosine_similarity`].
 *
 * Both arguments must be JSON arrays of numbers, e.g. `[0.1, 0.2, 0.3]`.
 * Returns a value in `[-1.0, 1.0]`, or `0.0` on parse error.
 *
 * # Examples (TypeScript)
 * ```ts
 * import { cosineSimilarity } from 'llmtxt';
 * const sim = cosineSimilarity('[1.0, 0.0]', '[0.0, 1.0]'); // 0.0 — orthogonal
 * ```
 */
export function cosine_similarity_wasm(a_json: string, b_json: string): number;

/**
 * Create a unified diff patch representing the difference between `original`
 * and `modified`.
 */
export function create_patch(original: string, modified: string): string;

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
 * Reconstruct two versions and compute a diff between them.
 *
 * Returns a JSON string with `fromVersion`, `toVersion`, `addedLines`,
 * `removedLines`, `addedTokens`, `removedTokens`, and `patchText` fields.
 * Matches the TypeScript `VersionDiffSummary` interface.
 */
export function diff_versions(base: string, patches_json: string, from_version: number, to_version: number): string;

/**
 * Encode a non-negative integer into a base62 string.
 *
 * Uses the alphabet `0-9A-Za-z`. Zero encodes to `"0"`.
 */
export function encode_base62(num: bigint): string;

/**
 * Evaluate reviews against a policy. All inputs and output are JSON strings.
 *
 * Input `reviews_json`: `[{"reviewerId":"...","status":"APPROVED","timestamp":123,"atVersion":1}]`
 * Input `policy_json`: `{"requiredCount":1,"requireUnanimous":false,"allowedReviewerIds":[],"timeoutMs":0}`
 *
 * Returns a JSON string matching the TypeScript `ApprovalResult` interface.
 */
export function evaluate_approvals(reviews_json: string, policy_json: string, current_version: number, now_ms: number): string;

/**
 * Generate an 8-character base62 ID from a UUID v4.
 */
export function generate_id(): string;

/**
 * Compute the SHA-256 hash of a UTF-8 string, returned as lowercase hex.
 */
export function hash_content(data: string): string;

/**
 * Check whether a document state allows content modifications.
 *
 * Only DRAFT and REVIEW states accept new versions/patches.
 */
export function is_editable(state: DocumentState): boolean;

/**
 * Parse a state string and check if it's editable.
 * Returns false for unrecognized state names.
 */
export function is_editable_str(state: string): boolean;

/**
 * Check whether a timestamp (milliseconds) has expired.
 * Returns false for 0 (no expiration).
 *
 * Uses `js_sys::Date::now()` in WASM, `std::time::SystemTime` natively.
 */
export function is_expired(expires_at_ms: number): boolean;

/**
 * Check whether a document state is terminal (no further transitions).
 */
export function is_terminal(state: DocumentState): boolean;

/**
 * Parse a state string and check if it's terminal.
 * Returns false for unrecognized state names.
 */
export function is_terminal_str(state: string): boolean;

/**
 * Check whether a state transition is allowed.
 */
export function is_valid_transition(from: DocumentState, to: DocumentState): boolean;

/**
 * Parse a state string and check if the transition is valid.
 * Accepts uppercase state names ("DRAFT", "REVIEW", etc.).
 * Returns false for unrecognized state names.
 */
export function is_valid_transition_str(from: string, to: string): boolean;

/**
 * L2-normalize a vector supplied as a JSON array of numbers (WASM entry point).
 *
 * Delegates to [`l2_normalize`].
 *
 * # Arguments
 * * `vec_json` — JSON array of numbers, e.g. `"[0.1, 0.2, 0.3]"`.
 *
 * # Returns
 * JSON array string of normalized f32 values, or `"[]"` on parse error.
 *
 * # Examples (TypeScript)
 * ```ts
 * import { l2Normalize } from 'llmtxt';
 * const normed = l2Normalize('[3.0, 4.0]'); // "[0.6, 0.8]"
 * ```
 */
export function l2_normalize_wasm(vec_json: string): string;

/**
 * Mark reviews as stale for the given version. JSON I/O for WASM.
 *
 * Returns a JSON array of updated reviews.
 */
export function mark_stale_reviews(reviews_json: string, current_version: number): string;

/**
 * WASM binding for [`multi_way_diff`].
 *
 * Takes base content and a JSON array of version strings.
 * Returns a JSON-serialised `MultiDiffResult` on success, or
 * `{"error": "<message>"}` on failure.
 */
export function multi_way_diff_wasm(base: string, versions_json: string): string;

/**
 * Apply a sequence of patches to base content, returning the content at the
 * target version. This avoids N WASM boundary crossings by performing all
 * patch applications in a single Rust call.
 *
 * `patches_json` is a JSON array of patch strings: `["patch1", "patch2", ...]`.
 * `target` is the 1-based version to reconstruct (0 returns `base` unchanged).
 * If `target` exceeds the number of patches, all patches are applied.
 */
export function reconstruct_version(base: string, patches_json: string, target: number): string;

/**
 * Evaluate semantic consensus from a JSON array of reviews (WASM / backend entry point).
 *
 * `reviews_json` must be a JSON array of objects with the shape
 * `{ reviewerId: string, content: string, embedding: number[] }`.
 *
 * Returns a JSON-serialised [`SemanticConsensusResult`], or `{"error":"..."}` on failure.
 */
export function semantic_consensus(reviews_json: string, threshold: number): string;

/**
 * WASM binding for [`semantic_consensus`].
 *
 * `reviews_json` is a JSON array of `{ reviewerId, content, embedding: number[] }`.
 * `threshold` is the minimum cosine similarity for two reviews to agree (e.g. 0.80).
 * Returns a JSON-serialised `SemanticConsensusResult`, or `{"error":"..."}`.
 */
export function semantic_consensus_wasm(reviews_json: string, threshold: number): string;

/**
 * Compute semantic diff from JSON strings (WASM / backend entry point).
 *
 * `sections_a_json` and `sections_b_json` must each be a JSON array of objects
 * with the shape `{ title: string, content: string, embedding: number[] }`.
 *
 * Returns a JSON-serialised [`SemanticDiffResult`], or `{"error":"..."}` on failure.
 */
export function semantic_diff(sections_a_json: string, sections_b_json: string): string;

/**
 * WASM binding for [`semantic_diff`].
 *
 * `sections_a_json` and `sections_b_json` are JSON arrays of
 * `{ title, content, embedding: number[] }`.
 * Returns a JSON-serialised `SemanticDiffResult`, or `{"error":"..."}`.
 */
export function semantic_diff_wasm(sections_a_json: string, sections_b_json: string): string;

/**
 * Compute the HMAC-SHA256 webhook signature for a payload.
 *
 * Returns `"sha256=<hex>"` — the canonical format for the
 * `X-LLMtxt-Signature` request header.
 *
 * # Arguments
 * * `secret` - The webhook signing secret (UTF-8 string).
 * * `payload` - The raw request body bytes to sign.
 *
 * Returns an empty string if the HMAC key is invalid (should not occur
 * in practice; HMAC-SHA256 accepts keys of any length).
 */
export function sign_webhook_payload(secret: string, payload: string): string;

/**
 * Apply all patches sequentially to base content, then produce a single
 * unified diff from the original base to the final state.
 *
 * `patches_json` is a JSON array of patch strings: `["patch1", "patch2", ...]`.
 */
export function squash_patches(base: string, patches_json: string): string;

/**
 * Compute a structured line-level diff between two texts.
 *
 * Returns a JSON-serialized [`StructuredDiffResult`] with interleaved
 * context, added, and removed lines including line numbers for both
 * old and new text. This is the single source of truth for diff display.
 *
 * Uses the same LCS algorithm as [`compute_diff`] but produces full
 * line-by-line output instead of just counts.
 */
export function structured_diff(old_text: string, new_text: string): string;

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

/**
 * WASM binding for the 3-way merge algorithm.
 *
 * Takes `base`, `ours`, and `theirs` content strings.
 * Returns a JSON-serialised [`ThreeWayMergeResult`] on success, or
 * `{"error": "<message>"}` on serialization failure.
 */
export function three_way_merge_wasm(base: string, ours: string, theirs: string): string;

/**
 * Validate a proposed transition and return a JSON result.
 *
 * Returns a JSON object with `valid`, `reason`, and `allowedTargets` fields.
 * Matches the TypeScript `TransitionResult` interface.
 */
export function validate_transition(from: string, to: string): string;

/**
 * Check if a role has a specific permission.
 *
 * Returns `true` if `role` (e.g. `"editor"`) has the given `permission`
 * (e.g. `"write"`). Unknown roles or permissions return `false`.
 */
export function role_has_permission(role: string, permission: string): boolean;

/**
 * Return the permissions for a document role as a JSON array of strings.
 *
 * Accepts `"owner"`, `"editor"`, or `"viewer"`.
 * Returns `["read","write","delete","manage","approve"]` etc.
 * Returns `"[]"` for unknown roles.
 */
export function role_permissions(role: string): string;

/**
 * Convert a collection or document name to a URL-safe slug.
 *
 * 1. Lowercase the input.
 * 2. Strip non-word, non-space, non-hyphen characters.
 * 3. Replace runs of whitespace with a single hyphen.
 * 4. Collapse multiple consecutive hyphens into one.
 * 5. Trim leading and trailing hyphens.
 * 6. Truncate to 80 characters.
 *
 * Returns an empty string if the input is empty or produces no slug characters.
 */
export function slugify(name: string): string;

// ── Validation primitives (T123) ────────────────────────────────────

/**
 * Detect whether content is JSON, markdown, or plain text.
 * Returns `"json"`, `"markdown"`, or `"text"`.
 */
export function detect_format(content: string): string;

/**
 * Check for binary content by scanning for control characters (0x00–0x08)
 * in the first 8 KB of the content.
 */
export function contains_binary_content(content: string): boolean;

/**
 * Find the 1-based line number of the first line that exceeds `max_chars`.
 * Returns 0 if no overlong line exists.
 */
export function find_overlong_line(content: string, max_chars: number): number;

/** WASM-exposed default max content bytes (5 MB). */
export function default_max_content_bytes(): bigint;

/** WASM-exposed default max line bytes (64 KiB). */
export function default_max_line_bytes(): number;

// ── Graph primitives (T122) ─────────────────────────────────────────

/**
 * Extract @mentions from content. Returns JSON array of strings.
 */
export function extract_mentions_wasm(content: string): string;

/**
 * Extract #tags from content. Returns JSON array of strings.
 */
export function extract_tags_wasm(content: string): string;

/**
 * Extract /directives from content. Returns JSON array of strings.
 */
export function extract_directives_wasm(content: string): string;

/**
 * Build a knowledge graph from a JSON array of MessageInput objects.
 * Returns a JSON-serialised KnowledgeGraph, or `{"error":"..."}` on failure.
 */
export function build_graph_wasm(messages_json: string): string;

/**
 * Find the most connected topics. Returns JSON array of `{ topic, agents }`.
 */
export function top_topics_wasm(graph_json: string, limit: number): string;

/**
 * Find the most active agents. Returns JSON array of `{ agent, activity }`.
 */
export function top_agents_wasm(graph_json: string, limit: number): string;

// ── Similarity primitives (T121) ────────────────────────────────────

/**
 * Extract character n-grams from text. Returns JSON array of strings.
 */
export function extract_ngrams_wasm(text: string, n: number): string;

/**
 * Extract word shingles from text. Returns JSON array of strings.
 */
export function extract_word_shingles_wasm(text: string, n: number): string;

/**
 * Compute Jaccard similarity between two texts using character n-grams (n=3).
 */
export function jaccard_similarity_wasm(a: string, b: string): number;

/**
 * Compute content similarity using word shingles (n=2).
 */
export function content_similarity_wasm(a: string, b: string): number;

/**
 * Generate a MinHash fingerprint. Returns JSON array of numbers.
 */
export function min_hash_fingerprint_wasm(text: string, num_hashes: number, ngram_size: number): string;

/**
 * Rank candidates by similarity to query.
 * `candidates_json` is a JSON array of strings.
 * `options_json` is `{"method":"ngram"|"shingle","threshold":0.0}`.
 * Returns JSON array of `{ index, score }` sorted descending.
 */
export function rank_by_similarity_wasm(query: string, candidates_json: string, options_json: string): string;
