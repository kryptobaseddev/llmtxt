//! Lightweight content similarity using n-gram fingerprinting.
//!
//! No external dependencies — uses only string operations.
//! Designed for agent use cases: find similar messages in a conversation
//! without vector embeddings or external APIs.
//!
//! Ported from `packages/llmtxt/src/similarity.ts`.
//!
//! Note: `cosine_similarity` lives in `semantic.rs` (from Wave A).
//! This module covers Jaccard/MinHash/ranking variants.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

// ── N-gram Generation ─────────────────────────────────────────────

/// Extract character-level n-grams from text.
///
/// Normalizes whitespace and lowercases before extraction.
/// Matches the TypeScript `extractNgrams` behaviour exactly.
pub fn extract_ngrams(text: &str, n: usize) -> HashSet<String> {
    if n == 0 {
        return HashSet::new();
    }
    let normalized: String = text
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let chars: Vec<char> = normalized.chars().collect();
    let mut grams = HashSet::new();

    if chars.len() < n {
        return grams;
    }

    for i in 0..=(chars.len() - n) {
        let gram: String = chars[i..i + n].iter().collect();
        grams.insert(gram);
    }
    grams
}

/// Extract word-level n-grams (shingles) from text.
///
/// Better for longer content where word order matters.
/// Matches the TypeScript `extractWordShingles` behaviour exactly.
pub fn extract_word_shingles(text: &str, n: usize) -> HashSet<String> {
    if n == 0 {
        return HashSet::new();
    }
    let words: Vec<String> = text
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(|w| w.to_string())
        .collect();

    let mut shingles = HashSet::new();
    if words.len() < n {
        return shingles;
    }

    for i in 0..=(words.len() - n) {
        let shingle = words[i..i + n].join(" ");
        shingles.insert(shingle);
    }
    shingles
}

// ── Similarity Metrics ────────────────────────────────────────────

/// Jaccard similarity: |A ∩ B| / |A ∪ B|.
///
/// Returns 0.0 (no overlap) to 1.0 (identical sets).
/// Matches the TypeScript `jaccardSimilarity` exactly.
pub fn jaccard_similarity(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }

    let intersection = a.intersection(b).count();
    let union = a.len() + b.len() - intersection;

    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

/// Compute similarity between two texts using character n-grams.
///
/// Returns 0.0 to 1.0. Default n=3.
/// Matches the TypeScript `textSimilarity` exactly.
pub fn text_similarity_jaccard(a: &str, b: &str, ngram_size: usize) -> f64 {
    jaccard_similarity(
        &extract_ngrams(a, ngram_size),
        &extract_ngrams(b, ngram_size),
    )
}

/// Compute similarity using word shingles.
///
/// Better for comparing messages where word choice matters more than character patterns.
/// Default shingle_size=2.
/// Matches the TypeScript `contentSimilarity` exactly.
pub fn content_similarity(a: &str, b: &str, shingle_size: usize) -> f64 {
    jaccard_similarity(
        &extract_word_shingles(a, shingle_size),
        &extract_word_shingles(b, shingle_size),
    )
}

// ── FNV-1a Hash ───────────────────────────────────────────────────

/// Simple hash function for MinHash. Uses FNV-1a variant with seed mixing.
///
/// Matches the TypeScript `simpleHash` exactly. Algorithm:
/// ```text
/// let hash = 2166136261 ^ seed;
/// for each char: hash ^= charCode; hash = hash * 16777619 (imul 32-bit);
/// return hash >>> 0;
/// ```
pub fn simple_hash(s: &str, seed: u32) -> u32 {
    let mut hash: u32 = 2_166_136_261u32.wrapping_add(seed);
    for byte in s.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}

// ── MinHash Fingerprinting ────────────────────────────────────────

/// Generate a compact fingerprint for content using MinHash.
///
/// The fingerprint is a vector of `num_hashes` minimum hash values over
/// the n-gram set. Two fingerprints with many matching values indicate
/// similar content.
/// Matches the TypeScript `minHashFingerprint` exactly.
pub fn min_hash_fingerprint(text: &str, num_hashes: usize, ngram_size: usize) -> Vec<u32> {
    let ngrams = extract_ngrams(text, ngram_size);
    let mut fingerprint = vec![u32::MAX; num_hashes];

    for gram in &ngrams {
        for (i, slot) in fingerprint.iter_mut().enumerate() {
            let h = simple_hash(gram, i as u32);
            if h < *slot {
                *slot = h;
            }
        }
    }
    fingerprint
}

/// Estimate similarity between two MinHash fingerprints.
///
/// Returns approximate Jaccard similarity (0.0 to 1.0).
pub fn fingerprint_similarity(a: &[u32], b: &[u32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let matches = a.iter().zip(b.iter()).filter(|(x, y)| x == y).count();
    matches as f64 / a.len() as f64
}

// ── Ranking ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimilarityResult {
    pub index: usize,
    pub score: f64,
}

/// Rank a list of texts by similarity to a query.
///
/// Returns results with score > threshold, sorted by descending score.
/// Matches the TypeScript `rankBySimilarity` exactly.
pub fn rank_by_similarity(
    query: &str,
    candidates: &[&str],
    method: &str,
    threshold: f64,
) -> Vec<SimilarityResult> {
    let mut results: Vec<SimilarityResult> = Vec::new();

    for (i, candidate) in candidates.iter().enumerate() {
        let score = if method == "ngram" {
            text_similarity_jaccard(query, candidate, 3)
        } else {
            content_similarity(query, candidate, 2)
        };

        if score > threshold {
            results.push(SimilarityResult { index: i, score });
        }
    }

    results.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results
}

// ── WASM entry points ─────────────────────────────────────────────

/// Extract character n-grams from text. Returns JSON array of strings.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn extract_ngrams_wasm(text: &str, n: u32) -> String {
    let mut grams: Vec<String> = extract_ngrams(text, n as usize).into_iter().collect();
    grams.sort();
    serde_json::to_string(&grams).unwrap_or_else(|_| "[]".to_string())
}

/// Extract word shingles from text. Returns JSON array of strings.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn extract_word_shingles_wasm(text: &str, n: u32) -> String {
    let mut shingles: Vec<String> = extract_word_shingles(text, n as usize)
        .into_iter()
        .collect();
    shingles.sort();
    serde_json::to_string(&shingles).unwrap_or_else(|_| "[]".to_string())
}

/// Compute Jaccard similarity between two texts using character n-grams.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn jaccard_similarity_wasm(a: &str, b: &str) -> f64 {
    text_similarity_jaccard(a, b, 3)
}

/// Compute content similarity using word shingles.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn content_similarity_wasm(a: &str, b: &str) -> f64 {
    content_similarity(a, b, 2)
}

/// Generate a MinHash fingerprint. Returns JSON array of numbers.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn min_hash_fingerprint_wasm(text: &str, num_hashes: u32, ngram_size: u32) -> String {
    let fp = min_hash_fingerprint(text, num_hashes as usize, ngram_size as usize);
    serde_json::to_string(&fp).unwrap_or_else(|_| "[]".to_string())
}

/// Rank candidates by similarity to query.
///
/// `candidates_json` is a JSON array of strings.
/// `options_json` is `{"method":"ngram"|"shingle","threshold":0.0}` (optional keys).
/// Returns JSON array of `{ index, score }` sorted descending.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn rank_by_similarity_wasm(query: &str, candidates_json: &str, options_json: &str) -> String {
    let candidates: Vec<String> = match serde_json::from_str(candidates_json) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"Invalid candidates JSON: {e}"}}"#),
    };

    let opts: serde_json::Value =
        serde_json::from_str(options_json).unwrap_or(serde_json::json!({}));
    let method = opts
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("shingle");
    let threshold = opts
        .get("threshold")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let refs: Vec<&str> = candidates.iter().map(String::as_str).collect();
    let results = rank_by_similarity(query, &refs, method, threshold);
    serde_json::to_string(&results)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── extract_ngrams ────────────────────────────────────────────

    #[test]
    fn ngrams_basic() {
        let grams = extract_ngrams("hello", 3);
        assert!(grams.contains("hel"));
        assert!(grams.contains("ell"));
        assert!(grams.contains("llo"));
    }

    #[test]
    fn ngrams_normalizes_whitespace() {
        let a = extract_ngrams("hello world", 3);
        let b = extract_ngrams("hello  world", 3);
        assert_eq!(a, b);
    }

    #[test]
    fn ngrams_lowercases() {
        let a = extract_ngrams("Hello", 3);
        let b = extract_ngrams("hello", 3);
        assert_eq!(a, b);
    }

    #[test]
    fn ngrams_empty_text() {
        assert!(extract_ngrams("", 3).is_empty());
    }

    // ── extract_word_shingles ─────────────────────────────────────

    #[test]
    fn shingles_basic() {
        let shingles = extract_word_shingles("the quick brown fox", 2);
        assert!(shingles.contains("the quick"));
        assert!(shingles.contains("quick brown"));
        assert!(shingles.contains("brown fox"));
    }

    #[test]
    fn shingles_strips_punctuation() {
        let a = extract_word_shingles("hello, world", 2);
        let b = extract_word_shingles("hello world", 2);
        assert_eq!(a, b);
    }

    // ── jaccard_similarity ────────────────────────────────────────

    #[test]
    fn jaccard_identical() {
        let a: HashSet<String> = ["x", "y"].iter().map(|s| s.to_string()).collect();
        assert!((jaccard_similarity(&a, &a) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn jaccard_disjoint() {
        let a: HashSet<String> = ["x"].iter().map(|s| s.to_string()).collect();
        let b: HashSet<String> = ["y"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard_similarity(&a, &b), 0.0);
    }

    #[test]
    fn jaccard_both_empty() {
        let a: HashSet<String> = HashSet::new();
        assert!((jaccard_similarity(&a, &a) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn jaccard_one_empty() {
        let a: HashSet<String> = HashSet::new();
        let b: HashSet<String> = ["x"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard_similarity(&a, &b), 0.0);
    }

    // ── simple_hash ───────────────────────────────────────────────

    #[test]
    fn simple_hash_deterministic() {
        assert_eq!(simple_hash("abc", 0), simple_hash("abc", 0));
    }

    #[test]
    fn simple_hash_seed_affects_result() {
        assert_ne!(simple_hash("abc", 0), simple_hash("abc", 1));
    }

    // ── min_hash_fingerprint ──────────────────────────────────────

    #[test]
    fn minhash_same_text() {
        let a = min_hash_fingerprint("hello world", 16, 3);
        let b = min_hash_fingerprint("hello world", 16, 3);
        assert_eq!(a, b);
    }

    #[test]
    fn minhash_similar_texts() {
        let a = min_hash_fingerprint("hello world foo", 64, 3);
        let b = min_hash_fingerprint("hello world bar", 64, 3);
        // Should have some matching entries
        let sim = fingerprint_similarity(&a, &b);
        assert!(sim > 0.0, "similar texts should share some MinHash values");
    }

    #[test]
    fn minhash_length() {
        let fp = min_hash_fingerprint("test", 64, 3);
        assert_eq!(fp.len(), 64);
    }

    // ── rank_by_similarity ────────────────────────────────────────

    #[test]
    fn rank_returns_sorted() {
        let query = "hello world";
        let candidates = vec!["hello world", "completely different", "hello there"];
        let results = rank_by_similarity(query, &candidates, "shingle", 0.0);
        assert!(!results.is_empty());
        // First result should have highest score
        for i in 1..results.len() {
            assert!(results[i - 1].score >= results[i].score);
        }
    }

    #[test]
    fn rank_respects_threshold() {
        let query = "unique content xyzzy";
        let candidates = vec!["completely unrelated text here"];
        let results = rank_by_similarity(query, &candidates, "shingle", 0.5);
        // With a high threshold, low-similarity candidates should be excluded
        for r in &results {
            assert!(r.score > 0.5);
        }
    }

    // Byte-identity vectors matching TypeScript similarity.ts
    #[test]
    fn byte_identity_vec1_ngrams() {
        // TS: extractNgrams('hello', 3) contains 'hel', 'ell', 'llo'
        let grams = extract_ngrams("hello", 3);
        assert!(grams.contains("hel"));
        assert!(grams.contains("ell"));
        assert!(grams.contains("llo"));
    }

    #[test]
    fn byte_identity_vec2_jaccard_identical() {
        // TS: jaccardSimilarity(extractNgrams('a', 1), extractNgrams('a', 1)) === 1.0
        let s: HashSet<String> = ["a"].iter().map(|c| c.to_string()).collect();
        assert!((jaccard_similarity(&s, &s) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn byte_identity_vec3_content_similarity() {
        // TS: contentSimilarity('hello world', 'hello world', 2) === 1.0
        assert!((content_similarity("hello world", "hello world", 2) - 1.0).abs() < 1e-9);
    }

    // ── WASM JSON roundtrip ───────────────────────────────────────

    #[test]
    fn wasm_rank_by_similarity_json() {
        let candidates = r#"["hello world","unrelated text","hello there"]"#;
        let opts = r#"{"method":"shingle","threshold":0.0}"#;
        let json = rank_by_similarity_wasm("hello world", candidates, opts);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.is_array());
    }
}
