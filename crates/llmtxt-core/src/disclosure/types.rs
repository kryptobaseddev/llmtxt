//! Shared types for the disclosure module.

use serde::{Deserialize, Serialize};

/// A logical section identified within a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    /// Display title of the section.
    pub title: String,
    /// Nesting depth (0-based).
    pub depth: u32,
    /// 1-based line number where the section begins.
    pub start_line: usize,
    /// 1-based line number where the section ends (inclusive).
    pub end_line: usize,
    /// Estimated token count for the section content.
    pub token_count: u32,
    /// Structural type of the section.
    #[serde(rename = "type")]
    pub section_type: String,
}

/// High-level structural overview of a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOverview {
    /// The detected document format.
    pub format: String,
    /// Total number of lines in the document.
    pub line_count: usize,
    /// Estimated total token count.
    pub token_count: u32,
    /// Ordered list of sections.
    pub sections: Vec<Section>,
    /// Top-level JSON keys (JSON documents only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keys: Option<Vec<JsonKey>>,
    /// Markdown table of contents (markdown documents only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub toc: Option<Vec<TocEntry>>,
}

/// A JSON key with type info and a preview value.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonKey {
    pub key: String,
    #[serde(rename = "type")]
    pub key_type: String,
    pub preview: String,
}

/// A table-of-contents entry for markdown documents.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocEntry {
    pub title: String,
    pub depth: u32,
    pub line: usize,
}

/// A single search match.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// 1-based line number of the matching line.
    pub line: usize,
    /// The full text of the matching line.
    pub content: String,
    /// Lines immediately preceding the match.
    pub context_before: Vec<String>,
    /// Lines immediately following the match.
    pub context_after: Vec<String>,
}

/// Result of extracting a line range from a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineRangeResult {
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
    pub token_count: u32,
    pub total_lines: usize,
    pub total_tokens: u32,
    pub tokens_saved: i64,
}
