//! Semantic similarity primitives for embedding-based document comparison.
//!
//! This module operates on **pre-computed** embeddings supplied by the caller.
//! It never calls external APIs — all network I/O is the backend's responsibility.
//! Functions accept JSON strings for WASM compatibility; native callers can use
//! the struct-based helpers directly.

use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

// ── Vector math ──────────────────────────────────────────────────

/// Cosine similarity between two embedding vectors.
///
/// Returns a value in `[-1.0, 1.0]`:
/// - `1.0`  — identical direction
/// - `0.0`  — orthogonal (unrelated)
/// - `-1.0` — opposite direction
///
/// Returns `0.0` for mismatched lengths or zero-magnitude vectors.
pub fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

// ── Data types ───────────────────────────────────────────────────

/// A document section with a pre-computed embedding.
#[derive(Debug, Clone, Deserialize)]
pub struct EmbeddedSection {
    /// Section heading title.
    pub title: String,
    /// Raw text content (excluding the heading line itself).
    pub content: String,
    /// Embedding vector produced by the backend embedding provider.
    pub embedding: Vec<f64>,
}

/// How a section from version A maps to version B.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SectionAlignment {
    /// Same title found in both versions.
    Matched,
    /// Different title but high content similarity (≥ 0.85).
    Renamed,
    /// Section only exists in version B.
    Added,
    /// Section only exists in version A.
    Removed,
}

/// Per-section similarity record.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSimilarity {
    /// Section heading from version A (empty string for `Added` sections).
    pub section_a: String,
    /// Matched section heading from version B (empty string for `Removed` sections).
    pub section_b: String,
    /// Cosine similarity of the section embeddings (`0.0` to `1.0`).
    pub similarity: f64,
    /// How the section maps between versions.
    pub alignment: SectionAlignment,
}

/// A semantic change annotation for a section pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticChange {
    /// One of: `"unchanged"`, `"rephrased"`, `"modified"`, `"rewritten"`.
    pub change_type: String,
    /// Section title this change refers to.
    pub section: String,
    /// Cosine similarity score for this section pair.
    pub similarity: f64,
    /// Human-readable summary of what changed.
    pub description: String,
}

/// Full result of a semantic diff between two document versions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticDiffResult {
    /// Weighted average cosine similarity across all matched/renamed sections.
    /// Pure adds/removes contribute `0.0` to the average.
    pub overall_similarity: f64,
    /// Per-section comparison details.
    pub section_similarities: Vec<SectionSimilarity>,
    /// Change annotations for matched/renamed sections.
    pub semantic_changes: Vec<SemanticChange>,
}

/// Compute cosine similarity between two embedding vectors supplied as JSON arrays.
///
/// WASM entry point for [`cosine_similarity`].
///
/// Both arguments must be JSON arrays of numbers, e.g. `[0.1, 0.2, 0.3]`.
/// Returns a value in `[-1.0, 1.0]`, or `0.0` on parse error.
///
/// # Examples (TypeScript)
/// ```ts
/// import { cosineSimilarity } from 'llmtxt';
/// const sim = cosineSimilarity('[1.0, 0.0]', '[0.0, 1.0]'); // 0.0 — orthogonal
/// ```
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn cosine_similarity_wasm(a_json: &str, b_json: &str) -> f64 {
    let a: Vec<f64> = match serde_json::from_str(a_json) {
        Ok(v) => v,
        Err(_) => return 0.0,
    };
    let b: Vec<f64> = match serde_json::from_str(b_json) {
        Ok(v) => v,
        Err(_) => return 0.0,
    };
    cosine_similarity(&a, &b)
}

// ── Semantic diff ─────────────────────────────────────────────────

/// Classify the type of semantic change for a matched section pair.
fn classify_change(title: &str, similarity: f64) -> SemanticChange {
    let (change_type, description) = if similarity >= 0.95 {
        (
            "unchanged",
            format!("Section '{title}' is semantically identical (similarity {similarity:.2})"),
        )
    } else if similarity >= 0.85 {
        (
            "rephrased",
            format!(
                "Section '{title}' expresses the same meaning with different wording (similarity {similarity:.2})"
            ),
        )
    } else if similarity >= 0.70 {
        (
            "modified",
            format!("Section '{title}' has been partially changed (similarity {similarity:.2})"),
        )
    } else {
        (
            "rewritten",
            format!(
                "Section '{title}' has been substantially rewritten (similarity {similarity:.2})"
            ),
        )
    };
    SemanticChange {
        change_type: change_type.to_string(),
        section: title.to_string(),
        similarity,
        description,
    }
}

/// Compute a semantic diff between two sets of pre-embedded sections (native API).
///
/// For each section in `a`, finds the best-matching section in `b` by cosine
/// similarity, then classifies the alignment and change type.
pub fn semantic_diff_native(
    sections_a: &[EmbeddedSection],
    sections_b: &[EmbeddedSection],
) -> SemanticDiffResult {
    // Track which sections in B have already been matched.
    let mut matched_b: Vec<bool> = vec![false; sections_b.len()];
    let mut section_similarities: Vec<SectionSimilarity> = Vec::new();
    let mut semantic_changes: Vec<SemanticChange> = Vec::new();

    // ── Pass 1: match sections in A to the best section in B ─────
    for sec_a in sections_a {
        if sections_b.is_empty() {
            section_similarities.push(SectionSimilarity {
                section_a: sec_a.title.clone(),
                section_b: String::new(),
                similarity: 0.0,
                alignment: SectionAlignment::Removed,
            });
            continue;
        }

        // Find the most similar section in B.
        let (best_idx, best_sim) = sections_b
            .iter()
            .enumerate()
            .map(|(i, sec_b)| (i, cosine_similarity(&sec_a.embedding, &sec_b.embedding)))
            .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap_or((0, 0.0));

        // Determine alignment.
        if best_sim < 0.40 {
            // No meaningful match — treat as removed.
            section_similarities.push(SectionSimilarity {
                section_a: sec_a.title.clone(),
                section_b: String::new(),
                similarity: 0.0,
                alignment: SectionAlignment::Removed,
            });
        } else {
            let sec_b = &sections_b[best_idx];
            matched_b[best_idx] = true;

            let alignment =
                if sec_a.title.trim().to_lowercase() == sec_b.title.trim().to_lowercase() {
                    SectionAlignment::Matched
                } else if best_sim >= 0.85 {
                    SectionAlignment::Renamed
                } else {
                    SectionAlignment::Matched
                };

            section_similarities.push(SectionSimilarity {
                section_a: sec_a.title.clone(),
                section_b: sec_b.title.clone(),
                similarity: best_sim,
                alignment,
            });

            semantic_changes.push(classify_change(&sec_a.title, best_sim));
        }
    }

    // ── Pass 2: unmatched sections in B are Added ─────────────────
    for (i, sec_b) in sections_b.iter().enumerate() {
        if !matched_b[i] {
            section_similarities.push(SectionSimilarity {
                section_a: String::new(),
                section_b: sec_b.title.clone(),
                similarity: 0.0,
                alignment: SectionAlignment::Added,
            });
        }
    }

    // ── Overall similarity: mean of non-zero similarities ─────────
    let non_zero: Vec<f64> = section_similarities
        .iter()
        .filter(|s| s.similarity > 0.0)
        .map(|s| s.similarity)
        .collect();

    let overall_similarity = if non_zero.is_empty() {
        0.0
    } else {
        let sum: f64 = non_zero.iter().sum();
        sum / non_zero.len() as f64
    };

    SemanticDiffResult {
        overall_similarity,
        section_similarities,
        semantic_changes,
    }
}

/// Compute semantic diff from JSON strings (WASM / backend entry point).
///
/// `sections_a_json` and `sections_b_json` must each be a JSON array of objects
/// with the shape `{ title: string, content: string, embedding: number[] }`.
///
/// Returns a JSON-serialised [`SemanticDiffResult`], or `{"error":"..."}` on failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn semantic_diff(sections_a_json: &str, sections_b_json: &str) -> String {
    let sections_a: Vec<EmbeddedSection> = match serde_json::from_str(sections_a_json) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"Invalid sections_a JSON: {e}"}}"#),
    };
    let sections_b: Vec<EmbeddedSection> = match serde_json::from_str(sections_b_json) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"Invalid sections_b JSON: {e}"}}"#),
    };

    let result = semantic_diff_native(&sections_a, &sections_b);
    serde_json::to_string(&result)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

// ── Semantic consensus ────────────────────────────────────────────

/// A single agent review with a pre-computed embedding of its content.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddedReview {
    /// Agent/reviewer identifier.
    pub reviewer_id: String,
    /// Raw review text content.
    pub content: String,
    /// Embedding vector of the review content.
    pub embedding: Vec<f64>,
}

/// A cluster of reviewers whose embeddings are mutually similar.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCluster {
    /// Reviewer IDs that belong to this cluster.
    pub members: Vec<String>,
    /// Average pairwise cosine similarity within the cluster.
    pub avg_similarity: f64,
}

/// Result of semantic consensus evaluation across a set of reviews.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticConsensusResult {
    /// `true` when the largest cluster contains > 50% of reviewers.
    pub consensus: bool,
    /// Mean pairwise cosine similarity across all review pairs.
    pub agreement_score: f64,
    /// Agreement clusters ordered by size (largest first).
    pub clusters: Vec<ReviewCluster>,
    /// Reviewer IDs whose embeddings fall outside the majority cluster.
    pub outliers: Vec<String>,
}

/// Evaluate semantic consensus across a set of reviews (native API).
///
/// `threshold` — minimum cosine similarity for two reviews to be considered
/// in agreement (recommended: 0.80).
pub fn semantic_consensus_native(
    reviews: &[EmbeddedReview],
    threshold: f64,
) -> SemanticConsensusResult {
    if reviews.is_empty() {
        return SemanticConsensusResult {
            consensus: false,
            agreement_score: 0.0,
            clusters: vec![],
            outliers: vec![],
        };
    }

    let n = reviews.len();

    // ── Pairwise similarity matrix ────────────────────────────────
    // `sims[i][j]` = cosine_similarity(reviews[i].embedding, reviews[j].embedding)
    let mut sims = vec![vec![0.0f64; n]; n];
    for (i, review_i) in reviews.iter().enumerate() {
        sims[i][i] = 1.0;
        for j in (i + 1)..n {
            let s = cosine_similarity(&review_i.embedding, &reviews[j].embedding);
            sims[i][j] = s;
            sims[j][i] = s;
        }
    }

    // ── Overall agreement score: mean of off-diagonal upper triangle ─
    let pair_count = n * (n - 1) / 2;
    let agreement_score = if pair_count == 0 {
        1.0 // single reviewer — trivially unanimous
    } else {
        // Sum all upper-triangle pairs without range-index loops (Clippy-clean).
        let total: f64 = sims
            .iter()
            .enumerate()
            .flat_map(|(i, row)| row.iter().enumerate().skip(i + 1).map(|(_, &v)| v))
            .sum();
        total / pair_count as f64
    };

    // ── Greedy clustering: assign each reviewer to the first cluster
    // whose centroid (represented by the founding member) is similar
    // enough, otherwise start a new cluster. ─────────────────────────
    let mut clusters: Vec<Vec<usize>> = Vec::new(); // indices into `reviews`

    'outer: for (i, _) in reviews.iter().enumerate() {
        for cluster in &mut clusters {
            // Check similarity against all current cluster members (complete-linkage).
            if cluster.iter().all(|&j| sims[i][j] >= threshold) {
                cluster.push(i);
                continue 'outer;
            }
        }
        clusters.push(vec![i]);
    }

    // Sort clusters by size (largest first).
    clusters.sort_by_key(|c| std::cmp::Reverse(c.len()));

    // Build result clusters with named members.
    let result_clusters: Vec<ReviewCluster> = clusters
        .iter()
        .map(|members| {
            let ids: Vec<String> = members
                .iter()
                .map(|&i| reviews[i].reviewer_id.clone())
                .collect();
            let avg_sim = if members.len() == 1 {
                1.0
            } else {
                let mut total = 0.0;
                let mut count = 0;
                for a in 0..members.len() {
                    for b in (a + 1)..members.len() {
                        total += sims[members[a]][members[b]];
                        count += 1;
                    }
                }
                if count > 0 { total / count as f64 } else { 1.0 }
            };
            ReviewCluster {
                members: ids,
                avg_similarity: avg_sim,
            }
        })
        .collect();

    // ── Consensus: majority cluster covers > 50% of reviewers ─────
    let majority_size = result_clusters
        .first()
        .map(|c| c.members.len())
        .unwrap_or(0);
    let consensus = majority_size * 2 > n; // strict majority

    // Outliers: everyone not in the majority cluster.
    let majority_members: std::collections::HashSet<&str> = result_clusters
        .first()
        .map(|c| c.members.iter().map(String::as_str).collect())
        .unwrap_or_default();

    let outliers: Vec<String> = reviews
        .iter()
        .filter(|r| !majority_members.contains(r.reviewer_id.as_str()))
        .map(|r| r.reviewer_id.clone())
        .collect();

    SemanticConsensusResult {
        consensus,
        agreement_score,
        clusters: result_clusters,
        outliers,
    }
}

/// Evaluate semantic consensus from a JSON array of reviews (WASM / backend entry point).
///
/// `reviews_json` must be a JSON array of objects with the shape
/// `{ reviewerId: string, content: string, embedding: number[] }`.
///
/// Returns a JSON-serialised [`SemanticConsensusResult`], or `{"error":"..."}` on failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn semantic_consensus(reviews_json: &str, threshold: f64) -> String {
    let reviews: Vec<EmbeddedReview> = match serde_json::from_str(reviews_json) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"Invalid reviews JSON: {e}"}}"#),
    };

    let result = semantic_consensus_native(&reviews, threshold);
    serde_json::to_string(&result)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::EPSILON;

    // ── cosine_similarity ─────────────────────────────────────────

    #[test]
    fn cosine_identical_vectors() {
        let v = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&v, &v);
        assert!(
            (sim - 1.0).abs() < EPSILON,
            "identical vectors → 1.0, got {sim}"
        );
    }

    #[test]
    fn cosine_orthogonal_vectors() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < EPSILON, "orthogonal vectors → 0.0, got {sim}");
    }

    #[test]
    fn cosine_opposite_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![-1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(
            (sim - (-1.0)).abs() < EPSILON,
            "opposite vectors → -1.0, got {sim}"
        );
    }

    #[test]
    fn cosine_different_lengths_returns_zero() {
        let a = vec![1.0, 2.0];
        let b = vec![1.0, 2.0, 3.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0, "mismatched lengths → 0.0");
    }

    #[test]
    fn cosine_zero_vector_returns_zero() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![1.0, 2.0, 3.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0, "zero vector → 0.0");
    }

    #[test]
    fn cosine_empty_vectors_returns_zero() {
        assert_eq!(cosine_similarity(&[], &[]), 0.0, "empty vectors → 0.0");
    }

    // ── semantic_diff ─────────────────────────────────────────────

    fn make_section(title: &str, vec: Vec<f64>) -> EmbeddedSection {
        EmbeddedSection {
            title: title.to_string(),
            content: title.to_string(),
            embedding: vec,
        }
    }

    #[test]
    fn semantic_diff_identical_sections() {
        let sections = vec![make_section("Intro", vec![1.0, 0.0, 0.0])];
        let result = semantic_diff_native(&sections, &sections);
        assert!(
            (result.overall_similarity - 1.0).abs() < 1e-9,
            "identical sections → overall_similarity ≈ 1.0, got {}",
            result.overall_similarity
        );
        assert_eq!(result.section_similarities.len(), 1);
        assert_eq!(result.semantic_changes.len(), 1);
        assert_eq!(result.semantic_changes[0].change_type, "unchanged");
    }

    #[test]
    fn semantic_diff_detects_added_section() {
        let sections_a = vec![make_section("Overview", vec![1.0, 0.0])];
        let sections_b = vec![
            make_section("Overview", vec![1.0, 0.0]),
            make_section("NewSection", vec![0.0, 1.0]),
        ];
        let result = semantic_diff_native(&sections_a, &sections_b);
        let added = result
            .section_similarities
            .iter()
            .find(|s| matches!(s.alignment, SectionAlignment::Added));
        assert!(added.is_some(), "should detect Added section");
        assert_eq!(added.unwrap().section_b, "NewSection");
    }

    #[test]
    fn semantic_diff_detects_removed_section() {
        let sections_a = vec![
            make_section("Overview", vec![1.0, 0.0]),
            make_section("OldSection", vec![0.0, 1.0]),
        ];
        let sections_b = vec![make_section("Overview", vec![1.0, 0.0])];
        let result = semantic_diff_native(&sections_a, &sections_b);
        let removed = result
            .section_similarities
            .iter()
            .find(|s| matches!(s.alignment, SectionAlignment::Removed));
        assert!(removed.is_some(), "should detect Removed section");
        assert_eq!(removed.unwrap().section_a, "OldSection");
    }

    #[test]
    fn semantic_diff_detects_renamed_section() {
        // High similarity embedding, different title.
        let sections_a = vec![make_section("Old Title", vec![0.9, 0.1])];
        let sections_b = vec![make_section("New Title", vec![0.91, 0.09])];
        let result = semantic_diff_native(&sections_a, &sections_b);
        let renamed = result
            .section_similarities
            .iter()
            .find(|s| matches!(s.alignment, SectionAlignment::Renamed));
        assert!(renamed.is_some(), "should detect Renamed section");
    }

    #[test]
    fn semantic_diff_json_roundtrip() {
        let sections_a = r#"[{"title":"A","content":"A text","embedding":[1.0,0.0]}]"#;
        let sections_b = r#"[{"title":"A","content":"A text","embedding":[1.0,0.0]}]"#;
        let out = semantic_diff(sections_a, sections_b);
        let parsed: serde_json::Value = serde_json::from_str(&out).expect("valid JSON");
        assert!(parsed.get("error").is_none(), "should not have error field");
        assert!(parsed.get("overallSimilarity").is_some());
    }

    // ── semantic_consensus ────────────────────────────────────────

    fn make_review(id: &str, vec: Vec<f64>) -> EmbeddedReview {
        EmbeddedReview {
            reviewer_id: id.to_string(),
            content: id.to_string(),
            embedding: vec,
        }
    }

    #[test]
    fn consensus_unanimous_single_cluster() {
        let reviews = vec![
            make_review("a", vec![1.0, 0.0]),
            make_review("b", vec![0.98, 0.02]),
            make_review("c", vec![0.99, 0.01]),
        ];
        let result = semantic_consensus_native(&reviews, 0.80);
        assert!(result.consensus, "3 similar reviews should reach consensus");
        assert!(result.outliers.is_empty(), "no outliers expected");
        assert_eq!(result.clusters.len(), 1, "should form one cluster");
    }

    #[test]
    fn consensus_divergent_outlier() {
        // Two reviewers agree; one is completely orthogonal.
        let reviews = vec![
            make_review("a", vec![1.0, 0.0]),
            make_review("b", vec![0.99, 0.01]),
            make_review("c", vec![0.0, 1.0]), // orthogonal outlier
        ];
        let result = semantic_consensus_native(&reviews, 0.80);
        // Majority cluster has 2/3 > 50% → consensus
        assert!(result.consensus, "2/3 agreement should reach consensus");
        assert!(
            result.outliers.contains(&"c".to_string()),
            "'c' should be an outlier"
        );
    }

    #[test]
    fn consensus_no_consensus_split() {
        // Two groups of 1 each — no majority (single reviewers).
        let reviews = vec![
            make_review("a", vec![1.0, 0.0]),
            make_review("b", vec![0.0, 1.0]),
        ];
        let result = semantic_consensus_native(&reviews, 0.80);
        // 1/2 is NOT > 50% strict majority.
        assert!(!result.consensus, "50/50 split should not reach consensus");
    }

    #[test]
    fn consensus_empty_reviews() {
        let result = semantic_consensus_native(&[], 0.80);
        assert!(!result.consensus);
        assert_eq!(result.agreement_score, 0.0);
        assert!(result.clusters.is_empty());
        assert!(result.outliers.is_empty());
    }

    #[test]
    fn consensus_json_roundtrip() {
        let reviews_json = r#"[
            {"reviewerId":"a","content":"test","embedding":[1.0,0.0]},
            {"reviewerId":"b","content":"test","embedding":[0.99,0.01]}
        ]"#;
        let out = semantic_consensus(reviews_json, 0.80);
        let parsed: serde_json::Value = serde_json::from_str(&out).expect("valid JSON");
        assert!(parsed.get("error").is_none(), "should not have error field");
        assert!(parsed.get("consensus").is_some());
    }
}
