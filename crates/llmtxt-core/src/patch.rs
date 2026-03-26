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
    fn test_apply_conflicting_patch() {
        let original = "Hello world. This is a test.\n";
        let modified = "Hello beautiful world. This is an awesome test.\n";
        let patch = create_patch(original, modified);

        let result = apply_patch("Completely different text\n", &patch);
        assert!(result.is_err());
    }
}
