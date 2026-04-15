//! URL-safe slug generation.
//!
//! Converts a free-text name into a lowercase, hyphen-separated slug
//! suitable for use in URLs and database keys. Strips non-alphanumeric
//! characters, collapses whitespace into hyphens, and trims leading/trailing
//! hyphens. The output is capped at 80 characters.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Convert a collection or document name to a URL-safe slug.
///
/// Algorithm:
/// 1. Lowercase the input.
/// 2. Strip non-word, non-space, non-hyphen characters.
/// 3. Replace runs of whitespace with a single hyphen.
/// 4. Collapse multiple consecutive hyphens into one.
/// 5. Trim leading and trailing hyphens.
/// 6. Truncate to 80 characters.
///
/// Returns an empty string if the input is empty or produces no slug characters.
///
/// # Examples (TypeScript via WASM)
/// ```ts
/// import { slugify } from 'llmtxt';
/// slugify('Hello World!'); // "hello-world"
/// slugify('  my  doc  '); // "my-doc"
/// slugify('Rust & TypeScript'); // "rust-typescript"
/// ```
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn slugify(name: &str) -> String {
    // Step 1: lowercase
    let lower = name.to_lowercase();

    // Step 2: strip chars that are not word chars, spaces, or hyphens.
    // Word chars = [a-zA-Z0-9_]. We allow hyphens explicitly.
    let stripped: String = lower
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                ' '
            }
        })
        .collect();

    // Step 3+4: split on whitespace, join with hyphens, then collapse multiple hyphens
    let parts: Vec<&str> = stripped.split_whitespace().collect();
    let joined = parts.join("-");

    // Collapse consecutive hyphens
    let mut result = String::with_capacity(joined.len());
    let mut prev_hyphen = false;
    for c in joined.chars() {
        if c == '-' {
            if !prev_hyphen {
                result.push('-');
            }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }

    // Step 5: trim leading/trailing hyphens
    let trimmed = result.trim_matches('-');

    // Step 6: truncate to 80 chars (char boundary safe)
    if trimmed.len() <= 80 {
        trimmed.to_string()
    } else {
        // Truncate at char boundary
        let mut end = 80;
        while !trimmed.is_char_boundary(end) {
            end -= 1;
        }
        trimmed[..end].trim_matches('-').to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("Hello World"), "hello-world");
    }

    #[test]
    fn slugify_special_chars() {
        assert_eq!(slugify("Rust & TypeScript!"), "rust-typescript");
    }

    #[test]
    fn slugify_leading_trailing_spaces() {
        assert_eq!(slugify("  my doc  "), "my-doc");
    }

    #[test]
    fn slugify_multiple_spaces() {
        assert_eq!(slugify("my   big   doc"), "my-big-doc");
    }

    #[test]
    fn slugify_empty() {
        assert_eq!(slugify(""), "");
    }

    #[test]
    fn slugify_only_special_chars() {
        assert_eq!(slugify("!!!"), "");
    }

    #[test]
    fn slugify_numbers() {
        assert_eq!(slugify("My Doc 2024"), "my-doc-2024");
    }

    #[test]
    fn slugify_existing_hyphens() {
        assert_eq!(slugify("my-doc"), "my-doc");
    }

    #[test]
    fn slugify_truncates_at_80() {
        let long = "a".repeat(100);
        let result = slugify(&long);
        assert_eq!(result.len(), 80);
    }

    #[test]
    fn slugify_byte_identity_vs_ts_vec1() {
        // TS: slugify("Hello World") === "hello-world"
        assert_eq!(slugify("Hello World"), "hello-world");
    }

    #[test]
    fn slugify_byte_identity_vs_ts_vec2() {
        // TS: slugify("My Collection 2024") === "my-collection-2024"
        assert_eq!(slugify("My Collection 2024"), "my-collection-2024");
    }

    #[test]
    fn slugify_byte_identity_vs_ts_vec3() {
        // TS: slugify("  LLMtxt  Docs  ") === "llmtxt-docs"
        assert_eq!(slugify("  LLMtxt  Docs  "), "llmtxt-docs");
    }
}
