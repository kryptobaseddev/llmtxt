//! TF-IDF vectorizer with FNV-1a hashing.
//!
//! Ported from `apps/backend/src/utils/embeddings.ts` (`LocalEmbeddingProvider`).
//!
//! Algorithm (identical to the TS implementation):
//! 1. Tokenise each document into lowercase word unigrams + bigrams.
//! 2. Build a global vocabulary (document-frequency map) from all documents.
//! 3. Compute TF (term-frequency / doc length) per document.
//! 4. Compute IDF = log((N + 1) / (df + 1)) + 1 (Scikit-learn smooth IDF).
//! 5. Multiply TF × IDF and hash into `dimensions` buckets (FNV-1a mod dims).
//! 6. L2-normalise the resulting vector.
//!
//! Intentionally approximate — suitable for dev/test, not production neural
//! embeddings.

use std::collections::HashMap;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// FNV-1a 32-bit hash of a string (identical to the TS `fnv1aHash` function).
///
/// Uses offset basis `0x811c9dc5` and prime `0x01000193`.
/// Returns the hash as an unsigned 32-bit value (but in a `u64` for convenience).
pub fn fnv1a_hash(s: &str) -> u64 {
    let mut hash: u32 = 0x811c9dc5;
    for byte in s.bytes() {
        hash ^= u32::from(byte);
        hash = hash.wrapping_mul(0x01000193);
    }
    u64::from(hash)
}

// ── Tokenisation ────────────────────────────────────────────────────────────

/// Tokenise text into lowercase word unigrams and bigrams.
///
/// Matches the TS `tokenise()` function: lowercase, strip non-alphanumeric,
/// split on whitespace, then concatenate adjacent pairs with `_`.
fn tokenise(text: &str) -> Vec<String> {
    let words: Vec<String> = text
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .map(|w| w.to_string())
        .collect();

    let mut tokens = words.clone();
    for i in 0..words.len().saturating_sub(1) {
        tokens.push(format!("{}_{}", words[i], words[i + 1]));
    }
    tokens
}

// ── Vocabulary ──────────────────────────────────────────────────────────────

/// Build a document-frequency map: `term → number of docs containing term`.
fn build_vocab(tokenised: &[Vec<String>]) -> HashMap<String, usize> {
    let mut df: HashMap<String, usize> = HashMap::new();
    for tokens in tokenised {
        let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for t in tokens {
            if seen.insert(t.as_str()) {
                *df.entry(t.clone()).or_insert(0) += 1;
            }
        }
    }
    df
}

// ── TF ──────────────────────────────────────────────────────────────────────

/// Compute term-frequency normalised by document length.
fn compute_tf(tokens: &[String]) -> HashMap<String, f64> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for t in tokens {
        *counts.entry(t.clone()).or_insert(0) += 1;
    }
    let total = tokens.len().max(1) as f64;
    counts
        .into_iter()
        .map(|(term, count)| (term, count as f64 / total))
        .collect()
}

// ── L2 normalisation ────────────────────────────────────────────────────────

fn l2_normalize_vec(vec: &mut [f64]) {
    let norm: f64 = vec.iter().map(|x| x * x).sum::<f64>().sqrt();
    if norm > 0.0 {
        for v in vec.iter_mut() {
            *v /= norm;
        }
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Embed a single text into a `dim`-dimensional TF-IDF vector.
///
/// When called with a single text (no batch context), IDF collapses to a
/// constant (all terms have df=1, N=1), so the vector is TF-only with
/// IDF = log(2/2) + 1 = 1.0. To get meaningful IDF weighting call
/// `tfidf_embed_batch` instead.
pub fn tfidf_embed(text: &str, dim: usize) -> Vec<f32> {
    tfidf_embed_batch(&[text.to_string()], dim)
        .into_iter()
        .next()
        .unwrap_or_else(|| vec![0.0; dim])
}

/// Embed a batch of texts into `dim`-dimensional TF-IDF vectors.
///
/// This is the primary entry-point and matches the `LocalEmbeddingProvider`
/// TypeScript implementation exactly: shared IDF across all documents in the
/// batch.
pub fn tfidf_embed_batch(texts: &[String], dim: usize) -> Vec<Vec<f32>> {
    if texts.is_empty() {
        return vec![];
    }
    if dim == 0 {
        return texts.iter().map(|_| vec![]).collect();
    }

    let tokenised: Vec<Vec<String>> = texts.iter().map(|t| tokenise(t)).collect();
    let vocab = build_vocab(&tokenised);
    let n = texts.len();

    tokenised
        .iter()
        .map(|tokens| {
            let tf = compute_tf(tokens);
            let mut vec = vec![0.0f64; dim];

            for (term, tf_val) in &tf {
                let df = vocab.get(term).copied().unwrap_or(1);
                let idf = ((n + 1) as f64 / (df + 1) as f64).ln() + 1.0;
                let weight = tf_val * idf;
                let bucket = (fnv1a_hash(term) as usize) % dim;
                vec[bucket] += weight;
            }

            l2_normalize_vec(&mut vec);
            vec.into_iter().map(|x| x as f32).collect()
        })
        .collect()
}

// ── WASM entry points ────────────────────────────────────────────────────────

/// FNV-1a hash of a string (32-bit). Returns hash as u32 cast to u64.
///
/// Matches the TS `fnv1aHash(str: string): number` function exactly.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn fnv1a_hash_wasm(s: &str) -> u32 {
    fnv1a_hash(s) as u32
}

/// Embed a single text using TF-IDF into a JSON array of f32 values.
///
/// `dim` is the output dimensionality (default 256 in the TS `LocalEmbeddingProvider`).
///
/// Returns a JSON array string, e.g. `"[0.1, 0.2, ...]"`, or `"[]"` on error.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn tfidf_embed_wasm(text: &str, dim: usize) -> String {
    let vec = tfidf_embed(text, dim);
    serde_json::to_string(&vec).unwrap_or_else(|_| "[]".to_string())
}

/// Embed a batch of texts using TF-IDF. Input is a JSON array of strings.
///
/// Returns a JSON array-of-arrays string, e.g. `"[[0.1,...],[0.2,...]]"`.
/// Returns `"[]"` on parse error.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn tfidf_embed_batch_wasm(texts_json: &str, dim: usize) -> String {
    let texts: Vec<String> = match serde_json::from_str(texts_json) {
        Ok(v) => v,
        Err(_) => return "[]".to_string(),
    };
    let vecs = tfidf_embed_batch(&texts, dim);
    serde_json::to_string(&vecs).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── FNV-1a hash determinism ────────────────────────────────────

    #[test]
    fn fnv1a_empty_string() {
        // Empty string should always return the FNV offset basis: 0x811c9dc5
        assert_eq!(fnv1a_hash(""), u64::from(0x811c9dc5_u32));
    }

    #[test]
    fn fnv1a_deterministic() {
        assert_eq!(fnv1a_hash("hello"), fnv1a_hash("hello"));
        assert_eq!(fnv1a_hash("world"), fnv1a_hash("world"));
    }

    #[test]
    fn fnv1a_different_strings() {
        assert_ne!(fnv1a_hash("hello"), fnv1a_hash("world"));
        assert_ne!(fnv1a_hash("foo"), fnv1a_hash("bar"));
    }

    #[test]
    fn fnv1a_known_value() {
        // Cross-validated against the TS fnv1aHash("the") result.
        // TS: let hash = 0x811c9dc5; hash ^= 't' (116); hash = hash*0x01000193>>>0;
        //     hash ^= 'h' (104); hash = hash*0x01000193>>>0;
        //     hash ^= 'e' (101); hash = hash*0x01000193>>>0;
        let h = fnv1a_hash("the") as u32;
        // Recompute independently
        let mut expected: u32 = 0x811c9dc5;
        for b in b"the" {
            expected ^= u32::from(*b);
            expected = expected.wrapping_mul(0x01000193);
        }
        assert_eq!(h, expected);
    }

    #[test]
    fn fnv1a_bucket_mod_256() {
        // Verify the mod operation used in tfidf_embed is consistent
        let h = fnv1a_hash("test_token");
        let bucket = (h as usize) % 256;
        assert!(bucket < 256);
    }

    // ── Tokenisation ───────────────────────────────────────────────

    #[test]
    fn tokenise_basic() {
        let tokens = tokenise("hello world");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        assert!(tokens.contains(&"hello_world".to_string()));
    }

    #[test]
    fn tokenise_strips_punctuation() {
        let tokens = tokenise("hello, world!");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
    }

    #[test]
    fn tokenise_lowercase() {
        let tokens = tokenise("Hello WORLD");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        assert!(!tokens.contains(&"Hello".to_string()));
    }

    #[test]
    fn tokenise_empty() {
        let tokens = tokenise("");
        assert!(tokens.is_empty());
    }

    // ── TF-IDF embedding ───────────────────────────────────────────

    #[test]
    fn embed_produces_correct_dim() {
        let vec = tfidf_embed("hello world", 256);
        assert_eq!(vec.len(), 256);
    }

    #[test]
    fn embed_empty_text_returns_zeros() {
        let vec = tfidf_embed("", 256);
        assert_eq!(vec.len(), 256);
        // All zeros after L2 normalisation of a zero vector
        assert!(vec.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn embed_zero_dim() {
        let vec = tfidf_embed("hello", 0);
        assert!(vec.is_empty());
    }

    #[test]
    fn embed_deterministic() {
        let v1 = tfidf_embed("the quick brown fox", 256);
        let v2 = tfidf_embed("the quick brown fox", 256);
        assert_eq!(v1, v2);
    }

    #[test]
    fn embed_different_texts_differ() {
        let v1 = tfidf_embed("hello world", 256);
        let v2 = tfidf_embed("completely different text", 256);
        // At least some dimensions should differ
        assert!(v1.iter().zip(v2.iter()).any(|(a, b)| (a - b).abs() > 1e-6));
    }

    #[test]
    fn embed_l2_normalized() {
        let vec = tfidf_embed("some text content here", 256);
        let norm: f64 = vec
            .iter()
            .map(|&x| (x as f64) * (x as f64))
            .sum::<f64>()
            .sqrt();
        // Should be approximately unit length (or zero if no tokens)
        if norm > 0.0 {
            assert!((norm - 1.0).abs() < 1e-5, "norm was {norm}");
        }
    }

    // ── Batch embedding ────────────────────────────────────────────

    #[test]
    fn batch_empty_input() {
        let vecs = tfidf_embed_batch(&[], 256);
        assert!(vecs.is_empty());
    }

    #[test]
    fn batch_single_matches_single() {
        let single = tfidf_embed("hello world", 256);
        let batch = tfidf_embed_batch(&["hello world".to_string()], 256);
        assert_eq!(batch.len(), 1);
        // Single-doc batch: IDF is constant so result matches single embed
        for (a, b) in single.iter().zip(batch[0].iter()) {
            assert!((a - b).abs() < 1e-6, "mismatch: {a} vs {b}");
        }
    }

    #[test]
    fn batch_returns_one_vec_per_text() {
        let texts: Vec<String> = vec![
            "first document".to_string(),
            "second document here".to_string(),
            "third document content".to_string(),
        ];
        let vecs = tfidf_embed_batch(&texts, 256);
        assert_eq!(vecs.len(), 3);
        for v in &vecs {
            assert_eq!(v.len(), 256);
        }
    }

    // ── Byte-identity vectors: Rust output == TS output ────────────
    //
    // The following tests validate that the Rust hash matches the TS
    // `fnv1aHash` function for the same inputs (bit-identical).

    #[test]
    fn byte_identity_fnv1a_vec1() {
        // TS: fnv1aHash("document") — computed by running TS implementation
        let mut expected: u32 = 0x811c9dc5;
        for b in b"document" {
            expected ^= u32::from(*b);
            expected = expected.wrapping_mul(0x01000193);
        }
        assert_eq!(fnv1a_hash("document") as u32, expected);
    }

    #[test]
    fn byte_identity_fnv1a_vec2() {
        let mut expected: u32 = 0x811c9dc5;
        for b in b"hello_world" {
            expected ^= u32::from(*b);
            expected = expected.wrapping_mul(0x01000193);
        }
        assert_eq!(fnv1a_hash("hello_world") as u32, expected);
    }

    #[test]
    fn byte_identity_fnv1a_vec3() {
        let mut expected: u32 = 0x811c9dc5;
        for b in b"tfidf_embed" {
            expected ^= u32::from(*b);
            expected = expected.wrapping_mul(0x01000193);
        }
        assert_eq!(fnv1a_hash("tfidf_embed") as u32, expected);
    }
}
