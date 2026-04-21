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
    let s = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        // Malformed UTF-8 → still treat as plain text, low confidence.
        Err(_) => return plain_text_result(0.3),
    };

    // ── 1. JSON ──────────────────────────────────────────────────────
    let trimmed = s.trim();
    if (trimmed.starts_with('{') || trimmed.starts_with('['))
        && serde_json::from_str::<serde_json::Value>(trimmed).is_ok()
    {
        return ClassificationResult {
            mime_type: "application/json".into(),
            category: ContentCategory::Structured,
            format: ContentFormat::Json,
            confidence: 1.0,
            is_extractable: true,
        };
    }

    // ── 2. Markdown ──────────────────────────────────────────────────
    let md_signals = markdown_signals(s);
    // T814 short-circuit: heading alone is strong unambiguous evidence.
    if md_signals[0] {
        return markdown_result(if md_signals.iter().filter(|&&b| b).count() >= 2 {
            0.9
        } else {
            0.8
        });
    }
    if md_signals.iter().filter(|&&b| b).count() >= SIGNAL_THRESHOLD {
        return markdown_result(0.7);
    }

    // ── 3. Code ──────────────────────────────────────────────────────
    if let Some(code_format) = detect_code_language(s) {
        return code_result(code_format, 0.8);
    }
    let code_signals = code_signals_count(s);
    if code_signals >= SIGNAL_THRESHOLD {
        return code_result(ContentFormat::JavaScript, 0.6);
    }

    // ── 4. Plain text fallback ───────────────────────────────────────
    plain_text_result(0.5)
}

/// Return the 5 markdown signal booleans in T814-compatible order:
/// \[heading, bullet, numbered, fenced, link\].
fn markdown_signals(s: &str) -> [bool; 5] {
    [
        s.lines().any(|l| {
            let t = l.trim_start_matches(' ');
            t.starts_with("# ")
                || t.starts_with("## ")
                || t.starts_with("### ")
                || t.starts_with("#### ")
                || t.starts_with("##### ")
                || t.starts_with("###### ")
        }),
        s.lines()
            .any(|l| l.trim_start().starts_with("- ") || l.trim_start().starts_with("* ")),
        s.lines()
            .any(|l| l.trim_start().starts_with(|c: char| c.is_ascii_digit()) && l.contains(". ")),
        s.contains("```"),
        has_markdown_link(s),
    ]
}

#[allow(clippy::collapsible_if)]
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

/// Tight language detection — looks for unambiguous syntactic markers.
fn detect_code_language(s: &str) -> Option<ContentFormat> {
    // Rust
    if s.contains("fn ") && (s.contains("let ") || s.contains("use ") || s.contains("pub ")) {
        return Some(ContentFormat::Rust);
    }
    // Python
    if s.contains("def ") && (s.contains("    ") || s.contains("import ") || s.contains(":\n")) {
        return Some(ContentFormat::Python);
    }
    // Go
    if s.contains("package ")
        && (s.contains("func ") || s.contains("import (") || s.contains("import \""))
    {
        return Some(ContentFormat::Go);
    }
    // TypeScript (type annotations / interfaces)
    if (s.contains(": string") || s.contains(": number") || s.contains(": boolean"))
        && (s.contains("const ") || s.contains("function ") || s.contains("interface "))
    {
        return Some(ContentFormat::TypeScript);
    }
    // JavaScript (ES module / function)
    if (s.contains("const ") || s.contains("function ") || s.contains("=>"))
        && (s.contains(';') || s.contains('{'))
    {
        return Some(ContentFormat::JavaScript);
    }
    None
}

fn code_signals_count(s: &str) -> usize {
    let signals = [
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
        }),
        s.lines().any(|l| {
            l.trim_end().ends_with('{')
                || l.trim_end().ends_with(';')
                || l.trim_end().ends_with('}')
        }),
        s.lines().any(|l| {
            let t = l.trim_start();
            t.starts_with("if ")
                || t.starts_with("for ")
                || t.starts_with("while ")
                || t.starts_with("return ")
                || t.starts_with("switch ")
        }),
        s.contains("=>"),
        s.contains(": string")
            || s.contains(": number")
            || s.contains(": boolean")
            || s.contains(": int")
            || s.contains(": void")
            || s.contains(": any"),
    ];
    signals.iter().filter(|&&b| b).count()
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

    // ── Markdown ─────────────────────────────────────────────────────
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
        // Bullet + fenced code block = 2-of-5 → markdown (no heading).
        let r = classify_text(b"- item one\n- item two\n\n```\ncode\n```");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn numbered_list_and_link_is_markdown() {
        let r = classify_text(b"1. First\n2. Second\n\nSee [docs](https://docs.example.com)");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    // ── JSON ─────────────────────────────────────────────────────────
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
        // Looks like JSON but doesn't parse → drops to next layer.
        let r = classify_text(b"{not valid json");
        assert_ne!(r.format, ContentFormat::Json);
    }

    // ── Code ─────────────────────────────────────────────────────────
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

    // ── Plain text fallback ──────────────────────────────────────────
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
