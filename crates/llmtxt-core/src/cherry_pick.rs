//! Cherry-pick merge: assemble document content from line ranges and sections
//! across multiple versions.

use std::collections::HashMap;

// ── Input types ───────────────────────────────────────────────────────────────

/// A single source specification for cherry-pick merge.
/// Either `line_ranges` or `sections` must be non-empty.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSpec {
    version_index: usize,
    #[serde(default)]
    line_ranges: Vec<[usize; 2]>,
    #[serde(default)]
    sections: Vec<String>,
}

/// Top-level selection spec for cherry-pick merge.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionSpec {
    sources: Vec<SourceSpec>,
    fill_from: Option<usize>,
}

// ── Output types ──────────────────────────────────────────────────────────────

/// A single provenance entry in the merged output.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceEntry {
    line_start: usize,
    line_end: usize,
    from_version: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    fill_from: Option<bool>,
}

/// Return value of cherry-pick merge.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CherryPickResult {
    content: String,
    provenance: Vec<ProvenanceEntry>,
    stats: CherryPickStats,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CherryPickStats {
    total_lines: usize,
    sources_used: usize,
    sections_extracted: usize,
    line_ranges_extracted: usize,
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Find the 1-based inclusive line range [start, end] of a markdown section.
///
/// A section starts at the heading line that matches `heading` exactly (after
/// trimming) and runs to the next heading of the same or higher level, or end
/// of content.
///
/// Returns `None` when the heading is not found.
fn find_section_line_range(lines: &[&str], heading: &str) -> Option<(usize, usize)> {
    let heading_trimmed = heading.trim();
    let target_level = heading_trimmed.chars().take_while(|&c| c == '#').count();

    let mut section_start: Option<usize> = None;

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if let Some(start) = section_start {
            if trimmed.starts_with('#') {
                let level = trimmed.chars().take_while(|&c| c == '#').count();
                if level <= target_level {
                    // End of section (exclusive boundary at line i)
                    return Some((start + 1, i));
                }
            }
        } else if trimmed == heading_trimmed {
            section_start = Some(i);
        }
    }

    section_start.map(|s| (s + 1, lines.len()))
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Merge content from multiple versions by cherry-picking specific line ranges
/// and/or markdown sections.
///
/// # Arguments
/// - `base`: base version content (usually v1). Inserted as version index 0 if
///   key `"0"` is absent from `versions_json`.
/// - `versions_json`: JSON object mapping version index (string key) to full
///   content, e.g. `{"0":"...", "1":"...", "2":"..."}`.
/// - `selection_json`: JSON object with a `sources` array and an optional
///   `fillFrom` index. Each source has `versionIndex` and either `lineRanges`
///   (array of `[start, end]` 1-based inclusive pairs) or `sections` (array of
///   markdown heading strings).
///
/// # Returns
/// JSON string with `content`, `provenance`, and `stats` fields on success, or
/// an `Err` string describing the first error encountered.
///
/// # Errors
/// - `"Version index N not found"` — `versionIndex` references missing version.
/// - `"Section 'X' not found in version N"` — section heading not present.
/// - `"Overlapping line ranges: ..."` — two selections assign the same line.
pub fn cherry_pick_merge(
    base: &str,
    versions_json: &str,
    selection_json: &str,
) -> Result<String, String> {
    // ── Parse inputs ──────────────────────────────────────────────────────────
    let versions_raw: HashMap<String, String> =
        serde_json::from_str(versions_json).map_err(|e| format!("Invalid versions JSON: {e}"))?;

    let selection: SelectionSpec =
        serde_json::from_str(selection_json).map_err(|e| format!("Invalid selection JSON: {e}"))?;

    // Build a numeric-keyed map; fall back to `base` for key "0" when absent.
    let mut versions: HashMap<usize, String> = HashMap::new();
    for (k, v) in &versions_raw {
        let idx: usize = k
            .parse()
            .map_err(|_| format!("Version key '{k}' is not a valid integer"))?;
        versions.insert(idx, v.clone());
    }
    versions.entry(0).or_insert_with(|| base.to_string());

    // ── Determine fill source ─────────────────────────────────────────────────
    let fill_version_idx = selection.fill_from.unwrap_or(0);
    let fill_content = versions
        .get(&fill_version_idx)
        .ok_or_else(|| format!("Version index {fill_version_idx} not found"))?
        .clone();
    let fill_line_count = fill_content.lines().count();

    // ── Build per-line assignment map ─────────────────────────────────────────
    // Key: 1-based line number. Value: (version_index, is_fill).
    let mut assigned: HashMap<usize, (usize, bool)> = HashMap::new();
    let mut sections_extracted: usize = 0;
    let mut line_ranges_extracted: usize = 0;

    for source in &selection.sources {
        let ver_idx = source.version_index;
        let ver_content = versions
            .get(&ver_idx)
            .ok_or_else(|| format!("Version index {ver_idx} not found"))?;
        let ver_lines: Vec<&str> = ver_content.lines().collect();
        let ver_total = ver_lines.len();

        // Process explicit line ranges
        for range in &source.line_ranges {
            let [start, end] = *range;
            if start < 1 || end < start || end > ver_total {
                return Err(format!(
                    "Line range [{start}, {end}] is out of bounds for version \
                     {ver_idx} ({ver_total} lines)"
                ));
            }
            for ln in start..=end {
                if let Some(&(existing_ver, _)) = assigned.get(&ln) {
                    return Err(format!(
                        "Overlapping line ranges: lines {start}-{end} \
                         (version {ver_idx}) overlap at line {ln} already \
                         assigned from version {existing_ver}"
                    ));
                }
                assigned.insert(ln, (ver_idx, false));
            }
            line_ranges_extracted += 1;
        }

        // Process section names
        for section_heading in &source.sections {
            let (sec_start, sec_end) = find_section_line_range(&ver_lines, section_heading)
                .ok_or_else(|| {
                    format!("Section '{section_heading}' not found in version {ver_idx}")
                })?;

            for ln in sec_start..=sec_end {
                if let Some(&(existing_ver, _)) = assigned.get(&ln) {
                    return Err(format!(
                        "Overlapping line ranges: section '{section_heading}' \
                         lines {sec_start}-{sec_end} (version {ver_idx}) \
                         overlap at line {ln} already assigned from version \
                         {existing_ver}"
                    ));
                }
                assigned.insert(ln, (ver_idx, false));
            }
            sections_extracted += 1;
        }
    }

    // Fill unassigned lines from fill_from version
    if selection.fill_from.is_some() {
        for ln in 1..=fill_line_count {
            assigned.entry(ln).or_insert((fill_version_idx, true));
        }
    }

    // ── Assemble output ───────────────────────────────────────────────────────
    let mut sorted_lines: Vec<usize> = assigned.keys().copied().collect();
    sorted_lines.sort_unstable();

    // Cache version lines to avoid repeated splits
    let ver_line_cache: HashMap<usize, Vec<String>> = versions
        .iter()
        .map(|(&idx, content)| (idx, content.lines().map(str::to_string).collect()))
        .collect();

    let mut output_lines: Vec<String> = Vec::with_capacity(sorted_lines.len());
    let mut provenance: Vec<ProvenanceEntry> = Vec::new();
    let mut prov_start: usize = 1;
    // (from_version, current_output_line_num, is_fill)
    let mut prev_entry: Option<(usize, usize, bool)> = None;

    for (out_idx, &source_line) in sorted_lines.iter().enumerate() {
        let output_line_num = out_idx + 1;
        let &(ver_idx, is_fill) = assigned.get(&source_line).ok_or_else(|| {
            format!("Internal error: source line {source_line} missing from assignment map")
        })?;

        let ver_lines = ver_line_cache
            .get(&ver_idx)
            .ok_or_else(|| format!("Internal error: version {ver_idx} missing from cache"))?;
        let line_content = ver_lines
            .get(source_line - 1)
            .ok_or_else(|| {
                format!(
                    "Internal error: line {source_line} out of range for \
                     version {ver_idx}"
                )
            })?
            .clone();
        output_lines.push(line_content);

        match prev_entry {
            None => {
                prev_entry = Some((ver_idx, output_line_num, is_fill));
                prov_start = output_line_num;
            }
            Some((prev_ver, prev_out, prev_fill)) => {
                if prev_ver != ver_idx || prev_fill != is_fill {
                    provenance.push(ProvenanceEntry {
                        line_start: prov_start,
                        line_end: prev_out,
                        from_version: prev_ver,
                        fill_from: if prev_fill { Some(true) } else { None },
                    });
                    prov_start = output_line_num;
                }
                prev_entry = Some((ver_idx, output_line_num, is_fill));
            }
        }
    }

    if let Some((ver_idx, last_out, is_fill)) = prev_entry {
        provenance.push(ProvenanceEntry {
            line_start: prov_start,
            line_end: last_out,
            from_version: ver_idx,
            fill_from: if is_fill { Some(true) } else { None },
        });
    }

    // Preserve trailing newline if the fill source had one
    let mut content = output_lines.join("\n");
    if fill_content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }

    let sources_used = selection.sources.len();
    serde_json::to_string(&CherryPickResult {
        content,
        provenance,
        stats: CherryPickStats {
            total_lines: output_lines.len(),
            sources_used,
            sections_extracted,
            line_ranges_extracted,
        },
    })
    .map_err(|e| format!("Serialization failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a versions_json string from a slice of (index, content) pairs.
    fn make_versions_json(versions: &[(usize, &str)]) -> String {
        let map: serde_json::Map<String, serde_json::Value> = versions
            .iter()
            .map(|(i, c)| (i.to_string(), serde_json::Value::String(c.to_string())))
            .collect();
        serde_json::to_string(&map).unwrap()
    }

    /// Build a selection JSON string programmatically to avoid raw-string
    /// delimiter conflicts with markdown `#` characters.
    fn make_selection(sources: &[serde_json::Value], fill_from: Option<usize>) -> String {
        let mut obj = serde_json::json!({ "sources": sources });
        if let Some(idx) = fill_from {
            obj["fillFrom"] = serde_json::json!(idx);
        }
        serde_json::to_string(&obj).unwrap()
    }

    // ── Line range tests ──────────────────────────────────────────

    #[test]
    fn test_line_range_basic() {
        let v0 = "a\nb\nc\nd\ne\n";
        let v1 = "A\nB\nC\nD\nE\n";
        let versions_json = make_versions_json(&[(0, v0), (1, v1)]);
        // Lines 1-2 from v0, lines 4-5 from v1, fill rest from v0
        let selection = make_selection(
            &[
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[1, 2]] }),
                serde_json::json!({ "versionIndex": 1, "lineRanges": [[4, 5]] }),
            ],
            Some(0),
        );

        let result_json = cherry_pick_merge(v0, &versions_json, &selection).unwrap();
        let result: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        let content = result["content"].as_str().unwrap();
        let lines: Vec<&str> = content.lines().collect();

        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0], "a"); // line 1 from v0
        assert_eq!(lines[1], "b"); // line 2 from v0
        assert_eq!(lines[2], "c"); // line 3 fill from v0
        assert_eq!(lines[3], "D"); // line 4 from v1
        assert_eq!(lines[4], "E"); // line 5 from v1

        assert_eq!(result["stats"]["totalLines"], 5);
        assert_eq!(result["stats"]["lineRangesExtracted"], 2);
        assert_eq!(result["stats"]["sectionsExtracted"], 0);
    }

    #[test]
    fn test_no_fill_only_explicit() {
        let v0 = "a\nb\nc\n";
        let v1 = "X\nY\nZ\n";
        let versions_json = make_versions_json(&[(0, v0), (1, v1)]);
        // Only take line 2 from v1, no fill
        let selection = make_selection(
            &[serde_json::json!({ "versionIndex": 1, "lineRanges": [[2, 2]] })],
            None,
        );

        let result_json = cherry_pick_merge(v0, &versions_json, &selection).unwrap();
        let result: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        let content = result["content"].as_str().unwrap();
        let lines: Vec<&str> = content.lines().collect();

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], "Y");
        assert_eq!(result["stats"]["totalLines"], 1);
    }

    // ── Section name tests ────────────────────────────────────────

    #[test]
    fn test_section_names() {
        let v0 = "# Intro\nOriginal intro\n# Sec1\nOriginal sec1\n# Sec2\nOriginal sec2\n";
        let v1 = "# Intro\nUpdated intro\n# Sec1\nUpdated sec1\n# Sec2\nUpdated sec2\n";
        let versions_json = make_versions_json(&[(0, v0), (1, v1)]);
        // Take Sec1 from v1, fill rest from v0
        let selection = make_selection(
            &[serde_json::json!({
                "versionIndex": 1,
                "sections": ["# Sec1"]
            })],
            Some(0),
        );

        let result_json = cherry_pick_merge(v0, &versions_json, &selection).unwrap();
        let result: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        let content = result["content"].as_str().unwrap();

        assert!(content.contains("Updated sec1"), "expected v1 sec1 body");
        assert!(content.contains("Original intro"), "expected v0 intro fill");
        assert!(content.contains("Original sec2"), "expected v0 sec2 fill");
        assert_eq!(result["stats"]["sectionsExtracted"], 1);
    }

    #[test]
    fn test_multiple_sections_from_different_versions() {
        let v0 = "# Alpha\nalpha v0\n# Beta\nbeta v0\n# Gamma\ngamma v0\n";
        let v1 = "# Alpha\nalpha v1\n# Beta\nbeta v1\n# Gamma\ngamma v1\n";
        let v2 = "# Alpha\nalpha v2\n# Beta\nbeta v2\n# Gamma\ngamma v2\n";
        let versions_json = make_versions_json(&[(0, v0), (1, v1), (2, v2)]);
        let selection = make_selection(
            &[
                serde_json::json!({ "versionIndex": 1, "sections": ["# Beta"] }),
                serde_json::json!({ "versionIndex": 2, "sections": ["# Gamma"] }),
            ],
            Some(0),
        );

        let result_json = cherry_pick_merge(v0, &versions_json, &selection).unwrap();
        let result: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        let content = result["content"].as_str().unwrap();

        assert!(
            content.contains("alpha v0"),
            "Alpha should be filled from v0"
        );
        assert!(content.contains("beta v1"), "Beta should come from v1");
        assert!(content.contains("gamma v2"), "Gamma should come from v2");
        assert_eq!(result["stats"]["sectionsExtracted"], 2);
        assert_eq!(result["stats"]["sourcesUsed"], 2);
    }

    // ── Provenance tests ──────────────────────────────────────────

    #[test]
    fn test_provenance_metadata() {
        let v0 = "a\nb\nc\nd\ne\n";
        let v1 = "A\nB\nC\nD\nE\n";
        let versions_json = make_versions_json(&[(0, v0), (1, v1)]);
        // Lines 1-2 from v0, lines 4-5 from v1, fill line 3 from v0
        let selection = make_selection(
            &[
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[1, 2]] }),
                serde_json::json!({ "versionIndex": 1, "lineRanges": [[4, 5]] }),
            ],
            Some(0),
        );

        let result_json = cherry_pick_merge(v0, &versions_json, &selection).unwrap();
        let result: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        let provenance = result["provenance"].as_array().unwrap();

        // Explicit v0 range at lines 1-2
        let has_v0_explicit = provenance.iter().any(|p| {
            p["fromVersion"] == 0
                && p["lineStart"] == 1
                && p["lineEnd"] == 2
                && p["fillFrom"].is_null()
        });
        assert!(has_v0_explicit, "expected explicit v0 range in provenance");

        // Fill entry from v0
        let has_fill = provenance
            .iter()
            .any(|p| p["fromVersion"] == 0 && p["fillFrom"] == true);
        assert!(has_fill, "expected fill provenance entry");

        // v1 entry
        let has_v1 = provenance.iter().any(|p| p["fromVersion"] == 1);
        assert!(has_v1, "expected v1 range in provenance");
    }

    // ── Error tests ───────────────────────────────────────────────

    #[test]
    fn test_overlapping_line_ranges_error() {
        let v0 = "a\nb\nc\nd\ne\n";
        let versions_json = make_versions_json(&[(0, v0)]);
        // Ranges [2,4] and [3,5] overlap
        let selection = make_selection(
            &[
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[2, 4]] }),
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[3, 5]] }),
            ],
            None,
        );

        let result = cherry_pick_merge(v0, &versions_json, &selection);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Overlapping line ranges"),
            "expected overlap error, got: {err}"
        );
    }

    #[test]
    fn test_version_not_found_error() {
        let v0 = "a\nb\nc\n";
        let versions_json = make_versions_json(&[(0, v0)]);
        let selection = make_selection(
            &[serde_json::json!({ "versionIndex": 99, "lineRanges": [[1, 2]] })],
            None,
        );

        let result = cherry_pick_merge(v0, &versions_json, &selection);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Version index 99 not found"),
            "expected version-not-found error, got: {err}"
        );
    }

    #[test]
    fn test_section_not_found_error() {
        let v0 = "# Intro\nHello\n# Footer\nBye\n";
        let versions_json = make_versions_json(&[(0, v0)]);
        let selection = make_selection(
            &[serde_json::json!({
                "versionIndex": 0,
                "sections": ["# Nonexistent"]
            })],
            None,
        );

        let result = cherry_pick_merge(v0, &versions_json, &selection);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Section '# Nonexistent' not found"),
            "expected section-not-found error, got: {err}"
        );
    }
}
