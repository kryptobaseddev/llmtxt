//! Shared types for the classify module.

use serde::{Deserialize, Serialize};

/// Result of classifying a document.
///
/// Returned by [`classify_content`](super::classify_content).
/// Serializable to JSON for WASM interop.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationResult {
    /// MIME type string (e.g. `application/pdf`, `text/markdown`).
    pub mime_type: String,

    /// High-level category — binary / text / structured / unknown.
    pub category: ContentCategory,

    /// Fine-grained format identifier.
    pub format: ContentFormat,

    /// Confidence of the classification, 0.0..=1.0.
    /// 1.0 = magic-byte match; 0.8 = strong heuristic;
    /// 0.5 = weak heuristic; 0.0 = no signal.
    pub confidence: f32,

    /// Whether the content is text-extractable (true for text formats
    /// and future PDF/OCR; false for raw binary).
    pub is_extractable: bool,
}

/// High-level content category.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContentCategory {
    Binary,
    Text,
    Structured,
    Unknown,
}

/// Fine-grained content format.
///
/// Covers binary multimedia formats, text markup formats, and source-code
/// language families. Extend by adding new variants — downstream callers
/// should handle `Unknown` gracefully.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContentFormat {
    // ── Binary ────────────────────────────────────────────────
    Pdf,
    Png,
    Jpeg,
    Gif,
    Webp,
    Avif,
    Svg,
    Mp4,
    Webm,
    Mp3,
    Wav,
    Ogg,
    Zip,
    // ── Text ──────────────────────────────────────────────────
    Markdown,
    Json,
    JavaScript,
    TypeScript,
    Python,
    Rust,
    Go,
    #[serde(rename = "plainText")]
    PlainText,
    // ── Fallback ──────────────────────────────────────────────
    Unknown,
}
