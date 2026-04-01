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
}
