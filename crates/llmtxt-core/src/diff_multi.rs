//! LCS-aligned multi-way diff helpers.
//!
//! Internal implementation module for [`crate::multi_way_diff_native`].
//! All types and functions here are private to the crate.

use crate::diff::{MultiDiffLine, MultiDiffStats, MultiDiffVariant, structured_diff_native};

// ── Internal grid types ────────────────────────────────────────

/// What a single version contributes at one aligned grid slot.
#[derive(Debug, Clone)]
pub(crate) enum SlotContent {
    /// The version has this line at the aligned base position (context).
    Present(String),
    /// The version deleted the base line at this position.
    Absent,
    /// This slot is an insertion row — the version supplies this content here.
    Inserted(String),
    /// This slot is an insertion row but this version has no line here.
    NotInserted,
}

/// One row in the aligned grid.
#[derive(Debug, Clone)]
pub(crate) struct AlignedRow {
    /// True when this row comes from a base line; false for insertion rows.
    pub is_base_line: bool,
    /// Per-version content. Length == `version_count`.
    pub slots: Vec<SlotContent>,
}

/// Per-version LCS alignment of one additional version against the base.
pub(crate) struct VersionAlignment {
    /// 1-indexed by base line number. `None` means the version removed that line.
    pub base_line_action: Vec<Option<String>>,
    /// `insertions_after[i]` holds lines this version inserts after base line `i`
    /// (index 0 = before base line 1).
    pub insertions_after: Vec<Vec<String>>,
}

// ── Alignment helpers ──────────────────────────────────────────

/// Align one additional version against `base` using [`structured_diff_native`].
///
/// Returns a [`VersionAlignment`] describing which base lines the version kept
/// (context), replaced with new content (present with different text), deleted
/// (absent), and which entirely new lines it inserted between base lines.
///
/// **Replacement detection**: in the LCS diff, a "removed" entry immediately
/// followed by one or more "added" entries (before the next "context" or
/// "removed") is treated as a replacement: the first "added" becomes the
/// version's content for that base-line slot, and any remaining "added" entries
/// are insertions appended after it.  This avoids falsely reporting divergent
/// content as absent-plus-insertion, which would inflate insertion counts and
/// deflate consensus percentages.
pub(crate) fn align_version(base: &str, version_text: &str, n_base: usize) -> VersionAlignment {
    let diff = structured_diff_native(base, version_text);

    // Slot 0 is unused (1-indexed). Default to None (= absent/deleted).
    let mut base_line_action: Vec<Option<String>> = vec![None; n_base + 1];
    // insertions_after[0] = before base line 1; insertions_after[i] = after line i.
    let mut insertions_after: Vec<Vec<String>> = vec![Vec::new(); n_base + 1];

    // `cursor` is the last base line we have committed.
    // `pending_removal` holds a base line index that was removed and may be
    // replaced by the immediately following "added" entry.
    let mut cursor: usize = 0;
    let mut pending_removal: Option<usize> = None;

    for entry in &diff.lines {
        match entry.line_type.as_str() {
            "context" => {
                // Any pending removal is a pure deletion — leave its slot as None.
                pending_removal = None;
                if let Some(base_idx) = entry.old_line {
                    let idx = base_idx as usize;
                    base_line_action[idx] = Some(entry.content.clone());
                    cursor = idx;
                }
            }
            "removed" => {
                // Flush any previous pending removal as a pure deletion.
                if let Some(prev) = pending_removal.take() {
                    // base_line_action[prev] stays None; cursor stays at prev.
                    cursor = prev;
                }
                if let Some(base_idx) = entry.old_line {
                    pending_removal = Some(base_idx as usize);
                }
            }
            "added" => {
                if let Some(removed_idx) = pending_removal.take() {
                    // First "added" after a "removed" = replacement of that base line.
                    base_line_action[removed_idx] = Some(entry.content.clone());
                    cursor = removed_idx;
                } else {
                    // Pure insertion after `cursor`.
                    insertions_after[cursor].push(entry.content.clone());
                }
            }
            _ => {}
        }
    }
    // Flush any trailing pending removal.
    if let Some(prev) = pending_removal {
        cursor = prev;
        let _ = cursor; // suppress unused-variable warning
    }

    VersionAlignment {
        base_line_action,
        insertions_after,
    }
}

/// Emit insertion rows for lines added by any version after `after_base_line`.
///
/// Insertions from each version are interleaved in version order at each depth
/// level (first line inserted by each version, then second, etc.).
pub(crate) fn emit_insertions_after(
    grid: &mut Vec<AlignedRow>,
    alignments: &[VersionAlignment],
    version_count: usize,
    after_base_line: usize,
) {
    let lists: Vec<&Vec<String>> = alignments
        .iter()
        .map(|a| &a.insertions_after[after_base_line])
        .collect();

    let max_depth = lists.iter().map(|l| l.len()).max().unwrap_or(0);
    if max_depth == 0 {
        return;
    }

    for depth in 0..max_depth {
        for (vi, list) in lists.iter().enumerate() {
            if depth >= list.len() {
                continue;
            }
            // One insertion row per version per depth.  Slot 0 = base (never inserts).
            let mut slots: Vec<SlotContent> = Vec::with_capacity(version_count);
            slots.push(SlotContent::NotInserted);
            for vi2 in 0..lists.len() {
                if vi2 == vi {
                    slots.push(SlotContent::Inserted(list[depth].clone()));
                } else {
                    slots.push(SlotContent::NotInserted);
                }
            }
            grid.push(AlignedRow {
                is_base_line: false,
                slots,
            });
        }
    }
}

/// Build the aligned grid from base lines and per-version alignments.
///
/// Each base line becomes an anchor row; insertion rows for version-added lines
/// are interleaved immediately after the base line they follow.
pub(crate) fn build_aligned_grid(
    base_lines: &[&str],
    alignments: &[VersionAlignment],
    version_count: usize,
) -> Vec<AlignedRow> {
    let n_base = base_lines.len();
    let mut grid: Vec<AlignedRow> = Vec::new();

    // Insertions before base line 1.
    emit_insertions_after(&mut grid, alignments, version_count, 0);

    for base_line_idx in 1..=n_base {
        let base_content = base_lines[base_line_idx - 1].to_string();
        let mut slots: Vec<SlotContent> = Vec::with_capacity(version_count);
        // Slot 0 = base — always present.
        slots.push(SlotContent::Present(base_content));
        for alignment in alignments {
            match &alignment.base_line_action[base_line_idx] {
                Some(c) => slots.push(SlotContent::Present(c.clone())),
                None => slots.push(SlotContent::Absent),
            }
        }
        grid.push(AlignedRow {
            is_base_line: true,
            slots,
        });

        emit_insertions_after(&mut grid, alignments, version_count, base_line_idx);
    }

    grid
}

/// Convert the aligned grid into [`MultiDiffLine`] entries and aggregate stats.
///
/// Consensus percentage is computed over base-line rows only.  Insertion rows
/// are version-specific additions and do not count as disagreements.
pub(crate) fn score_grid(
    grid: &[AlignedRow],
    version_count: usize,
) -> (Vec<MultiDiffLine>, MultiDiffStats) {
    // Absent slots use a sentinel so they compare unequal to real content.
    const ABSENT: &str = "\x00__ABSENT__\x00";

    let mut result_lines: Vec<MultiDiffLine> = Vec::with_capacity(grid.len());
    let mut consensus_count = 0usize;
    let mut divergent_count = 0usize;
    let mut insertion_count = 0usize;

    for (row_idx, row) in grid.iter().enumerate() {
        let line_number = row_idx + 1;

        if !row.is_base_line {
            // Find the single version that contributed this insertion.
            let mut content = String::new();
            let mut inserting_vi = 0usize;
            for (vi, slot) in row.slots.iter().enumerate() {
                if let SlotContent::Inserted(c) = slot {
                    content = c.clone();
                    inserting_vi = vi;
                    break;
                }
            }
            insertion_count += 1;
            result_lines.push(MultiDiffLine {
                line_number,
                line_type: "insertion".to_string(),
                content: content.clone(),
                agreement: 1,
                total: version_count,
                variants: vec![MultiDiffVariant {
                    version_index: inserting_vi,
                    content,
                }],
            });
            continue;
        }

        // Base-line row: find the plurality content.
        let contents: Vec<&str> = row
            .slots
            .iter()
            .map(|s| match s {
                SlotContent::Present(c) => c.as_str(),
                _ => ABSENT,
            })
            .collect();

        let mut best: &str = contents[0];
        let mut best_n = 0usize;
        for candidate in &contents {
            let n = contents.iter().filter(|c| *c == candidate).count();
            if n > best_n {
                best_n = n;
                best = candidate;
            }
        }

        if best_n == version_count {
            consensus_count += 1;
            result_lines.push(MultiDiffLine {
                line_number,
                line_type: "consensus".to_string(),
                content: best.to_string(),
                agreement: version_count,
                total: version_count,
                variants: vec![],
            });
        } else {
            divergent_count += 1;
            let variants: Vec<MultiDiffVariant> = row
                .slots
                .iter()
                .enumerate()
                .map(|(vi, slot)| {
                    let c = match slot {
                        SlotContent::Present(s) => s.clone(),
                        _ => String::new(),
                    };
                    MultiDiffVariant {
                        version_index: vi,
                        content: c,
                    }
                })
                .collect();
            result_lines.push(MultiDiffLine {
                line_number,
                line_type: "divergent".to_string(),
                content: if best == ABSENT {
                    String::new()
                } else {
                    best.to_string()
                },
                agreement: best_n,
                total: version_count,
                variants,
            });
        }
    }

    let base_row_count = consensus_count + divergent_count;
    let consensus_percentage = if base_row_count == 0 {
        100.0
    } else {
        let pct = (consensus_count as f64 / base_row_count as f64) * 100.0;
        (pct * 10.0).round() / 10.0
    };

    let stats = MultiDiffStats {
        total_lines: base_row_count + insertion_count,
        consensus_lines: consensus_count,
        divergent_lines: divergent_count,
        consensus_percentage,
    };

    (result_lines, stats)
}
