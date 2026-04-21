//! Magic-byte detection layer.
//!
//! Wraps the `infer` crate to identify binary formats by their magic-number
//! signature. Pure function; no I/O; no allocations beyond returned types.
//! Returns `None` when `infer` doesn't recognize the bytes (caller falls
//! through to the text gate).

use crate::classify::types::{ClassificationResult, ContentCategory, ContentFormat};

/// Detect a binary format from magic bytes.
///
/// Returns `Some(ClassificationResult)` for recognized formats, `None`
/// otherwise. Confidence is always 1.0 for a positive magic-byte match.
///
/// # Examples
/// ```ignore
/// // PDF header
/// let bytes = b"%PDF-1.7\n";
/// let result = detect_magic(bytes).unwrap();
/// assert_eq!(result.format, ContentFormat::Pdf);
/// assert_eq!(result.confidence, 1.0);
/// ```
pub fn detect_magic(bytes: &[u8]) -> Option<ClassificationResult> {
    if bytes.is_empty() {
        return None;
    }
    let kind = infer::get(bytes)?;
    let mime = kind.mime_type().to_string();
    let format = map_mime_to_format(&mime);
    Some(ClassificationResult {
        mime_type: mime,
        category: category_for_format(format),
        format,
        confidence: 1.0,
        is_extractable: is_extractable(format),
    })
}

fn map_mime_to_format(mime: &str) -> ContentFormat {
    match mime {
        "application/pdf" => ContentFormat::Pdf,
        "image/png" => ContentFormat::Png,
        "image/jpeg" => ContentFormat::Jpeg,
        "image/gif" => ContentFormat::Gif,
        "image/webp" => ContentFormat::Webp,
        "image/avif" => ContentFormat::Avif,
        "image/svg+xml" => ContentFormat::Svg,
        "video/mp4" => ContentFormat::Mp4,
        "video/webm" => ContentFormat::Webm,
        "audio/mpeg" => ContentFormat::Mp3,
        "audio/wav" | "audio/x-wav" => ContentFormat::Wav,
        "audio/ogg" | "application/ogg" => ContentFormat::Ogg,
        "application/zip" => ContentFormat::Zip,
        _ => ContentFormat::Unknown,
    }
}

fn category_for_format(format: ContentFormat) -> ContentCategory {
    match format {
        ContentFormat::Markdown
        | ContentFormat::Json
        | ContentFormat::JavaScript
        | ContentFormat::TypeScript
        | ContentFormat::Python
        | ContentFormat::Rust
        | ContentFormat::Go
        | ContentFormat::PlainText => ContentCategory::Text,
        ContentFormat::Svg => ContentCategory::Text, // SVG is XML text
        ContentFormat::Unknown => ContentCategory::Unknown,
        _ => ContentCategory::Binary,
    }
}

fn is_extractable(format: ContentFormat) -> bool {
    matches!(
        format,
        ContentFormat::Markdown
            | ContentFormat::Json
            | ContentFormat::JavaScript
            | ContentFormat::TypeScript
            | ContentFormat::Python
            | ContentFormat::Rust
            | ContentFormat::Go
            | ContentFormat::PlainText
            | ContentFormat::Svg
            | ContentFormat::Pdf // future OCR / text extraction — scope noted
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_pdf() {
        let r = detect_magic(b"%PDF-1.7\n...").unwrap();
        assert_eq!(r.format, ContentFormat::Pdf);
        assert_eq!(r.mime_type, "application/pdf");
        assert_eq!(r.category, ContentCategory::Binary);
        assert!((r.confidence - 1.0).abs() < f32::EPSILON);
        assert!(r.is_extractable);
    }

    #[test]
    fn detect_png() {
        let png_magic = b"\x89PNG\r\n\x1a\n";
        let r = detect_magic(png_magic).unwrap();
        assert_eq!(r.format, ContentFormat::Png);
        assert_eq!(r.mime_type, "image/png");
        assert!(!r.is_extractable);
    }

    #[test]
    fn detect_jpeg() {
        let jpeg_magic = b"\xFF\xD8\xFF\xE0\x00\x10JFIF";
        let r = detect_magic(jpeg_magic).unwrap();
        assert_eq!(r.format, ContentFormat::Jpeg);
    }

    #[test]
    fn detect_gif() {
        let r = detect_magic(b"GIF89a").unwrap();
        assert_eq!(r.format, ContentFormat::Gif);
    }

    #[test]
    fn detect_zip() {
        let r = detect_magic(b"PK\x03\x04").unwrap();
        assert_eq!(r.format, ContentFormat::Zip);
    }

    #[test]
    fn detect_mp3_id3() {
        let r = detect_magic(b"ID3\x04\x00\x00\x00").unwrap();
        assert_eq!(r.format, ContentFormat::Mp3);
    }

    #[test]
    fn detect_empty_is_none() {
        assert!(detect_magic(&[]).is_none());
    }

    #[test]
    fn detect_plain_text_is_none() {
        // infer doesn't recognize plain text — caller falls through.
        assert!(detect_magic(b"just some text").is_none());
    }

    #[test]
    fn detect_json_is_none() {
        // infer doesn't recognize JSON either — text gate + heuristic handles it.
        assert!(detect_magic(b"{\"key\": 1}").is_none());
    }
}
