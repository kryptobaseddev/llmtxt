//! Canonical frontmatter serializer for document export (T427).
//!
//! This module provides the single source of truth for producing a byte-stable,
//! deterministic YAML frontmatter block. The output is consumed both natively
//! and via the WASM binding `canonicalFrontmatter`.
//!
//! # Spec
//! See `docs/specs/ARCH-T427-document-export-ssot.md` §4.1 for the full schema.
//!
//! # Key invariants
//! - Fixed key order: title, slug, version, state, contributors, content_hash, exported_at
//! - Contributors sorted lexicographically *inside* this function (callers MUST NOT pre-sort)
//! - LF (`\n`) line endings only — no CRLF
//! - Single trailing newline after the closing `---` fence
//! - All string values double-quoted
//! - UTF-8 output

use serde::{Deserialize, Serialize};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

/// Structured input for [`canonical_frontmatter`].
///
/// Callers provide this struct; contributors are sorted inside the serializer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontmatterMeta {
    /// Document title (UTF-8, will be double-quoted in output).
    pub title: String,
    /// URL-safe slug.
    pub slug: String,
    /// Integer version number of the exported state.
    pub version: u64,
    /// Lifecycle state string (e.g. `"DRAFT"`, `"APPROVED"`).
    pub state: String,
    /// Agent IDs. Sorted lexicographically by this function before output.
    pub contributors: Vec<String>,
    /// SHA-256 hex of the body content (64 chars, lowercase).
    pub content_hash: String,
    /// ISO 8601 UTC timestamp with millisecond precision (e.g. `"2026-04-17T19:00:00.000Z"`).
    pub exported_at: String,
}

/// Produce the canonical YAML frontmatter block for a document export.
///
/// The output format is:
/// ```text
/// ---
/// title: "..."
/// slug: "..."
/// version: N
/// state: "..."
/// contributors:
///   - "..."
/// content_hash: "..."
/// exported_at: "..."
/// ---
/// ```
///
/// The trailing `---` is followed by a single `\n`.
/// Contributors are sorted lexicographically inside this function.
pub fn canonical_frontmatter(meta: &FrontmatterMeta) -> String {
    let mut sorted_contributors = meta.contributors.clone();
    sorted_contributors.sort();

    let mut out = String::new();

    out.push_str("---\n");
    out.push_str(&format!("title: \"{}\"\n", escape_yaml_string(&meta.title)));
    out.push_str(&format!("slug: \"{}\"\n", escape_yaml_string(&meta.slug)));
    out.push_str(&format!("version: {}\n", meta.version));
    out.push_str(&format!("state: \"{}\"\n", escape_yaml_string(&meta.state)));
    out.push_str("contributors:\n");
    for contributor in &sorted_contributors {
        out.push_str(&format!("  - \"{}\"\n", escape_yaml_string(contributor)));
    }
    out.push_str(&format!(
        "content_hash: \"{}\"\n",
        escape_yaml_string(&meta.content_hash)
    ));
    out.push_str(&format!(
        "exported_at: \"{}\"\n",
        escape_yaml_string(&meta.exported_at)
    ));
    out.push_str("---\n");

    out
}

/// Escape a string value for safe embedding in double-quoted YAML scalars.
///
/// The canonical frontmatter schema uses only double-quoted scalars. The characters
/// that require escaping inside double-quoted YAML are: `\`, `"`, and control
/// characters. This function escapes `\` and `"` (the common cases); control
/// characters should not appear in well-formed document metadata.
fn escape_yaml_string(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

// ── WASM binding ────────────────────────────────────────────────

/// WASM binding for [`canonical_frontmatter`].
///
/// Accepts a JSON-serialised [`FrontmatterMeta`] object.
/// Returns the canonical YAML frontmatter string, or an error message prefixed
/// with `"ERROR: "` if the JSON cannot be parsed.
///
/// # Example (TypeScript)
/// ```typescript
/// import init, { canonicalFrontmatter } from 'llmtxt-core';
/// await init();
/// const yaml = canonicalFrontmatter(JSON.stringify({
///   title: "My Doc",
///   slug: "my-doc",
///   version: 1,
///   state: "DRAFT",
///   contributors: ["bob", "alice"],
///   content_hash: "abc123...",
///   exported_at: "2026-04-17T19:00:00.000Z",
/// }));
/// ```
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = "canonicalFrontmatter"))]
pub fn canonical_frontmatter_wasm(meta_json: &str) -> String {
    match serde_json::from_str::<FrontmatterMeta>(meta_json) {
        Ok(meta) => canonical_frontmatter(&meta),
        Err(e) => format!("ERROR: invalid FrontmatterMeta JSON: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a standard test fixture and return the canonical output.
    fn fixture_standard() -> (&'static str, String) {
        let meta = FrontmatterMeta {
            title: "My Document Title".to_string(),
            slug: "my-document-title".to_string(),
            version: 3,
            state: "APPROVED".to_string(),
            contributors: vec!["agent-bob".to_string(), "agent-alice".to_string()],
            content_hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
                .to_string(),
            exported_at: "2026-04-17T19:00:00.000Z".to_string(),
        };
        let expected = concat!(
            "---\n",
            "title: \"My Document Title\"\n",
            "slug: \"my-document-title\"\n",
            "version: 3\n",
            "state: \"APPROVED\"\n",
            "contributors:\n",
            "  - \"agent-alice\"\n",
            "  - \"agent-bob\"\n",
            "content_hash: \"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824\"\n",
            "exported_at: \"2026-04-17T19:00:00.000Z\"\n",
            "---\n",
        );
        (expected, canonical_frontmatter(&meta))
    }

    // ── Fixture 1: spec example (from §4.1) ─────────────────────

    #[test]
    fn test_spec_example_byte_identical() {
        let (expected, actual) = fixture_standard();
        assert_eq!(
            actual, expected,
            "output must be byte-identical to spec §4.1 example"
        );
    }

    // ── Fixture 2: contributors sorted lexicographically ─────────

    #[test]
    fn test_contributors_sorted_regardless_of_input_order() {
        let meta = FrontmatterMeta {
            title: "Sort Test".to_string(),
            slug: "sort-test".to_string(),
            version: 1,
            state: "DRAFT".to_string(),
            // Deliberately reversed order; output must be alphabetical.
            contributors: vec![
                "zeta-agent".to_string(),
                "alpha-agent".to_string(),
                "beta-agent".to_string(),
            ],
            content_hash: "abc".to_string(),
            exported_at: "2026-01-01T00:00:00.000Z".to_string(),
        };
        let output = canonical_frontmatter(&meta);
        let contrib_start = output
            .find("contributors:\n")
            .expect("contributors key must appear");
        let contrib_section = &output[contrib_start..];
        let mut lines = contrib_section
            .lines()
            .skip(1) // skip "contributors:"
            .take(3) // three entries
            .collect::<Vec<_>>();
        // Strip leading whitespace and dashes for comparison.
        let names: Vec<&str> = lines
            .iter_mut()
            .map(|l| l.trim_start_matches("  - ").trim_matches('"'))
            .collect();
        assert_eq!(names, ["alpha-agent", "beta-agent", "zeta-agent"]);
    }

    // ── Fixture 3: empty contributors list ──────────────────────

    #[test]
    fn test_empty_contributors() {
        let meta = FrontmatterMeta {
            title: "No Contributors".to_string(),
            slug: "no-contributors".to_string(),
            version: 1,
            state: "DRAFT".to_string(),
            contributors: vec![],
            content_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                .to_string(),
            exported_at: "2026-04-17T00:00:00.000Z".to_string(),
        };
        let output = canonical_frontmatter(&meta);
        let expected = concat!(
            "---\n",
            "title: \"No Contributors\"\n",
            "slug: \"no-contributors\"\n",
            "version: 1\n",
            "state: \"DRAFT\"\n",
            "contributors:\n",
            "content_hash: \"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\"\n",
            "exported_at: \"2026-04-17T00:00:00.000Z\"\n",
            "---\n",
        );
        assert_eq!(output, expected);
    }

    // ── Fixture 4: LF line endings and single trailing newline ──

    #[test]
    fn test_lf_line_endings_and_single_trailing_newline() {
        let (_, output) = fixture_standard();
        // Must not contain CRLF.
        assert!(!output.contains("\r\n"), "output must use LF only, no CRLF");
        // Must end with exactly one newline.
        assert!(
            output.ends_with('\n'),
            "output must end with a trailing newline"
        );
        assert!(
            !output.ends_with("\n\n"),
            "output must end with exactly one newline, not two"
        );
    }

    // ── Fixture 5: title with special characters escaped ─────────

    #[test]
    fn test_special_characters_in_title_escaped() {
        let meta = FrontmatterMeta {
            title: "Doc with \"quotes\" and \\backslash".to_string(),
            slug: "doc-with-quotes".to_string(),
            version: 2,
            state: "REVIEW".to_string(),
            contributors: vec!["agent-x".to_string()],
            content_hash: "deadbeef".to_string(),
            exported_at: "2026-04-17T12:00:00.000Z".to_string(),
        };
        let output = canonical_frontmatter(&meta);
        // Verify the title line contains properly escaped YAML.
        assert!(
            output.contains(r#"title: "Doc with \"quotes\" and \\backslash""#),
            "title must have escaped quotes and backslashes; got:\n{output}"
        );
    }

    // ── Fixture 6: version 0 (edge case) ─────────────────────────

    #[test]
    fn test_version_zero() {
        let meta = FrontmatterMeta {
            title: "Initial".to_string(),
            slug: "initial".to_string(),
            version: 0,
            state: "DRAFT".to_string(),
            contributors: vec!["agent-a".to_string()],
            content_hash: "0000".to_string(),
            exported_at: "2026-04-17T00:00:00.000Z".to_string(),
        };
        let output = canonical_frontmatter(&meta);
        assert!(output.contains("version: 0\n"));
    }

    // ── WASM binding round-trip ──────────────────────────────────

    #[test]
    fn test_wasm_binding_round_trip() {
        let json = r#"{
            "title": "WASM Test",
            "slug": "wasm-test",
            "version": 1,
            "state": "DRAFT",
            "contributors": ["carol", "alice", "bob"],
            "content_hash": "abcdef",
            "exported_at": "2026-04-17T10:00:00.000Z"
        }"#;
        let output = canonical_frontmatter_wasm(json);
        // Contributors must be sorted in WASM output too.
        let alice_pos = output.find("alice").expect("alice must appear");
        let bob_pos = output.find("bob").expect("bob must appear");
        let carol_pos = output.find("carol").expect("carol must appear");
        assert!(alice_pos < bob_pos && bob_pos < carol_pos);
        assert!(!output.starts_with("ERROR:"));
    }

    #[test]
    fn test_wasm_binding_invalid_json_returns_error_prefix() {
        let output = canonical_frontmatter_wasm("{not valid json}");
        assert!(
            output.starts_with("ERROR:"),
            "invalid JSON must return ERROR prefix; got: {output}"
        );
    }
}
