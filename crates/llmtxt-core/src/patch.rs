use diffy::{Patch, apply as diffy_apply, create_patch as diffy_create_patch};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use crate::{DiffResult, compute_diff};

/// Apply a unified diff patch to an original string.
/// Returns the updated string on success, or an error if the patch is invalid
/// or fails to apply cleanly.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn apply_patch(original: &str, patch_text: &str) -> Result<String, String> {
    let patch = Patch::from_str(patch_text).map_err(|err| format!("Invalid patch text: {err}"))?;
    diffy_apply(original, &patch).map_err(|err| format!("Patch application failed: {err}"))
}

/// Create a unified diff patch representing the difference between `original`
/// and `modified`.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn create_patch(original: &str, modified: &str) -> String {
    diffy_create_patch(original, modified).to_string()
}

/// Apply a sequence of patches to base content, returning the content at the
/// target version. This avoids N WASM boundary crossings by performing all
/// patch applications in a single Rust call.
///
/// `patches_json` is a JSON array of patch strings: `["patch1", "patch2", ...]`.
/// `target` is the 1-based version to reconstruct (0 returns `base` unchanged).
/// If `target` exceeds the number of patches, all patches are applied.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn reconstruct_version(base: &str, patches_json: &str, target: u32) -> Result<String, String> {
    if target == 0 {
        return Ok(base.to_string());
    }

    let patches: Vec<String> =
        serde_json::from_str(patches_json).map_err(|e| format!("Invalid patches JSON: {e}"))?;

    let limit = (target as usize).min(patches.len());
    let mut content = base.to_string();

    for (i, patch_text) in patches.iter().take(limit).enumerate() {
        content = apply_patch(&content, patch_text)
            .map_err(|e| format!("Patch {} failed: {e}", i + 1))?;
    }

    Ok(content)
}

/// Native-friendly version of [`reconstruct_version`] that accepts a slice
/// directly instead of JSON. Use this from Rust consumers; the JSON variant
/// is for WASM callers.
pub fn reconstruct_version_native(
    base: &str,
    patches: &[String],
    target: usize,
) -> Result<String, String> {
    if target == 0 {
        return Ok(base.to_string());
    }
    let limit = target.min(patches.len());
    let mut content = base.to_string();
    for (i, patch_text) in patches.iter().take(limit).enumerate() {
        content = apply_patch(&content, patch_text)
            .map_err(|e| format!("Patch {} failed: {e}", i + 1))?;
    }
    Ok(content)
}

/// Native-friendly version of [`squash_patches`] that accepts a slice directly.
pub fn squash_patches_native(base: &str, patches: &[String]) -> Result<String, String> {
    let final_content = reconstruct_version_native(base, patches, patches.len())?;
    Ok(create_patch(base, &final_content))
}

/// Apply all patches sequentially to base content, then produce a single
/// unified diff from the original base to the final state.
///
/// `patches_json` is a JSON array of patch strings: `["patch1", "patch2", ...]`.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn squash_patches(base: &str, patches_json: &str) -> Result<String, String> {
    let patches: Vec<String> =
        serde_json::from_str(patches_json).map_err(|e| format!("Invalid patches JSON: {e}"))?;

    let mut content = base.to_string();
    for (i, patch_text) in patches.iter().enumerate() {
        content = apply_patch(&content, patch_text)
            .map_err(|e| format!("Patch {} failed: {e}", i + 1))?;
    }

    Ok(create_patch(base, &content))
}

// ── Version Diff ──────────────────────────────────────────────

/// Reconstruct two versions and compute a diff between them.
///
/// Returns a JSON string with `fromVersion`, `toVersion`, `addedLines`,
/// `removedLines`, `addedTokens`, `removedTokens`, and `patchText` fields.
/// Matches the TypeScript `VersionDiffSummary` interface.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn diff_versions(
    base: &str,
    patches_json: &str,
    from_version: u32,
    to_version: u32,
) -> Result<String, String> {
    let patches: Vec<String> =
        serde_json::from_str(patches_json).map_err(|e| format!("Invalid patches JSON: {e}"))?;
    let (diff, patch_text) =
        diff_versions_native(base, &patches, from_version as usize, to_version as usize)?;

    Ok(serde_json::json!({
        "fromVersion": from_version,
        "toVersion": to_version,
        "addedLines": diff.added_lines(),
        "removedLines": diff.removed_lines(),
        "addedTokens": diff.added_tokens(),
        "removedTokens": diff.removed_tokens(),
        "patchText": patch_text
    })
    .to_string())
}

/// Native version of [`diff_versions`] that accepts a slice and returns a struct.
pub fn diff_versions_native(
    base: &str,
    patches: &[String],
    from_version: usize,
    to_version: usize,
) -> Result<(DiffResult, String), String> {
    let from_content = reconstruct_version_native(base, patches, from_version)?;
    let to_content = reconstruct_version_native(base, patches, to_version)?;
    let diff = compute_diff(&from_content, &to_content);
    let patch_text = create_patch(&from_content, &to_content);
    Ok((diff, patch_text))
}

/// Compare multiple versions against a base version in a single call.
///
/// `version_numbers` is a JSON array of version numbers to compare: `[1, 3, 5, 8]`.
/// Each is reconstructed from the patch chain and diffed against `base_version`.
/// Returns a JSON array of diff results.
///
/// This avoids N separate WASM calls and parses the patches JSON once.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn batch_diff_versions(
    base: &str,
    patches_json: &str,
    base_version: u32,
    version_numbers_json: &str,
) -> Result<String, String> {
    let patches: Vec<String> =
        serde_json::from_str(patches_json).map_err(|e| format!("Invalid patches JSON: {e}"))?;
    let version_numbers: Vec<u32> = serde_json::from_str(version_numbers_json)
        .map_err(|e| format!("Invalid version numbers JSON: {e}"))?;

    let base_content = reconstruct_version_native(base, &patches, base_version as usize)?;
    let mut results = Vec::new();

    for &ver in &version_numbers {
        if ver == base_version {
            continue;
        }
        let ver_content = reconstruct_version_native(base, &patches, ver as usize)?;
        let diff = compute_diff(&base_content, &ver_content);
        let patch_text = create_patch(&base_content, &ver_content);

        results.push(serde_json::json!({
            "fromVersion": base_version,
            "toVersion": ver,
            "addedLines": diff.added_lines(),
            "removedLines": diff.removed_lines(),
            "addedTokens": diff.added_tokens(),
            "removedTokens": diff.removed_tokens(),
            "patchText": patch_text,
        }));
    }

    serde_json::to_string(&results).map_err(|e| format!("Serialization failed: {e}"))
}

// ── Section Change Detection ──────────────────────────────────

/// Split content into sections keyed by their heading name.
/// Lines before the first heading go under "".
fn sections_map(content: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut current_heading = String::new();
    let mut current_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            // Save previous section
            if !current_lines.is_empty() || !current_heading.is_empty() {
                map.insert(current_heading.clone(), current_lines.join("\n"));
            }
            current_heading = trimmed.trim_start_matches('#').trim().to_string();
            current_lines = Vec::new();
        } else {
            current_lines.push(line);
        }
    }
    // Save last section
    map.insert(current_heading, current_lines.join("\n"));
    map
}

/// Compute which markdown sections were modified between two document versions.
///
/// Returns a JSON array of section heading names that changed.
/// Detects added, removed, and modified sections.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compute_sections_modified(old_content: &str, new_content: &str) -> String {
    let result = compute_sections_modified_native(old_content, new_content);
    serde_json::to_string(&result).unwrap_or_else(|_| "[]".to_string())
}

/// Native version returning a `Vec<String>` of modified section names.
pub fn compute_sections_modified_native(old_content: &str, new_content: &str) -> Vec<String> {
    let old_sections = sections_map(old_content);
    let new_sections = sections_map(new_content);

    let mut modified = Vec::new();

    // Check for modified or removed sections
    for (name, old_body) in &old_sections {
        match new_sections.get(name) {
            Some(new_body) if new_body != old_body => {
                if !name.is_empty() {
                    modified.push(name.clone());
                }
            }
            None => {
                if !name.is_empty() {
                    modified.push(name.clone());
                }
            }
            _ => {}
        }
    }

    // Check for new sections
    for name in new_sections.keys() {
        if !name.is_empty() && !old_sections.contains_key(name) {
            modified.push(name.clone());
        }
    }

    modified.sort();
    modified
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_and_apply_patch() {
        let original = "Hello world. This is a test.\n";
        let modified = "Hello beautiful world. This is an awesome test.\n";

        let patch = create_patch(original, modified);
        assert!(patch.contains("@@"));

        let applied = apply_patch(original, &patch).expect("patch should apply");
        assert_eq!(applied, modified);
    }

    #[test]
    fn test_apply_invalid_patch() {
        let result = apply_patch("Hello world\n", "@@ invalid patch format @@");
        assert!(result.is_err());
    }

    #[test]
    fn test_reconstruct_version_zero_returns_base() {
        let base = "Hello world\n";
        let result = reconstruct_version(base, "[]", 0).unwrap();
        assert_eq!(result, base);
    }

    #[test]
    fn test_reconstruct_version_applies_patches() {
        let v0 = "line 1\n";
        let v1 = "line 1\nline 2\n";
        let v2 = "line 1\nline 2\nline 3\n";

        let p1 = create_patch(v0, v1);
        let p2 = create_patch(v1, v2);
        let patches_json = serde_json::to_string(&vec![p1, p2]).unwrap();

        let at_v1 = reconstruct_version(v0, &patches_json, 1).unwrap();
        assert_eq!(at_v1, v1);

        let at_v2 = reconstruct_version(v0, &patches_json, 2).unwrap();
        assert_eq!(at_v2, v2);
    }

    #[test]
    fn test_squash_patches_produces_single_diff() {
        let v0 = "line 1\n";
        let v1 = "line 1\nline 2\n";
        let v2 = "line 1\nline 2\nline 3\n";

        let p1 = create_patch(v0, v1);
        let p2 = create_patch(v1, v2);
        let patches_json = serde_json::to_string(&vec![p1, p2]).unwrap();

        let squashed = squash_patches(v0, &patches_json).unwrap();
        let result = apply_patch(v0, &squashed).unwrap();
        assert_eq!(result, v2);
    }

    #[test]
    fn test_reconstruct_version_native() {
        let v0 = "line 1\n";
        let v1 = "line 1\nline 2\n";
        let v2 = "line 1\nline 2\nline 3\n";

        let patches = vec![create_patch(v0, v1), create_patch(v1, v2)];
        let at_v2 = reconstruct_version_native(v0, &patches, 2).unwrap();
        assert_eq!(at_v2, v2);
    }

    #[test]
    fn test_squash_patches_native() {
        let v0 = "line 1\n";
        let v1 = "line 1\nline 2\n";
        let v2 = "line 1\nline 2\nline 3\n";

        let patches = vec![create_patch(v0, v1), create_patch(v1, v2)];
        let squashed = squash_patches_native(v0, &patches).unwrap();
        let result = apply_patch(v0, &squashed).unwrap();
        assert_eq!(result, v2);
    }

    #[test]
    fn test_apply_conflicting_patch() {
        let original = "Hello world. This is a test.\n";
        let modified = "Hello beautiful world. This is an awesome test.\n";
        let patch = create_patch(original, modified);

        let result = apply_patch("Completely different text\n", &patch);
        assert!(result.is_err());
    }

    #[test]
    fn test_diff_versions() {
        let v0 = "line 1\n";
        let v1 = "line 1\nline 2\n";
        let v2 = "line 1\nline 2\nline 3\n";

        let p1 = create_patch(v0, v1);
        let p2 = create_patch(v1, v2);
        let patches_json = serde_json::to_string(&vec![p1, p2]).unwrap();

        let result_json = diff_versions(v0, &patches_json, 0, 2).unwrap();
        let result: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        assert_eq!(result["fromVersion"], 0);
        assert_eq!(result["toVersion"], 2);
        assert_eq!(result["addedLines"], 2);
        assert_eq!(result["removedLines"], 0);
    }

    #[test]
    fn test_diff_versions_between_non_zero() {
        let v0 = "line 1\n";
        let v1 = "line 1\nline 2\n";
        let v2 = "line 1\nmodified 2\nline 3\n";

        let p1 = create_patch(v0, v1);
        let p2 = create_patch(v1, v2);
        let patches_json = serde_json::to_string(&vec![p1, p2]).unwrap();

        let result_json = diff_versions(v0, &patches_json, 1, 2).unwrap();
        let result: serde_json::Value = serde_json::from_str(&result_json).unwrap();
        assert_eq!(result["fromVersion"], 1);
        assert_eq!(result["toVersion"], 2);
        // "line 2" removed, "modified 2" and "line 3" added
        assert!(result["addedLines"].as_u64().unwrap() > 0);
    }

    #[test]
    fn test_compute_sections_modified_basic() {
        let old = "# Intro\nHello world\n# Details\nSome details\n";
        let new = "# Intro\nHello world\n# Details\nModified details\n";

        let result = compute_sections_modified_native(old, new);
        assert_eq!(result, vec!["Details"]);
    }

    #[test]
    fn test_compute_sections_modified_new_section() {
        let old = "# Intro\nHello world\n";
        let new = "# Intro\nHello world\n# New Section\nNew content\n";

        let result = compute_sections_modified_native(old, new);
        assert_eq!(result, vec!["New Section"]);
    }

    #[test]
    fn test_compute_sections_modified_removed_section() {
        let old = "# Intro\nHello world\n# ToRemove\nOld content\n";
        let new = "# Intro\nHello world\n";

        let result = compute_sections_modified_native(old, new);
        assert_eq!(result, vec!["ToRemove"]);
    }

    #[test]
    fn test_compute_sections_modified_no_changes() {
        let content = "# Intro\nHello world\n# Details\nSome details\n";
        let result = compute_sections_modified_native(content, content);
        assert!(result.is_empty());
    }

    #[test]
    fn test_compute_sections_modified_wasm_json() {
        let old = "# A\ntext\n# B\ntext\n";
        let new = "# A\nchanged\n# B\ntext\n";
        let json = compute_sections_modified(old, new);
        let result: Vec<String> = serde_json::from_str(&json).unwrap();
        assert_eq!(result, vec!["A"]);
    }
}
