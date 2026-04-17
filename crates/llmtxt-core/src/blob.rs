//! Binary blob primitives for content-addressed attachment storage (T428).
//!
//! This module provides two exported functions used by higher-level backends:
//!
//! - [`hash_blob`]: SHA-256 hash of raw bytes, returned as lowercase hex (64 chars).
//! - [`blob_name_validate`]: Validates attachment names per the security rules in
//!   `docs/specs/ARCH-T428-binary-blob-attachments.md` §3.2.
//!
//! Both functions are exported as WASM bindings under the `wasm` feature.

use sha2::{Digest, Sha256};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

// ── Error type ───────────────────────────────────────────────────

/// Error returned by [`blob_name_validate`] when an attachment name is invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlobNameError {
    /// The name is empty (zero bytes).
    Empty,
    /// The name exceeds 255 bytes in UTF-8 encoding.
    TooLong { actual_bytes: usize },
    /// The name contains the `..` path traversal sequence.
    PathTraversal,
    /// The name contains a forward slash (`/`) path separator.
    ForwardSlash,
    /// The name contains a backslash (`\`) path separator.
    Backslash,
    /// The name contains a null byte (`\0`).
    NullByte,
    /// The name starts with whitespace.
    LeadingWhitespace,
    /// The name ends with whitespace.
    TrailingWhitespace,
}

impl std::fmt::Display for BlobNameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BlobNameError::Empty => write!(f, "blob name must not be empty"),
            BlobNameError::TooLong { actual_bytes } => {
                write!(f, "blob name exceeds 255 bytes (got {actual_bytes} bytes)")
            }
            BlobNameError::PathTraversal => {
                write!(f, "blob name must not contain '..' (path traversal)")
            }
            BlobNameError::ForwardSlash => {
                write!(f, "blob name must not contain '/' (path separator)")
            }
            BlobNameError::Backslash => {
                write!(f, "blob name must not contain '\\' (path separator)")
            }
            BlobNameError::NullByte => write!(f, "blob name must not contain null bytes"),
            BlobNameError::LeadingWhitespace => {
                write!(f, "blob name must not start with whitespace")
            }
            BlobNameError::TrailingWhitespace => {
                write!(f, "blob name must not end with whitespace")
            }
        }
    }
}

impl std::error::Error for BlobNameError {}

// ── Core functions ───────────────────────────────────────────────

/// Compute the SHA-256 digest of raw bytes and return it as a lowercase hex string.
///
/// The returned string is exactly 64 ASCII characters long.
///
/// # Example
/// ```
/// # use llmtxt_core::blob::hash_blob;
/// let digest = hash_blob(b"");
/// assert_eq!(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
/// let digest = hash_blob(b"hello");
/// assert_eq!(digest, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
/// ```
pub fn hash_blob(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Validate an attachment name according to the rules in spec §3.2.
///
/// Validation rules (RFC 2119 MUST):
/// - Length: 1–255 bytes (UTF-8)
/// - MUST NOT contain `..` (path traversal)
/// - MUST NOT contain `/` or `\` (path separators)
/// - MUST NOT contain null bytes (`\0`)
/// - MUST NOT start or end with ASCII whitespace
///
/// Returns `Ok(())` when the name is valid, or a [`BlobNameError`] describing
/// the first violated rule.
///
/// # Example
/// ```
/// # use llmtxt_core::blob::{blob_name_validate, BlobNameError};
/// assert!(blob_name_validate("diagram.png").is_ok());
/// assert_eq!(blob_name_validate(""), Err(BlobNameError::Empty));
/// assert_eq!(blob_name_validate("../etc/passwd"), Err(BlobNameError::PathTraversal));
/// ```
pub fn blob_name_validate(name: &str) -> Result<(), BlobNameError> {
    // 1. Empty check
    if name.is_empty() {
        return Err(BlobNameError::Empty);
    }

    // 2. Length check (UTF-8 byte count, not char count)
    let byte_len = name.len();
    if byte_len > 255 {
        return Err(BlobNameError::TooLong {
            actual_bytes: byte_len,
        });
    }

    // 3. Null byte check
    if name.contains('\0') {
        return Err(BlobNameError::NullByte);
    }

    // 4. Path traversal check — reject any occurrence of ".."
    if name.contains("..") {
        return Err(BlobNameError::PathTraversal);
    }

    // 5. Forward slash
    if name.contains('/') {
        return Err(BlobNameError::ForwardSlash);
    }

    // 6. Backslash
    if name.contains('\\') {
        return Err(BlobNameError::Backslash);
    }

    // 7. Leading whitespace
    if name
        .chars()
        .next()
        .map(|c| c.is_ascii_whitespace())
        .unwrap_or(false)
    {
        return Err(BlobNameError::LeadingWhitespace);
    }

    // 8. Trailing whitespace
    if name
        .chars()
        .last()
        .map(|c| c.is_ascii_whitespace())
        .unwrap_or(false)
    {
        return Err(BlobNameError::TrailingWhitespace);
    }

    Ok(())
}

// ── WASM bindings ────────────────────────────────────────────────

/// WASM binding for [`hash_blob`].
///
/// Accepts raw bytes and returns the lowercase hex SHA-256 digest (64 chars).
#[cfg_attr(feature = "wasm", wasm_bindgen(js_name = "hashBlob"))]
pub fn hash_blob_wasm(bytes: &[u8]) -> String {
    hash_blob(bytes)
}

/// WASM binding for [`blob_name_validate`].
///
/// Returns `Ok(())` when the name is valid, or throws a `JsValue` string
/// describing the validation failure.
#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = "blobNameValidate")]
pub fn blob_name_validate_wasm(name: &str) -> Result<(), JsValue> {
    blob_name_validate(name).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── hash_blob ────────────────────────────────────────────────

    #[test]
    fn test_hash_blob_empty_bytes() {
        // SHA-256 of empty input — well-known vector
        assert_eq!(
            hash_blob(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_hash_blob_hello() {
        // SHA-256("hello") — well-known vector
        assert_eq!(
            hash_blob(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_hash_blob_known_vector_abc() {
        // SHA-256("abc") — NIST FIPS 180-4 test vector
        assert_eq!(
            hash_blob(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn test_hash_blob_output_is_64_lowercase_hex_chars() {
        let digest = hash_blob(b"test data");
        assert_eq!(digest.len(), 64, "digest must be 64 characters");
        assert!(
            digest
                .chars()
                .all(|c: char| c.is_ascii_hexdigit() && !c.is_uppercase()),
            "digest must be lowercase hex"
        );
    }

    #[test]
    fn test_hash_blob_binary_data() {
        // Verify binary (non-UTF-8) input is handled correctly
        let bytes: Vec<u8> = (0u8..=255u8).collect();
        let digest = hash_blob(&bytes);
        assert_eq!(digest.len(), 64);
        // Known SHA-256 of bytes 0x00..=0xFF
        assert_eq!(
            digest,
            "40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880"
        );
    }

    // ── blob_name_validate ───────────────────────────────────────

    #[test]
    fn test_valid_names_accepted() {
        let valid_names = [
            "diagram.png",
            "report.pdf",
            "a",
            "file with spaces.txt",
            "unicode-名前.md",
            "UPPERCASE.TXT",
            "mixed_CamelCase-123.json",
        ];
        for name in &valid_names {
            assert!(
                blob_name_validate(name).is_ok(),
                "expected '{name}' to be valid"
            );
        }
    }

    #[test]
    fn test_reject_empty_name() {
        assert_eq!(blob_name_validate(""), Err(BlobNameError::Empty));
    }

    #[test]
    fn test_reject_name_too_long() {
        // 256 'a' characters exceeds 255-byte limit
        let long_name = "a".repeat(256);
        assert_eq!(
            blob_name_validate(&long_name),
            Err(BlobNameError::TooLong { actual_bytes: 256 })
        );
        // Exactly 255 bytes must be accepted
        let max_name = "a".repeat(255);
        assert!(blob_name_validate(&max_name).is_ok());
    }

    #[test]
    fn test_reject_path_traversal() {
        let cases = [
            "..",
            "../etc/passwd",
            "foo/../bar",
            "a..b", // contains ".." sequence
        ];
        for name in &cases {
            assert_eq!(
                blob_name_validate(name),
                Err(BlobNameError::PathTraversal),
                "expected '{name}' to be rejected for path traversal"
            );
        }
    }

    #[test]
    fn test_reject_forward_slash() {
        assert_eq!(
            blob_name_validate("foo/bar.txt"),
            Err(BlobNameError::ForwardSlash)
        );
        assert_eq!(
            blob_name_validate("/absolute"),
            Err(BlobNameError::ForwardSlash)
        );
    }

    #[test]
    fn test_reject_backslash() {
        assert_eq!(
            blob_name_validate("foo\\bar.txt"),
            Err(BlobNameError::Backslash)
        );
        assert_eq!(
            blob_name_validate("C:\\Windows\\file"),
            Err(BlobNameError::Backslash)
        );
    }

    #[test]
    fn test_reject_null_byte() {
        let name_with_null = "file\0name.txt";
        assert_eq!(
            blob_name_validate(name_with_null),
            Err(BlobNameError::NullByte)
        );
    }

    #[test]
    fn test_reject_leading_whitespace() {
        assert_eq!(
            blob_name_validate(" file.txt"),
            Err(BlobNameError::LeadingWhitespace)
        );
        assert_eq!(
            blob_name_validate("\tfile.txt"),
            Err(BlobNameError::LeadingWhitespace)
        );
    }

    #[test]
    fn test_reject_trailing_whitespace() {
        assert_eq!(
            blob_name_validate("file.txt "),
            Err(BlobNameError::TrailingWhitespace)
        );
        assert_eq!(
            blob_name_validate("file.txt\n"),
            Err(BlobNameError::TrailingWhitespace)
        );
    }

    #[test]
    fn test_error_messages_are_descriptive() {
        // Each error variant must have a non-empty, human-readable Display string.
        let cases: &[(&str, BlobNameError)] = &[
            ("", BlobNameError::Empty),
            ("..", BlobNameError::PathTraversal),
            ("a/b", BlobNameError::ForwardSlash),
            ("a\\b", BlobNameError::Backslash),
            ("file\0.txt", BlobNameError::NullByte),
            (" file", BlobNameError::LeadingWhitespace),
            ("file ", BlobNameError::TrailingWhitespace),
        ];
        for (name, expected_err) in cases {
            let err = blob_name_validate(name).unwrap_err();
            assert_eq!(&err, expected_err);
            let msg = err.to_string();
            assert!(
                !msg.is_empty(),
                "error message for {name:?} must not be empty"
            );
        }
    }
}
