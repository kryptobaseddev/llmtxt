//! Integration tests for the top-level disclosure API.

use super::{
    detect_document_format, generate_overview, get_line_range, get_section, query_json_path,
};

// ── detect_document_format ─────────────────────────────────────────

#[test]
fn detect_json() {
    assert_eq!(detect_document_format(r#"{"a":1}"#), "json");
    assert_eq!(detect_document_format("[1,2,3]"), "json");
}

#[test]
fn detect_markdown() {
    assert_eq!(detect_document_format("# Title\n- item"), "markdown");
    assert_eq!(detect_document_format("## Heading\n```code```"), "markdown");
}

#[test]
fn detect_text() {
    assert_eq!(detect_document_format("Hello world"), "text");
}

// Byte-identity vectors matching TS detectDocumentFormat
#[test]
fn byte_identity_vec1_json() {
    assert_eq!(detect_document_format(r#"{"key":"value"}"#), "json");
}

#[test]
fn byte_identity_vec2_markdown() {
    assert_eq!(
        detect_document_format("# Installation\n- Step 1\n- Step 2"),
        "markdown"
    );
}

#[test]
fn byte_identity_vec3_text() {
    assert_eq!(detect_document_format("Plain text document."), "text");
}

// ── detect_document_format: markdown threshold (T815) ─────────────

#[test]
fn test_detect_markdown_threshold_heading_only() {
    // Heading-only with body — single heading signal must short-circuit
    assert_eq!(
        detect_document_format("# Title\n## Subtitle\nbody text"),
        "markdown"
    );
}

#[test]
fn test_detect_markdown_threshold_heading_and_code_fence() {
    // Heading + code fence → markdown (heading short-circuit fires)
    assert_eq!(
        detect_document_format("# H\n```rust\nfn main() {}\n```"),
        "markdown"
    );
}

#[test]
fn test_detect_markdown_threshold_heading_and_bullet_list() {
    // Heading + bullet list → markdown
    assert_eq!(
        detect_document_format("# Section\n- item one\n- item two"),
        "markdown"
    );
}

#[test]
fn test_detect_markdown_threshold_link_and_bullet_no_heading() {
    // No heading — link + bullet satisfies old 2-of-5 count path
    assert_eq!(
        detect_document_format("- bullet\n[foo](https://example.com)"),
        "markdown"
    );
}

#[test]
fn test_detect_markdown_threshold_json_unchanged() {
    // JSON still detected before markdown signals are checked
    assert_eq!(detect_document_format(r#"{"key":"value"}"#), "json");
}

#[test]
fn test_detect_markdown_threshold_code_unchanged() {
    // Code detected after markdown — ensure no regression
    assert_eq!(
        detect_document_format("const x = 1;\nif (x) { return x; }"),
        "code"
    );
}

#[test]
fn test_detect_markdown_threshold_plain_text_unchanged() {
    // Plain text with no signals → text
    assert_eq!(detect_document_format("just a paragraph"), "text");
}

#[test]
fn test_detect_markdown_threshold_empty_string() {
    // Empty string → text
    assert_eq!(detect_document_format(""), "text");
}

#[test]
fn test_detect_markdown_threshold_single_char() {
    // Single character → text
    assert_eq!(detect_document_format("a"), "text");
}

// ── get_line_range ─────────────────────────────────────────────────

#[test]
fn line_range_basic() {
    let content = "a\nb\nc\nd\ne";
    let result = get_line_range(content, 2, 4);
    assert_eq!(result.start_line, 2);
    assert_eq!(result.end_line, 4);
    assert_eq!(result.content, "b\nc\nd");
}

#[test]
fn line_range_clamps() {
    let content = "a\nb\nc";
    let result = get_line_range(content, 0, 100);
    assert_eq!(result.start_line, 1);
    assert_eq!(result.end_line, 3);
}

// ── generate_overview ─────────────────────────────────────────────

#[test]
fn overview_markdown() {
    // 2 signals: ATX headings + list items
    let content = "# Title\ncontent\n## Section\n- list item";
    let ov = generate_overview(content);
    assert_eq!(ov.format, "markdown");
    assert_eq!(ov.sections.len(), 2);
    assert!(ov.toc.is_some());
}

#[test]
fn overview_json() {
    let content = r#"{"name":"Alice","age":30}"#;
    let ov = generate_overview(content);
    assert_eq!(ov.format, "json");
    assert!(ov.keys.is_some());
}

#[test]
fn overview_text() {
    let content = "paragraph one\n\nparagraph two";
    let ov = generate_overview(content);
    assert_eq!(ov.format, "text");
    assert_eq!(ov.sections.len(), 2);
}

// ── query_json_path ───────────────────────────────────────────────

#[test]
fn jsonpath_basic() {
    let json = r#"{"a":{"b":42}}"#;
    let result = query_json_path(json, "$.a.b").unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed["result"], 42);
}

#[test]
fn jsonpath_array_index() {
    let json = r#"{"items":[1,2,3]}"#;
    let result = query_json_path(json, "$.items[1]").unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(parsed["result"], 2);
}

#[test]
fn jsonpath_invalid_json() {
    assert!(query_json_path("not json", "$.a").is_err());
}

// ── get_section ───────────────────────────────────────────────────

#[test]
fn get_section_by_exact_name() {
    // 2 signals: ATX headings + list items so format is "markdown"
    let content = "# Introduction\nsome text\n- item\n# Details\nmore text";
    let result = get_section(content, "Introduction", false);
    assert!(result.is_some());
    let v = result.unwrap();
    assert!(v["content"].as_str().unwrap().contains("some text"));
}

#[test]
fn get_section_not_found() {
    let content = "# Title\ntext";
    let result = get_section(content, "NonExistent", false);
    assert!(result.is_none());
}
