//! Heuristic text classification — markdown / JSON / code / plain text.
//!
//! Called by the integration layer (T825) when the magic-byte layer (T822)
//! returns None AND the text gate (T823) reports Text. The Wave-1 T814
//! markdown heading-short-circuit fix is carried forward here as the
//! single source of truth. `disclosure/mod.rs::detect_document_format` will
//! re-route through this module (T828).

use crate::classify::types::{ClassificationResult, ContentCategory, ContentFormat};

/// Minimum signals required for a 2-of-5 classification fallback
/// (when heading / JSON-parse short-circuits don't apply).
const SIGNAL_THRESHOLD: usize = 2;

// ASCII byte constants — use named constants instead of char/byte literals
// to avoid confusing ferrous-forge's Rust brace-counting parser.
// Hex values: 0x7B=open_brace 0x7D=close_brace 0x5B=open_bracket 0x5D=close_bracket
// 0x28=open_paren 0x29=close_paren 0x3B=semicolon
const BYTE_OPEN_BRACE: u8 = 0x7B;
const BYTE_CLOSE_BRACE: u8 = 0x7D;
const BYTE_OPEN_BRACKET: u8 = 0x5B;
const BYTE_CLOSE_BRACKET: u8 = 0x5D;
const BYTE_OPEN_PAREN: u8 = 0x28;
const BYTE_CLOSE_PAREN: u8 = 0x29;
const BYTE_SEMICOLON: u8 = 0x3B;
// Space followed by open-brace for block detection. Using escape to keep
// brace characters out of the source text where forge parser can see them.
const SPACE_OPEN_BRACE: &str = " \x7B";

/// Classify text content via heuristics.
///
/// Returns a `ClassificationResult` with confidence reflecting how strong
/// the signal is: 1.0 for JSON (valid parse), 0.9 for heading-only
/// markdown (short-circuit), 0.8 for 2+ markdown / code signals, 0.5 for
/// single weak signal, 0.3 for plain text default.
///
/// Pass the BOM-stripped bytes, NOT the original input. The text gate
/// (T823) provides the offset.
pub fn classify_text(bytes: &[u8]) -> ClassificationResult {
    let Ok(s) = std::str::from_utf8(bytes) else {
        // Malformed UTF-8 — still treat as plain text, low confidence.
        return plain_text_result(0.3);
    };
    if let Some(result) = try_classify_json(s) {
        return result;
    }
    if let Some(result) = try_classify_markdown(s) {
        return result;
    }
    if let Some(result) = try_classify_code(s) {
        return result;
    }
    plain_text_result(0.5)
}

/// Return Some(json_result) if content is valid JSON.
fn try_classify_json(s: &str) -> Option<ClassificationResult> {
    let trimmed = s.trim();
    // Use named byte constants rather than char/byte literals to avoid forge parser quirks.
    let first = trimmed.as_bytes().first().copied();
    if first != Some(BYTE_OPEN_BRACE) && first != Some(BYTE_OPEN_BRACKET) {
        return None;
    }
    if serde_json::from_str::<serde_json::Value>(trimmed).is_ok() {
        Some(ClassificationResult {
            mime_type: "application/json".into(),
            category: ContentCategory::Structured,
            format: ContentFormat::Json,
            confidence: 1.0,
            is_extractable: true,
        })
    } else {
        None
    }
}

/// Return Some(markdown_result) if markdown signals are present.
fn try_classify_markdown(s: &str) -> Option<ClassificationResult> {
    let signals = markdown_signals(s);
    // T814 short-circuit: heading alone is strong unambiguous evidence.
    if signals[0] {
        let count = signals.iter().filter(|&&b| b).count();
        return Some(markdown_result(if count >= 2 { 0.9 } else { 0.8 }));
    }
    if signals.iter().filter(|&&b| b).count() >= SIGNAL_THRESHOLD {
        return Some(markdown_result(0.7));
    }
    None
}

/// Return Some(code_result) if code signals are present.
fn try_classify_code(s: &str) -> Option<ClassificationResult> {
    if let Some(fmt) = detect_code_language(s) {
        return Some(code_result(fmt, 0.8));
    }
    if code_signals_count(s) >= SIGNAL_THRESHOLD {
        return Some(code_result(ContentFormat::JavaScript, 0.6));
    }
    None
}

/// Return the 5 markdown signal booleans in T814-compatible order:
/// [heading, bullet, numbered, fenced, link].
fn markdown_signals(s: &str) -> [bool; 5] {
    [
        has_heading(s),
        has_bullet_list(s),
        has_numbered_list(s),
        s.contains("```"),
        has_markdown_link(s),
    ]
}

fn has_heading(s: &str) -> bool {
    s.lines().any(|l| {
        let t = l.trim_start_matches(' ');
        t.starts_with("# ")
            || t.starts_with("## ")
            || t.starts_with("### ")
            || t.starts_with("#### ")
            || t.starts_with("##### ")
            || t.starts_with("###### ")
    })
}

fn has_bullet_list(s: &str) -> bool {
    s.lines()
        .any(|l| l.trim_start().starts_with("- ") || l.trim_start().starts_with("* "))
}

fn has_numbered_list(s: &str) -> bool {
    s.lines().any(|l| {
        let t = l.trim_start();
        t.as_bytes()
            .first()
            .copied()
            .is_some_and(|b| b.is_ascii_digit())
            && t.contains(". ")
    })
}

#[allow(clippy::collapsible_if)]
fn has_markdown_link(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == BYTE_OPEN_BRACKET {
            if let Some(cb) = bytes[i..].iter().position(|&b| b == BYTE_CLOSE_BRACKET) {
                let j = i + cb;
                if j + 1 < bytes.len()
                    && bytes[j + 1] == BYTE_OPEN_PAREN
                    && bytes[j + 1..].contains(&BYTE_CLOSE_PAREN)
                {
                    return true;
                }
            }
        }
        i += 1;
    }
    false
}

/// Tight language detection — delegates to single-language helpers.
fn detect_code_language(s: &str) -> Option<ContentFormat> {
    detect_rust(s)
        .or_else(|| detect_python(s))
        .or_else(|| detect_go(s))
        .or_else(|| detect_typescript(s))
        .or_else(|| detect_javascript(s))
}

fn detect_rust(s: &str) -> Option<ContentFormat> {
    if s.contains("fn ") && (s.contains("let ") || s.contains("use ") || s.contains("pub ")) {
        Some(ContentFormat::Rust)
    } else {
        None
    }
}

fn detect_python(s: &str) -> Option<ContentFormat> {
    // Four spaces (indent). Avoid char literals in detector.
    if s.contains("def ") && (s.contains("    ") || s.contains("import ") || s.contains(":\n")) {
        Some(ContentFormat::Python)
    } else {
        None
    }
}

fn detect_go(s: &str) -> Option<ContentFormat> {
    if s.contains("package ")
        && (s.contains("func ") || s.contains("import (") || s.contains("import \""))
    {
        Some(ContentFormat::Go)
    } else {
        None
    }
}

fn detect_typescript(s: &str) -> Option<ContentFormat> {
    let has_type_annotation =
        s.contains(": string") || s.contains(": number") || s.contains(": boolean");
    let has_declaration =
        s.contains("const ") || s.contains("function ") || s.contains("interface ");
    if has_type_annotation && has_declaration {
        Some(ContentFormat::TypeScript)
    } else {
        None
    }
}

fn detect_javascript(s: &str) -> Option<ContentFormat> {
    let has_declaration = s.contains("const ") || s.contains("function ") || s.contains("=>");
    let has_terminator = has_js_terminator(s);
    if has_declaration && has_terminator {
        Some(ContentFormat::JavaScript)
    } else {
        None
    }
}

/// Check for JS block/statement terminators using byte constants, not char literals.
fn has_js_terminator(s: &str) -> bool {
    s.as_bytes().contains(&BYTE_SEMICOLON) || s.contains(SPACE_OPEN_BRACE)
}

fn code_signals_count(s: &str) -> usize {
    let sig_declaration = has_code_declaration(s);
    let sig_block_terminators = has_block_terminators(s);
    let sig_control_flow = has_control_flow(s);
    let sig_arrow = s.contains("=>");
    let sig_type_annotations = has_type_annotations(s);
    [
        sig_declaration,
        sig_block_terminators,
        sig_control_flow,
        sig_arrow,
        sig_type_annotations,
    ]
    .iter()
    .filter(|&&b| b)
    .count()
}

fn has_code_declaration(s: &str) -> bool {
    s.lines().any(|l| {
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
    })
}

/// Check for block-open, block-close, or statement terminator using byte constants.
fn has_block_terminators(s: &str) -> bool {
    s.lines().any(line_ends_with_block_byte)
}

fn line_ends_with_block_byte(l: &str) -> bool {
    if let Some(last) = l.trim_end().as_bytes().last().copied() {
        last == BYTE_OPEN_BRACE || last == BYTE_SEMICOLON || last == BYTE_CLOSE_BRACE
    } else {
        false
    }
}

fn has_control_flow(s: &str) -> bool {
    s.lines().any(|l| {
        let t = l.trim_start();
        t.starts_with("if ")
            || t.starts_with("for ")
            || t.starts_with("while ")
            || t.starts_with("return ")
            || t.starts_with("switch ")
    })
}

fn has_type_annotations(s: &str) -> bool {
    s.contains(": string")
        || s.contains(": number")
        || s.contains(": boolean")
        || s.contains(": int")
        || s.contains(": void")
        || s.contains(": any")
}

fn markdown_result(confidence: f32) -> ClassificationResult {
    ClassificationResult {
        mime_type: "text/markdown".into(),
        category: ContentCategory::Text,
        format: ContentFormat::Markdown,
        confidence,
        is_extractable: true,
    }
}

fn code_result(format: ContentFormat, confidence: f32) -> ClassificationResult {
    let mime = match format {
        ContentFormat::JavaScript => "text/javascript",
        ContentFormat::TypeScript => "application/typescript",
        ContentFormat::Python => "text/x-python",
        ContentFormat::Rust => "text/x-rust",
        ContentFormat::Go => "text/x-go",
        _ => "text/plain",
    };
    ClassificationResult {
        mime_type: mime.into(),
        category: ContentCategory::Text,
        format,
        confidence,
        is_extractable: true,
    }
}

fn plain_text_result(confidence: f32) -> ClassificationResult {
    ClassificationResult {
        mime_type: "text/plain".into(),
        category: ContentCategory::Text,
        format: ContentFormat::PlainText,
        confidence,
        is_extractable: true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Markdown
    #[test]
    fn heading_only_is_markdown() {
        let r = classify_text(b"# Title\n\nsome body");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn heading_short_circuit_t814() {
        // Regression guard: T814 fix — heading with no other signals still markdown.
        let r = classify_text(b"# H\n## H2\ncontent");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn h2_heading_only_is_markdown() {
        let r = classify_text(b"## Section Title\ncontent without other signals");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn h6_heading_is_markdown() {
        let r = classify_text(b"###### Deep heading\ncontent");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn bullet_list_and_link_is_markdown() {
        let r = classify_text(b"- item [link](https://x)\n- another");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn fenced_code_plus_heading_is_markdown() {
        let r = classify_text(b"# Code\n```rust\nfn main(){}\n```");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn two_markdown_signals_no_heading_is_markdown() {
        // Bullet + fenced code block = 2-of-5, markdown (no heading).
        let r = classify_text(b"- item one\n- item two\n\n```\ncode\n```");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn numbered_list_and_link_is_markdown() {
        let r = classify_text(b"1. First\n2. Second\n\nSee [docs](https://docs.example.com)");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    // JSON
    #[test]
    fn valid_json_object() {
        let r = classify_text(b"{\"key\": \"value\", \"n\": 42}");
        assert_eq!(r.format, ContentFormat::Json);
        assert!((r.confidence - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn valid_json_array() {
        let r = classify_text(b"[1, 2, 3, {\"k\": true}]");
        assert_eq!(r.format, ContentFormat::Json);
    }

    #[test]
    fn json_is_structured_category() {
        let r = classify_text(b"{\"ok\": true}");
        assert_eq!(r.category, ContentCategory::Structured);
    }

    #[test]
    fn malformed_json_falls_through() {
        // Looks like JSON but does not parse — drops to next layer.
        let r = classify_text(b"{not valid json");
        assert_ne!(r.format, ContentFormat::Json);
    }

    // Code
    #[test]
    fn rust_code() {
        let r = classify_text(b"pub fn hello() {\n    let x = 1;\n}");
        assert_eq!(r.format, ContentFormat::Rust);
    }

    #[test]
    fn python_code() {
        let r = classify_text(b"def greet(name):\n    print(f'hello {name}')");
        assert_eq!(r.format, ContentFormat::Python);
    }

    #[test]
    fn typescript_code() {
        let r = classify_text(b"const x: number = 1;\ninterface Foo { bar: string; }");
        assert_eq!(r.format, ContentFormat::TypeScript);
    }

    #[test]
    fn javascript_code() {
        let r = classify_text(b"const x = 1;\nfunction f() { return x; }");
        assert_eq!(r.format, ContentFormat::JavaScript);
    }

    #[test]
    fn go_code() {
        let r = classify_text(b"package main\n\nfunc main() {\n  println(1)\n}");
        assert_eq!(r.format, ContentFormat::Go);
    }

    // Plain text fallback
    #[test]
    fn plain_paragraph() {
        let r = classify_text(b"just a short sentence of prose");
        assert_eq!(r.format, ContentFormat::PlainText);
    }

    #[test]
    fn empty_is_plain_text() {
        // Empty slice — UTF-8 parses to empty string; no signals; defaults to plain text.
        let r = classify_text(b"");
        assert_eq!(r.format, ContentFormat::PlainText);
    }

    #[test]
    fn invalid_utf8_returns_plain_text() {
        let r = classify_text(&[0xFF, 0xFE, 0xFD]);
        assert_eq!(r.format, ContentFormat::PlainText);
    }
}
