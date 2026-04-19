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
 * WASM: build and sign an A2A message.
 *
 * Parameters:
 * * `from_id`      — sender agent identifier
 * * `to_id`        — recipient agent identifier
 * * `nonce_hex`    — 32-char hex nonce (16 random bytes)
 * * `timestamp_ms` — milliseconds since epoch
 * * `content_type` — e.g. `"application/json"`
 * * `payload_b64`  — base64-encoded payload bytes
 * * `sk_hex`       — 64-char hex of the 32-byte secret key
 *
 * Returns JSON-serialized [`A2AMessage`], or `{"error":"..."}`.
 */
export function a2a_build_and_sign(from_id: string, to_id: string, nonce_hex: string, timestamp_ms: number, content_type: string, payload_b64: string, sk_hex: string): string;

/**
 * WASM: verify an A2A message JSON against a public key.
 *
 * Returns `"true"` or `"false"`.
 */
export function a2a_verify(msg_json: string, pk_hex: string): boolean;

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
 * WASM: compute BFT quorum for fault count `f`.
 *
 * Returns `2f + 1` as a u32.
 */
export function bft_quorum_wasm(n: number, f: number): number;

/**
 * WASM binding for [`blob_name_validate`].
 *
 * Returns `Ok(())` when the name is valid, or throws a `JsValue` string
 * describing the validation failure.
 */
export function blobNameValidate(name: string): void;

/**
 * Build a knowledge graph from a JSON array of MessageInput objects.
 *
 * Returns a JSON-serialised KnowledgeGraph, or `{"error":"..."}` on failure.
 */
export function build_graph_wasm(messages_json: string): string;

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
 * WASM binding for [`canonical_frontmatter`].
 *
 * Accepts a JSON-serialised [`FrontmatterMeta`] object.
 * Returns the canonical YAML frontmatter string, or an error message prefixed
 * with `"ERROR: "` if the JSON cannot be parsed.
 *
 * # Example (TypeScript)
 * ```typescript
 * import init, { canonicalFrontmatter } from 'llmtxt-core';
 * await init();
 * const yaml = canonicalFrontmatter(JSON.stringify({
 *   title: "My Doc",
 *   slug: "my-doc",
 *   version: 1,
 *   state: "DRAFT",
 *   contributors: ["bob", "alice"],
 *   content_hash: "abc123...",
 *   exported_at: "2026-04-17T19:00:00.000Z",
 * }));
 * ```
 */
export function canonicalFrontmatter(meta_json: string): string;

/**
 * WASM binding for [`cherry_pick_merge`].
 *
 * Takes base content, a JSON versions map, and a JSON selection spec.
 * Returns a JSON-serialised `CherryPickResult` on success, or
 * `{"error": "<message>"}` on failure.
 */
export function cherry_pick_merge_wasm(base: string, versions_json: string, selection_json: string): string;

/**
 * Compress a UTF-8 string using **zstd** (RFC 8478), level 3.
 *
 * New writes use zstd. Existing zlib-stored data is still readable via
 * [`decompress`], which detects the codec by inspecting magic bytes.
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
 * Compare two hex-encoded digest strings (e.g. SHA-256 or HMAC digests) in
 * constant time to prevent timing side-channel attacks.
 *
 * Returns `true` if and only if `a == b` **and** both strings have the same
 * length. Strings of different lengths return `false` immediately (the length
 * difference itself leaks no secret information when both inputs are fixed-
 * length digests such as SHA-256).
 *
 * # S-01 (T108.7)
 * Use this function whenever comparing API key hashes or webhook signatures.
 * Never use `==` on secret strings from JavaScript / TypeScript.
 *
 * # WASM export
 * The WASM binding returns `1` for equal, `0` for not equal so that the
 * JavaScript caller can check `if (constantTimeEqHex(a, b))` cleanly.
 */
export function constant_time_eq_hex(a: string, b: string): boolean;

/**
 * Check for binary content by scanning for control characters (0x00–0x08)
 * in the first 8 KB of the content.
 *
 * Returns `true` if binary control characters are found.
 *
 * Matches the TypeScript `containsBinaryContent` helper exactly.
 */
export function contains_binary_content(content: string): boolean;

/**
 * Compute content similarity using word shingles.
 */
export function content_similarity_wasm(a: string, b: string): number;

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
 * Apply a Loro update (or snapshot) to a document state and return the new state.
 *
 * This is the core persistence operation: given the persisted state and an
 * incoming update from a client, produce the new state to store in
 * `section_crdt_states.crdt_state`.
 *
 * Loro `import` is idempotent — applying the same update twice yields the
 * same result (CRDT property).
 *
 * # Arguments
 * * `state`  — current state bytes (may be empty for a new section).
 * * `update` — incoming Loro update or snapshot bytes from a client.
 *
 * # Returns
 * New snapshot bytes suitable for persisting, or empty vec on decode error.
 */
export function crdt_apply_update(state: Uint8Array, update: Uint8Array): Uint8Array;

/**
 * Compute the diff update between server state and a remote VersionVector.
 *
 * Sync step 2: given the server's full state and the client's VersionVector
 * (from sync step 1 — encoded via [`crdt_state_vector`]), return only the
 * operations the client is missing.
 *
 * # Arguments
 * * `state`     — server state bytes from `section_crdt_states.crdt_state`.
 * * `remote_sv` — the client's Loro VersionVector bytes (from [`crdt_state_vector`]).
 *   Empty `remote_sv` means "give me everything" (full snapshot).
 *
 * # Returns
 * Loro update bytes containing only the missing operations, or empty vec on
 * error. Empty `remote_sv` returns the full snapshot.
 */
export function crdt_diff_update(state: Uint8Array, remote_sv: Uint8Array): Uint8Array;

/**
 * Encode the full document state as a Loro snapshot blob.
 *
 * Used to bootstrap a new client: send them the full state so they can import
 * it locally and arrive at the current document content.
 *
 * # Arguments
 * * `state` — bytes from `section_crdt_states.crdt_state` (consolidated state).
 *   May be empty to obtain the canonical empty-doc snapshot.
 *
 * # Returns
 * A Loro snapshot blob, or empty vec if `state` is non-empty and corrupt.
 */
export function crdt_encode_state_as_update(state: Uint8Array): Uint8Array;

/**
 * WASM-exported variant of [`crdt_merge_updates`].
 *
 * Accepts a flat byte buffer with 4-byte LE length prefixes:
 * `[len1:u32le][bytes1][len2:u32le][bytes2]...`
 *
 * This avoids the `Vec<Vec<u8>>` type which is not directly
 * wasm-bindgen-compatible.
 */
export function crdt_merge_updates_wasm(packed: Uint8Array): Uint8Array;

/**
 * Create an empty Loro doc for a section and return its snapshot bytes.
 *
 * The doc contains a single `LoroText` root named `"content"`. The returned
 * bytes are an opaque Loro snapshot blob. Callers MUST treat this as a state
 * blob — it is NOT a Y.js state vector (incompatible format).
 *
 * Use the returned bytes as the initial `state` argument to
 * [`crdt_encode_state_as_update`] or [`crdt_apply_update`].
 */
export function crdt_new_doc(): Uint8Array;

/**
 * Extract the Loro [`VersionVector`] from a state snapshot.
 *
 * The returned bytes are encoded via [`VersionVector::encode`] — they are
 * **not** Y.js state vector bytes and MUST be decoded with
 * [`VersionVector::decode`] on the receiving end. Peers using this in the
 * sync protocol MUST NOT pass these bytes to any Yrs / lib0 decoder.
 *
 * # Arguments
 * * `state` — state bytes from `section_crdt_states.crdt_state`.
 *
 * # Returns
 * Loro VersionVector bytes, or empty vec on error.
 */
export function crdt_state_vector(state: Uint8Array): Uint8Array;

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
 * Decompress bytes back to a UTF-8 string.
 *
 * Codec is detected automatically from the magic bytes:
 * - `0xFD 0x2F 0xB5 0x28` → zstd (RFC 8478)
 * - `0x78 __` (zlib CMF byte) → zlib/deflate (RFC 1950, legacy)
 *
 * This guarantees backward compatibility: all rows written before the zstd
 * migration continue to decode correctly without a schema change.
 *
 * # Errors
 * Returns an error string if decompression or UTF-8 conversion fails.
 */
export function decompress(data: Uint8Array): string;

/**
 * WASM-exposed default max content bytes.
 */
export function default_max_content_bytes(): bigint;

/**
 * WASM-exposed default max line bytes.
 */
export function default_max_line_bytes(): number;

/**
 * Derive a per-agent signing key from their API key.
 * Uses `HMAC-SHA256(api_key, "llmtxt-signing")`.
 */
export function derive_signing_key(api_key: string): string;

/**
 * WASM binding for [`deserialize_export_archive`].
 *
 * Returns the verified archive JSON on success, or `{"error":"..."}` on
 * any failure (parse error, version mismatch, hash mismatch).
 */
export function deserialize_export_archive_wasm(archive_json: string): string;

/**
 * Detect the structural format of a document.
 *
 * Returns `"json"`, `"markdown"`, `"code"`, or `"text"`.
 */
export function detect_document_format_wasm(content: string): string;

/**
 * Detect whether content is JSON, markdown, or plain text.
 *
 * Precedence:
 * 1. If `JSON.parse` succeeds → `"json"`.
 * 2. If 2+ markdown signals match → `"markdown"`.
 * 3. Otherwise → `"text"`.
 *
 * Matches the TypeScript `detectFormat` heuristic in `validation.ts`.
 * Note: `detectDocumentFormat` in `disclosure.rs` has an extended version
 * that also detects `"code"` — the canonical name for the validation variant
 * is `detect_format` (no code detection, per audit item #14).
 *
 * # Examples
 * ```rust
 * use llmtxt_core::validation::detect_format;
 * assert_eq!(detect_format("{\"a\":1}"), "json");
 * assert_eq!(detect_format("# Title\n- item"), "markdown");
 * assert_eq!(detect_format("Hello world"), "text");
 * ```
 */
export function detect_format(content: string): string;

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
 * WASM binding: evaluate tier limits from JSON-serialised inputs.
 *
 * `usage_json` — JSON of `UsageSnapshot`.
 * `tier_str` — `"free"` | `"pro"` | `"enterprise"` (case-insensitive).
 *
 * Returns JSON of `TierDecision`, or `{"error":"..."}` on parse failure.
 */
export function evaluate_tier_limits_wasm(usage_json: string, tier_str: string): string;

/**
 * Extract /directives from content. Returns JSON array of strings.
 */
export function extract_directives_wasm(content: string): string;

/**
 * Extract @mentions from content. Returns JSON array of strings.
 */
export function extract_mentions_wasm(content: string): string;

/**
 * Extract character n-grams from text. Returns JSON array of strings.
 */
export function extract_ngrams_wasm(text: string, n: number): string;

/**
 * Extract #tags from content. Returns JSON array of strings.
 */
export function extract_tags_wasm(content: string): string;

/**
 * Extract word shingles from text. Returns JSON array of strings.
 */
export function extract_word_shingles_wasm(text: string, n: number): string;

/**
 * Find the 1-based line number of the first line that exceeds `max_bytes`
 * characters. Returns 0 if no such line exists.
 *
 * Uses character count (not byte count) to match the TypeScript behaviour,
 * which uses `lineLength = i - lineStart` where `i` advances by one
 * JavaScript character at a time.
 *
 * Returns 0 (no overlong line) instead of -1 (which cannot be expressed
 * as a u32). WASM callers should treat 0 as "no violation".
 */
export function find_overlong_line(content: string, max_chars: number): number;

/**
 * FNV-1a hash of a string (32-bit). Returns hash as u32 cast to u64.
 *
 * Matches the TS `fnv1aHash(str: string): number` function exactly.
 */
export function fnv1a_hash_wasm(s: string): number;

/**
 * Generate an 8-character base62 ID from a UUID v4.
 */
export function generate_id(): string;

/**
 * Generate a structural overview of a document.
 *
 * Returns JSON-serialised DocumentOverview, or `{"error":"..."}` on failure.
 */
export function generate_overview_wasm(content: string): string;

/**
 * Extract a line range from a document.
 *
 * Returns JSON-serialised LineRangeResult.
 */
export function get_line_range_wasm(content: string, start: number, end: number): string;

/**
 * Extract a named section from a document.
 *
 * Returns JSON result or `{"error":"section not found"}` if missing.
 */
export function get_section_wasm(content: string, section_name: string, depth_all: boolean): string;

/**
 * WASM binding: return tier limits as JSON.
 *
 * `tier_str` — `"free"` | `"pro"` | `"enterprise"` (case-insensitive).
 *
 * Returns JSON of `TierLimits`, or `{"error":"..."}` on serialization failure.
 */
export function get_tier_limits_wasm(tier_str: string): string;

/**
 * WASM binding for [`hash_blob`].
 *
 * Accepts raw bytes and returns the lowercase hex SHA-256 digest (64 chars).
 */
export function hashBlob(bytes: Uint8Array): string;

/**
 * WASM: compute hash chain extension.
 *
 * `prev_hash_hex` — 64-char lowercase hex of the 32-byte previous hash.
 * `event_json`    — UTF-8 event payload string.
 *
 * Returns 64-char lowercase hex of the new chain hash, or `{"error":"..."}`.
 */
export function hash_chain_extend_wasm(prev_hash_hex: string, event_json: string): string;

/**
 * Compute the SHA-256 hash of a UTF-8 string, returned as lowercase hex.
 */
export function hash_content(data: string): string;

/**
 * WASM: compute SHA-256 body hash as lowercase hex.
 */
export function identity_body_hash_hex(body: Uint8Array): string;

/**
 * WASM: build canonical payload bytes.
 *
 * Returns the raw UTF-8 bytes of the canonical payload string.
 */
export function identity_canonical_payload(method: string, path_and_query: string, timestamp_ms: number, agent_id: string, nonce_hex: string, body_hash_hex: string): Uint8Array;

/**
 * WASM: generate an Ed25519 keypair.
 *
 * Returns JSON `{"sk":"<hex64>","pk":"<hex64>"}`.
 */
export function identity_keygen(): string;

/**
 * WASM: sign a submission.
 *
 * * `sk_hex`  — 64-char hex of the 32-byte secret key
 * * `payload` — raw payload bytes
 *
 * Returns 128-char hex of the 64-byte signature, or `{"error":"..."}`.
 */
export function identity_sign(sk_hex: string, payload: Uint8Array): string;

/**
 * WASM: verify a submission signature.
 *
 * * `pk_hex`  — 64-char hex of the 32-byte public key
 * * `payload` — raw payload bytes
 * * `sig_hex` — 128-char hex of the 64-byte signature
 *
 * Returns `"true"` or `"false"`.
 */
export function identity_verify(pk_hex: string, payload: Uint8Array, sig_hex: string): boolean;

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
 * Compute Jaccard similarity between two texts using character n-grams.
 */
export function jaccard_similarity_wasm(a: string, b: string): number;

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
 * WASM: compute Merkle root over an array of leaf hashes.
 *
 * `leaves_hex_json` — JSON array of 64-character lowercase hex strings,
 * one per leaf (each representing a 32-byte SHA-256 digest).
 *
 * Returns a 64-character lowercase hex string of the root, or
 * `{"error":"..."}` on invalid input.
 */
export function merkle_root_wasm(leaves_hex_json: string): string;

/**
 * Generate a MinHash fingerprint. Returns JSON array of numbers.
 */
export function min_hash_fingerprint_wasm(text: string, num_hashes: number, ngram_size: number): string;

/**
 * WASM binding for [`multi_way_diff`].
 *
 * Takes base content and a JSON array of version strings.
 * Returns a JSON-serialised `MultiDiffResult` on success, or
 * `{"error": "<message>"}` on failure.
 */
export function multi_way_diff_wasm(base: string, versions_json: string): string;

/**
 * Execute a JSONPath query against JSON content.
 *
 * Returns `{ result, tokenCount, path }` JSON or `{"error":"..."}` on failure.
 */
export function query_json_path_wasm(content: string, path: string): string;

/**
 * Rank candidates by similarity to query.
 *
 * `candidates_json` is a JSON array of strings.
 * `options_json` is `{"method":"ngram"|"shingle","threshold":0.0}` (optional keys).
 * Returns JSON array of `{ index, score }` sorted descending.
 */
export function rank_by_similarity_wasm(query: string, candidates_json: string, options_json: string): string;

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
 * WASM entry point for retention policy evaluation.
 *
 * # Arguments (JSON strings)
 * - `rows_json`: JSON array of [`RetentionRow`] objects.
 * - `policy_json`: JSON object matching [`RetentionPolicy`].
 * - `now_ms`: current Unix timestamp in milliseconds (f64 for JS interop).
 *
 * # Returns
 * JSON-serialised [`EvictionSet`], or a JSON `{"error":"..."}` on parse failure.
 */
export function retention_apply_wasm(rows_json: string, policy_json: string, now_ms: number): string;

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
 *
 * # Examples (TypeScript via WASM)
 * ```ts
 * import { rolePermissions } from 'llmtxt';
 * rolePermissions('owner');  // '["read","write","delete","manage","approve"]'
 * rolePermissions('viewer'); // '["read"]'
 * ```
 */
export function role_permissions(role: string): string;

/**
 * Search document content.
 *
 * Returns JSON array of SearchResult.
 */
export function search_content_wasm(content: string, query: string, context_lines: number, max_results: number): string;

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
 * WASM binding for [`serialize_export_archive`].
 *
 * Accepts a JSON string representing an [`ExportArchive`] *without*
 * a valid `content_hash`, computes the hash, and returns the JSON
 * string with the hash embedded.
 *
 * Returns `{"error":"..."}` on parse failure.
 */
export function serialize_export_archive_wasm(archive_json: string): string;

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
 * Convert a collection or document name to a URL-safe slug.
 *
 * Algorithm:
 * 1. Lowercase the input.
 * 2. Strip non-word, non-space, non-hyphen characters.
 * 3. Replace runs of whitespace with a single hyphen.
 * 4. Collapse multiple consecutive hyphens into one.
 * 5. Trim leading and trailing hyphens.
 * 6. Truncate to 80 characters.
 *
 * Returns an empty string if the input is empty or produces no slug characters.
 *
 * # Examples (TypeScript via WASM)
 * ```ts
 * import { slugify } from 'llmtxt';
 * slugify('Hello World!'); // "hello-world"
 * slugify('  my  doc  '); // "my-doc"
 * slugify('Rust & TypeScript'); // "rust-typescript"
 * ```
 */
export function slugify(name: string): string;

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
 * WASM shim — delegates to [`similarity::text_similarity_jaccard`].
 */
export function text_similarity(a: string, b: string): number;

/**
 * Compute n-gram Jaccard similarity with configurable gram size.
 *
 * WASM shim — delegates to [`similarity::text_similarity_jaccard`].
 */
export function text_similarity_ngram(a: string, b: string, n: number): number;

/**
 * Embed a batch of texts using TF-IDF. Input is a JSON array of strings.
 *
 * Returns a JSON array-of-arrays string, e.g. `"[[0.1,...],[0.2,...]]"`.
 * Returns `"[]"` on parse error.
 */
export function tfidf_embed_batch_wasm(texts_json: string, dim: number): string;

/**
 * Embed a single text using TF-IDF into a JSON array of f32 values.
 *
 * `dim` is the output dimensionality (default 256 in the TS `LocalEmbeddingProvider`).
 *
 * Returns a JSON array string, e.g. `"[0.1, 0.2, ...]"`, or `"[]"` on error.
 */
export function tfidf_embed_wasm(text: string, dim: number): string;

/**
 * WASM binding for the 3-way merge algorithm.
 *
 * Takes `base`, `ours`, and `theirs` content strings.
 * Returns a JSON-serialised [`ThreeWayMergeResult`] on success, or
 * `{"error": "<message>"}` on serialization failure.
 */
export function three_way_merge_wasm(base: string, ours: string, theirs: string): string;

/**
 * Find the most active agents.
 *
 * `graph_json` is a serialised KnowledgeGraph. `limit` is the max number of results.
 * Returns a JSON array of `{ agent, activity }` objects.
 */
export function top_agents_wasm(graph_json: string, limit: number): string;

/**
 * Find the most connected topics.
 *
 * `graph_json` is a serialised KnowledgeGraph. `limit` is the max number of results.
 * Returns a JSON array of `{ topic, agents }` objects.
 */
export function top_topics_wasm(graph_json: string, limit: number): string;

/**
 * Validate a proposed transition and return a JSON result.
 *
 * Returns a JSON object with `valid`, `reason`, and `allowedTargets` fields.
 * Matches the TypeScript `TransitionResult` interface.
 */
export function validate_transition(from: string, to: string): string;

/**
 * WASM: verify a Merkle inclusion proof.
 *
 * `root_hex`  — 64-char hex root.
 * `leaf_hex`  — 64-char hex leaf.
 * `proof_json` — JSON array of `[siblingHex, isRightSibling]` pairs.
 *
 * Returns `"true"` or `"false"`, or `{"error":"..."}` on invalid input.
 */
export function verify_merkle_proof_wasm(root_hex: string, leaf_hex: string, proof_json: string): string;

/**
 * WASM binding: compress bytes using zstd, returning the compressed bytes.
 *
 * Accepts a `Uint8Array` from JavaScript.
 */
export function zstd_compress_bytes(data: Uint8Array): Uint8Array;

/**
 * WASM binding: decompress zstd bytes, returning the raw decompressed bytes.
 *
 * Accepts a `Uint8Array` from JavaScript.
 */
export function zstd_decompress_bytes(data: Uint8Array): Uint8Array;
