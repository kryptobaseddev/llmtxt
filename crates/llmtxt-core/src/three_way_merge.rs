//! 3-way merge algorithm for conflict-aware document merging.
//!
//! Given a common ancestor (`base`) and two diverged versions (`ours` and
//! `theirs`), produces a merged document.  Regions modified by only one side
//! are auto-merged.  Regions modified by both sides simultaneously produce a
//! [`Conflict`] with standard `<<<<<<<` / `=======` / `>>>>>>>` markers in
//! the merged output.

use crate::diff::structured_diff_native;

// ── Output types ──────────────────────────────────────────────────────────────

/// Statistics describing the outcome of a 3-way merge.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeStats {
    /// Total lines in the merged output (including conflict markers).
    pub total_lines: usize,
    /// Number of lines accepted without conflict.
    pub auto_merged_lines: usize,
    /// Number of distinct conflict regions.
    pub conflict_count: usize,
}

/// A single conflicting region where both `ours` and `theirs` diverge from `base`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    /// 1-based start line of the conflicting region in `ours`.
    pub ours_start: usize,
    /// 1-based end line of the conflicting region in `ours` (inclusive).
    pub ours_end: usize,
    /// 1-based start line of the conflicting region in `theirs`.
    pub theirs_start: usize,
    /// 1-based end line of the conflicting region in `theirs` (inclusive).
    pub theirs_end: usize,
    /// 1-based start line of the conflicting region in `base`.
    pub base_start: usize,
    /// 1-based end line of the conflicting region in `base` (inclusive).
    pub base_end: usize,
    /// The text from `ours` in this conflicting region.
    pub ours_content: String,
    /// The text from `theirs` in this conflicting region.
    pub theirs_content: String,
    /// The original text from `base` in this conflicting region.
    pub base_content: String,
}

/// Result of a 3-way merge operation.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreeWayMergeResult {
    /// The merged document content.
    ///
    /// When `has_conflicts` is `true`, conflict regions are delimited with
    /// standard markers:
    /// ```text
    /// <<<<<<< ours
    /// …our lines…
    /// =======
    /// …their lines…
    /// >>>>>>> theirs
    /// ```
    pub merged: String,
    /// `true` when at least one conflict was detected and could not be
    /// auto-merged.
    pub has_conflicts: bool,
    /// Details of each conflict region.
    pub conflicts: Vec<Conflict>,
    /// Summary statistics for the merge.
    pub stats: MergeStats,
}

// ── Internal change classification ───────────────────────────────────────────

/// The type of edit a diff operation represents relative to `base`.
#[derive(Debug, Clone, PartialEq)]
enum Edit {
    /// This line is unchanged from `base`.
    Keep,
    /// This line was removed (appears in `base` but not in the side).
    Delete,
}

/// Side edit data: per-base-line edit classification plus inserted lines.
struct SideEdits {
    /// For each base line index (0-based): Keep or Delete.
    line_edit: Vec<Edit>,
    /// Lines inserted immediately *before* `base_lines[i]`, keyed by base index.
    inserts_before: Vec<Vec<String>>,
    /// Lines inserted after all base lines.
    inserts_after: Vec<String>,
}

/// Classify each base line — and record any insertions — for one side of the diff.
///
/// `inserts_before[i]` contains lines inserted immediately before `base_lines[i]`.
/// `inserts_after` contains lines appended after all base lines.
/// `line_edit[i]` is `Keep` when base line `i` survived or `Delete` when it was removed.
fn compute_side_edits(base_lines: &[&str], side_lines: &[&str]) -> SideEdits {
    let n = base_lines.len();
    let diff = structured_diff_native(&base_lines.join("\n"), &side_lines.join("\n"));

    let mut line_edit: Vec<Edit> = vec![Edit::Keep; n];
    let mut inserts_before: Vec<Vec<String>> = vec![Vec::new(); n];
    let mut inserts_after: Vec<String> = Vec::new();

    // Walk the structured diff in forward order.  base_idx tracks which base
    // line we are currently positioned *before* (0-based, i.e. the next base
    // line that has not yet been consumed).
    let mut base_idx: usize = 0;

    for entry in &diff.lines {
        match entry.line_type.as_str() {
            "context" => {
                if let Some(old_line) = entry.old_line {
                    base_idx = old_line as usize; // advance past this base line (1-based → 0-based next)
                }
            }
            "removed" => {
                if let Some(old_line) = entry.old_line {
                    let idx = (old_line as usize) - 1;
                    line_edit[idx] = Edit::Delete;
                    base_idx = idx + 1;
                }
            }
            "added" => {
                if base_idx < n {
                    inserts_before[base_idx].push(entry.content.clone());
                } else {
                    inserts_after.push(entry.content.clone());
                }
            }
            _ => {}
        }
    }

    SideEdits {
        line_edit,
        inserts_before,
        inserts_after,
    }
}

// ── 3-way merge walk ──────────────────────────────────────────────────────────

/// Perform a 3-way merge of `base`, `ours`, and `theirs`.
///
/// Returns a [`ThreeWayMergeResult`] with the merged content and conflict metadata.
pub fn three_way_merge_native(base: &str, ours: &str, theirs: &str) -> ThreeWayMergeResult {
    let base_lines: Vec<&str> = base.lines().collect();
    let ours_lines: Vec<&str> = ours.lines().collect();
    let theirs_lines: Vec<&str> = theirs.lines().collect();

    let n = base_lines.len();

    // Fast path: identical inputs.
    if ours == theirs {
        let total = ours_lines.len();
        return ThreeWayMergeResult {
            merged: ours.to_string(),
            has_conflicts: false,
            conflicts: vec![],
            stats: MergeStats {
                total_lines: total,
                auto_merged_lines: total,
                conflict_count: 0,
            },
        };
    }

    let our_edits = compute_side_edits(&base_lines, &ours_lines);
    let their_edits = compute_side_edits(&base_lines, &theirs_lines);

    let mut merged_lines: Vec<String> = Vec::new();
    let mut conflicts: Vec<Conflict> = Vec::new();
    let mut auto_merged_lines: usize = 0;

    // ours_line / theirs_line are 1-based running line numbers in the respective sides.
    let mut ours_line: usize = 1;
    let mut theirs_line: usize = 1;

    // For each base line i, handle insertions then the base line itself.
    #[allow(clippy::needless_range_loop)]
    for i in 0..n {
        // ── Insertions before base line i ──────────────────────────────────
        let our_ins = &our_edits.inserts_before[i];
        let their_ins = &their_edits.inserts_before[i];

        let ins_conflict = !our_ins.is_empty() && !their_ins.is_empty() && our_ins != their_ins;
        let only_ours_inserts = !our_ins.is_empty() && their_ins.is_empty();
        let only_theirs_inserts = our_ins.is_empty() && !their_ins.is_empty();
        let both_agree_inserts =
            !our_ins.is_empty() && !their_ins.is_empty() && our_ins == their_ins;

        if ins_conflict {
            let ours_start = ours_line;
            let ours_end = ours_line + our_ins.len().saturating_sub(1);
            let theirs_start = theirs_line;
            let theirs_end = theirs_line + their_ins.len().saturating_sub(1);

            emit_conflict_markers(&mut merged_lines, our_ins, their_ins);

            conflicts.push(Conflict {
                ours_start,
                ours_end,
                theirs_start,
                theirs_end,
                base_start: i + 1,
                base_end: i + 1,
                ours_content: our_ins.join("\n"),
                theirs_content: their_ins.join("\n"),
                base_content: String::new(),
            });

            ours_line += our_ins.len();
            theirs_line += their_ins.len();
        } else if both_agree_inserts {
            for line in our_ins {
                merged_lines.push(line.clone());
            }
            auto_merged_lines += our_ins.len();
            ours_line += our_ins.len();
            theirs_line += their_ins.len();
        } else if only_ours_inserts {
            for line in our_ins {
                merged_lines.push(line.clone());
            }
            auto_merged_lines += our_ins.len();
            ours_line += our_ins.len();
        } else if only_theirs_inserts {
            for line in their_ins {
                merged_lines.push(line.clone());
            }
            auto_merged_lines += their_ins.len();
            theirs_line += their_ins.len();
        }

        // ── The base line itself ────────────────────────────────────────────
        let our_edit = &our_edits.line_edit[i];
        let their_edit = &their_edits.line_edit[i];

        match (our_edit, their_edit) {
            // Both kept — emit base line unchanged.
            (Edit::Keep, Edit::Keep) => {
                merged_lines.push(base_lines[i].to_string());
                auto_merged_lines += 1;
                ours_line += 1;
                theirs_line += 1;
            }

            // Both deleted — silently omit.
            (Edit::Delete, Edit::Delete) => {
                // Base line removed by both sides — skip it.
                // Neither ours_line nor theirs_line advances (line is gone from both).
            }

            // Only ours deleted — accept the deletion (one-sided change wins).
            (Edit::Delete, Edit::Keep) => {
                theirs_line += 1;
            }

            // Only theirs deleted — accept the deletion.
            (Edit::Keep, Edit::Delete) => {
                ours_line += 1;
            }
        }
    }

    // ── Insertions after all base lines ────────────────────────────────────
    let our_tail = &our_edits.inserts_after;
    let their_tail = &their_edits.inserts_after;

    let tail_conflict = !our_tail.is_empty() && !their_tail.is_empty() && our_tail != their_tail;

    if tail_conflict {
        let ours_start = ours_line;
        let ours_end = ours_line + our_tail.len().saturating_sub(1);
        let theirs_start = theirs_line;
        let theirs_end = theirs_line + their_tail.len().saturating_sub(1);

        emit_conflict_markers(&mut merged_lines, our_tail, their_tail);

        conflicts.push(Conflict {
            ours_start,
            ours_end,
            theirs_start,
            theirs_end,
            base_start: n + 1,
            base_end: n + 1,
            ours_content: our_tail.join("\n"),
            theirs_content: their_tail.join("\n"),
            base_content: String::new(),
        });
    } else if !our_tail.is_empty() && their_tail.is_empty() {
        for line in our_tail {
            merged_lines.push(line.clone());
        }
        auto_merged_lines += our_tail.len();
    } else if our_tail.is_empty() && !their_tail.is_empty() {
        for line in their_tail {
            merged_lines.push(line.clone());
        }
        auto_merged_lines += their_tail.len();
    } else if !our_tail.is_empty() {
        // Both non-empty and equal — emit once.
        for line in our_tail {
            merged_lines.push(line.clone());
        }
        auto_merged_lines += our_tail.len();
    }

    let total_lines = merged_lines.len();
    let conflict_count = conflicts.len();
    let has_conflicts = conflict_count > 0;

    ThreeWayMergeResult {
        merged: merged_lines.join("\n"),
        has_conflicts,
        conflicts,
        stats: MergeStats {
            total_lines,
            auto_merged_lines,
            conflict_count,
        },
    }
}

/// Append standard conflict marker block to `out`.
fn emit_conflict_markers(out: &mut Vec<String>, ours: &[String], theirs: &[String]) {
    out.push("<<<<<<< ours".to_string());
    for line in ours {
        out.push(line.clone());
    }
    out.push("=======".to_string());
    for line in theirs {
        out.push(line.clone());
    }
    out.push(">>>>>>> theirs".to_string());
}

// ── Public WASM-friendly entry points ────────────────────────────────────────

/// JSON-serializing wrapper around [`three_way_merge_native`].
///
/// Returns a JSON-serialized [`ThreeWayMergeResult`] on success, or a
/// JSON error object on serialization failure.
pub fn three_way_merge(base: &str, ours: &str, theirs: &str) -> String {
    let result = three_way_merge_native(base, ours, theirs);
    serde_json::to_string(&result)
        .unwrap_or_else(|e| format!(r#"{{"error":"three_way_merge serialization failed: {e}"}}"#))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn merge(base: &str, ours: &str, theirs: &str) -> ThreeWayMergeResult {
        three_way_merge_native(base, ours, theirs)
    }

    fn lines(s: &str) -> Vec<&str> {
        s.lines().collect()
    }

    // ── clean merge: no conflicts ─────────────────────────────────────────────

    #[test]
    fn test_clean_merge_different_lines_modified() {
        // ours modifies line 2, theirs modifies line 3 — no overlap.
        let base = "A\nB\nC";
        let ours = "A\nB_modified\nC";
        let theirs = "A\nB\nC_modified";
        let result = merge(base, ours, theirs);
        assert!(!result.has_conflicts, "Expected no conflict");
        assert_eq!(result.conflicts.len(), 0);
        let m = lines(&result.merged);
        assert!(m.contains(&"A"));
        assert!(m.contains(&"B_modified"));
        assert!(m.contains(&"C_modified"));
    }

    #[test]
    fn test_clean_merge_ours_adds_theirs_unchanged() {
        // ours inserts a new line before base line 2; theirs is identical to base.
        let base = "line1\nline3";
        let ours = "line1\nline2\nline3";
        let theirs = "line1\nline3";
        let result = merge(base, ours, theirs);
        assert!(!result.has_conflicts, "Expected no conflict");
        let m = lines(&result.merged);
        assert_eq!(m, vec!["line1", "line2", "line3"]);
    }

    #[test]
    fn test_clean_merge_theirs_adds_ours_unchanged() {
        let base = "line1\nline3";
        let ours = "line1\nline3";
        let theirs = "line1\nline2\nline3";
        let result = merge(base, ours, theirs);
        assert!(!result.has_conflicts, "Expected no conflict");
        let m = lines(&result.merged);
        assert_eq!(m, vec!["line1", "line2", "line3"]);
    }

    // ── conflict: both modify same line ───────────────────────────────────────

    #[test]
    fn test_conflict_both_modify_same_line() {
        let base = "line1\nshared_line\nline3";
        let ours = "line1\nours_version\nline3";
        let theirs = "line1\ntheirs_version\nline3";
        let result = merge(base, ours, theirs);
        assert!(result.has_conflicts);
        assert_eq!(result.conflicts.len(), 1);
        let merged = &result.merged;
        assert!(merged.contains("<<<<<<< ours"));
        assert!(merged.contains("ours_version"));
        assert!(merged.contains("======="));
        assert!(merged.contains("theirs_version"));
        assert!(merged.contains(">>>>>>> theirs"));
    }

    // ── one-sided edit ────────────────────────────────────────────────────────

    #[test]
    fn test_one_sided_edit_ours_only() {
        let base = "A\nB\nC";
        let ours = "A\nB_ours\nC";
        let theirs = "A\nB\nC"; // unchanged
        let result = merge(base, ours, theirs);
        assert!(!result.has_conflicts);
        let m = lines(&result.merged);
        assert!(m.contains(&"B_ours"), "ours change should be accepted");
    }

    #[test]
    fn test_one_sided_edit_theirs_only() {
        let base = "A\nB\nC";
        let ours = "A\nB\nC"; // unchanged
        let theirs = "A\nB_theirs\nC";
        let result = merge(base, ours, theirs);
        assert!(!result.has_conflicts);
        let m = lines(&result.merged);
        assert!(m.contains(&"B_theirs"), "theirs change should be accepted");
    }

    // ── empty base ────────────────────────────────────────────────────────────

    #[test]
    fn test_empty_base_both_add_same() {
        let base = "";
        let ours = "new content";
        let theirs = "new content";
        let result = merge(base, ours, theirs);
        // Identical inputs → fast path, no conflict.
        assert!(!result.has_conflicts);
        assert_eq!(result.merged, "new content");
    }

    #[test]
    fn test_empty_base_both_add_different() {
        let base = "";
        let ours = "ours content";
        let theirs = "theirs content";
        let result = merge(base, ours, theirs);
        // Both add different content to empty base — conflict.
        assert!(result.has_conflicts);
        assert!(result.merged.contains("<<<<<<< ours"));
        assert!(result.merged.contains("ours content"));
        assert!(result.merged.contains("theirs content"));
    }

    // ── deletion + modification conflict ──────────────────────────────────────

    #[test]
    fn test_both_delete_same_line() {
        let base = "keep\ndelete_me\nkeep2";
        let ours = "keep\nkeep2";
        let theirs = "keep\nkeep2";
        let result = merge(base, ours, theirs);
        assert!(!result.has_conflicts);
        let m = lines(&result.merged);
        assert!(!m.contains(&"delete_me"), "deleted line must not appear");
        assert_eq!(m, vec!["keep", "keep2"]);
    }

    #[test]
    fn test_ours_deletes_theirs_keeps() {
        let base = "A\nB\nC";
        let ours = "A\nC"; // deleted B
        let theirs = "A\nB\nC"; // kept B
        let result = merge(base, ours, theirs);
        // One-sided deletion: ours wins (auto-merge).
        assert!(!result.has_conflicts);
        let m = lines(&result.merged);
        assert!(
            !m.contains(&"B"),
            "B was deleted by ours and should not appear"
        );
    }

    // ── multiple conflicts ────────────────────────────────────────────────────

    #[test]
    fn test_multiple_conflicts() {
        let base = "A\nB\nC\nD\nE";
        let ours = "A\nB_ours\nC\nD_ours\nE";
        let theirs = "A\nB_theirs\nC\nD_theirs\nE";
        let result = merge(base, ours, theirs);
        assert!(result.has_conflicts);
        assert_eq!(result.conflicts.len(), 2, "Expected 2 conflicts");
        let marker_count = result.merged.matches("<<<<<<< ours").count();
        assert_eq!(marker_count, 2);
    }

    // ── conflict markers are properly formatted ───────────────────────────────

    #[test]
    fn test_conflict_marker_format() {
        let base = "x";
        let ours = "x_ours";
        let theirs = "x_theirs";
        let result = merge(base, ours, theirs);
        assert!(result.has_conflicts);
        let m = &result.merged;
        let ours_pos = m.find("<<<<<<< ours").expect("missing ours marker");
        let sep_pos = m.find("=======").expect("missing separator");
        let theirs_pos = m.find(">>>>>>> theirs").expect("missing theirs marker");
        assert!(ours_pos < sep_pos, "ours marker must precede separator");
        assert!(sep_pos < theirs_pos, "separator must precede theirs marker");
    }

    // ── stats accuracy ────────────────────────────────────────────────────────

    #[test]
    fn test_stats_no_conflict() {
        let base = "A\nB\nC";
        let ours = "A\nB_ours\nC";
        let theirs = "A\nB\nC_theirs";
        let result = merge(base, ours, theirs);
        assert_eq!(result.stats.conflict_count, 0);
        assert!(result.stats.auto_merged_lines > 0);
        assert_eq!(result.stats.total_lines, result.merged.lines().count());
    }

    #[test]
    fn test_stats_with_conflict() {
        let base = "A\nB\nC";
        let ours = "A\nB_ours\nC";
        let theirs = "A\nB_theirs\nC";
        let result = merge(base, ours, theirs);
        assert_eq!(result.stats.conflict_count, 1);
        assert_eq!(result.stats.total_lines, result.merged.lines().count());
    }

    // ── JSON serialization ────────────────────────────────────────────────────

    #[test]
    fn test_json_output_shape() {
        let base = "a\nb";
        let ours = "a\nb_ours";
        let theirs = "a\nb_theirs";
        let json = three_way_merge(base, ours, theirs);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed["merged"].is_string());
        assert!(parsed["hasConflicts"].is_boolean());
        assert!(parsed["conflicts"].is_array());
        assert!(parsed["stats"]["conflictCount"].is_number());
        assert!(parsed["stats"]["autoMergedLines"].is_number());
        assert!(parsed["stats"]["totalLines"].is_number());
    }

    // ── identical inputs fast path ────────────────────────────────────────────

    #[test]
    fn test_identical_ours_and_theirs() {
        let base = "A\nB\nC";
        let ours = "A\nX\nC";
        let theirs = "A\nX\nC"; // same as ours
        let result = merge(base, ours, theirs);
        assert!(!result.has_conflicts);
        assert_eq!(result.merged, ours);
    }

    // ── insertion conflict at same position ───────────────────────────────────

    #[test]
    fn test_insertion_conflict_same_position() {
        // Both insert before line 2 (C), but with different content.
        let base = "A\nC";
        let ours = "A\nB_ours\nC";
        let theirs = "A\nB_theirs\nC";
        let result = merge(base, ours, theirs);
        assert!(result.has_conflicts);
        assert!(result.merged.contains("B_ours"));
        assert!(result.merged.contains("B_theirs"));
    }
}
