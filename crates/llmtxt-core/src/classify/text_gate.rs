//! Binary-vs-text gate via `content_inspector`.
//!
//! After the magic-byte layer (T822) returns `None`, the caller uses this
//! gate to decide whether to run the heuristic text-parser layer (T824) or
//! classify the bytes as unknown binary. Handles UTF-8 / UTF-16 BOMs.

use content_inspector::{ContentType, inspect};

/// Outcome of the text-vs-binary gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextGateResult {
    /// Bytes appear to be text; heuristic layer should run.
    /// The stripped-BOM slice is provided for downstream parsing.
    Text { bom_stripped_offset: usize },
    /// Bytes appear to be binary (but not identified by magic layer).
    Binary,
    /// Empty input.
    Empty,
}

/// Inspect bytes and classify them as text or binary.
///
/// Strips any UTF-8 or UTF-16 BOM from the front and reports the offset
/// where the actual content begins. Downstream layers should slice
/// `bytes[bom_stripped_offset..]` before parsing.
///
/// # Examples
/// ```ignore
/// let r = inspect_text(b"plain ascii");
/// assert_eq!(r, TextGateResult::Text { bom_stripped_offset: 0 });
///
/// let with_bom = b"\xEF\xBB\xBFhello";
/// let r = inspect_text(with_bom);
/// assert_eq!(r, TextGateResult::Text { bom_stripped_offset: 3 });
/// ```
pub fn inspect_text(bytes: &[u8]) -> TextGateResult {
    if bytes.is_empty() {
        return TextGateResult::Empty;
    }

    let offset = detect_bom_offset(bytes);
    let payload = &bytes[offset..];

    // Empty after BOM → treat as text (empty file is not binary).
    if payload.is_empty() {
        return TextGateResult::Text {
            bom_stripped_offset: offset,
        };
    }

    match inspect(payload) {
        ContentType::BINARY => TextGateResult::Binary,
        // UTF_8, UTF_8_BOM, UTF_16_LE, UTF_16_BE — all text
        _ => TextGateResult::Text {
            bom_stripped_offset: offset,
        },
    }
}

/// Return the byte offset at which a BOM ends (0 if no BOM).
///
/// Recognizes UTF-8 (EF BB BF), UTF-16 LE (FF FE), UTF-16 BE (FE FF).
fn detect_bom_offset(bytes: &[u8]) -> usize {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        3
    } else if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) {
        2
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_ascii_is_text() {
        let r = inspect_text(b"hello world");
        assert!(matches!(r, TextGateResult::Text { .. }));
    }

    #[test]
    fn utf8_bom_stripped() {
        let r = inspect_text(b"\xEF\xBB\xBFhello");
        assert_eq!(
            r,
            TextGateResult::Text {
                bom_stripped_offset: 3
            }
        );
    }

    #[test]
    fn utf16_le_bom_stripped() {
        let r = inspect_text(b"\xFF\xFEhello");
        assert_eq!(
            r,
            TextGateResult::Text {
                bom_stripped_offset: 2
            }
        );
    }

    #[test]
    fn utf16_be_bom_stripped() {
        let r = inspect_text(b"\xFE\xFFhello");
        assert_eq!(
            r,
            TextGateResult::Text {
                bom_stripped_offset: 2
            }
        );
    }

    #[test]
    fn binary_nul_bytes_detected() {
        let r = inspect_text(&[0x00, 0x01, 0x02, 0xFF, 0xFE, 0x00, 0xAB, 0xCD]);
        assert_eq!(r, TextGateResult::Binary);
    }

    #[test]
    fn empty_input() {
        assert_eq!(inspect_text(&[]), TextGateResult::Empty);
    }

    #[test]
    fn empty_after_bom_is_text() {
        let r = inspect_text(b"\xEF\xBB\xBF");
        assert_eq!(
            r,
            TextGateResult::Text {
                bom_stripped_offset: 3
            }
        );
    }

    #[test]
    fn markdown_is_text() {
        let r = inspect_text(b"# Heading\n\nparagraph");
        assert!(matches!(r, TextGateResult::Text { .. }));
    }

    #[test]
    fn json_is_text() {
        let r = inspect_text(b"{\"k\": 1}");
        assert!(matches!(r, TextGateResult::Text { .. }));
    }

    #[test]
    fn code_is_text() {
        let r = inspect_text(b"const x = 1;\nfunction f() {}");
        assert!(matches!(r, TextGateResult::Text { .. }));
    }
}
