//! Integration tests for blob primitives (T453 / T428.2).
//!
//! Tests cover hash_blob (known SHA-256 vectors) and blob_name_validate
//! (all valid and all rejection cases).

use llmtxt_core::blob::{BlobNameError, blob_name_validate, hash_blob};

// ── hash_blob: known SHA-256 vectors ────────────────────────────

#[test]
fn test_hash_blob_empty() {
    // SHA-256("") — well-known constant
    assert_eq!(
        hash_blob(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn test_hash_blob_hello() {
    // SHA-256("hello")
    assert_eq!(
        hash_blob(b"hello"),
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
}

#[test]
fn test_hash_blob_abc_nist_vector() {
    // NIST FIPS 180-4 test vector: SHA-256("abc")
    assert_eq!(
        hash_blob(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn test_hash_blob_output_length_and_case() {
    let digest = hash_blob(b"llmtxt blob test");
    assert_eq!(digest.len(), 64);
    assert!(
        digest
            .chars()
            .all(|c: char| c.is_ascii_hexdigit() && !c.is_uppercase()),
        "digest must be 64 lowercase hex chars"
    );
}

#[test]
fn test_hash_blob_full_byte_range() {
    // bytes 0x00..=0xFF — verifies binary (non-UTF-8) input works
    let bytes: Vec<u8> = (0u8..=255u8).collect();
    let digest = hash_blob(&bytes);
    assert_eq!(
        digest,
        "40aff2e9d2d8922e47afd4648e6967497158785fbd1da870e7110266bf944880"
    );
}

#[test]
fn test_hash_blob_single_zero_byte() {
    // SHA-256([0x00])
    assert_eq!(
        hash_blob(&[0u8]),
        "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d"
    );
}

// ── blob_name_validate: valid names ─────────────────────────────

#[test]
fn test_valid_typical_filenames() {
    let valid = [
        "diagram.png",
        "report.pdf",
        "README.md",
        "data.json",
        "archive.tar.gz",
        "my-file_v2.txt",
        "unicode-名前.md",
    ];
    for name in &valid {
        assert!(blob_name_validate(name).is_ok(), "'{name}' should be valid");
    }
}

#[test]
fn test_valid_single_char_name() {
    assert!(blob_name_validate("a").is_ok());
    assert!(blob_name_validate("1").is_ok());
    assert!(blob_name_validate(".").is_ok());
}

#[test]
fn test_valid_max_length_255_bytes() {
    let name = "a".repeat(255);
    assert!(blob_name_validate(&name).is_ok());
}

// ── blob_name_validate: rejection cases ─────────────────────────

#[test]
fn test_reject_empty() {
    assert_eq!(blob_name_validate(""), Err(BlobNameError::Empty));
}

#[test]
fn test_reject_too_long_256_bytes() {
    let name = "x".repeat(256);
    assert_eq!(
        blob_name_validate(&name),
        Err(BlobNameError::TooLong { actual_bytes: 256 })
    );
}

#[test]
fn test_reject_path_traversal_dotdot() {
    assert_eq!(blob_name_validate(".."), Err(BlobNameError::PathTraversal));
}

#[test]
fn test_reject_path_traversal_in_path() {
    assert_eq!(
        blob_name_validate("../etc/passwd"),
        Err(BlobNameError::PathTraversal)
    );
    assert_eq!(
        blob_name_validate("foo/../bar"),
        Err(BlobNameError::PathTraversal)
    );
}

#[test]
fn test_reject_forward_slash() {
    assert_eq!(
        blob_name_validate("foo/bar"),
        Err(BlobNameError::ForwardSlash)
    );
    assert_eq!(
        blob_name_validate("/absolute/path"),
        Err(BlobNameError::ForwardSlash)
    );
}

#[test]
fn test_reject_backslash() {
    assert_eq!(
        blob_name_validate("foo\\bar"),
        Err(BlobNameError::Backslash)
    );
    assert_eq!(
        blob_name_validate("C:\\Windows\\file.txt"),
        Err(BlobNameError::Backslash)
    );
}

#[test]
fn test_reject_null_byte() {
    assert_eq!(
        blob_name_validate("file\0name.txt"),
        Err(BlobNameError::NullByte)
    );
    assert_eq!(blob_name_validate("\0"), Err(BlobNameError::NullByte));
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
    assert_eq!(
        blob_name_validate("\nfile.txt"),
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
        blob_name_validate("file.txt\t"),
        Err(BlobNameError::TrailingWhitespace)
    );
    assert_eq!(
        blob_name_validate("file.txt\n"),
        Err(BlobNameError::TrailingWhitespace)
    );
}

#[test]
fn test_error_messages_non_empty() {
    let variants: &[BlobNameError] = &[
        BlobNameError::Empty,
        BlobNameError::TooLong { actual_bytes: 300 },
        BlobNameError::PathTraversal,
        BlobNameError::ForwardSlash,
        BlobNameError::Backslash,
        BlobNameError::NullByte,
        BlobNameError::LeadingWhitespace,
        BlobNameError::TrailingWhitespace,
    ];
    for variant in variants {
        use std::fmt::Write as _;
        let mut msg = String::new();
        write!(msg, "{variant}").expect("Display impl must not fail");
        assert!(
            !msg.is_empty(),
            "error message for {variant:?} must not be empty"
        );
    }
}
