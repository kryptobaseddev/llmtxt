//! WASM binding wrappers for crates/llmtxt-core public API.
//!
//! Each function delegates to the corresponding native Rust function
//! and serializes the result as JSON for JavaScript consumers. Pure
//! glue — no business logic lives here.

#![cfg(feature = "wasm")]

use wasm_bindgen::prelude::*;

use crate::classify;
use crate::{
    cherry_pick_merge, multi_way_diff, semantic_consensus, semantic_diff, three_way_merge,
};

// Re-export crate-level WASM bindings from child modules so that Rust
// consumers can access them via the crate root when the `wasm` feature
// is active. (wasm-bindgen discovers them from the original modules
// directly; these re-exports serve Rust callers only.)
pub use crate::export_archive::{deserialize_export_archive_wasm, serialize_export_archive_wasm};
pub use crate::merkle::{merkle_root_wasm, verify_merkle_proof_wasm};
pub use crate::retention::retention_apply_wasm;

// ── 3-Way Merge (WASM) ──────────────────────────────────────────

/// WASM binding for the 3-way merge algorithm.
///
/// Takes `base`, `ours`, and `theirs` content strings.
/// Returns a JSON-serialised [`ThreeWayMergeResult`] on success, or
/// `{"error": "<message>"}` on serialization failure.
#[wasm_bindgen]
pub fn three_way_merge_wasm(base: &str, ours: &str, theirs: &str) -> String {
    three_way_merge(base, ours, theirs)
}

// ── Multi-way Diff (WASM) ────────────────────────────────────────

/// WASM binding for [`multi_way_diff`].
///
/// Takes base content and a JSON array of version strings.
/// Returns a JSON-serialised `MultiDiffResult` on success, or
/// `{"error": "<message>"}` on failure.
#[wasm_bindgen]
pub fn multi_way_diff_wasm(base: &str, versions_json: &str) -> String {
    multi_way_diff(base, versions_json)
}

// ── Cherry-Pick Merge (WASM) ─────────────────────────────────────

/// WASM binding for [`cherry_pick_merge`].
///
/// Takes base content, a JSON versions map, and a JSON selection spec.
/// Returns a JSON-serialised `CherryPickResult` on success, or
/// `{"error": "<message>"}` on failure.
#[wasm_bindgen]
pub fn cherry_pick_merge_wasm(base: &str, versions_json: &str, selection_json: &str) -> String {
    match cherry_pick_merge(base, versions_json, selection_json) {
        Ok(json) => json,
        Err(e) => format!(r#"{{"error":{}}}"#, serde_json::json!(e)),
    }
}

// ── Semantic Diff (WASM) ─────────────────────────────────────────

/// WASM binding for [`semantic_diff`].
///
/// `sections_a_json` and `sections_b_json` are JSON arrays of
/// `{ title, content, embedding: number[] }`.
/// Returns a JSON-serialised `SemanticDiffResult`, or `{"error":"..."}`.
#[wasm_bindgen]
pub fn semantic_diff_wasm(sections_a_json: &str, sections_b_json: &str) -> String {
    semantic_diff(sections_a_json, sections_b_json)
}

// ── Semantic Consensus (WASM) ────────────────────────────────────

/// WASM binding for [`semantic_consensus`].
///
/// `reviews_json` is a JSON array of `{ reviewerId, content, embedding: number[] }`.
/// `threshold` is the minimum cosine similarity for two reviews to agree (e.g. 0.80).
/// Returns a JSON-serialised `SemanticConsensusResult`, or `{"error":"..."}`.
#[wasm_bindgen]
pub fn semantic_consensus_wasm(reviews_json: &str, threshold: f64) -> String {
    semantic_consensus(reviews_json, threshold)
}

// ── Compression (WASM byte-level bindings) ───────────────────────

/// WASM binding: compress bytes using zstd, returning the compressed bytes.
///
/// Accepts a `Uint8Array` from JavaScript.
#[wasm_bindgen]
pub fn zstd_compress_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
    crate::zstd_compress(data)
}

/// WASM binding: decompress zstd bytes, returning the raw decompressed bytes.
///
/// Accepts a `Uint8Array` from JavaScript.
#[wasm_bindgen]
pub fn zstd_decompress_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
    crate::zstd_decompress(data)
}

// ── Similarity (WASM shims — delegate to similarity module) ────────

/// Compute character-level n-gram Jaccard similarity between two texts.
/// Returns 0.0 (no overlap) to 1.0 (identical). Default n=3.
///
/// WASM shim — delegates to [`similarity::text_similarity_jaccard`].
#[wasm_bindgen]
pub fn text_similarity(a: &str, b: &str) -> f64 {
    crate::similarity::text_similarity_jaccard(a, b, 3)
}

/// Compute n-gram Jaccard similarity with configurable gram size.
///
/// WASM shim — delegates to [`similarity::text_similarity_jaccard`].
#[wasm_bindgen]
pub fn text_similarity_ngram(a: &str, b: &str, n: usize) -> f64 {
    crate::similarity::text_similarity_jaccard(a, b, n)
}

// ── Classify (Wave-2: T826) ──────────────────────────────────────

/// WASM binding for [`classify::classify_content`].
///
/// Takes a byte slice (marshalled from JS as `Uint8Array` via
/// wasm-bindgen) and returns a JSON-serialised [`ClassificationResult`]
/// string. JS consumers parse the string back into an object.
///
/// Error handling: serialization failure returns `{"error":"..."}` —
/// callers should check for the `error` key before consuming.
///
/// # Examples
/// From JavaScript:
/// ```js
/// import { classify_content_wasm } from 'llmtxt';
/// const json = classify_content_wasm(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
/// // json = '{"mimeType":"application/pdf","category":"binary","format":"pdf",...}'
/// ```
#[wasm_bindgen]
pub fn classify_content_wasm(bytes: &[u8]) -> String {
    let result = classify::classify_content(bytes);
    match serde_json::to_string(&result) {
        Ok(s) => s,
        Err(e) => format!("{{\"error\":\"serialize failed: {}\"}}", e),
    }
}
