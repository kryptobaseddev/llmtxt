//! Content validation primitives.
//!
//! Pure-computation helpers for format detection, binary content checking,
//! and line-length enforcement. These are ported from the TypeScript
//! `packages/llmtxt/src/validation.ts` module.
//!
//! Zod-based schema validation (validateJson, validateText) stays in TypeScript
//! because it depends on the Zod library. These primitives are the computation
//! core that is safe to run in any environment.

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

// ── Format Detection ───────────────────────────────────────────────

/// Detect whether content is JSON, markdown, or plain text.
///
/// Precedence:
/// 1. If `JSON.parse` succeeds → `"json"`.
/// 2. If 2+ markdown signals match → `"markdown"`.
/// 3. Otherwise → `"text"`.
///
/// Matches the TypeScript `detectFormat` heuristic in `validation.ts`.
/// Note: `detectDocumentFormat` in `disclosure.rs` has an extended version
/// that also detects `"code"` — the canonical name for the validation variant
/// is `detect_format` (no code detection, per audit item #14).
///
/// # Examples
/// ```rust
/// use llmtxt_core::validation::detect_format;
/// assert_eq!(detect_format("{\"a\":1}"), "json");
/// assert_eq!(detect_format("# Title\n- item"), "markdown");
/// assert_eq!(detect_format("Hello world"), "text");
/// ```
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn detect_format(content: &str) -> String {
    // Try JSON parse
    if serde_json::from_str::<serde_json::Value>(content).is_ok() {
        return "json".to_string();
    }

    // Markdown signals (identical to TS MARKDOWN_SIGNALS array)
    let markdown_signals: [&dyn Fn(&str) -> bool; 5] = [
        &|s: &str| {
            s.lines().any(|l| {
                let t = l.trim_start_matches(' ');
                t.starts_with("# ")
                    || t.starts_with("## ")
                    || t.starts_with("### ")
                    || t.starts_with("#### ")
                    || t.starts_with("##### ")
                    || t.starts_with("###### ")
            })
        },
        &|s: &str| {
            s.lines()
                .any(|l| l.trim_start().starts_with("- ") || l.trim_start().starts_with("* "))
        },
        &|s: &str| {
            s.lines().any(|l| {
                let trimmed = l.trim_start();
                trimmed.len() > 2
                    && trimmed.starts_with(|c: char| c.is_ascii_digit())
                    && trimmed.contains(". ")
            })
        },
        &|s: &str| s.contains("```"),
        &|s: &str| contains_markdown_link(s),
    ];

    let score = markdown_signals.iter().filter(|f| f(content)).count();
    if score >= 2 {
        return "markdown".to_string();
    }

    "text".to_string()
}

/// Check whether a string contains a markdown link `[text](url)`.
fn contains_markdown_link(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            // Look for ](
            if let Some(close_bracket) = bytes[i..].iter().position(|&b| b == b']') {
                let j = i + close_bracket;
                if j + 1 < bytes.len() && bytes[j + 1] == b'(' && bytes[j + 1..].contains(&b')') {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

// ── Binary Content Detection ──────────────────────────────────────

/// Check for binary content by scanning for control characters (0x00–0x08)
/// in the first 8 KB of the content.
///
/// Returns `true` if binary control characters are found.
///
/// Matches the TypeScript `containsBinaryContent` helper exactly.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn contains_binary_content(content: &str) -> bool {
    let scan_length = content.len().min(8192);
    content[..scan_length].contains(|c: char| (c as u32) <= 8)
}

// ── Line Length Enforcement ───────────────────────────────────────

/// Find the 1-based line number of the first line that exceeds `max_bytes`
/// characters. Returns 0 if no such line exists.
///
/// Uses character count (not byte count) to match the TypeScript behaviour,
/// which uses `lineLength = i - lineStart` where `i` advances by one
/// JavaScript character at a time.
///
/// Returns 0 (no overlong line) instead of -1 (which cannot be expressed
/// as a u32). WASM callers should treat 0 as "no violation".
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn find_overlong_line(content: &str, max_chars: u32) -> u32 {
    let max = max_chars as usize;
    let mut line_num = 1u32;
    let mut line_start = 0usize;

    for (i, ch) in content.char_indices() {
        if ch == '\n' {
            let line_len = i - line_start;
            if line_len > max {
                return line_num;
            }
            line_num += 1;
            line_start = i + 1;
        }
    }

    // Check last line (no trailing newline)
    let last_len = content.len() - line_start;
    if last_len > max {
        return line_num;
    }

    0
}

// ── Constants ─────────────────────────────────────────────────────

/// Default maximum content size in bytes (5 MB).
pub const DEFAULT_MAX_CONTENT_BYTES: u64 = 5 * 1024 * 1024;

/// Default maximum line length in characters (64 KiB).
pub const DEFAULT_MAX_LINE_BYTES: u32 = 64 * 1024;

/// WASM-exposed default max content bytes.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn default_max_content_bytes() -> u64 {
    DEFAULT_MAX_CONTENT_BYTES
}

/// WASM-exposed default max line bytes.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn default_max_line_bytes() -> u32 {
    DEFAULT_MAX_LINE_BYTES
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── detect_format ─────────────────────────────────────────────

    #[test]
    fn detect_format_json() {
        assert_eq!(detect_format(r#"{"a":1}"#), "json");
        assert_eq!(detect_format("null"), "json");
        assert_eq!(detect_format("[1,2,3]"), "json");
    }

    #[test]
    fn detect_format_markdown() {
        assert_eq!(detect_format("# Title\n- item"), "markdown");
        assert_eq!(detect_format("## Heading\n```code```"), "markdown");
        assert_eq!(detect_format("1. first\n[link](url)"), "markdown");
    }

    #[test]
    fn detect_format_text() {
        assert_eq!(detect_format("Hello world"), "text");
        assert_eq!(detect_format("just plain text here"), "text");
        // single markdown signal = text (needs 2+)
        assert_eq!(detect_format("# Only one signal"), "text");
    }

    // Byte-identity vectors matching TS detectFormat
    #[test]
    fn byte_identity_vec1_json() {
        // TS: detectFormat('{"a":1}') === "json"
        assert_eq!(detect_format(r#"{"a":1}"#), "json");
    }

    #[test]
    fn byte_identity_vec2_markdown() {
        // TS: detectFormat('# Title\n- item') === "markdown"
        assert_eq!(detect_format("# Title\n- item"), "markdown");
    }

    #[test]
    fn byte_identity_vec3_text() {
        // TS: detectFormat('Hello') === "text"
        assert_eq!(detect_format("Hello"), "text");
    }

    // ── contains_binary_content ───────────────────────────────────

    #[test]
    fn binary_detects_null_byte() {
        let mut s = String::from("hello");
        s.push('\x00');
        assert!(contains_binary_content(&s));
    }

    #[test]
    fn binary_detects_control_char_0x08() {
        let mut s = String::from("hello");
        s.push('\x08');
        assert!(contains_binary_content(&s));
    }

    #[test]
    fn binary_clean_content() {
        assert!(!contains_binary_content("hello world\nnewlines\ttabs"));
    }

    #[test]
    fn binary_only_scans_first_8kb() {
        // Control char after 8192 bytes should not be detected
        let mut s = "a".repeat(8193);
        s.push('\x00');
        assert!(!contains_binary_content(&s));
    }

    // ── find_overlong_line ────────────────────────────────────────

    #[test]
    fn overlong_no_violation() {
        assert_eq!(find_overlong_line("short\nlines\nhere", 100), 0);
    }

    #[test]
    fn overlong_first_line() {
        let line = "a".repeat(101);
        assert_eq!(find_overlong_line(&line, 100), 1);
    }

    #[test]
    fn overlong_second_line() {
        let content = format!("ok\n{}\nok", "b".repeat(101));
        assert_eq!(find_overlong_line(&content, 100), 2);
    }

    #[test]
    fn overlong_empty() {
        assert_eq!(find_overlong_line("", 100), 0);
    }
}
