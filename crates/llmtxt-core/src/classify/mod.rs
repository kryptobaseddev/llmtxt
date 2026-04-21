//! Multi-modal document classification.
//!
//! Layered detection: (1) magic-byte sniff via `infer` → (2) text-vs-binary
//! gate via `content_inspector` → (3) heuristic parse for markdown/JSON/code.
//! Returns a rich `ClassificationResult` with MIME type, category, format,
//! confidence, and extractability.
//!
//! Single source of truth for document classification. Back-compat shim
//! `detect_document_format` in `disclosure/mod.rs` re-routes to this module.
//!
//! # Example
//! ```ignore
//! use llmtxt_core::classify::classify_content;
//!
//! let pdf_bytes = b"%PDF-1.7\n...";
//! let result = classify_content(pdf_bytes);
//! assert_eq!(result.mime_type, "application/pdf");
//! ```
//!
//! See `SPEC.md` in this directory for the full design.

mod types;
pub use types::{ClassificationResult, ContentCategory, ContentFormat};

// Layer implementations — each pending a dedicated implement task:
mod magic;
pub use magic::detect_magic;
mod text_gate; // T823 — content_inspector text/binary gate
pub use text_gate::{TextGateResult, inspect_text};
mod heuristic; // T824 — markdown/JSON/code heuristic layer
pub use heuristic::classify_text;

/// Classify a document by layered detection.
///
/// Pipeline:
/// 1. **Magic-byte layer** ([`detect_magic`]): identifies binary formats
///    from their signature. Returns `ClassificationResult` with
///    confidence 1.0 on match.
/// 2. **Text gate** ([`inspect_text`]): when magic misses, tests whether
///    the bytes are valid text (handles UTF-8 / UTF-16 BOMs). If binary
///    with no magic match, returns `Unknown` with confidence 0.2.
/// 3. **Heuristic layer** ([`classify_text`]): if text, parses the
///    content for JSON / markdown / code / plain-text signals.
///
/// # Empty input
/// Returns `Unknown` with confidence 0.0 for zero-byte slices.
///
/// # Never panics
/// This function is total — any byte sequence yields a valid
/// [`ClassificationResult`].
///
/// # Examples
/// ```
/// use llmtxt_core::classify::{classify_content, ContentFormat};
///
/// let result = classify_content(b"# Heading\n\nbody");
/// assert_eq!(result.format, ContentFormat::Markdown);
///
/// let pdf = b"%PDF-1.7\n...";
/// assert_eq!(classify_content(pdf).format, ContentFormat::Pdf);
///
/// let empty = classify_content(&[]);
/// assert_eq!(empty.format, ContentFormat::Unknown);
/// ```
pub fn classify_content(bytes: &[u8]) -> ClassificationResult {
    // Empty input — early return.
    if bytes.is_empty() {
        return ClassificationResult {
            mime_type: "application/octet-stream".into(),
            category: ContentCategory::Unknown,
            format: ContentFormat::Unknown,
            confidence: 0.0,
            is_extractable: false,
        };
    }

    // 1. Magic-byte layer — recognizes 13 binary formats by signature.
    if let Some(result) = detect_magic(bytes) {
        return result;
    }

    // 2. Text gate — is this bytes text at all?
    match inspect_text(bytes) {
        TextGateResult::Empty => ClassificationResult {
            mime_type: "application/octet-stream".into(),
            category: ContentCategory::Unknown,
            format: ContentFormat::Unknown,
            confidence: 0.0,
            is_extractable: false,
        },
        TextGateResult::Binary => ClassificationResult {
            // Unknown binary — no magic match, not text.
            mime_type: "application/octet-stream".into(),
            category: ContentCategory::Binary,
            format: ContentFormat::Unknown,
            confidence: 0.2,
            is_extractable: false,
        },
        TextGateResult::Text {
            bom_stripped_offset,
        } => {
            // 3. Heuristic layer — parses the text to identify format.
            classify_text(&bytes[bom_stripped_offset..])
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Empty input ──────────────────────────────────────────────────
    #[test]
    fn classify_empty_returns_unknown() {
        let r = classify_content(&[]);
        assert_eq!(r.category, ContentCategory::Unknown);
        assert_eq!(r.format, ContentFormat::Unknown);
        assert_eq!(r.confidence, 0.0);
        assert!(!r.is_extractable);
    }

    #[test]
    fn classify_never_panics() {
        // Random bytes — any input must produce a valid result.
        let _ = classify_content(b"anything");
        let _ = classify_content(&[0, 1, 2, 3]);
        let _ = classify_content(&[0xFF; 1024]);
    }

    // ── Binary (magic layer wins) ─────────────────────────────────────
    #[test]
    fn classify_pdf() {
        let r = classify_content(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
        assert_eq!(r.format, ContentFormat::Pdf);
        assert_eq!(r.category, ContentCategory::Binary);
        assert!((r.confidence - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn classify_png() {
        let r = classify_content(b"\x89PNG\r\n\x1a\n");
        assert_eq!(r.format, ContentFormat::Png);
        assert_eq!(r.category, ContentCategory::Binary);
    }

    #[test]
    fn classify_jpeg() {
        let r = classify_content(b"\xFF\xD8\xFF\xE0\x00\x10JFIF");
        assert_eq!(r.format, ContentFormat::Jpeg);
    }

    #[test]
    fn classify_zip() {
        let r = classify_content(b"PK\x03\x04");
        assert_eq!(r.format, ContentFormat::Zip);
    }

    // ── Text (heuristic layer) ────────────────────────────────────────
    #[test]
    fn classify_markdown_heading_only() {
        // T814 regression guard — heading alone → markdown.
        let r = classify_content(b"# H\n## H2\ncontent");
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn classify_json_object() {
        let r = classify_content(b"{\"key\": 42, \"ok\": true}");
        assert_eq!(r.format, ContentFormat::Json);
        assert_eq!(r.category, ContentCategory::Structured);
    }

    #[test]
    fn classify_rust_code() {
        let r = classify_content(b"pub fn main() {\n    let x = 1;\n}");
        assert_eq!(r.format, ContentFormat::Rust);
        assert_eq!(r.category, ContentCategory::Text);
    }

    #[test]
    fn classify_javascript_code() {
        let r = classify_content(b"const x = 1;\nfunction f() { return x; }");
        assert_eq!(r.format, ContentFormat::JavaScript);
    }

    #[test]
    fn classify_plain_text() {
        let r = classify_content(b"just a simple paragraph of prose");
        assert_eq!(r.format, ContentFormat::PlainText);
    }

    // ── BOM handling ──────────────────────────────────────────────────
    #[test]
    fn classify_utf8_bom_markdown() {
        let input = b"\xEF\xBB\xBF# Title\n\nbody";
        let r = classify_content(input);
        assert_eq!(r.format, ContentFormat::Markdown);
    }

    #[test]
    fn classify_utf16_bom_falls_through() {
        // UTF-16 BOM alone without UTF-16 encoded text — text gate may
        // still classify as text; heuristic gets empty string and returns
        // plain text. Either result is acceptable as long as no panic.
        let input = b"\xFF\xFE";
        let _ = classify_content(input);
    }

    // ── Binary without magic match ────────────────────────────────────
    #[test]
    fn classify_binary_without_magic() {
        // Random binary that infer doesn't recognize → unknown binary.
        let r = classify_content(&[0x00, 0x01, 0x02, 0x00, 0xFF, 0xFE, 0xFE, 0xFF, 0x00, 0x00]);
        assert_eq!(r.category, ContentCategory::Binary);
        assert_eq!(r.format, ContentFormat::Unknown);
    }

    // ── JSON is Structured, not Text ─────────────────────────────────
    #[test]
    fn classify_json_category_is_structured() {
        let r = classify_content(b"[1, 2, 3]");
        assert_eq!(r.category, ContentCategory::Structured);
    }

    // ── Magic takes precedence over heuristic ────────────────────────
    #[test]
    fn magic_precedence_over_heuristic() {
        // Construct bytes that LOOK like markdown header but are actually
        // a PNG file. Magic wins.
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        bytes.extend_from_slice(b"# Not actually markdown");
        let r = classify_content(&bytes);
        assert_eq!(r.format, ContentFormat::Png);
    }
}
