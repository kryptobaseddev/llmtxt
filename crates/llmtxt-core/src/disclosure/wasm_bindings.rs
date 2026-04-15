//! WASM entry-points for the disclosure module.
//!
//! All public functions here are thin wrappers that serialize/deserialize JSON
//! and delegate to the pure-Rust API in `mod.rs`.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

use super::detect_document_format;
use super::{generate_overview, get_line_range, get_section, query_json_path, search_content};

/// Detect the structural format of a document.
///
/// Returns `"json"`, `"markdown"`, `"code"`, or `"text"`.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn detect_document_format_wasm(content: &str) -> String {
    detect_document_format(content).to_string()
}

/// Generate a structural overview of a document.
///
/// Returns JSON-serialised DocumentOverview, or `{"error":"..."}` on failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn generate_overview_wasm(content: &str) -> String {
    let overview = generate_overview(content);
    serde_json::to_string(&overview)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

/// Extract a line range from a document.
///
/// Returns JSON-serialised LineRangeResult.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn get_line_range_wasm(content: &str, start: u32, end: u32) -> String {
    let result = get_line_range(content, start as usize, end as usize);
    serde_json::to_string(&result)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

/// Search document content.
///
/// Returns JSON array of SearchResult.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn search_content_wasm(
    content: &str,
    query: &str,
    context_lines: u32,
    max_results: u32,
) -> String {
    let results = search_content(content, query, context_lines as usize, max_results as usize);
    serde_json::to_string(&results)
        .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#))
}

/// Execute a JSONPath query against JSON content.
///
/// Returns `{ result, tokenCount, path }` JSON or `{"error":"..."}` on failure.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn query_json_path_wasm(content: &str, path: &str) -> String {
    match query_json_path(content, path) {
        Ok(json) => json,
        Err(e) => format!(r#"{{"error":"JSONPath query failed: {e}"}}"#),
    }
}

/// Extract a named section from a document.
///
/// Returns JSON result or `{"error":"section not found"}` if missing.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn get_section_wasm(content: &str, section_name: &str, depth_all: bool) -> String {
    match get_section(content, section_name, depth_all) {
        Some(v) => serde_json::to_string(&v)
            .unwrap_or_else(|e| format!(r#"{{"error":"Serialization: {e}"}}"#)),
        None => r#"{"error":"section not found"}"#.to_string(),
    }
}
