use diffy::{Patch, apply as diffy_apply, create_patch as diffy_create_patch};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

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
}
