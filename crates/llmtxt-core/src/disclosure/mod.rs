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
/// Precedence: JSON (valid parse) → markdown (2+ signals) → code (2+ signals) → text.
/// Matches the TypeScript `detectDocumentFormat` in `disclosure.ts`.
pub fn detect_document_format(content: &str) -> &'static str {
    let trimmed = content.trim();

    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
            return "json";
        }
        // Looks like JSON but has parse errors — check for JSON signals
        let json_signals = [
            content.contains("\":"),
            trimmed.starts_with('{') || trimmed.starts_with('['),
            trimmed.ends_with('}') || trimmed.ends_with(']'),
        ];
        if json_signals.iter().filter(|&&b| b).count() >= 2 {
            return "json";
        }
    }

    let markdown_signals: [bool; 5] = [
        content.lines().any(|l| {
            let t = l.trim_start_matches(' ');
            t.starts_with("# ")
                || t.starts_with("## ")
                || t.starts_with("### ")
                || t.starts_with("#### ")
                || t.starts_with("##### ")
                || t.starts_with("###### ")
        }),
        content
            .lines()
            .any(|l| l.trim_start().starts_with("- ") || l.trim_start().starts_with("* ")),
        content
            .lines()
            .any(|l| l.trim_start().starts_with(|c: char| c.is_ascii_digit()) && l.contains(". ")),
        content.contains("```"),
        has_markdown_link(content),
    ];
    // A heading is strong unambiguous evidence of markdown.
    // Short-circuit before the 2-of-5 count so heading-only docs classify correctly.
    if markdown_signals[0] {
        return "markdown";
    }
    if markdown_signals.iter().filter(|&&b| b).count() >= 2 {
        return "markdown";
    }

    let code_signals: [bool; 5] = [
        content.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("import ")
                || t.starts_with("export ")
                || t.starts_with("const ")
                || t.starts_with("let ")
                || t.starts_with("var ")
                || t.starts_with("function ")
                || t.starts_with("class ")
                || t.starts_with("def ")
                || t.starts_with("fn ")
                || t.starts_with("pub ")
                || t.starts_with("use ")
        }),
        content.lines().any(|l| {
            l.trim_end().ends_with('{')
                || l.trim_end().ends_with(';')
                || l.trim_end().ends_with('}')
        }),
        content.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("if ")
                || t.starts_with("for ")
                || t.starts_with("while ")
                || t.starts_with("return ")
                || t.starts_with("switch ")
        }),
        content.contains("=>"),
        content.contains(": string")
            || content.contains(": number")
            || content.contains(": boolean")
            || content.contains(": int")
            || content.contains(": void")
            || content.contains(": any"),
    ];
    if code_signals.iter().filter(|&&b| b).count() >= 2 {
        return "code";
    }

    "text"
}

fn has_markdown_link(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'['
            && let Some(cb) = bytes[i..].iter().position(|&b| b == b']')
        {
            let j = i + cb;
            if j + 1 < bytes.len() && bytes[j + 1] == b'(' && bytes[j + 1..].contains(&b')') {
                return true;
            }
        }
        i += 1;
    }
    false
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
