//! Cherry-pick merge: assemble document content from line ranges and sections
//! across multiple versions.

use std::collections::HashMap;

// ── Input types ───────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceSpec {
    version_index: usize,
    #[serde(default)]
    line_ranges: Vec<[usize; 2]>,
    #[serde(default)]
    sections: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionSpec {
    sources: Vec<SourceSpec>,
    fill_from: Option<usize>,
}

// ── Output types ──────────────────────────────────────────────────────────────

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceEntry {
    line_start: usize,
    line_end: usize,
    from_version: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    fill_from: Option<bool>,
}

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
                    return Some((start + 1, i));
                }
            }
        } else if trimmed == heading_trimmed {
            section_start = Some(i);
        }
    }
    section_start.map(|s| (s + 1, lines.len()))
}

/// Extract lines `start..=end` (1-based inclusive) joined by `\n`.
fn extract_section_content(lines: &[&str], start: usize, end: usize) -> String {
    lines[(start - 1)..end].join("\n")
}

/// A contiguous block of output lines plus provenance metadata.
#[derive(Debug)]
struct ContentBlock {
    lines: Vec<String>,
    from_version: usize,
    is_fill: bool,
}

// ── Source collection ─────────────────────────────────────────────────────────

/// Parse all source specs into section claims and line-range blocks.
///
/// Returns `(sections_extracted, line_ranges_extracted)`.
fn collect_sources(
    selection: &SelectionSpec,
    versions: &HashMap<usize, String>,
    section_claims: &mut HashMap<String, (usize, String)>,
    line_range_blocks: &mut Vec<ContentBlock>,
) -> Result<(usize, usize), String> {
    let mut sections_extracted: usize = 0;
    let mut line_ranges_extracted: usize = 0;

    for source in &selection.sources {
        let ver_idx = source.version_index;
        let ver_content = versions
            .get(&ver_idx)
            .ok_or_else(|| format!("Version index {ver_idx} not found"))?;
        let ver_lines: Vec<&str> = ver_content.lines().collect();
        let ver_total = ver_lines.len();

        for heading in &source.sections {
            let normalized = heading.trim().to_string();
            let (sec_start, sec_end) = find_section_line_range(&ver_lines, &normalized)
                .ok_or_else(|| format!("Section '{normalized}' not found in version {ver_idx}"))?;
            if let Some((existing_ver, _)) = section_claims.get(&normalized) {
                return Err(format!(
                    "Section '{normalized}' claimed by multiple sources: \
                     version {existing_ver} and version {ver_idx}"
                ));
            }
            let content = extract_section_content(&ver_lines, sec_start, sec_end);
            section_claims.insert(normalized, (ver_idx, content));
            sections_extracted += 1;
        }

        collect_line_ranges(
            source,
            ver_idx,
            &ver_lines,
            ver_total,
            line_range_blocks,
            &mut line_ranges_extracted,
        )?;
    }

    Ok((sections_extracted, line_ranges_extracted))
}

/// Validate and collect line-range blocks for one source spec.
/// Overlap detection is scoped to this version's own coordinate space.
fn collect_line_ranges(
    source: &SourceSpec,
    ver_idx: usize,
    ver_lines: &[&str],
    ver_total: usize,
    out_blocks: &mut Vec<ContentBlock>,
    counter: &mut usize,
) -> Result<(), String> {
    let mut ver_assigned: HashMap<usize, usize> = HashMap::new();
    for range in &source.line_ranges {
        let [start, end] = *range;
        if start < 1 || end < start || end > ver_total {
            return Err(format!(
                "Line range [{start}, {end}] is out of bounds for version \
                 {ver_idx} ({ver_total} lines)"
            ));
        }
        for ln in start..=end {
            if let Some(&prev) = ver_assigned.get(&ln) {
                return Err(format!(
                    "Overlapping line ranges: line {ln} in version {ver_idx} \
                     is already assigned (range near line {prev})"
                ));
            }
            ver_assigned.insert(ln, start);
        }
        let block_lines: Vec<String> = ver_lines[(start - 1)..end]
            .iter()
            .map(|l| l.to_string())
            .collect();
        out_blocks.push(ContentBlock {
            lines: block_lines,
            from_version: ver_idx,
            is_fill: false,
        });
        *counter += 1;
    }
    Ok(())
}

// ── Assembly strategies ───────────────────────────────────────────────────────

/// Section-based assembly: walk the fillFrom document in heading order.
///
/// Claimed headings emit their full block content from the source version.
/// Sub-headings inside a claimed block are skipped (`claimed_parent_level`).
///
/// Fill (unclaimed) headings emit only the lines from that heading up to the
/// next heading at ANY level.  Sub-headings are processed individually so
/// claimed sub-headings can still be emitted from their source versions.
/// This prevents a broad fill heading from swallowing claimed sub-sections.
///
/// Appends line-range blocks after section content.
fn assemble_section_blocks(
    fill_lines: &[&str],
    fill_version_idx: usize,
    has_fill: bool,
    section_claims: &HashMap<String, (usize, String)>,
    line_range_blocks: Vec<ContentBlock>,
) -> Result<Vec<ContentBlock>, String> {
    let mut blocks: Vec<ContentBlock> = Vec::new();

    let heading_positions: Vec<usize> = fill_lines
        .iter()
        .enumerate()
        .filter(|(_, l)| l.trim().starts_with('#'))
        .map(|(i, _)| i)
        .collect();
    let first_heading_pos = heading_positions.first().copied();
    match first_heading_pos {
        Some(0) => {}
        Some(pos) => blocks.push(ContentBlock {
            lines: fill_lines[..pos].iter().map(|l| l.to_string()).collect(),
            from_version: fill_version_idx,
            is_fill: true,
        }),
        None if !fill_lines.is_empty() => blocks.push(ContentBlock {
            lines: fill_lines.iter().map(|l| l.to_string()).collect(),
            from_version: fill_version_idx,
            is_fill: true,
        }),
        None => {}
    }

    // Tracks level of the last CLAIMED heading. Sub-headings already embedded
    // inside the claimed block are skipped. Fill headings do NOT set this so
    // their sub-headings remain eligible for individual claiming.
    let mut claimed_parent_level: Option<usize> = None;

    for (pos_idx, &line_idx) in heading_positions.iter().enumerate() {
        let heading = fill_lines[line_idx].trim();
        let level = heading.chars().take_while(|&c| c == '#').count();

        // Skip sub-headings already contained in an emitted claimed block.
        if let Some(parent_level) = claimed_parent_level {
            if level > parent_level {
                continue;
            }
            claimed_parent_level = None;
        }

        if let Some((ver_idx, content)) = section_claims.get(heading) {
            blocks.push(ContentBlock {
                lines: content.lines().map(str::to_string).collect(),
                from_version: *ver_idx,
                is_fill: false,
            });
            claimed_parent_level = Some(level);
        } else if has_fill {
            // Emit only lines from this heading to the next heading (any level).
            // Sub-headings are processed individually so claimed ones still fire.
            let next_heading_line = heading_positions
                .get(pos_idx + 1)
                .copied()
                .unwrap_or(fill_lines.len());
            blocks.push(ContentBlock {
                lines: fill_lines[line_idx..next_heading_line]
                    .iter()
                    .map(|l| l.to_string())
                    .collect(),
                from_version: fill_version_idx,
                is_fill: true,
            });
        }
    }

    blocks.extend(line_range_blocks);
    Ok(blocks)
}

/// Positional (line-range-only) assembly: the original algorithm.
/// Builds a line-number assignment map, fills gaps, then emits in order.
fn assemble_line_range_blocks(
    selection: &SelectionSpec,
    versions: &HashMap<usize, String>,
    fill_version_idx: usize,
    fill_content: &str,
) -> Result<Vec<ContentBlock>, String> {
    let mut assigned: HashMap<usize, (usize, bool)> = HashMap::new();

    for source in &selection.sources {
        let ver_idx = source.version_index;
        let ver_content = versions
            .get(&ver_idx)
            .ok_or_else(|| format!("Version index {ver_idx} not found"))?;
        let ver_lines: Vec<&str> = ver_content.lines().collect();
        let ver_total = ver_lines.len();

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
        }
    }

    if selection.fill_from.is_some() {
        for ln in 1..=fill_content.lines().count() {
            assigned.entry(ln).or_insert((fill_version_idx, true));
        }
    }

    let ver_line_cache: HashMap<usize, Vec<String>> = versions
        .iter()
        .map(|(&idx, c)| (idx, c.lines().map(str::to_string).collect()))
        .collect();

    let mut sorted: Vec<usize> = assigned.keys().copied().collect();
    sorted.sort_unstable();

    let mut blocks: Vec<ContentBlock> = Vec::new();
    let mut current: Option<ContentBlock> = None;

    for &ln in &sorted {
        let &(ver_idx, is_fill) = assigned
            .get(&ln)
            .ok_or_else(|| format!("Internal error: line {ln} missing from map"))?;
        let ver_lines = ver_line_cache
            .get(&ver_idx)
            .ok_or_else(|| format!("Internal error: version {ver_idx} missing from cache"))?;
        let line_str = ver_lines
            .get(ln - 1)
            .ok_or_else(|| format!("Internal error: line {ln} out of range for v{ver_idx}"))?;

        match current.as_mut() {
            Some(b) if b.from_version == ver_idx && b.is_fill == is_fill => {
                b.lines.push(line_str.clone());
            }
            _ => {
                if let Some(b) = current.take() {
                    blocks.push(b);
                }
                current = Some(ContentBlock {
                    lines: vec![line_str.clone()],
                    from_version: ver_idx,
                    is_fill,
                });
            }
        }
    }
    if let Some(b) = current {
        blocks.push(b);
    }
    Ok(blocks)
}

// ── Output builder ────────────────────────────────────────────────────────────

/// Convert `ContentBlock`s into a final content string and provenance list.
fn build_output(blocks: &[ContentBlock], fill_content: &str) -> (String, Vec<ProvenanceEntry>) {
    let mut all_lines: Vec<String> = Vec::new();
    let mut provenance: Vec<ProvenanceEntry> = Vec::new();

    for block in blocks {
        if block.lines.is_empty() {
            continue;
        }
        let start_line = all_lines.len() + 1;
        all_lines.extend(block.lines.iter().cloned());
        provenance.push(ProvenanceEntry {
            line_start: start_line,
            line_end: all_lines.len(),
            from_version: block.from_version,
            fill_from: if block.is_fill { Some(true) } else { None },
        });
    }

    let mut content = all_lines.join("\n");
    if fill_content.ends_with('\n') && !content.is_empty() {
        content.push('\n');
    }
    (content, provenance)
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
/// JSON string with `content`, `provenance`, and `stats` fields on success.
///
/// # Errors
/// - `"Version index N not found"` — `versionIndex` references missing version.
/// - `"Section 'X' not found in version N"` — section heading not present.
/// - `"Section 'X' claimed by multiple sources"` — two sources pick same section.
/// - `"Overlapping line ranges: ..."` — two selections assign the same line.
pub fn cherry_pick_merge(
    base: &str,
    versions_json: &str,
    selection_json: &str,
) -> Result<String, String> {
    let versions_raw: HashMap<String, String> =
        serde_json::from_str(versions_json).map_err(|e| format!("Invalid versions JSON: {e}"))?;
    let selection: SelectionSpec =
        serde_json::from_str(selection_json).map_err(|e| format!("Invalid selection JSON: {e}"))?;

    let mut versions: HashMap<usize, String> = HashMap::new();
    for (k, v) in &versions_raw {
        let idx: usize = k
            .parse()
            .map_err(|_| format!("Version key '{k}' is not a valid integer"))?;
        versions.insert(idx, v.clone());
    }
    versions.entry(0).or_insert_with(|| base.to_string());

    let fill_version_idx = selection.fill_from.unwrap_or(0);
    let fill_content = versions
        .get(&fill_version_idx)
        .ok_or_else(|| format!("Version index {fill_version_idx} not found"))?
        .clone();

    let mut section_claims: HashMap<String, (usize, String)> = HashMap::new();
    let mut line_range_blocks: Vec<ContentBlock> = Vec::new();
    let (sections_extracted, line_ranges_extracted) = collect_sources(
        &selection,
        &versions,
        &mut section_claims,
        &mut line_range_blocks,
    )?;

    let has_sections =
        !section_claims.is_empty() || selection.sources.iter().any(|s| !s.sections.is_empty());

    let blocks: Vec<ContentBlock> = if has_sections {
        let fill_lines: Vec<&str> = fill_content.lines().collect();
        assemble_section_blocks(
            &fill_lines,
            fill_version_idx,
            selection.fill_from.is_some(),
            &section_claims,
            line_range_blocks,
        )?
    } else {
        assemble_line_range_blocks(&selection, &versions, fill_version_idx, &fill_content)?
    };

    let (content, provenance) = build_output(&blocks, &fill_content);
    let total_lines = content.lines().count();

    serde_json::to_string(&CherryPickResult {
        content,
        provenance,
        stats: CherryPickStats {
            total_lines,
            sources_used: selection.sources.len(),
            sections_extracted,
            line_ranges_extracted,
        },
    })
    .map_err(|e| format!("Serialization failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_versions_json(versions: &[(usize, &str)]) -> String {
        let map: serde_json::Map<String, serde_json::Value> = versions
            .iter()
            .map(|(i, c)| (i.to_string(), serde_json::Value::String(c.to_string())))
            .collect();
        serde_json::to_string(&map).unwrap()
    }

    fn make_selection(sources: &[serde_json::Value], fill_from: Option<usize>) -> String {
        let mut obj = serde_json::json!({ "sources": sources });
        if let Some(idx) = fill_from {
            obj["fillFrom"] = serde_json::json!(idx);
        }
        serde_json::to_string(&obj).unwrap()
    }

    fn parse(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }

    // ── Line range tests ──────────────────────────────────────────

    #[test]
    fn test_line_range_basic() {
        let v0 = "a\nb\nc\nd\ne\n";
        let v1 = "A\nB\nC\nD\nE\n";
        let vj = make_versions_json(&[(0, v0), (1, v1)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[1, 2]] }),
                serde_json::json!({ "versionIndex": 1, "lineRanges": [[4, 5]] }),
            ],
            Some(0),
        );
        let r = parse(&cherry_pick_merge(v0, &vj, &sel).unwrap());
        let lines: Vec<&str> = r["content"].as_str().unwrap().lines().collect();
        assert_eq!(lines, ["a", "b", "c", "D", "E"]);
        assert_eq!(r["stats"]["totalLines"], 5);
        assert_eq!(r["stats"]["lineRangesExtracted"], 2);
        assert_eq!(r["stats"]["sectionsExtracted"], 0);
    }

    #[test]
    fn test_no_fill_only_explicit() {
        let v0 = "a\nb\nc\n";
        let v1 = "X\nY\nZ\n";
        let vj = make_versions_json(&[(0, v0), (1, v1)]);
        let sel = make_selection(
            &[serde_json::json!({ "versionIndex": 1, "lineRanges": [[2, 2]] })],
            None,
        );
        let r = parse(&cherry_pick_merge(v0, &vj, &sel).unwrap());
        let lines: Vec<&str> = r["content"].as_str().unwrap().lines().collect();
        assert_eq!(lines, ["Y"]);
        assert_eq!(r["stats"]["totalLines"], 1);
    }

    // ── Section tests ─────────────────────────────────────────────

    #[test]
    fn test_multiple_sections_from_different_versions() {
        let v0 = "# Alpha\nalpha v0\n# Beta\nbeta v0\n# Gamma\ngamma v0\n";
        let v1 = "# Alpha\nalpha v1\n# Beta\nbeta v1\n# Gamma\ngamma v1\n";
        let v2 = "# Alpha\nalpha v2\n# Beta\nbeta v2\n# Gamma\ngamma v2\n";
        let vj = make_versions_json(&[(0, v0), (1, v1), (2, v2)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 1, "sections": ["# Beta"] }),
                serde_json::json!({ "versionIndex": 2, "sections": ["# Gamma"] }),
            ],
            Some(0),
        );
        let r = parse(&cherry_pick_merge(v0, &vj, &sel).unwrap());
        let c = r["content"].as_str().unwrap();
        assert!(c.contains("alpha v0") && c.contains("beta v1") && c.contains("gamma v2"));
        assert_eq!(r["stats"]["sectionsExtracted"], 2);
        assert_eq!(r["stats"]["sourcesUsed"], 2);
    }

    // ── Provenance tests ──────────────────────────────────────────

    #[test]
    fn test_provenance_metadata() {
        let v0 = "a\nb\nc\nd\ne\n";
        let v1 = "A\nB\nC\nD\nE\n";
        let vj = make_versions_json(&[(0, v0), (1, v1)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[1, 2]] }),
                serde_json::json!({ "versionIndex": 1, "lineRanges": [[4, 5]] }),
            ],
            Some(0),
        );
        let r = parse(&cherry_pick_merge(v0, &vj, &sel).unwrap());
        let prov = r["provenance"].as_array().unwrap();
        assert!(prov.iter().any(|p| p["fromVersion"] == 0
            && p["lineStart"] == 1
            && p["lineEnd"] == 2
            && p["fillFrom"].is_null()));
        assert!(
            prov.iter()
                .any(|p| p["fromVersion"] == 0 && p["fillFrom"] == true)
        );
        assert!(prov.iter().any(|p| p["fromVersion"] == 1));
    }

    // ── Error tests ───────────────────────────────────────────────

    #[test]
    fn test_overlapping_line_ranges_error() {
        let v0 = "a\nb\nc\nd\ne\n";
        let vj = make_versions_json(&[(0, v0)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[2, 4]] }),
                serde_json::json!({ "versionIndex": 0, "lineRanges": [[3, 5]] }),
            ],
            None,
        );
        assert!(
            cherry_pick_merge(v0, &vj, &sel)
                .unwrap_err()
                .contains("Overlapping line ranges")
        );
    }

    #[test]
    fn test_version_not_found_error() {
        let v0 = "a\nb\nc\n";
        let vj = make_versions_json(&[(0, v0)]);
        let sel = make_selection(
            &[serde_json::json!({ "versionIndex": 99, "lineRanges": [[1, 2]] })],
            None,
        );
        assert!(
            cherry_pick_merge(v0, &vj, &sel)
                .unwrap_err()
                .contains("Version index 99 not found")
        );
    }

    #[test]
    fn test_section_not_found_error() {
        let v0 = "# Intro\nHello\n# Footer\nBye\n";
        let vj = make_versions_json(&[(0, v0)]);
        let sel = make_selection(
            &[serde_json::json!({ "versionIndex": 0, "sections": ["# Nonexistent"] })],
            None,
        );
        assert!(
            cherry_pick_merge(v0, &vj, &sel)
                .unwrap_err()
                .contains("Section '# Nonexistent' not found")
        );
    }

    // ── New tests: per-version coordinate spaces ──────────────────

    /// Core regression: v2 expands Section 1, v3 expands Section 2 — different
    /// line counts across versions must not cause overlap errors or wrong fills.
    #[test]
    fn test_multi_version_sections_different_line_counts() {
        let base = "# Section 1\nbase s1\n# Section 2\nbase s2\n# Section 3\nbase s3\n";
        let v2 = "# Section 1\nv2 s1 line1\nv2 s1 line2\nv2 s1 line3\n# Section 2\nv2 s2\n# Section 3\nv2 s3\n";
        let v3 = "# Section 1\nv3 s1\n# Section 2\nv3 s2 line1\nv3 s2 line2\n# Section 3\nv3 s3\n";
        let vj = make_versions_json(&[(0, base), (2, v2), (3, v3)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 2, "sections": ["# Section 1"] }),
                serde_json::json!({ "versionIndex": 3, "sections": ["# Section 2"] }),
            ],
            Some(0),
        );
        let r = parse(&cherry_pick_merge(base, &vj, &sel).expect("merge must succeed"));
        let c = r["content"].as_str().unwrap();
        assert!(c.contains("v2 s1 line1") && c.contains("v2 s1 line3"));
        assert!(c.contains("v3 s2 line1") && c.contains("v3 s2 line2"));
        assert!(c.contains("base s3") && !c.contains("v3 s1") && !c.contains("v2 s2"));
        assert_eq!(r["stats"]["sectionsExtracted"], 2);
    }

    #[test]
    fn test_duplicate_section_claim_error() {
        let v0 = "# Alpha\nalpha v0\n# Beta\nbeta v0\n";
        let v1 = "# Alpha\nalpha v1\n# Beta\nbeta v1\n";
        let v2 = "# Alpha\nalpha v2\n# Beta\nbeta v2\n";
        let vj = make_versions_json(&[(0, v0), (1, v1), (2, v2)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 1, "sections": ["# Alpha"] }),
                serde_json::json!({ "versionIndex": 2, "sections": ["# Alpha"] }),
            ],
            Some(0),
        );
        assert!(
            cherry_pick_merge(v0, &vj, &sel)
                .unwrap_err()
                .contains("claimed by multiple sources")
        );
    }

    #[test]
    fn test_line_ranges_per_version_coordinate_space() {
        let v0 = "line1\nline2\nline3\nline4\nline5\n";
        let v1 = "LINE1\nLINE2\nLINE3\nLINE4\nLINE5\n";
        let vj = make_versions_json(&[(0, v0), (1, v1)]);
        let sel = make_selection(
            &[serde_json::json!({ "versionIndex": 1, "lineRanges": [[3, 4]] })],
            Some(0),
        );
        let r = parse(&cherry_pick_merge(v0, &vj, &sel).unwrap());
        let lines: Vec<&str> = r["content"].as_str().unwrap().lines().collect();
        assert_eq!(lines, ["line1", "line2", "LINE3", "LINE4", "line5"]);
    }

    /// 5-section merge: B from v2, D from v4, fill from v1.
    /// Output must be A(v1) B(v2) C(v1) D(v4) E(v1) — no duplication.
    #[test]
    fn test_five_section_no_duplication() {
        let v1 = "# A\nA v1\n# B\nB v1\n# C\nC v1\n# D\nD v1\n# E\nE v1\n";
        let v2 = "# A\nA v2\n# B\nB v2\n# C\nC v2\n# D\nD v2\n# E\nE v2\n";
        let v4 = "# A\nA v4\n# B\nB v4\n# C\nC v4\n# D\nD v4\n# E\nE v4\n";
        let vj = make_versions_json(&[(1, v1), (2, v2), (4, v4)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 2, "sections": ["# B"] }),
                serde_json::json!({ "versionIndex": 4, "sections": ["# D"] }),
            ],
            Some(1),
        );
        let r = parse(&cherry_pick_merge(v1, &vj, &sel).unwrap());
        let c = r["content"].as_str().unwrap();
        let hdrs: Vec<&str> = c.lines().filter(|l| l.starts_with('#')).collect();
        assert_eq!(hdrs, ["# A", "# B", "# C", "# D", "# E"]);
        assert!(c.contains("A v1") && c.contains("B v2") && c.contains("C v1"));
        assert!(c.contains("D v4") && c.contains("E v1"));
        assert!(!c.contains("B v1") && !c.contains("D v1"));
        let (pa, pb, pc, pd, pe) = (
            c.find("A v1").unwrap(),
            c.find("B v2").unwrap(),
            c.find("C v1").unwrap(),
            c.find("D v4").unwrap(),
            c.find("E v1").unwrap(),
        );
        assert!(pa < pb && pb < pc && pc < pd && pd < pe);
    }

    /// Claiming a parent section must not also emit its child headings from fill.
    /// Regression: ## Setup claimed from v1 must not repeat ### Install / ### Config
    /// that are already inside the claimed block.
    #[test]
    fn test_claimed_parent_does_not_duplicate_children() {
        let base =
            "## Setup\n### Install\ninstall base\n### Config\nconfig base\n## Usage\nusage base\n";
        let v1 = "## Setup\n### Install\ninstall v1\n### Config\nconfig v1\n## Usage\nusage v1\n";
        let vj = make_versions_json(&[(0, base), (1, v1)]);
        let sel = make_selection(
            &[serde_json::json!({ "versionIndex": 1, "sections": ["## Setup"] })],
            Some(0),
        );
        let r = parse(&cherry_pick_merge(base, &vj, &sel).unwrap());
        let c = r["content"].as_str().unwrap();
        // Each heading must appear exactly once
        let setup_count = c.matches("## Setup").count();
        let install_count = c.matches("### Install").count();
        let config_count = c.matches("### Config").count();
        assert_eq!(setup_count, 1, "## Setup must appear exactly once");
        assert_eq!(install_count, 1, "### Install must appear exactly once");
        assert_eq!(config_count, 1, "### Config must appear exactly once");
        // Content is correct version
        assert!(c.contains("install v1"), "### Install content from v1");
        assert!(c.contains("config v1"), "### Config content from v1");
        assert!(c.contains("usage base"), "## Usage content from fill");
        assert!(!c.contains("install base"), "fill install must not appear");
        assert!(!c.contains("config base"), "fill config must not appear");
        // Order: Setup before Usage
        assert!(c.find("## Setup").unwrap() < c.find("## Usage").unwrap());
    }

    /// Mixed mode: section source + line-range source in the same selection.
    #[test]
    fn test_mixed_sections_and_line_ranges() {
        let base = "# Intro\nintro base\n# Body\nbody base\n# Footer\nfooter base\n";
        let v1 = "# Intro\nintro v1\n# Body\nbody v1\n# Footer\nfooter v1\n";
        let v2 = "EXTRA_LINE_1\nEXTRA_LINE_2\nEXTRA_LINE_3\n";
        let vj = make_versions_json(&[(0, base), (1, v1), (2, v2)]);
        let sel = make_selection(
            &[
                serde_json::json!({ "versionIndex": 1, "sections": ["# Body"] }),
                serde_json::json!({ "versionIndex": 2, "lineRanges": [[1, 2]] }),
            ],
            Some(0),
        );
        let r = parse(&cherry_pick_merge(base, &vj, &sel).unwrap());
        let c = r["content"].as_str().unwrap();
        assert!(c.contains("intro base") && c.contains("body v1") && c.contains("footer base"));
        assert!(
            c.contains("EXTRA_LINE_1") && c.contains("EXTRA_LINE_2") && !c.contains("EXTRA_LINE_3")
        );
        assert_eq!(r["stats"]["sectionsExtracted"], 1);
        assert_eq!(r["stats"]["lineRangesExtracted"], 1);
    }
}
