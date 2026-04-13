//! Line-based diff computation using LCS (Longest Common Subsequence).
//!
//! Provides both summary-only ([`compute_diff`]) and structured
//! ([`structured_diff`]) diff output. The structured variant is the
//! single source of truth for diff display across frontend, backend,
//! and CLI consumers.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use crate::calculate_tokens;

// ── Summary Diff ───────────────────────────────────────────────

/// Result of computing a line-based diff between two texts.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
#[derive(Debug, Clone)]
pub struct DiffResult {
    added_lines: u32,
    removed_lines: u32,
    added_tokens: u32,
    removed_tokens: u32,
}

#[cfg_attr(feature = "wasm", wasm_bindgen)]
impl DiffResult {
    /// Number of lines added in the new text.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn added_lines(&self) -> u32 {
        self.added_lines
    }
    /// Number of lines removed from the old text.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn removed_lines(&self) -> u32 {
        self.removed_lines
    }
    /// Estimated tokens added.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn added_tokens(&self) -> u32 {
        self.added_tokens
    }
    /// Estimated tokens removed.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn removed_tokens(&self) -> u32 {
        self.removed_tokens
    }
}

/// Build the LCS DP table for two line arrays.
fn build_lcs_table(old_lines: &[&str], new_lines: &[&str]) -> Vec<Vec<u32>> {
    let n = old_lines.len();
    let m = new_lines.len();
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in 1..=n {
        for j in 1..=m {
            if old_lines[i - 1] == new_lines[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }
    dp
}

/// Compute a line-based diff between two texts.
///
/// Uses a hash-based LCS (Longest Common Subsequence) approach for
/// O(n*m) comparison where n and m are line counts. Returns counts
/// of added/removed lines and estimated token impact.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compute_diff(old_text: &str, new_text: &str) -> DiffResult {
    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();

    let n = old_lines.len();
    let m = new_lines.len();
    let dp = build_lcs_table(&old_lines, &new_lines);

    // Backtrack to find which lines were removed and which were added
    let mut removed = Vec::new();
    let mut added = Vec::new();
    let mut i = n;
    let mut j = m;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old_lines[i - 1] == new_lines[j - 1] {
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            added.push(new_lines[j - 1]);
            j -= 1;
        } else {
            removed.push(old_lines[i - 1]);
            i -= 1;
        }
    }

    let added_tokens: u32 = added.iter().map(|l| calculate_tokens(l)).sum();
    let removed_tokens: u32 = removed.iter().map(|l| calculate_tokens(l)).sum();

    DiffResult {
        added_lines: added.len() as u32,
        removed_lines: removed.len() as u32,
        added_tokens,
        removed_tokens,
    }
}

// ── Structured Diff ────────────────────────────────────────────

/// A single line in a structured diff, with type and line numbers.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StructuredDiffLine {
    /// "context", "added", or "removed".
    #[serde(rename = "type")]
    pub line_type: String,
    /// The text content of the line.
    pub content: String,
    /// Line number in the old text (null for added lines).
    #[serde(rename = "oldLine")]
    pub old_line: Option<u32>,
    /// Line number in the new text (null for removed lines).
    #[serde(rename = "newLine")]
    pub new_line: Option<u32>,
}

/// Full structured diff result with lines and summary counts.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StructuredDiffResult {
    /// Interleaved diff lines with types and line numbers.
    pub lines: Vec<StructuredDiffLine>,
    /// Number of added lines.
    #[serde(rename = "addedLineCount")]
    pub added_line_count: u32,
    /// Number of removed lines.
    #[serde(rename = "removedLineCount")]
    pub removed_line_count: u32,
    /// Estimated tokens added.
    #[serde(rename = "addedTokens")]
    pub added_tokens: u32,
    /// Estimated tokens removed.
    #[serde(rename = "removedTokens")]
    pub removed_tokens: u32,
}

/// Compute a structured line-level diff between two texts.
///
/// Returns a JSON-serialized [`StructuredDiffResult`] with interleaved
/// context, added, and removed lines including line numbers for both
/// old and new text. This is the single source of truth for diff display.
///
/// Uses the same LCS algorithm as [`compute_diff`] but produces full
/// line-by-line output instead of just counts.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn structured_diff(old_text: &str, new_text: &str) -> String {
    let result = structured_diff_native(old_text, new_text);
    serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"lines":[],"addedLineCount":0,"removedLineCount":0,"addedTokens":0,"removedTokens":0}"#
            .to_string()
    })
}

/// Native version of [`structured_diff`] returning a typed struct.
pub fn structured_diff_native(old_text: &str, new_text: &str) -> StructuredDiffResult {
    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();

    let n = old_lines.len();
    let m = new_lines.len();
    let dp = build_lcs_table(&old_lines, &new_lines);

    // Backtrack from bottom-right, collecting entries in reverse
    let mut entries: Vec<StructuredDiffLine> = Vec::new();
    let mut i = n;
    let mut j = m;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old_lines[i - 1] == new_lines[j - 1] {
            entries.push(StructuredDiffLine {
                line_type: "context".to_string(),
                content: old_lines[i - 1].to_string(),
                old_line: Some(i as u32),
                new_line: Some(j as u32),
            });
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            entries.push(StructuredDiffLine {
                line_type: "added".to_string(),
                content: new_lines[j - 1].to_string(),
                old_line: None,
                new_line: Some(j as u32),
            });
            j -= 1;
        } else {
            entries.push(StructuredDiffLine {
                line_type: "removed".to_string(),
                content: old_lines[i - 1].to_string(),
                old_line: Some(i as u32),
                new_line: None,
            });
            i -= 1;
        }
    }

    // Reverse to get forward order
    entries.reverse();

    // Compute summary counts
    let mut added_count: u32 = 0;
    let mut removed_count: u32 = 0;
    let mut added_tokens: u32 = 0;
    let mut removed_tokens: u32 = 0;

    for entry in &entries {
        match entry.line_type.as_str() {
            "added" => {
                added_count += 1;
                added_tokens += calculate_tokens(&entry.content);
            }
            "removed" => {
                removed_count += 1;
                removed_tokens += calculate_tokens(&entry.content);
            }
            _ => {}
        }
    }

    StructuredDiffResult {
        lines: entries,
        added_line_count: added_count,
        removed_line_count: removed_count,
        added_tokens,
        removed_tokens,
    }
}

// ── Multi-way Diff ─────────────────────────────────────────────

/// A single version variant at a divergent line position.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MultiDiffVariant {
    /// 0-based index into the versions array that was passed in.
    #[serde(rename = "versionIndex")]
    pub version_index: usize,
    /// The content this version has at this line position.
    pub content: String,
}

/// One line entry in a multi-way diff result.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MultiDiffLine {
    /// 1-based position in the padded line grid.
    #[serde(rename = "lineNumber")]
    pub line_number: usize,
    /// "consensus" when all versions agree, "divergent" otherwise.
    #[serde(rename = "type")]
    pub line_type: String,
    /// The most common variant's content (or the unanimous content for consensus lines).
    pub content: String,
    /// How many versions have `content` at this position.
    pub agreement: usize,
    /// Total number of versions (including the base).
    pub total: usize,
    /// All per-version contents when `line_type` is "divergent"; empty for "consensus".
    pub variants: Vec<MultiDiffVariant>,
}

/// Aggregate statistics for a multi-way diff.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MultiDiffStats {
    #[serde(rename = "totalLines")]
    pub total_lines: usize,
    #[serde(rename = "consensusLines")]
    pub consensus_lines: usize,
    #[serde(rename = "divergentLines")]
    pub divergent_lines: usize,
    #[serde(rename = "consensusPercentage")]
    pub consensus_percentage: f64,
}

/// Full result of a multi-way diff.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MultiDiffResult {
    /// Index of the base version (always 0, meaning `base` itself).
    #[serde(rename = "baseVersion")]
    pub base_version: usize,
    /// Number of versions compared (base + additional versions).
    #[serde(rename = "versionCount")]
    pub version_count: usize,
    pub lines: Vec<MultiDiffLine>,
    pub stats: MultiDiffStats,
}

/// Compute a multi-way diff across a base version and up to 4 additional versions.
///
/// `base` is the base version content (typically v1).
/// `versions_json` is a JSON array of strings (up to 4 entries) where each string
/// is the full content of an additional version.
///
/// Uses LCS-based alignment via [`structured_diff_native`] so that insertions and
/// deletions in any version do not cause downstream lines to appear divergent.
/// Each base line is an anchor row; lines inserted by versions get their own rows
/// tagged as "insertion".
///
/// Returns a [`MultiDiffResult`] or an error string.
pub fn multi_way_diff_native(base: &str, versions_json: &str) -> Result<MultiDiffResult, String> {
    let additional: Vec<String> =
        serde_json::from_str(versions_json).map_err(|e| format!("Invalid versions JSON: {e}"))?;

    if additional.len() > 4 {
        return Err(format!(
            "Too many versions: got {}, max is 4 additional (5 total)",
            additional.len()
        ));
    }

    let version_count = 1 + additional.len();
    let base_lines: Vec<&str> = base.lines().collect();

    if base_lines.is_empty() && additional.iter().all(|v| v.is_empty()) {
        return Ok(MultiDiffResult {
            base_version: 0,
            version_count,
            lines: vec![],
            stats: MultiDiffStats {
                total_lines: 0,
                consensus_lines: 0,
                divergent_lines: 0,
                consensus_percentage: 100.0,
            },
        });
    }

    let n_base = base_lines.len();
    let alignments: Vec<crate::diff_multi::VersionAlignment> = additional
        .iter()
        .map(|v| crate::diff_multi::align_version(base, v.as_str(), n_base))
        .collect();

    let grid = crate::diff_multi::build_aligned_grid(&base_lines, &alignments, version_count);
    let (lines, stats) = crate::diff_multi::score_grid(&grid, version_count);

    Ok(MultiDiffResult {
        base_version: 0,
        version_count,
        lines,
        stats,
    })
}

/// JSON-returning wrapper for [`multi_way_diff_native`].
///
/// On success returns a JSON-serialised [`MultiDiffResult`].
/// On error returns `{"error": "<message>"}`.
pub fn multi_way_diff(base: &str, versions_json: &str) -> String {
    match multi_way_diff_native(base, versions_json) {
        Ok(result) => serde_json::to_string(&result)
            .unwrap_or_else(|e| format!(r#"{{"error":"serialization failed: {e}"}}"#)),
        Err(e) => format!(r#"{{"error":{}}}"#, serde_json::json!(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_diff_identical() {
        let text = "line 1\nline 2\nline 3";
        let result = compute_diff(text, text);
        assert_eq!(result.added_lines(), 0);
        assert_eq!(result.removed_lines(), 0);
        assert_eq!(result.added_tokens(), 0);
        assert_eq!(result.removed_tokens(), 0);
    }

    #[test]
    fn test_compute_diff_empty_to_content() {
        let result = compute_diff("", "line 1\nline 2");
        assert_eq!(result.added_lines(), 2);
        assert_eq!(result.removed_lines(), 0);
    }

    #[test]
    fn test_compute_diff_content_to_empty() {
        let result = compute_diff("line 1\nline 2", "");
        assert_eq!(result.added_lines(), 0);
        assert_eq!(result.removed_lines(), 2);
    }

    #[test]
    fn test_compute_diff_mixed_changes() {
        let old = "line 1\nline 2\nline 3\nline 4";
        let new = "line 1\nmodified 2\nline 3\nline 5\nline 6";
        let result = compute_diff(old, new);
        assert_eq!(result.removed_lines(), 2);
        assert_eq!(result.added_lines(), 3);
        assert!(result.added_tokens() > 0);
        assert!(result.removed_tokens() > 0);
    }

    #[test]
    fn test_compute_diff_tokens() {
        let old = "short";
        let new = "this is a much longer replacement line";
        let result = compute_diff(old, new);
        assert_eq!(result.removed_lines(), 1);
        assert_eq!(result.added_lines(), 1);
        assert_eq!(result.removed_tokens(), calculate_tokens("short"));
        assert_eq!(
            result.added_tokens(),
            calculate_tokens("this is a much longer replacement line")
        );
    }

    #[test]
    fn test_structured_diff_identical() {
        let text = "line 1\nline 2\nline 3";
        let result = structured_diff_native(text, text);
        assert_eq!(result.lines.len(), 3);
        assert!(result.lines.iter().all(|l| l.line_type == "context"));
        assert_eq!(result.added_line_count, 0);
        assert_eq!(result.removed_line_count, 0);
        assert_eq!(result.lines[0].old_line, Some(1));
        assert_eq!(result.lines[0].new_line, Some(1));
        assert_eq!(result.lines[2].old_line, Some(3));
        assert_eq!(result.lines[2].new_line, Some(3));
    }

    #[test]
    fn test_structured_diff_additions() {
        let old = "line 1\nline 3";
        let new = "line 1\nline 2\nline 3";
        let result = structured_diff_native(old, new);
        assert_eq!(result.added_line_count, 1);
        assert_eq!(result.removed_line_count, 0);
        let types: Vec<&str> = result.lines.iter().map(|l| l.line_type.as_str()).collect();
        assert_eq!(types, vec!["context", "added", "context"]);
        let added = &result.lines[1];
        assert_eq!(added.content, "line 2");
        assert_eq!(added.old_line, None);
        assert_eq!(added.new_line, Some(2));
    }

    #[test]
    fn test_structured_diff_removals() {
        let old = "line 1\nline 2\nline 3";
        let new = "line 1\nline 3";
        let result = structured_diff_native(old, new);
        assert_eq!(result.added_line_count, 0);
        assert_eq!(result.removed_line_count, 1);
        let types: Vec<&str> = result.lines.iter().map(|l| l.line_type.as_str()).collect();
        assert_eq!(types, vec!["context", "removed", "context"]);
        let removed = &result.lines[1];
        assert_eq!(removed.content, "line 2");
        assert_eq!(removed.old_line, Some(2));
        assert_eq!(removed.new_line, None);
    }

    #[test]
    fn test_structured_diff_mixed() {
        let old = "line 1\nline 2\nline 3\nline 4";
        let new = "line 1\nmodified 2\nline 3\nline 5";
        let result = structured_diff_native(old, new);
        assert_eq!(result.added_line_count, 2);
        assert_eq!(result.removed_line_count, 2);
        assert!(result.added_tokens > 0);
        assert!(result.removed_tokens > 0);
    }

    #[test]
    fn test_structured_diff_empty_to_content() {
        let result = structured_diff_native("", "line 1\nline 2");
        assert_eq!(result.added_line_count, 2);
        assert_eq!(result.removed_line_count, 0);
        assert!(result.lines.iter().all(|l| l.line_type == "added"));
    }

    #[test]
    fn test_structured_diff_content_to_empty() {
        let result = structured_diff_native("line 1\nline 2", "");
        assert_eq!(result.added_line_count, 0);
        assert_eq!(result.removed_line_count, 2);
        assert!(result.lines.iter().all(|l| l.line_type == "removed"));
    }

    #[test]
    fn test_structured_diff_json_serialization() {
        let json = structured_diff("hello\n", "hello\nworld\n");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed["lines"].is_array());
        assert_eq!(parsed["addedLineCount"], 1);
        assert_eq!(parsed["removedLineCount"], 0);
    }

    // ── multi_way_diff tests ───────────────────────────────────────

    #[test]
    fn test_multi_way_diff_all_identical() {
        let base = "line 1\nline 2\nline 3";
        let v1 = "line 1\nline 2\nline 3";
        let v2 = "line 1\nline 2\nline 3";
        let versions_json = serde_json::to_string(&vec![v1, v2]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        assert_eq!(result.base_version, 0);
        assert_eq!(result.version_count, 3);
        assert_eq!(result.lines.len(), 3);
        assert!(result.lines.iter().all(|l| l.line_type == "consensus"));
        assert!(result.lines.iter().all(|l| l.agreement == 3));
        assert!(result.lines.iter().all(|l| l.total == 3));
        assert!(result.lines.iter().all(|l| l.variants.is_empty()));
        assert_eq!(result.stats.consensus_lines, 3);
        assert_eq!(result.stats.divergent_lines, 0);
        assert_eq!(result.stats.total_lines, 3);
        assert_eq!(result.stats.consensus_percentage, 100.0);
    }

    #[test]
    fn test_multi_way_diff_one_divergent_line() {
        // Same line count in all versions — only line 2 differs by content.
        // LCS alignment: "alpha" and "gamma" are context; "beta" vs "BETA" diverges.
        let base = "alpha\nbeta\ngamma";
        let v1 = "alpha\nBETA\ngamma";
        let v2 = "alpha\nBETA\ngamma";
        let versions_json = serde_json::to_string(&vec![v1, v2]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        assert_eq!(result.version_count, 3);
        assert_eq!(result.stats.consensus_lines, 2);
        assert_eq!(result.stats.divergent_lines, 1);

        // Line 1 (alpha) — consensus.
        let line1 = &result.lines[0];
        assert_eq!(line1.line_type, "consensus");
        assert_eq!(line1.content, "alpha");
        assert_eq!(line1.agreement, 3);

        // Line 2 (beta / BETA) — divergent; majority (2 of 3) say "BETA".
        let line2 = &result.lines[1];
        assert_eq!(line2.line_type, "divergent");
        assert_eq!(line2.content, "BETA");
        assert_eq!(line2.agreement, 2);
        assert_eq!(line2.total, 3);
        assert_eq!(line2.variants.len(), 3);
    }

    #[test]
    fn test_multi_way_diff_three_way_split() {
        // Same line count; each version has a unique line 2 — no majority.
        let base = "same\nbase_line2\nsame";
        let v1 = "same\nv1_line2\nsame";
        let v2 = "same\nv2_line2\nsame";
        let versions_json = serde_json::to_string(&vec![v1, v2]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        let line2 = &result.lines[1];
        assert_eq!(line2.line_type, "divergent");
        assert_eq!(line2.agreement, 1); // each content appears exactly once
        assert_eq!(line2.total, 3);
        assert_eq!(line2.variants.len(), 3);
    }

    #[test]
    fn test_multi_way_diff_different_lengths_lcs_aligned() {
        // v1 appends "d", v2 removes "c"; LCS keeps a,b,c anchored.
        let base = "a\nb\nc";
        let v1 = "a\nb\nc\nd";
        let v2 = "a\nb";
        let versions_json = serde_json::to_string(&vec![v1, v2]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        // 3 base-line rows + 1 insertion row = 4 total.
        assert_eq!(result.stats.total_lines, 4);
        assert_eq!(result.stats.consensus_lines, 2);
        assert_eq!(result.stats.divergent_lines, 1);

        assert_eq!(result.lines[0].line_type, "consensus");
        assert_eq!(result.lines[0].content, "a");
        assert_eq!(result.lines[1].line_type, "consensus");
        assert_eq!(result.lines[1].content, "b");

        // c: base+v1 have it, v2 removed it.
        assert_eq!(result.lines[2].line_type, "divergent");
        assert_eq!(result.lines[2].content, "c");

        // "d" inserted by v1.
        assert_eq!(result.lines[3].line_type, "insertion");
        assert_eq!(result.lines[3].content, "d");
    }

    #[test]
    fn test_multi_way_diff_empty_base_and_versions() {
        let versions_json = serde_json::to_string(&vec!["", ""]).unwrap();
        let result = multi_way_diff_native("", &versions_json).unwrap();
        assert_eq!(result.stats.total_lines, 0);
        assert!(result.lines.is_empty());
        assert_eq!(result.stats.consensus_percentage, 100.0);
    }

    #[test]
    fn test_multi_way_diff_single_version() {
        let base = "hello\nworld";
        let v1 = "hello\nearth";
        let versions_json = serde_json::to_string(&vec![v1]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        assert_eq!(result.version_count, 2);
        assert_eq!(result.stats.total_lines, 2);
        assert_eq!(result.lines[0].line_type, "consensus");
        assert_eq!(result.lines[1].line_type, "divergent");
        assert_eq!(result.lines[1].agreement, 1);
        assert_eq!(result.lines[1].variants.len(), 2);
    }

    #[test]
    fn test_multi_way_diff_rejects_too_many_versions() {
        let versions: Vec<&str> = vec!["a", "b", "c", "d", "e"]; // 5 additional = 6 total
        let versions_json = serde_json::to_string(&versions).unwrap();
        let err = multi_way_diff_native("base", &versions_json).unwrap_err();
        assert!(err.contains("Too many versions"));
    }

    #[test]
    fn test_multi_way_diff_max_versions_accepted() {
        // Exactly 4 additional versions (5 total) must be accepted.
        let versions: Vec<&str> = vec!["a\nb", "a\nc", "a\nd", "a\ne"];
        let versions_json = serde_json::to_string(&versions).unwrap();
        let result = multi_way_diff_native("a\nb", &versions_json).unwrap();
        assert_eq!(result.version_count, 5);
    }

    #[test]
    fn test_multi_way_diff_json_output_shape() {
        let base = "x\ny";
        let v1 = "x\nz";
        let versions_json = serde_json::to_string(&vec![v1]).unwrap();
        let json = multi_way_diff(base, &versions_json);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["lines"].is_array());
        assert_eq!(parsed["baseVersion"], 0);
        assert_eq!(parsed["versionCount"], 2);
        assert!(parsed["stats"]["totalLines"].is_number());
        assert!(parsed["stats"]["consensusLines"].is_number());
        assert!(parsed["stats"]["divergentLines"].is_number());
        assert!(parsed["stats"]["consensusPercentage"].is_number());
    }

    #[test]
    fn test_multi_way_diff_line_numbers_are_one_based() {
        let base = "a\nb\nc";
        let v1 = "a\nb\nc";
        let versions_json = serde_json::to_string(&vec![v1]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        for (idx, line) in result.lines.iter().enumerate() {
            assert_eq!(line.line_number, idx + 1);
        }
    }

    #[test]
    fn test_multi_way_diff_consensus_percentage_rounding() {
        // 2 consensus lines out of 3 base lines = 66.666...% → rounds to 66.7.
        let base = "a\nb\nc";
        let v1 = "a\nX\nc";
        let versions_json = serde_json::to_string(&vec![v1]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();
        assert_eq!(result.stats.consensus_percentage, 66.7);
    }

    // ── New LCS-alignment behavior tests ──────────────────────────

    #[test]
    fn test_multi_way_diff_insertion_after_first_line() {
        // V1 inserts X,Y after A: positional diff wrongly marks B..E divergent;
        // LCS-aligned diff correctly marks them consensus with X,Y as insertions.
        let base = "A\nB\nC\nD\nE";
        let v1 = "A\nX\nY\nB\nC\nD\nE";
        let versions_json = serde_json::to_string(&vec![v1]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        assert_eq!(result.stats.total_lines, 7); // 5 base + 2 insertions
        assert_eq!(result.stats.consensus_lines, 5);
        assert_eq!(result.stats.divergent_lines, 0);
        assert_eq!(result.stats.consensus_percentage, 100.0);
        assert_eq!(result.lines[0].content, "A");
        assert_eq!(result.lines[1].line_type, "insertion");
        assert_eq!(result.lines[1].content, "X");
        assert_eq!(result.lines[2].line_type, "insertion");
        assert_eq!(result.lines[2].content, "Y");
        for (i, expected) in ["B", "C", "D", "E"].iter().enumerate() {
            assert_eq!(result.lines[3 + i].line_type, "consensus");
            assert_eq!(result.lines[3 + i].content, *expected);
        }
    }

    #[test]
    fn test_multi_way_diff_deletion_aligned() {
        // V1 removes C: A,B,D,E consensus; C is divergent (base has it, v1 removed it).
        let base = "A\nB\nC\nD\nE";
        let v1 = "A\nB\nD\nE";
        let versions_json = serde_json::to_string(&vec![v1]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        assert_eq!(result.stats.total_lines, 5);
        assert_eq!(result.stats.consensus_lines, 4);
        assert_eq!(result.stats.divergent_lines, 1);
        let row_c = result
            .lines
            .iter()
            .find(|l| l.line_type == "divergent")
            .expect("expected one divergent row for C");
        assert_eq!(row_c.content, "C");
        for line in result.lines.iter().filter(|l| l.line_type != "divergent") {
            assert_eq!(line.line_type, "consensus");
        }
    }

    #[test]
    fn test_multi_way_diff_mixed_insertions_two_versions() {
        // V1 inserts X after A; V2 inserts Y after B. A,B,C must be consensus.
        let base = "A\nB\nC";
        let v1 = "A\nX\nB\nC";
        let v2 = "A\nB\nY\nC";
        let versions_json = serde_json::to_string(&vec![v1, v2]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        assert_eq!(result.stats.total_lines, 5); // 3 base + 2 insertions
        assert_eq!(result.stats.consensus_lines, 3);
        assert_eq!(result.stats.divergent_lines, 0);
        assert_eq!(result.stats.consensus_percentage, 100.0);

        let insertions: Vec<&MultiDiffLine> = result
            .lines
            .iter()
            .filter(|l| l.line_type == "insertion")
            .collect();
        assert_eq!(insertions.len(), 2);

        let insertion_contents: std::collections::HashSet<&str> =
            insertions.iter().map(|l| l.content.as_str()).collect();
        assert!(insertion_contents.contains("X"));
        assert!(insertion_contents.contains("Y"));

        for line in result.lines.iter().filter(|l| l.line_type != "insertion") {
            assert_eq!(line.line_type, "consensus");
        }
    }

    #[test]
    fn test_multi_way_diff_markdown_section_insertion() {
        // V1 adds a new section in the middle; all 7 base lines stay consensus.
        let base = "# Title\n\nFirst paragraph.\n\n# Conclusion\n\nEnd.";
        let v1 = "# Title\n\nFirst paragraph.\n\n# New Section\n\nMiddle content.\n\n# Conclusion\n\nEnd.";
        let versions_json = serde_json::to_string(&vec![v1]).unwrap();
        let result = multi_way_diff_native(base, &versions_json).unwrap();

        // Base has 7 lines; v1 inserts 4 lines between "First paragraph." and "# Conclusion":
        // "# New Section", "" (blank), "Middle content.", "" (blank).
        assert_eq!(result.stats.consensus_lines, 7);
        assert_eq!(result.stats.divergent_lines, 0);
        assert_eq!(result.stats.consensus_percentage, 100.0);
        let insertion_lines: Vec<&MultiDiffLine> = result
            .lines
            .iter()
            .filter(|l| l.line_type == "insertion")
            .collect();
        assert_eq!(insertion_lines.len(), 4);
        let contents: Vec<&str> = insertion_lines.iter().map(|l| l.content.as_str()).collect();
        assert!(contents.contains(&"# New Section"));
        assert!(contents.contains(&"Middle content."));
    }
}
