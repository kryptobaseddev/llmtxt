//! Progressive disclosure: structural analysis, section extraction,
//! line-range access, content search, and JSONPath queries.
//!
//! Ported from `packages/llmtxt/src/disclosure.ts`.
//!
//! Sub-modules:
//! - `types`    — shared structs (Section, DocumentOverview, etc.)
//! - `markdown` — markdown section parsing
//! - `code`     — code section parsing
//! - `json`     — JSON section parsing
//! - `text`     — plain text section parsing
//! - `search`   — content search
//! - `mod.rs`   — top-level API (detect_document_format, generate_overview, etc.)

pub mod code;
pub mod json;
pub mod jsonpath;
pub mod markdown;
pub mod search;
pub mod section_extract;
pub mod text;
pub mod types;
pub mod wasm_bindings;

#[cfg(test)]
mod tests;

pub use section_extract::get_section;
pub use types::{DocumentOverview, JsonKey, LineRangeResult, SearchResult, Section, TocEntry};

use crate::calculate_tokens;
use code::parse_code_sections;
use json::{extract_json_keys, parse_json_sections};
use jsonpath::resolve_path;
use markdown::{extract_markdown_toc, parse_markdown_sections};
use search::search_content;
use text::parse_text_sections;

// ── Format Detection ───────────────────────────────────────────────

/// Detect the structural format of a document.
///
/// # Back-compat shim (T828 — Wave-2 reroute)
///
/// Prior to Wave-2, this function owned the detection logic inline
/// (heading / bullet / link / code signal counting). As of T828 it
/// delegates to [`crate::classify::classify_content`] and maps the
/// richer [`ContentFormat`](crate::classify::ContentFormat) back to
/// the four legacy string values for `generate_overview` and any
/// external callers.
///
/// Returned values: `"json"`, `"markdown"`, `"code"`, `"text"`.
/// Binary inputs (PDF, PNG, etc.) map to `"text"` — matching the
/// pre-Wave-2 behavior where the string-only `&str` API had no way
/// to represent binary content.
///
/// The Wave-1 T814 heading short-circuit fix is preserved via
/// `classify::heuristic::classify_text`.
pub fn detect_document_format(content: &str) -> &'static str {
    use crate::classify::{ContentFormat, classify_content};
    match classify_content(content.as_bytes()).format {
        ContentFormat::Json => "json",
        ContentFormat::Markdown => "markdown",
        ContentFormat::JavaScript
        | ContentFormat::TypeScript
        | ContentFormat::Python
        | ContentFormat::Rust
        | ContentFormat::Go => "code",
        // PlainText, Unknown, and any binary format map to "text"
        // (back-compat with pre-Wave-2 behavior).
        _ => "text",
    }
}

// ── Line Range Access ──────────────────────────────────────────────

/// Extract a range of lines from a document.
pub fn get_line_range(content: &str, start: usize, end: usize) -> LineRangeResult {
    let lines: Vec<&str> = content.split('\n').collect();
    let total_lines = lines.len();
    let total_tokens = calculate_tokens(content);

    let s = start.max(1).min(total_lines);
    let e = end.max(s).min(total_lines);

    let selected = lines[s - 1..e].join("\n");
    let selected_tokens = calculate_tokens(&selected);

    LineRangeResult {
        start_line: s,
        end_line: e,
        content: selected,
        token_count: selected_tokens,
        total_lines,
        total_tokens,
        tokens_saved: total_tokens as i64 - selected_tokens as i64,
    }
}

// ── Document Overview ──────────────────────────────────────────────

/// Generate a structural overview of a document.
pub fn generate_overview(content: &str) -> DocumentOverview {
    let format = detect_document_format(content);
    let lines: Vec<&str> = content.split('\n').collect();
    let line_count = lines.len();
    let token_count = calculate_tokens(content);

    let mut overview = DocumentOverview {
        format: format.to_string(),
        line_count,
        token_count,
        sections: vec![],
        keys: None,
        toc: None,
    };

    match format {
        "json" => {
            overview.sections = parse_json_sections(content, &lines);
            overview.keys = Some(extract_json_keys(content));
        }
        "markdown" => {
            overview.sections = parse_markdown_sections(&lines);
            overview.toc = Some(extract_markdown_toc(&lines));
        }
        "code" => {
            overview.sections = parse_code_sections(&lines);
        }
        _ => {
            overview.sections = parse_text_sections(&lines);
        }
    }

    overview
}

// ── JSONPath Query ─────────────────────────────────────────────────

/// Execute a JSONPath-style query against JSON content.
///
/// Returns JSON with `{ result, tokenCount, path }` or throws on error.
pub fn query_json_path(content: &str, path: &str) -> Result<String, String> {
    let parsed: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("Invalid JSON: {e}"))?;
    let result = resolve_path(&parsed, path)?;
    let result_str = serde_json::to_string_pretty(&result).unwrap_or_default();
    let token_count = calculate_tokens(&result_str);
    let out = serde_json::json!({
        "result": result,
        "tokenCount": token_count,
        "path": path,
    });
    serde_json::to_string(&out).map_err(|e| format!("Serialization: {e}"))
}
