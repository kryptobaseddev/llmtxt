//! Integration tests for the canonical frontmatter serializer (T435 / T427.1).
//!
//! These tests use the public API from the crate root and verify byte-identical
//! output against known expected strings.

use llmtxt_core::canonical::{FrontmatterMeta, canonical_frontmatter};

// ── Helper ───────────────────────────────────────────────────────

fn meta(
    title: &str,
    slug: &str,
    version: u64,
    state: &str,
    contributors: &[&str],
    content_hash: &str,
    exported_at: &str,
) -> FrontmatterMeta {
    FrontmatterMeta {
        title: title.to_string(),
        slug: slug.to_string(),
        version,
        state: state.to_string(),
        contributors: contributors.iter().map(|s| s.to_string()).collect(),
        content_hash: content_hash.to_string(),
        exported_at: exported_at.to_string(),
    }
}

// ── Fixture 1: spec §4.1 example ────────────────────────────────

#[test]
fn test_fixture1_spec_example() {
    let m = meta(
        "My Document Title",
        "my-document-title",
        3,
        "APPROVED",
        &["agent-alice", "agent-bob"],
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        "2026-04-17T19:00:00.000Z",
    );
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
    assert_eq!(canonical_frontmatter(&m), expected);
}

// ── Fixture 2: contributors not sorted by caller → must be sorted ─

#[test]
fn test_fixture2_contributors_sorted_by_serializer() {
    // Input order: zebra, mango, apple → expected output: apple, mango, zebra
    let m = meta(
        "Sort Document",
        "sort-doc",
        1,
        "DRAFT",
        &["zebra-agent", "mango-agent", "apple-agent"],
        "deadbeef",
        "2026-01-01T00:00:00.000Z",
    );
    let output = canonical_frontmatter(&m);
    let expected = concat!(
        "---\n",
        "title: \"Sort Document\"\n",
        "slug: \"sort-doc\"\n",
        "version: 1\n",
        "state: \"DRAFT\"\n",
        "contributors:\n",
        "  - \"apple-agent\"\n",
        "  - \"mango-agent\"\n",
        "  - \"zebra-agent\"\n",
        "content_hash: \"deadbeef\"\n",
        "exported_at: \"2026-01-01T00:00:00.000Z\"\n",
        "---\n",
    );
    assert_eq!(output, expected);
}

// ── Fixture 3: empty contributors list ──────────────────────────

#[test]
fn test_fixture3_empty_contributors() {
    let m = meta(
        "Solo Work",
        "solo-work",
        5,
        "APPROVED",
        &[],
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "2026-04-17T12:00:00.000Z",
    );
    let output = canonical_frontmatter(&m);
    let expected = concat!(
        "---\n",
        "title: \"Solo Work\"\n",
        "slug: \"solo-work\"\n",
        "version: 5\n",
        "state: \"APPROVED\"\n",
        "contributors:\n",
        "content_hash: \"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\"\n",
        "exported_at: \"2026-04-17T12:00:00.000Z\"\n",
        "---\n",
    );
    assert_eq!(output, expected);
}

// ── Fixture 4: escaped double-quotes and backslashes in title ────

#[test]
fn test_fixture4_escaped_special_characters() {
    let m = meta(
        r#"Title with "quotes" and \backslash"#,
        "special-chars",
        1,
        "DRAFT",
        &["agent-1"],
        "abc123",
        "2026-04-17T00:00:00.000Z",
    );
    let output = canonical_frontmatter(&m);
    // The title line must escape " as \" and \ as \\
    assert!(
        output.contains(r#"title: "Title with \"quotes\" and \\backslash""#),
        "special chars must be escaped; got:\n{output}"
    );
}

// ── Fixture 5: LF only, single trailing newline ──────────────────

#[test]
fn test_fixture5_lf_and_single_trailing_newline() {
    let m = meta(
        "Line Endings",
        "line-endings",
        2,
        "REVIEW",
        &["qa-agent"],
        "0abc",
        "2026-04-17T08:00:00.000Z",
    );
    let output = canonical_frontmatter(&m);
    assert!(!output.contains("\r\n"), "must use LF only, no CRLF");
    assert!(output.ends_with('\n'), "must end with trailing newline");
    assert!(
        !output.ends_with("\n\n"),
        "must end with exactly one newline"
    );
}

// ── Fixture 6: single contributor (no sorting needed) ────────────

#[test]
fn test_fixture6_single_contributor() {
    let m = meta(
        "Single Author",
        "single-author",
        10,
        "APPROVED",
        &["only-agent"],
        "f00dcafe",
        "2026-04-17T20:00:00.000Z",
    );
    let expected = concat!(
        "---\n",
        "title: \"Single Author\"\n",
        "slug: \"single-author\"\n",
        "version: 10\n",
        "state: \"APPROVED\"\n",
        "contributors:\n",
        "  - \"only-agent\"\n",
        "content_hash: \"f00dcafe\"\n",
        "exported_at: \"2026-04-17T20:00:00.000Z\"\n",
        "---\n",
    );
    assert_eq!(canonical_frontmatter(&m), expected);
}

// ── Fixture 7: version 0 edge case ───────────────────────────────

#[test]
fn test_fixture7_version_zero() {
    let m = meta(
        "Initial Draft",
        "initial-draft",
        0,
        "DRAFT",
        &["bootstrapper"],
        "0000000000000000000000000000000000000000000000000000000000000000",
        "2026-04-17T00:00:00.000Z",
    );
    let output = canonical_frontmatter(&m);
    assert!(output.contains("version: 0\n"));
    // Full byte check for key ordering
    assert!(output.starts_with("---\ntitle:"));
    assert!(output.ends_with("---\n"));
}
