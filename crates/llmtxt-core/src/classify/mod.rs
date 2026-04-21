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
// mod magic;         // T822 — infer-based magic-byte layer
// mod text_gate;     // T823 — content_inspector text/binary gate
// mod heuristic;     // T824 — markdown/JSON/code heuristic layer

// Top-level integration — T825 task:
// pub fn classify_content(bytes: &[u8]) -> ClassificationResult { ... }

/// Stub implementation until T825 integrates the layers.
/// Returns `unknown` with confidence 0.0 for any input. Empty slice safe.
///
/// # Panics
/// Never panics, even on zero-byte input (returns unknown with confidence 0).
pub fn classify_content(_bytes: &[u8]) -> ClassificationResult {
    ClassificationResult {
        mime_type: "application/octet-stream".into(),
        category: ContentCategory::Unknown,
        format: ContentFormat::Unknown,
        confidence: 0.0,
        is_extractable: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_empty_bytes_returns_unknown() {
        let result = classify_content(&[]);
        assert_eq!(result.category, ContentCategory::Unknown);
        assert_eq!(result.format, ContentFormat::Unknown);
        assert_eq!(result.confidence, 0.0);
        assert!(!result.is_extractable);
    }

    #[test]
    fn classify_stub_never_panics() {
        // Any input — stub returns safely. Full behavior in T825.
        let _ = classify_content(b"anything");
        let _ = classify_content(&[0, 1, 2, 3]);
        let _ = classify_content(&[0xFF; 1024]);
    }
}
