/* @ts-self-types="./llmtxt_core.d.ts" */

/**
 * Result of computing a line-based diff between two texts.
 */
class DiffResult {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(DiffResult.prototype);
        obj.__wbg_ptr = ptr;
        DiffResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DiffResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_diffresult_free(ptr, 0);
    }
    /**
     * Number of lines added in the new text.
     * @returns {number}
     */
    get added_lines() {
        const ret = wasm.diffresult_added_lines(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Estimated tokens added.
     * @returns {number}
     */
    get added_tokens() {
        const ret = wasm.diffresult_added_tokens(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of lines removed from the old text.
     * @returns {number}
     */
    get removed_lines() {
        const ret = wasm.diffresult_removed_lines(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Estimated tokens removed.
     * @returns {number}
     */
    get removed_tokens() {
        const ret = wasm.diffresult_removed_tokens(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) DiffResult.prototype[Symbol.dispose] = DiffResult.prototype.free;
exports.DiffResult = DiffResult;

/**
 * Lifecycle state of a collaborative document.
 *
 * Matches the TypeScript `DocumentState` type exactly.
 * @enum {0 | 1 | 2 | 3}
 */
const DocumentState = Object.freeze({
    Draft: 0, "0": "Draft",
    Review: 1, "1": "Review",
    Locked: 2, "2": "Locked",
    Archived: 3, "3": "Archived",
});
exports.DocumentState = DocumentState;

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
 * @param {string} from_id
 * @param {string} to_id
 * @param {string} nonce_hex
 * @param {number} timestamp_ms
 * @param {string} content_type
 * @param {string} payload_b64
 * @param {string} sk_hex
 * @returns {string}
 */
function a2a_build_and_sign(from_id, to_id, nonce_hex, timestamp_ms, content_type, payload_b64, sk_hex) {
    let deferred7_0;
    let deferred7_1;
    try {
        const ptr0 = passStringToWasm0(from_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(to_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(content_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(payload_b64, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ptr5 = passStringToWasm0(sk_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len5 = WASM_VECTOR_LEN;
        const ret = wasm.a2a_build_and_sign(ptr0, len0, ptr1, len1, ptr2, len2, timestamp_ms, ptr3, len3, ptr4, len4, ptr5, len5);
        deferred7_0 = ret[0];
        deferred7_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred7_0, deferred7_1, 1);
    }
}
exports.a2a_build_and_sign = a2a_build_and_sign;

/**
 * WASM: verify an A2A message JSON against a public key.
 *
 * Returns `"true"` or `"false"`.
 * @param {string} msg_json
 * @param {string} pk_hex
 * @returns {boolean}
 */
function a2a_verify(msg_json, pk_hex) {
    const ptr0 = passStringToWasm0(msg_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(pk_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.a2a_verify(ptr0, len0, ptr1, len1);
    return ret !== 0;
}
exports.a2a_verify = a2a_verify;

/**
 * Apply a unified diff patch to an original string.
 * Returns the updated string on success, or an error if the patch is invalid
 * or fails to apply cleanly.
 * @param {string} original
 * @param {string} patch_text
 * @returns {string}
 */
function apply_patch(original, patch_text) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(original, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(patch_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.apply_patch(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.apply_patch = apply_patch;

/**
 * Compare multiple versions against a base version in a single call.
 *
 * `version_numbers` is a JSON array of version numbers to compare: `[1, 3, 5, 8]`.
 * Each is reconstructed from the patch chain and diffed against `base_version`.
 * Returns a JSON array of diff results.
 *
 * This avoids N separate WASM calls and parses the patches JSON once.
 * @param {string} base
 * @param {string} patches_json
 * @param {number} base_version
 * @param {string} version_numbers_json
 * @returns {string}
 */
function batch_diff_versions(base, patches_json, base_version, version_numbers_json) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(patches_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(version_numbers_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.batch_diff_versions(ptr0, len0, ptr1, len1, base_version, ptr2, len2);
        var ptr4 = ret[0];
        var len4 = ret[1];
        if (ret[3]) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}
exports.batch_diff_versions = batch_diff_versions;

/**
 * WASM: compute BFT quorum for fault count `f`.
 *
 * Returns `2f + 1` as a u32.
 * @param {number} n
 * @param {number} f
 * @returns {number}
 */
function bft_quorum_wasm(n, f) {
    const ret = wasm.bft_quorum_wasm(n, f);
    return ret >>> 0;
}
exports.bft_quorum_wasm = bft_quorum_wasm;

/**
 * WASM binding for [`blob_name_validate`].
 *
 * Returns `Ok(())` when the name is valid, or throws a `JsValue` string
 * describing the validation failure.
 * @param {string} name
 */
function blobNameValidate(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.blobNameValidate(ptr0, len0);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}
exports.blobNameValidate = blobNameValidate;

/**
 * Build a knowledge graph from a JSON array of MessageInput objects.
 *
 * Returns a JSON-serialised KnowledgeGraph, or `{"error":"..."}` on failure.
 * @param {string} messages_json
 * @returns {string}
 */
function build_graph_wasm(messages_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(messages_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.build_graph_wasm(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.build_graph_wasm = build_graph_wasm;

/**
 * Calculate the compression ratio (original / compressed), rounded to 2 decimals.
 * Returns 1.0 when `compressed_size` is 0.
 * @param {number} original_size
 * @param {number} compressed_size
 * @returns {number}
 */
function calculate_compression_ratio(original_size, compressed_size) {
    const ret = wasm.calculate_compression_ratio(original_size, compressed_size);
    return ret;
}
exports.calculate_compression_ratio = calculate_compression_ratio;

/**
 * Estimate token count using the ~4 chars/token heuristic.
 * @param {string} text
 * @returns {number}
 */
function calculate_tokens(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.calculate_tokens(ptr0, len0);
    return ret >>> 0;
}
exports.calculate_tokens = calculate_tokens;

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
 * @param {string} meta_json
 * @returns {string}
 */
function canonicalFrontmatter(meta_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(meta_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.canonicalFrontmatter(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.canonicalFrontmatter = canonicalFrontmatter;

/**
 * WASM binding for [`cherry_pick_merge`].
 *
 * Takes base content, a JSON versions map, and a JSON selection spec.
 * Returns a JSON-serialised `CherryPickResult` on success, or
 * `{"error": "<message>"}` on failure.
 * @param {string} base
 * @param {string} versions_json
 * @param {string} selection_json
 * @returns {string}
 */
function cherry_pick_merge_wasm(base, versions_json, selection_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(versions_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(selection_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.cherry_pick_merge_wasm(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.cherry_pick_merge_wasm = cherry_pick_merge_wasm;

/**
 * Compress a UTF-8 string using zlib-wrapped deflate (RFC 1950).
 *
 * Matches Node.js `zlib.deflate` output for backward compatibility
 * with existing stored data.
 *
 * # Errors
 * Returns an error string if compression fails.
 * @param {string} data
 * @returns {Uint8Array}
 */
function compress(data) {
    const ptr0 = passStringToWasm0(data, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compress(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
exports.compress = compress;

/**
 * Compute a line-based diff between two texts.
 *
 * Uses a hash-based LCS (Longest Common Subsequence) approach for
 * O(n*m) comparison where n and m are line counts. Returns counts
 * of added/removed lines and estimated token impact.
 * @param {string} old_text
 * @param {string} new_text
 * @returns {DiffResult}
 */
function compute_diff(old_text, new_text) {
    const ptr0 = passStringToWasm0(old_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(new_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.compute_diff(ptr0, len0, ptr1, len1);
    return DiffResult.__wrap(ret);
}
exports.compute_diff = compute_diff;

/**
 * Compute the HMAC-SHA256 signature for org-scoped signed URL parameters.
 * Includes `org_id` in the HMAC payload for organization-level access control.
 * Returns the first 32 hex characters (128 bits) by default.
 * @param {string} slug
 * @param {string} agent_id
 * @param {string} conversation_id
 * @param {string} org_id
 * @param {number} expires_at
 * @param {string} secret
 * @returns {string}
 */
function compute_org_signature(slug, agent_id, conversation_id, org_id, expires_at, secret) {
    let deferred6_0;
    let deferred6_1;
    try {
        const ptr0 = passStringToWasm0(slug, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(conversation_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(org_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(secret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.compute_org_signature(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, expires_at, ptr4, len4);
        deferred6_0 = ret[0];
        deferred6_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
    }
}
exports.compute_org_signature = compute_org_signature;

/**
 * Compute org-scoped HMAC-SHA256 signature with configurable output length.
 * @param {string} slug
 * @param {string} agent_id
 * @param {string} conversation_id
 * @param {string} org_id
 * @param {number} expires_at
 * @param {string} secret
 * @param {number} sig_length
 * @returns {string}
 */
function compute_org_signature_with_length(slug, agent_id, conversation_id, org_id, expires_at, secret, sig_length) {
    let deferred6_0;
    let deferred6_1;
    try {
        const ptr0 = passStringToWasm0(slug, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(conversation_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(org_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(secret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.compute_org_signature_with_length(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, expires_at, ptr4, len4, sig_length);
        deferred6_0 = ret[0];
        deferred6_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
    }
}
exports.compute_org_signature_with_length = compute_org_signature_with_length;

/**
 * Compute which markdown sections were modified between two document versions.
 *
 * Returns a JSON array of section heading names that changed.
 * Detects added, removed, and modified sections.
 * @param {string} old_content
 * @param {string} new_content
 * @returns {string}
 */
function compute_sections_modified(old_content, new_content) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(old_content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(new_content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.compute_sections_modified(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.compute_sections_modified = compute_sections_modified;

/**
 * Compute the HMAC-SHA256 signature for signed URL parameters.
 * Returns the first 16 hex characters of the digest (64 bits).
 * For longer signatures, use [`compute_signature_with_length`].
 * @param {string} slug
 * @param {string} agent_id
 * @param {string} conversation_id
 * @param {number} expires_at
 * @param {string} secret
 * @returns {string}
 */
function compute_signature(slug, agent_id, conversation_id, expires_at, secret) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(slug, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(conversation_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(secret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.compute_signature(ptr0, len0, ptr1, len1, ptr2, len2, expires_at, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}
exports.compute_signature = compute_signature;

/**
 * Compute the HMAC-SHA256 signature with configurable output length.
 *
 * `sig_length` controls how many hex characters to return (max 64).
 * Use 16 for short-lived URLs (backward compat), 32 for long-lived URLs (128 bits).
 * @param {string} slug
 * @param {string} agent_id
 * @param {string} conversation_id
 * @param {number} expires_at
 * @param {string} secret
 * @param {number} sig_length
 * @returns {string}
 */
function compute_signature_with_length(slug, agent_id, conversation_id, expires_at, secret, sig_length) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(slug, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(conversation_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(secret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.compute_signature_with_length(ptr0, len0, ptr1, len1, ptr2, len2, expires_at, ptr3, len3, sig_length);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}
exports.compute_signature_with_length = compute_signature_with_length;

/**
 * Check for binary content by scanning for control characters (0x00–0x08)
 * in the first 8 KB of the content.
 *
 * Returns `true` if binary control characters are found.
 *
 * Matches the TypeScript `containsBinaryContent` helper exactly.
 * @param {string} content
 * @returns {boolean}
 */
function contains_binary_content(content) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.contains_binary_content(ptr0, len0);
    return ret !== 0;
}
exports.contains_binary_content = contains_binary_content;

/**
 * Compute content similarity using word shingles.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function content_similarity_wasm(a, b) {
    const ptr0 = passStringToWasm0(a, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.content_similarity_wasm(ptr0, len0, ptr1, len1);
    return ret;
}
exports.content_similarity_wasm = content_similarity_wasm;

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
 * @param {string} a_json
 * @param {string} b_json
 * @returns {number}
 */
function cosine_similarity_wasm(a_json, b_json) {
    const ptr0 = passStringToWasm0(a_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.cosine_similarity_wasm(ptr0, len0, ptr1, len1);
    return ret;
}
exports.cosine_similarity_wasm = cosine_similarity_wasm;

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
 * @param {Uint8Array} state
 * @param {Uint8Array} update
 * @returns {Uint8Array}
 */
function crdt_apply_update(state, update) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(update, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.crdt_apply_update(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.crdt_apply_update = crdt_apply_update;

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
 * @param {Uint8Array} state
 * @param {Uint8Array} remote_sv
 * @returns {Uint8Array}
 */
function crdt_diff_update(state, remote_sv) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(remote_sv, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.crdt_diff_update(ptr0, len0, ptr1, len1);
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}
exports.crdt_diff_update = crdt_diff_update;

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
 * @param {Uint8Array} state
 * @returns {Uint8Array}
 */
function crdt_encode_state_as_update(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.crdt_encode_state_as_update(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
exports.crdt_encode_state_as_update = crdt_encode_state_as_update;

/**
 * WASM-exported variant of [`crdt_merge_updates`].
 *
 * Accepts a flat byte buffer with 4-byte LE length prefixes:
 * `[len1:u32le][bytes1][len2:u32le][bytes2]...`
 *
 * This avoids the `Vec<Vec<u8>>` type which is not directly
 * wasm-bindgen-compatible.
 * @param {Uint8Array} packed
 * @returns {Uint8Array}
 */
function crdt_merge_updates_wasm(packed) {
    const ptr0 = passArray8ToWasm0(packed, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.crdt_merge_updates_wasm(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
exports.crdt_merge_updates_wasm = crdt_merge_updates_wasm;

/**
 * Create an empty Loro doc for a section and return its snapshot bytes.
 *
 * The doc contains a single `LoroText` root named `"content"`. The returned
 * bytes are an opaque Loro snapshot blob. Callers MUST treat this as a state
 * blob — it is NOT a Y.js state vector (incompatible format).
 *
 * Use the returned bytes as the initial `state` argument to
 * [`crdt_encode_state_as_update`] or [`crdt_apply_update`].
 * @returns {Uint8Array}
 */
function crdt_new_doc() {
    const ret = wasm.crdt_new_doc();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}
exports.crdt_new_doc = crdt_new_doc;

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
 * @param {Uint8Array} state
 * @returns {Uint8Array}
 */
function crdt_state_vector(state) {
    const ptr0 = passArray8ToWasm0(state, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.crdt_state_vector(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}
exports.crdt_state_vector = crdt_state_vector;

/**
 * Create a unified diff patch representing the difference between `original`
 * and `modified`.
 * @param {string} original
 * @param {string} modified
 * @returns {string}
 */
function create_patch(original, modified) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(original, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(modified, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.create_patch(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.create_patch = create_patch;

/**
 * Decode a base62-encoded string back into an integer.
 * @param {string} s
 * @returns {bigint}
 */
function decode_base62(s) {
    const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decode_base62(ptr0, len0);
    return BigInt.asUintN(64, ret);
}
exports.decode_base62 = decode_base62;

/**
 * Decompress zlib-wrapped deflate bytes back to a UTF-8 string.
 *
 * Matches Node.js `zlib.inflate` for backward compatibility.
 *
 * # Errors
 * Returns an error string if decompression or UTF-8 conversion fails.
 * @param {Uint8Array} data
 * @returns {string}
 */
function decompress(data) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decompress(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.decompress = decompress;

/**
 * WASM-exposed default max content bytes.
 * @returns {bigint}
 */
function default_max_content_bytes() {
    const ret = wasm.default_max_content_bytes();
    return BigInt.asUintN(64, ret);
}
exports.default_max_content_bytes = default_max_content_bytes;

/**
 * WASM-exposed default max line bytes.
 * @returns {number}
 */
function default_max_line_bytes() {
    const ret = wasm.default_max_line_bytes();
    return ret >>> 0;
}
exports.default_max_line_bytes = default_max_line_bytes;

/**
 * Derive a per-agent signing key from their API key.
 * Uses `HMAC-SHA256(api_key, "llmtxt-signing")`.
 * @param {string} api_key
 * @returns {string}
 */
function derive_signing_key(api_key) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(api_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.derive_signing_key(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.derive_signing_key = derive_signing_key;

/**
 * Detect the structural format of a document.
 *
 * Returns `"json"`, `"markdown"`, `"code"`, or `"text"`.
 * @param {string} content
 * @returns {string}
 */
function detect_document_format_wasm(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.detect_document_format_wasm(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.detect_document_format_wasm = detect_document_format_wasm;

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
 * @param {string} content
 * @returns {string}
 */
function detect_format(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.detect_format(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.detect_format = detect_format;

/**
 * Reconstruct two versions and compute a diff between them.
 *
 * Returns a JSON string with `fromVersion`, `toVersion`, `addedLines`,
 * `removedLines`, `addedTokens`, `removedTokens`, and `patchText` fields.
 * Matches the TypeScript `VersionDiffSummary` interface.
 * @param {string} base
 * @param {string} patches_json
 * @param {number} from_version
 * @param {number} to_version
 * @returns {string}
 */
function diff_versions(base, patches_json, from_version, to_version) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(patches_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.diff_versions(ptr0, len0, ptr1, len1, from_version, to_version);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.diff_versions = diff_versions;

/**
 * Encode a non-negative integer into a base62 string.
 *
 * Uses the alphabet `0-9A-Za-z`. Zero encodes to `"0"`.
 * @param {bigint} num
 * @returns {string}
 */
function encode_base62(num) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.encode_base62(num);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.encode_base62 = encode_base62;

/**
 * Evaluate reviews against a policy. All inputs and output are JSON strings.
 *
 * Input `reviews_json`: `[{"reviewerId":"...","status":"APPROVED","timestamp":123,"atVersion":1}]`
 * Input `policy_json`: `{"requiredCount":1,"requireUnanimous":false,"allowedReviewerIds":[],"timeoutMs":0}`
 *
 * Returns a JSON string matching the TypeScript `ApprovalResult` interface.
 * @param {string} reviews_json
 * @param {string} policy_json
 * @param {number} current_version
 * @param {number} now_ms
 * @returns {string}
 */
function evaluate_approvals(reviews_json, policy_json, current_version, now_ms) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(reviews_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(policy_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.evaluate_approvals(ptr0, len0, ptr1, len1, current_version, now_ms);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.evaluate_approvals = evaluate_approvals;

/**
 * Extract /directives from content. Returns JSON array of strings.
 * @param {string} content
 * @returns {string}
 */
function extract_directives_wasm(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_directives_wasm(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.extract_directives_wasm = extract_directives_wasm;

/**
 * Extract @mentions from content. Returns JSON array of strings.
 * @param {string} content
 * @returns {string}
 */
function extract_mentions_wasm(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_mentions_wasm(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.extract_mentions_wasm = extract_mentions_wasm;

/**
 * Extract character n-grams from text. Returns JSON array of strings.
 * @param {string} text
 * @param {number} n
 * @returns {string}
 */
function extract_ngrams_wasm(text, n) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_ngrams_wasm(ptr0, len0, n);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.extract_ngrams_wasm = extract_ngrams_wasm;

/**
 * Extract #tags from content. Returns JSON array of strings.
 * @param {string} content
 * @returns {string}
 */
function extract_tags_wasm(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_tags_wasm(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.extract_tags_wasm = extract_tags_wasm;

/**
 * Extract word shingles from text. Returns JSON array of strings.
 * @param {string} text
 * @param {number} n
 * @returns {string}
 */
function extract_word_shingles_wasm(text, n) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.extract_word_shingles_wasm(ptr0, len0, n);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.extract_word_shingles_wasm = extract_word_shingles_wasm;

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
 * @param {string} content
 * @param {number} max_chars
 * @returns {number}
 */
function find_overlong_line(content, max_chars) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.find_overlong_line(ptr0, len0, max_chars);
    return ret >>> 0;
}
exports.find_overlong_line = find_overlong_line;

/**
 * FNV-1a hash of a string (32-bit). Returns hash as u32 cast to u64.
 *
 * Matches the TS `fnv1aHash(str: string): number` function exactly.
 * @param {string} s
 * @returns {number}
 */
function fnv1a_hash_wasm(s) {
    const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fnv1a_hash_wasm(ptr0, len0);
    return ret >>> 0;
}
exports.fnv1a_hash_wasm = fnv1a_hash_wasm;

/**
 * Generate an 8-character base62 ID from a UUID v4.
 * @returns {string}
 */
function generate_id() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.generate_id();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.generate_id = generate_id;

/**
 * Generate a structural overview of a document.
 *
 * Returns JSON-serialised DocumentOverview, or `{"error":"..."}` on failure.
 * @param {string} content
 * @returns {string}
 */
function generate_overview_wasm(content) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.generate_overview_wasm(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.generate_overview_wasm = generate_overview_wasm;

/**
 * Extract a line range from a document.
 *
 * Returns JSON-serialised LineRangeResult.
 * @param {string} content
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
function get_line_range_wasm(content, start, end) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.get_line_range_wasm(ptr0, len0, start, end);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.get_line_range_wasm = get_line_range_wasm;

/**
 * Extract a named section from a document.
 *
 * Returns JSON result or `{"error":"section not found"}` if missing.
 * @param {string} content
 * @param {string} section_name
 * @param {boolean} depth_all
 * @returns {string}
 */
function get_section_wasm(content, section_name, depth_all) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(section_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.get_section_wasm(ptr0, len0, ptr1, len1, depth_all);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.get_section_wasm = get_section_wasm;

/**
 * WASM binding for [`hash_blob`].
 *
 * Accepts raw bytes and returns the lowercase hex SHA-256 digest (64 chars).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function hashBlob(bytes) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hashBlob(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.hashBlob = hashBlob;

/**
 * WASM: compute hash chain extension.
 *
 * `prev_hash_hex` — 64-char lowercase hex of the 32-byte previous hash.
 * `event_json`    — UTF-8 event payload string.
 *
 * Returns 64-char lowercase hex of the new chain hash, or `{"error":"..."}`.
 * @param {string} prev_hash_hex
 * @param {string} event_json
 * @returns {string}
 */
function hash_chain_extend_wasm(prev_hash_hex, event_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(prev_hash_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(event_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.hash_chain_extend_wasm(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.hash_chain_extend_wasm = hash_chain_extend_wasm;

/**
 * Compute the SHA-256 hash of a UTF-8 string, returned as lowercase hex.
 * @param {string} data
 * @returns {string}
 */
function hash_content(data) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(data, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hash_content(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.hash_content = hash_content;

/**
 * WASM: compute SHA-256 body hash as lowercase hex.
 * @param {Uint8Array} body
 * @returns {string}
 */
function identity_body_hash_hex(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(body, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.identity_body_hash_hex(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.identity_body_hash_hex = identity_body_hash_hex;

/**
 * WASM: build canonical payload bytes.
 *
 * Returns the raw UTF-8 bytes of the canonical payload string.
 * @param {string} method
 * @param {string} path_and_query
 * @param {number} timestamp_ms
 * @param {string} agent_id
 * @param {string} nonce_hex
 * @param {string} body_hash_hex
 * @returns {Uint8Array}
 */
function identity_canonical_payload(method, path_and_query, timestamp_ms, agent_id, nonce_hex, body_hash_hex) {
    const ptr0 = passStringToWasm0(method, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(path_and_query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(agent_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(nonce_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(body_hash_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len4 = WASM_VECTOR_LEN;
    const ret = wasm.identity_canonical_payload(ptr0, len0, ptr1, len1, timestamp_ms, ptr2, len2, ptr3, len3, ptr4, len4);
    var v6 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v6;
}
exports.identity_canonical_payload = identity_canonical_payload;

/**
 * WASM: generate an Ed25519 keypair.
 *
 * Returns JSON `{"sk":"<hex64>","pk":"<hex64>"}`.
 * @returns {string}
 */
function identity_keygen() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.identity_keygen();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.identity_keygen = identity_keygen;

/**
 * WASM: sign a submission.
 *
 * * `sk_hex`  — 64-char hex of the 32-byte secret key
 * * `payload` — raw payload bytes
 *
 * Returns 128-char hex of the 64-byte signature, or `{"error":"..."}`.
 * @param {string} sk_hex
 * @param {Uint8Array} payload
 * @returns {string}
 */
function identity_sign(sk_hex, payload) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(sk_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(payload, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.identity_sign(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.identity_sign = identity_sign;

/**
 * WASM: verify a submission signature.
 *
 * * `pk_hex`  — 64-char hex of the 32-byte public key
 * * `payload` — raw payload bytes
 * * `sig_hex` — 128-char hex of the 64-byte signature
 *
 * Returns `"true"` or `"false"`.
 * @param {string} pk_hex
 * @param {Uint8Array} payload
 * @param {string} sig_hex
 * @returns {boolean}
 */
function identity_verify(pk_hex, payload, sig_hex) {
    const ptr0 = passStringToWasm0(pk_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(payload, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(sig_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.identity_verify(ptr0, len0, ptr1, len1, ptr2, len2);
    return ret !== 0;
}
exports.identity_verify = identity_verify;

/**
 * Check whether a document state allows content modifications.
 *
 * Only DRAFT and REVIEW states accept new versions/patches.
 * @param {DocumentState} state
 * @returns {boolean}
 */
function is_editable(state) {
    const ret = wasm.is_editable(state);
    return ret !== 0;
}
exports.is_editable = is_editable;

/**
 * Parse a state string and check if it's editable.
 * Returns false for unrecognized state names.
 * @param {string} state
 * @returns {boolean}
 */
function is_editable_str(state) {
    const ptr0 = passStringToWasm0(state, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_editable_str(ptr0, len0);
    return ret !== 0;
}
exports.is_editable_str = is_editable_str;

/**
 * Check whether a timestamp (milliseconds) has expired.
 * Returns false for 0 (no expiration).
 *
 * Uses `js_sys::Date::now()` in WASM, `std::time::SystemTime` natively.
 * @param {number} expires_at_ms
 * @returns {boolean}
 */
function is_expired(expires_at_ms) {
    const ret = wasm.is_expired(expires_at_ms);
    return ret !== 0;
}
exports.is_expired = is_expired;

/**
 * Check whether a document state is terminal (no further transitions).
 * @param {DocumentState} state
 * @returns {boolean}
 */
function is_terminal(state) {
    const ret = wasm.is_terminal(state);
    return ret !== 0;
}
exports.is_terminal = is_terminal;

/**
 * Parse a state string and check if it's terminal.
 * Returns false for unrecognized state names.
 * @param {string} state
 * @returns {boolean}
 */
function is_terminal_str(state) {
    const ptr0 = passStringToWasm0(state, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_terminal_str(ptr0, len0);
    return ret !== 0;
}
exports.is_terminal_str = is_terminal_str;

/**
 * Check whether a state transition is allowed.
 * @param {DocumentState} from
 * @param {DocumentState} to
 * @returns {boolean}
 */
function is_valid_transition(from, to) {
    const ret = wasm.is_valid_transition(from, to);
    return ret !== 0;
}
exports.is_valid_transition = is_valid_transition;

/**
 * Parse a state string and check if the transition is valid.
 * Accepts uppercase state names ("DRAFT", "REVIEW", etc.).
 * Returns false for unrecognized state names.
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
function is_valid_transition_str(from, to) {
    const ptr0 = passStringToWasm0(from, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(to, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.is_valid_transition_str(ptr0, len0, ptr1, len1);
    return ret !== 0;
}
exports.is_valid_transition_str = is_valid_transition_str;

/**
 * Compute Jaccard similarity between two texts using character n-grams.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function jaccard_similarity_wasm(a, b) {
    const ptr0 = passStringToWasm0(a, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.jaccard_similarity_wasm(ptr0, len0, ptr1, len1);
    return ret;
}
exports.jaccard_similarity_wasm = jaccard_similarity_wasm;

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
 * @param {string} vec_json
 * @returns {string}
 */
function l2_normalize_wasm(vec_json) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(vec_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.l2_normalize_wasm(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.l2_normalize_wasm = l2_normalize_wasm;

/**
 * Mark reviews as stale for the given version. JSON I/O for WASM.
 *
 * Returns a JSON array of updated reviews.
 * @param {string} reviews_json
 * @param {number} current_version
 * @returns {string}
 */
function mark_stale_reviews(reviews_json, current_version) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(reviews_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mark_stale_reviews(ptr0, len0, current_version);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.mark_stale_reviews = mark_stale_reviews;

/**
 * Generate a MinHash fingerprint. Returns JSON array of numbers.
 * @param {string} text
 * @param {number} num_hashes
 * @param {number} ngram_size
 * @returns {string}
 */
function min_hash_fingerprint_wasm(text, num_hashes, ngram_size) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.min_hash_fingerprint_wasm(ptr0, len0, num_hashes, ngram_size);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.min_hash_fingerprint_wasm = min_hash_fingerprint_wasm;

/**
 * WASM binding for [`multi_way_diff`].
 *
 * Takes base content and a JSON array of version strings.
 * Returns a JSON-serialised `MultiDiffResult` on success, or
 * `{"error": "<message>"}` on failure.
 * @param {string} base
 * @param {string} versions_json
 * @returns {string}
 */
function multi_way_diff_wasm(base, versions_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(versions_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.multi_way_diff_wasm(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.multi_way_diff_wasm = multi_way_diff_wasm;

/**
 * Execute a JSONPath query against JSON content.
 *
 * Returns `{ result, tokenCount, path }` JSON or `{"error":"..."}` on failure.
 * @param {string} content
 * @param {string} path
 * @returns {string}
 */
function query_json_path_wasm(content, path) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.query_json_path_wasm(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.query_json_path_wasm = query_json_path_wasm;

/**
 * Rank candidates by similarity to query.
 *
 * `candidates_json` is a JSON array of strings.
 * `options_json` is `{"method":"ngram"|"shingle","threshold":0.0}` (optional keys).
 * Returns JSON array of `{ index, score }` sorted descending.
 * @param {string} query
 * @param {string} candidates_json
 * @param {string} options_json
 * @returns {string}
 */
function rank_by_similarity_wasm(query, candidates_json, options_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(candidates_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.rank_by_similarity_wasm(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.rank_by_similarity_wasm = rank_by_similarity_wasm;

/**
 * Apply a sequence of patches to base content, returning the content at the
 * target version. This avoids N WASM boundary crossings by performing all
 * patch applications in a single Rust call.
 *
 * `patches_json` is a JSON array of patch strings: `["patch1", "patch2", ...]`.
 * `target` is the 1-based version to reconstruct (0 returns `base` unchanged).
 * If `target` exceeds the number of patches, all patches are applied.
 * @param {string} base
 * @param {string} patches_json
 * @param {number} target
 * @returns {string}
 */
function reconstruct_version(base, patches_json, target) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(patches_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.reconstruct_version(ptr0, len0, ptr1, len1, target);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.reconstruct_version = reconstruct_version;

/**
 * Check if a role has a specific permission.
 *
 * Returns `true` if `role` (e.g. `"editor"`) has the given `permission`
 * (e.g. `"write"`). Unknown roles or permissions return `false`.
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
function role_has_permission(role, permission) {
    const ptr0 = passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(permission, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.role_has_permission(ptr0, len0, ptr1, len1);
    return ret !== 0;
}
exports.role_has_permission = role_has_permission;

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
 * @param {string} role
 * @returns {string}
 */
function role_permissions(role) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.role_permissions(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.role_permissions = role_permissions;

/**
 * Search document content.
 *
 * Returns JSON array of SearchResult.
 * @param {string} content
 * @param {string} query
 * @param {number} context_lines
 * @param {number} max_results
 * @returns {string}
 */
function search_content_wasm(content, query, context_lines, max_results) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.search_content_wasm(ptr0, len0, ptr1, len1, context_lines, max_results);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.search_content_wasm = search_content_wasm;

/**
 * Evaluate semantic consensus from a JSON array of reviews (WASM / backend entry point).
 *
 * `reviews_json` must be a JSON array of objects with the shape
 * `{ reviewerId: string, content: string, embedding: number[] }`.
 *
 * Returns a JSON-serialised [`SemanticConsensusResult`], or `{"error":"..."}` on failure.
 * @param {string} reviews_json
 * @param {number} threshold
 * @returns {string}
 */
function semantic_consensus(reviews_json, threshold) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(reviews_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.semantic_consensus(ptr0, len0, threshold);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.semantic_consensus = semantic_consensus;

/**
 * WASM binding for [`semantic_consensus`].
 *
 * `reviews_json` is a JSON array of `{ reviewerId, content, embedding: number[] }`.
 * `threshold` is the minimum cosine similarity for two reviews to agree (e.g. 0.80).
 * Returns a JSON-serialised `SemanticConsensusResult`, or `{"error":"..."}`.
 * @param {string} reviews_json
 * @param {number} threshold
 * @returns {string}
 */
function semantic_consensus_wasm(reviews_json, threshold) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(reviews_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.semantic_consensus_wasm(ptr0, len0, threshold);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.semantic_consensus_wasm = semantic_consensus_wasm;

/**
 * Compute semantic diff from JSON strings (WASM / backend entry point).
 *
 * `sections_a_json` and `sections_b_json` must each be a JSON array of objects
 * with the shape `{ title: string, content: string, embedding: number[] }`.
 *
 * Returns a JSON-serialised [`SemanticDiffResult`], or `{"error":"..."}` on failure.
 * @param {string} sections_a_json
 * @param {string} sections_b_json
 * @returns {string}
 */
function semantic_diff(sections_a_json, sections_b_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(sections_a_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(sections_b_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.semantic_diff(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.semantic_diff = semantic_diff;

/**
 * WASM binding for [`semantic_diff`].
 *
 * `sections_a_json` and `sections_b_json` are JSON arrays of
 * `{ title, content, embedding: number[] }`.
 * Returns a JSON-serialised `SemanticDiffResult`, or `{"error":"..."}`.
 * @param {string} sections_a_json
 * @param {string} sections_b_json
 * @returns {string}
 */
function semantic_diff_wasm(sections_a_json, sections_b_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(sections_a_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(sections_b_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.semantic_diff_wasm(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.semantic_diff_wasm = semantic_diff_wasm;

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
 * @param {string} secret
 * @param {string} payload
 * @returns {string}
 */
function sign_webhook_payload(secret, payload) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(secret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(payload, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.sign_webhook_payload(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.sign_webhook_payload = sign_webhook_payload;

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
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.slugify(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.slugify = slugify;

/**
 * Apply all patches sequentially to base content, then produce a single
 * unified diff from the original base to the final state.
 *
 * `patches_json` is a JSON array of patch strings: `["patch1", "patch2", ...]`.
 * @param {string} base
 * @param {string} patches_json
 * @returns {string}
 */
function squash_patches(base, patches_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(patches_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.squash_patches(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.squash_patches = squash_patches;

/**
 * Compute a structured line-level diff between two texts.
 *
 * Returns a JSON-serialized [`StructuredDiffResult`] with interleaved
 * context, added, and removed lines including line numbers for both
 * old and new text. This is the single source of truth for diff display.
 *
 * Uses the same LCS algorithm as [`compute_diff`] but produces full
 * line-by-line output instead of just counts.
 * @param {string} old_text
 * @param {string} new_text
 * @returns {string}
 */
function structured_diff(old_text, new_text) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(old_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(new_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.structured_diff(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.structured_diff = structured_diff;

/**
 * Compute character-level n-gram Jaccard similarity between two texts.
 * Returns 0.0 (no overlap) to 1.0 (identical). Default n=3.
 *
 * WASM shim — delegates to [`similarity::text_similarity_jaccard`].
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function text_similarity(a, b) {
    const ptr0 = passStringToWasm0(a, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.text_similarity(ptr0, len0, ptr1, len1);
    return ret;
}
exports.text_similarity = text_similarity;

/**
 * Compute n-gram Jaccard similarity with configurable gram size.
 *
 * WASM shim — delegates to [`similarity::text_similarity_jaccard`].
 * @param {string} a
 * @param {string} b
 * @param {number} n
 * @returns {number}
 */
function text_similarity_ngram(a, b, n) {
    const ptr0 = passStringToWasm0(a, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.text_similarity_ngram(ptr0, len0, ptr1, len1, n);
    return ret;
}
exports.text_similarity_ngram = text_similarity_ngram;

/**
 * Embed a batch of texts using TF-IDF. Input is a JSON array of strings.
 *
 * Returns a JSON array-of-arrays string, e.g. `"[[0.1,...],[0.2,...]]"`.
 * Returns `"[]"` on parse error.
 * @param {string} texts_json
 * @param {number} dim
 * @returns {string}
 */
function tfidf_embed_batch_wasm(texts_json, dim) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(texts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tfidf_embed_batch_wasm(ptr0, len0, dim);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.tfidf_embed_batch_wasm = tfidf_embed_batch_wasm;

/**
 * Embed a single text using TF-IDF into a JSON array of f32 values.
 *
 * `dim` is the output dimensionality (default 256 in the TS `LocalEmbeddingProvider`).
 *
 * Returns a JSON array string, e.g. `"[0.1, 0.2, ...]"`, or `"[]"` on error.
 * @param {string} text
 * @param {number} dim
 * @returns {string}
 */
function tfidf_embed_wasm(text, dim) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tfidf_embed_wasm(ptr0, len0, dim);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.tfidf_embed_wasm = tfidf_embed_wasm;

/**
 * WASM binding for the 3-way merge algorithm.
 *
 * Takes `base`, `ours`, and `theirs` content strings.
 * Returns a JSON-serialised [`ThreeWayMergeResult`] on success, or
 * `{"error": "<message>"}` on serialization failure.
 * @param {string} base
 * @param {string} ours
 * @param {string} theirs
 * @returns {string}
 */
function three_way_merge_wasm(base, ours, theirs) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(ours, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(theirs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.three_way_merge_wasm(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}
exports.three_way_merge_wasm = three_way_merge_wasm;

/**
 * Find the most active agents.
 *
 * `graph_json` is a serialised KnowledgeGraph. `limit` is the max number of results.
 * Returns a JSON array of `{ agent, activity }` objects.
 * @param {string} graph_json
 * @param {number} limit
 * @returns {string}
 */
function top_agents_wasm(graph_json, limit) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(graph_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.top_agents_wasm(ptr0, len0, limit);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.top_agents_wasm = top_agents_wasm;

/**
 * Find the most connected topics.
 *
 * `graph_json` is a serialised KnowledgeGraph. `limit` is the max number of results.
 * Returns a JSON array of `{ topic, agents }` objects.
 * @param {string} graph_json
 * @param {number} limit
 * @returns {string}
 */
function top_topics_wasm(graph_json, limit) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(graph_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.top_topics_wasm(ptr0, len0, limit);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.top_topics_wasm = top_topics_wasm;

/**
 * Validate a proposed transition and return a JSON result.
 *
 * Returns a JSON object with `valid`, `reason`, and `allowedTargets` fields.
 * Matches the TypeScript `TransitionResult` interface.
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function validate_transition(from, to) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(from, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(to, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.validate_transition(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.validate_transition = validate_transition;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_3c846841762788c1: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_781bc9f159099513: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_7ef6b97b02428fae: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_52709e72fb9f179c: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_2d781c1f4d5c0ef8: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_getRandomValues_a1cf2e70b003a59d: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_length_ea16607d7b61445b: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_with_length_825018a1616e9e55: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_16f0c993d5dd6c27: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_now_7487a8384907a228: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_d62e5099504357e6: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_8adb955bd33fac2f: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_f207c857566db248: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_bb9f1ba69d61b386: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_a068d24e39478a8a: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./llmtxt_core_bg.js": import0,
    };
}

const DiffResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_diffresult_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/llmtxt_core_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
