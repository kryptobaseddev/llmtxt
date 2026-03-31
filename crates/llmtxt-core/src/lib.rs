//! llmtxt-core: Portable primitives for the llmtxt content platform.
//!
//! This crate is the single source of truth for compression, hashing,
//! signing, and encoding functions used by both the Rust (SignalDock)
//! and TypeScript (npm `llmtxt` via WASM) consumers.
//!
//! # Features
//! - `wasm` (default): Enables `wasm-bindgen` exports for JavaScript consumption.
//!   Disable with `default-features = false` for native-only usage.
//!
//! # Native
//! All functions are available as regular Rust APIs regardless of features.

use flate2::Compression;
use flate2::read::{ZlibDecoder, ZlibEncoder};
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::io::Read;
use uuid::Uuid;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(not(target_arch = "wasm32"))]
mod native_signed_url;

#[cfg(not(target_arch = "wasm32"))]
pub use native_signed_url::{
    SignedUrlBuildRequest, SignedUrlParams, VerifyError, generate_signed_url, verify_signed_url,
};

mod patch;
pub use patch::{
    apply_patch, batch_diff_versions, compute_sections_modified,
    compute_sections_modified_native, create_patch, diff_versions, diff_versions_native,
    reconstruct_version, reconstruct_version_native, squash_patches, squash_patches_native,
};

mod lifecycle;
pub use lifecycle::{
    DocumentState, is_editable, is_editable_str, is_terminal, is_terminal_str, is_valid_transition,
    is_valid_transition_str, validate_transition,
};

mod consensus;
pub use consensus::{
    ApprovalPolicy, ApprovalResult, Review, evaluate_approvals, evaluate_approvals_native,
    mark_stale_reviews, mark_stale_reviews_native,
};

type HmacSha256 = Hmac<Sha256>;

const BASE62: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// ── Base62 ──────────────────────────────────────────────────────

/// Encode a non-negative integer into a base62 string.
///
/// Uses the alphabet `0-9A-Za-z`. Zero encodes to `"0"`.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn encode_base62(mut num: u64) -> String {
    if num == 0 {
        return "0".to_string();
    }
    let mut result = Vec::new();
    while num > 0 {
        result.push(BASE62[(num % 62) as usize]);
        num /= 62;
    }
    result.reverse();
    String::from_utf8(result).unwrap_or_default()
}

/// Decode a base62-encoded string back into an integer.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn decode_base62(s: &str) -> u64 {
    let mut result: u64 = 0;
    for byte in s.bytes() {
        let val = match byte {
            b'0'..=b'9' => byte - b'0',
            b'A'..=b'Z' => byte - b'A' + 10,
            b'a'..=b'z' => byte - b'a' + 36,
            _ => 0,
        } as u64;
        result = result * 62 + val;
    }
    result
}

// ── Compression ─────────────────────────────────────────────────

/// Compress a UTF-8 string using zlib-wrapped deflate (RFC 1950).
///
/// Matches Node.js `zlib.deflate` output for backward compatibility
/// with existing stored data.
///
/// # Errors
/// Returns an error string if compression fails.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compress(data: &str) -> Result<Vec<u8>, String> {
    let mut encoder = ZlibEncoder::new(data.as_bytes(), Compression::default());
    let mut compressed = Vec::new();
    encoder
        .read_to_end(&mut compressed)
        .map_err(|e| format!("compression failed: {e}"))?;
    Ok(compressed)
}

/// Decompress zlib-wrapped deflate bytes back to a UTF-8 string.
///
/// Matches Node.js `zlib.inflate` for backward compatibility.
///
/// # Errors
/// Returns an error string if decompression or UTF-8 conversion fails.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn decompress(data: &[u8]) -> Result<String, String> {
    let mut decoder = ZlibDecoder::new(data);
    let mut decompressed = Vec::new();
    decoder
        .read_to_end(&mut decompressed)
        .map_err(|e| format!("decompression failed: {e}"))?;
    String::from_utf8(decompressed).map_err(|e| format!("invalid UTF-8: {e}"))
}

// ── ID Generation ───────────────────────────────────────────────

/// Generate an 8-character base62 ID from a UUID v4.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn generate_id() -> String {
    let uuid = Uuid::new_v4();
    let hex = uuid.simple().to_string();
    let hex_prefix = &hex[..16];
    let num = u64::from_str_radix(hex_prefix, 16).unwrap_or(0);
    let base62 = encode_base62(num);
    format!("{:0>8}", &base62[..base62.len().min(8)])
}

// ── Hashing ─────────────────────────────────────────────────────

/// Compute the SHA-256 hash of a UTF-8 string, returned as lowercase hex.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn hash_content(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

// ── Token Estimation ────────────────────────────────────────────

/// Estimate token count using the ~4 chars/token heuristic.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn calculate_tokens(text: &str) -> u32 {
    let len = text.len() as f64;
    (len / 4.0).ceil() as u32
}

// ── Compression Ratio ───────────────────────────────────────────

/// Calculate the compression ratio (original / compressed), rounded to 2 decimals.
/// Returns 1.0 when `compressed_size` is 0.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn calculate_compression_ratio(original_size: u32, compressed_size: u32) -> f64 {
    if compressed_size == 0 {
        return 1.0;
    }
    let ratio = original_size as f64 / compressed_size as f64;
    (ratio * 100.0).round() / 100.0
}

// ── HMAC Signing ────────────────────────────────────────────────

/// Compute the HMAC-SHA256 signature for signed URL parameters.
/// Returns the first 16 hex characters of the digest (64 bits).
/// For longer signatures, use [`compute_signature_with_length`].
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compute_signature(
    slug: &str,
    agent_id: &str,
    conversation_id: &str,
    expires_at: f64,
    secret: &str,
) -> String {
    compute_signature_with_length(slug, agent_id, conversation_id, expires_at, secret, 16)
}

/// Compute the HMAC-SHA256 signature with configurable output length.
///
/// `sig_length` controls how many hex characters to return (max 64).
/// Use 16 for short-lived URLs (backward compat), 32 for long-lived URLs (128 bits).
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compute_signature_with_length(
    slug: &str,
    agent_id: &str,
    conversation_id: &str,
    expires_at: f64,
    secret: &str,
    sig_length: usize,
) -> String {
    let payload = format!(
        "{}:{}:{}:{}",
        slug, agent_id, conversation_id, expires_at as u64
    );
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return String::new();
    };
    mac.update(payload.as_bytes());
    let result = mac.finalize();
    let hex_full = hex::encode(result.into_bytes());
    let len = sig_length.min(64);
    hex_full[..len].to_string()
}

/// Compute the HMAC-SHA256 signature for org-scoped signed URL parameters.
/// Includes `org_id` in the HMAC payload for organization-level access control.
/// Returns the first 32 hex characters (128 bits) by default.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compute_org_signature(
    slug: &str,
    agent_id: &str,
    conversation_id: &str,
    org_id: &str,
    expires_at: f64,
    secret: &str,
) -> String {
    compute_org_signature_with_length(
        slug,
        agent_id,
        conversation_id,
        org_id,
        expires_at,
        secret,
        32,
    )
}

/// Compute org-scoped HMAC-SHA256 signature with configurable output length.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compute_org_signature_with_length(
    slug: &str,
    agent_id: &str,
    conversation_id: &str,
    org_id: &str,
    expires_at: f64,
    secret: &str,
    sig_length: usize,
) -> String {
    let payload = format!(
        "{}:{}:{}:{}:{}",
        slug, agent_id, conversation_id, org_id, expires_at as u64
    );
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return String::new();
    };
    mac.update(payload.as_bytes());
    let result = mac.finalize();
    let hex_full = hex::encode(result.into_bytes());
    let len = sig_length.min(64);
    hex_full[..len].to_string()
}

/// Derive a per-agent signing key from their API key.
/// Uses `HMAC-SHA256(api_key, "llmtxt-signing")`.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn derive_signing_key(api_key: &str) -> String {
    let Ok(mut mac) = HmacSha256::new_from_slice(api_key.as_bytes()) else {
        return String::new();
    };
    mac.update(b"llmtxt-signing");
    hex::encode(mac.finalize().into_bytes())
}

// ── Expiration ──────────────────────────────────────────────────

/// Check whether a timestamp (milliseconds) has expired.
/// Returns false for 0 (no expiration).
///
/// Uses `js_sys::Date::now()` in WASM, `std::time::SystemTime` natively.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn is_expired(expires_at_ms: f64) -> bool {
    if expires_at_ms == 0.0 {
        return false;
    }
    let now = current_time_ms();
    now > expires_at_ms
}

/// Get current time in milliseconds since epoch.
/// Uses `js_sys::Date::now()` when compiled to WASM, `SystemTime` natively.
#[cfg(target_arch = "wasm32")]
fn current_time_ms() -> f64 {
    js_sys::Date::now()
}

/// Get current time in milliseconds since epoch.
#[cfg(not(target_arch = "wasm32"))]
fn current_time_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

// ── Similarity ─────────────────────────────────────────────────

/// Compute character-level n-gram Jaccard similarity between two texts.
/// Returns 0.0 (no overlap) to 1.0 (identical). Default n=3.
///
/// Suitable for finding similar messages without vector embeddings.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn text_similarity(a: &str, b: &str) -> f64 {
    text_similarity_ngram(a, b, 3)
}

/// Compute n-gram Jaccard similarity with configurable gram size.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn text_similarity_ngram(a: &str, b: &str, n: usize) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();
    let a_norm: String = a_lower.split_whitespace().collect::<Vec<_>>().join(" ");
    let b_norm: String = b_lower.split_whitespace().collect::<Vec<_>>().join(" ");

    if a_norm.len() < n && b_norm.len() < n {
        return if a_norm == b_norm { 1.0 } else { 0.0 };
    }

    let a_grams: std::collections::HashSet<&str> = (0..=a_norm.len().saturating_sub(n))
        .filter_map(|i| a_norm.get(i..i + n))
        .collect();
    let b_grams: std::collections::HashSet<&str> = (0..=b_norm.len().saturating_sub(n))
        .filter_map(|i| b_norm.get(i..i + n))
        .collect();

    if a_grams.is_empty() && b_grams.is_empty() {
        return 1.0;
    }

    let intersection = a_grams.intersection(&b_grams).count();
    let union = a_grams.union(&b_grams).count();

    if union == 0 {
        0.0
    } else {
        intersection as f64 / union as f64
    }
}

// ── Diff ────────────────────────────────────────────────────────

/// Result of computing a line-based diff between two texts.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
#[derive(Debug, Clone)]
pub struct DiffResult {
    added_lines: u32,
    removed_lines: u32,
    added_tokens: u32,
    removed_tokens: u32,
}

#[cfg_attr(feature = "wasm", wasm_bindgen)]
impl DiffResult {
    /// Number of lines added in the new text.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn added_lines(&self) -> u32 {
        self.added_lines
    }
    /// Number of lines removed from the old text.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn removed_lines(&self) -> u32 {
        self.removed_lines
    }
    /// Estimated tokens added.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn added_tokens(&self) -> u32 {
        self.added_tokens
    }
    /// Estimated tokens removed.
    #[cfg_attr(feature = "wasm", wasm_bindgen(getter))]
    pub fn removed_tokens(&self) -> u32 {
        self.removed_tokens
    }
}

/// Compute a line-based diff between two texts.
///
/// Uses a hash-based LCS (Longest Common Subsequence) approach for
/// O(n*m) comparison where n and m are line counts. Returns counts
/// of added/removed lines and estimated token impact.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn compute_diff(old_text: &str, new_text: &str) -> DiffResult {
    let old_lines: Vec<&str> = old_text.lines().collect();
    let new_lines: Vec<&str> = new_text.lines().collect();

    let n = old_lines.len();
    let m = new_lines.len();

    // Build LCS table
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in 1..=n {
        for j in 1..=m {
            if old_lines[i - 1] == new_lines[j - 1] {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = dp[i - 1][j].max(dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find which lines were removed and which were added
    let mut removed = Vec::new();
    let mut added = Vec::new();
    let mut i = n;
    let mut j = m;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old_lines[i - 1] == new_lines[j - 1] {
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            added.push(new_lines[j - 1]);
            j -= 1;
        } else {
            removed.push(old_lines[i - 1]);
            i -= 1;
        }
    }

    let added_tokens: u32 = added.iter().map(|l| calculate_tokens(l)).sum();
    let removed_tokens: u32 = removed.iter().map(|l| calculate_tokens(l)).sum();

    DiffResult {
        added_lines: added.len() as u32,
        removed_lines: removed.len() as u32,
        added_tokens,
        removed_tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base62_encode() {
        assert_eq!(encode_base62(0), "0");
        assert_eq!(encode_base62(1), "1");
        assert_eq!(encode_base62(61), "z");
        assert_eq!(encode_base62(62), "10");
        assert_eq!(encode_base62(3844), "100");
    }

    #[test]
    fn test_base62_decode() {
        assert_eq!(decode_base62("0"), 0);
        assert_eq!(decode_base62("z"), 61);
        assert_eq!(decode_base62("10"), 62);
        assert_eq!(decode_base62("100"), 3844);
    }

    #[test]
    fn test_base62_roundtrip() {
        for n in [0, 1, 42, 61, 62, 100, 3844, 999_999, u64::MAX / 2] {
            assert_eq!(
                decode_base62(&encode_base62(n)),
                n,
                "roundtrip failed for {n}"
            );
        }
    }

    #[test]
    fn test_hash_content() {
        assert_eq!(
            hash_content("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(
            hash_content(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_calculate_tokens() {
        assert_eq!(calculate_tokens("Hello, world!"), 4);
        assert_eq!(calculate_tokens(""), 0);
        assert_eq!(calculate_tokens("a"), 1);
        assert_eq!(calculate_tokens("1234"), 1);
        assert_eq!(calculate_tokens("12345"), 2);
    }

    #[test]
    fn test_compression_ratio() {
        assert_eq!(calculate_compression_ratio(1000, 400), 2.5);
        assert_eq!(calculate_compression_ratio(100, 100), 1.0);
        assert_eq!(calculate_compression_ratio(100, 0), 1.0);
        assert_eq!(calculate_compression_ratio(500, 200), 2.5);
    }

    #[test]
    fn test_compress_decompress_roundtrip() {
        let input = "Hello, world! This is a test of the llmtxt compression.";
        let compressed = compress(input).expect("compress should succeed");
        let decompressed = decompress(&compressed).expect("decompress should succeed");
        assert_eq!(decompressed, input);
    }

    #[test]
    fn test_compress_empty() {
        let compressed = compress("").expect("compress empty should succeed");
        let decompressed = decompress(&compressed).expect("decompress should succeed");
        assert_eq!(decompressed, "");
    }

    #[test]
    fn test_compute_signature() {
        let sig = compute_signature(
            "xK9mP2nQ",
            "test-agent",
            "conv_123",
            1_700_000_000_000.0,
            "test-secret",
        );
        assert_eq!(sig, "650eb9dd6c396a45");
    }

    #[test]
    fn test_compute_signature_with_length() {
        let sig16 = compute_signature_with_length(
            "xK9mP2nQ",
            "test-agent",
            "conv_123",
            1_700_000_000_000.0,
            "test-secret",
            16,
        );
        let sig32 = compute_signature_with_length(
            "xK9mP2nQ",
            "test-agent",
            "conv_123",
            1_700_000_000_000.0,
            "test-secret",
            32,
        );
        assert_eq!(sig16, "650eb9dd6c396a45");
        assert_eq!(sig16.len(), 16);
        assert_eq!(sig32.len(), 32);
        assert!(sig32.starts_with(&sig16)); // longer sig is a prefix extension
    }

    #[test]
    fn test_generate_signed_url_with_path_prefix() {
        let url = generate_signed_url(&SignedUrlBuildRequest {
            base_url: "https://api.example.com",
            path_prefix: "attachments",
            slug: "xK9mP2nQ",
            agent_id: "test-agent",
            conversation_id: "conv_123",
            expires_at: 1_700_000_000_000,
            secret: "test-secret",
            sig_length: 32,
        })
        .expect("signed URL should build");

        assert!(url.starts_with("https://api.example.com/attachments/xK9mP2nQ?"));
        assert!(url.contains("sig="));
    }

    #[test]
    fn test_derive_signing_key() {
        let key = derive_signing_key("sk_live_abc123");
        assert_eq!(
            key,
            "fb5f79640e9ed141d4949ccb36110c7aaf829c56d9870942dd77219a57575372"
        );
    }

    #[test]
    fn test_generate_id_format() {
        let id = generate_id();
        assert_eq!(id.len(), 8);
        assert!(id.chars().all(|c| c.is_ascii_alphanumeric()));
    }

    #[test]
    fn test_generate_id_uniqueness() {
        let ids: Vec<String> = (0..100).map(|_| generate_id()).collect();
        let unique: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(unique.len(), 100, "generated IDs should be unique");
    }

    #[test]
    fn test_compute_org_signature() {
        let sig = compute_org_signature(
            "xK9mP2nQ",
            "test-agent",
            "conv_123",
            "org_456",
            1_700_000_000_000.0,
            "test-secret",
        );
        assert_eq!(sig.len(), 32); // default 32 chars for org sigs
        // Org sig must differ from non-org sig (different payload)
        let non_org_sig = compute_signature_with_length(
            "xK9mP2nQ",
            "test-agent",
            "conv_123",
            1_700_000_000_000.0,
            "test-secret",
            32,
        );
        assert_ne!(sig, non_org_sig);
    }

    #[test]
    fn test_compute_org_signature_with_length() {
        let sig16 = compute_org_signature_with_length(
            "xK9mP2nQ",
            "test-agent",
            "conv_123",
            "org_456",
            1_700_000_000_000.0,
            "test-secret",
            16,
        );
        let sig32 = compute_org_signature_with_length(
            "xK9mP2nQ",
            "test-agent",
            "conv_123",
            "org_456",
            1_700_000_000_000.0,
            "test-secret",
            32,
        );
        assert_eq!(sig16.len(), 16);
        assert_eq!(sig32.len(), 32);
        assert!(sig32.starts_with(&sig16));
    }

    #[test]
    fn test_is_expired() {
        assert!(!is_expired(0.0));
        assert!(is_expired(1.0)); // 1ms after epoch = definitely expired
        assert!(!is_expired(f64::MAX)); // far future
    }

    #[test]
    fn test_verify_signed_url_accepts_32_char_signature_and_path_prefix() {
        let url = generate_signed_url(&SignedUrlBuildRequest {
            base_url: "https://api.example.com",
            path_prefix: "attachments",
            slug: "xK9mP2nQ",
            agent_id: "test-agent",
            conversation_id: "conv_123",
            expires_at: u64::MAX / 2,
            secret: "test-secret",
            sig_length: 32,
        })
        .expect("signed URL should build");

        let params = verify_signed_url(&url, "test-secret").expect("signed URL should verify");
        assert_eq!(params.slug, "xK9mP2nQ");
        assert_eq!(params.agent_id, "test-agent");
        assert_eq!(params.conversation_id, "conv_123");
    }

    #[test]
    fn test_verify_signed_url_exp_zero_never_expires() {
        let url = generate_signed_url(&SignedUrlBuildRequest {
            base_url: "https://api.example.com",
            path_prefix: "attachments",
            slug: "xK9mP2nQ",
            agent_id: "test-agent",
            conversation_id: "conv_123",
            expires_at: 0,
            secret: "test-secret",
            sig_length: 32,
        })
        .expect("signed URL should build");

        let params = verify_signed_url(&url, "test-secret").expect("exp=0 should never expire");
        assert_eq!(params.slug, "xK9mP2nQ");
        assert_eq!(params.expires_at, 0);
    }

    #[test]
    fn test_compute_diff_identical() {
        let text = "line 1\nline 2\nline 3";
        let result = compute_diff(text, text);
        assert_eq!(result.added_lines(), 0);
        assert_eq!(result.removed_lines(), 0);
        assert_eq!(result.added_tokens(), 0);
        assert_eq!(result.removed_tokens(), 0);
    }

    #[test]
    fn test_compute_diff_empty_to_content() {
        let result = compute_diff("", "line 1\nline 2");
        assert_eq!(result.added_lines(), 2);
        assert_eq!(result.removed_lines(), 0);
    }

    #[test]
    fn test_compute_diff_content_to_empty() {
        let result = compute_diff("line 1\nline 2", "");
        assert_eq!(result.added_lines(), 0);
        assert_eq!(result.removed_lines(), 2);
    }

    #[test]
    fn test_compute_diff_mixed_changes() {
        let old = "line 1\nline 2\nline 3\nline 4";
        let new = "line 1\nmodified 2\nline 3\nline 5\nline 6";
        let result = compute_diff(old, new);
        // "line 2" and "line 4" removed; "modified 2", "line 5", "line 6" added
        assert_eq!(result.removed_lines(), 2);
        assert_eq!(result.added_lines(), 3);
        assert!(result.added_tokens() > 0);
        assert!(result.removed_tokens() > 0);
    }

    #[test]
    fn test_compute_diff_tokens() {
        let old = "short";
        let new = "this is a much longer replacement line";
        let result = compute_diff(old, new);
        assert_eq!(result.removed_lines(), 1);
        assert_eq!(result.added_lines(), 1);
        assert_eq!(result.removed_tokens(), calculate_tokens("short"));
        assert_eq!(
            result.added_tokens(),
            calculate_tokens("this is a much longer replacement line")
        );
    }
}
