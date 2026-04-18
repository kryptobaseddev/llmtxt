//! Webhook and generic payload HMAC signing primitives.
//!
//! This module provides the canonical HMAC-SHA256 implementation for webhook
//! signature headers used by the llmtxt platform.
//!
//! # Format
//! The returned signature string matches the GitHub webhook convention:
//! `sha256=<lowercase hex HMAC-SHA256 digest>`
//!
//! Recipients should compare the value of the `X-LLMtxt-Signature` header
//! against the value produced by this function using a constant-time
//! comparison to prevent timing attacks.
//!
//! # S-01 Constant-Time Comparison (T108.7)
//! [`constant_time_eq_hex`] provides a timing-safe hex-digest comparison that
//! MUST be used whenever two API-key hash digests or HMAC signatures are
//! compared in application code. JavaScript string equality (`===`) is NOT
//! timing-safe and MUST NOT be used for secret comparison.

use hmac::{Hmac, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

type HmacSha256 = Hmac<Sha256>;

/// Compute the HMAC-SHA256 webhook signature for a payload.
///
/// Returns `"sha256=<hex>"` — the canonical format for the
/// `X-LLMtxt-Signature` request header.
///
/// # Arguments
/// * `secret` - The webhook signing secret (UTF-8 string).
/// * `payload` - The raw request body bytes to sign.
///
/// Returns an empty string if the HMAC key is invalid (should not occur
/// in practice; HMAC-SHA256 accepts keys of any length).
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn sign_webhook_payload(secret: &str, payload: &str) -> String {
    let Ok(mut mac) = HmacSha256::new_from_slice(secret.as_bytes()) else {
        return String::new();
    };
    mac.update(payload.as_bytes());
    let hex = hex::encode(mac.finalize().into_bytes());
    format!("sha256={hex}")
}

// ── Constant-Time Comparison ──────────────────────────────────────

/// Compare two hex-encoded digest strings (e.g. SHA-256 or HMAC digests) in
/// constant time to prevent timing side-channel attacks.
///
/// Returns `true` if and only if `a == b` **and** both strings have the same
/// length. Strings of different lengths return `false` immediately (the length
/// difference itself leaks no secret information when both inputs are fixed-
/// length digests such as SHA-256).
///
/// # S-01 (T108.7)
/// Use this function whenever comparing API key hashes or webhook signatures.
/// Never use `==` on secret strings from JavaScript / TypeScript.
///
/// # WASM export
/// The WASM binding returns `1` for equal, `0` for not equal so that the
/// JavaScript caller can check `if (constantTimeEqHex(a, b))` cleanly.
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn constant_time_eq_hex(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Known-good vector produced by Node.js:
    /// ```js
    /// const { createHmac } = require('node:crypto');
    /// const hmac = createHmac('sha256', 'test-secret');
    /// hmac.update('{"type":"version.created"}');
    /// console.log('sha256=' + hmac.digest('hex'));
    /// // → sha256=d2a84b21ceeefdf96...
    /// ```
    /// Known-good vectors verified against Node.js:
    /// ```js
    /// const { createHmac } = require('node:crypto');
    /// createHmac('sha256', secret).update(payload).digest('hex')
    /// ```
    #[test]
    fn sign_matches_node_crypto_vector_1() {
        let sig = sign_webhook_payload("test-secret", r#"{"type":"version.created"}"#);
        assert!(sig.starts_with("sha256="), "must use sha256= prefix");
        assert_eq!(sig.len(), 7 + 64, "sha256= + 64 hex chars");
        assert_eq!(
            sig,
            "sha256=b80c1f1744d458868dfc052244cc86b0fa5ddc9da037c9c8a23b7e473ff80bbe"
        );
    }

    #[test]
    fn sign_matches_node_crypto_vector_2() {
        let sig = sign_webhook_payload(
            "my-webhook-secret",
            r#"{"type":"state.changed","slug":"xK9mP2nQ"}"#,
        );
        assert!(sig.starts_with("sha256="));
        assert_eq!(sig.len(), 7 + 64);
        assert_eq!(
            sig,
            "sha256=60a5fe34e07cb00dae4d6344f36ed0983504b097fc9e94fc011a70ce66e0938e"
        );
    }

    #[test]
    fn sign_matches_node_crypto_vector_3() {
        // Empty payload — still produces a valid HMAC
        let sig = sign_webhook_payload("secret", "");
        assert!(sig.starts_with("sha256="));
        assert_eq!(sig.len(), 7 + 64);
        assert_eq!(
            sig,
            "sha256=f9e66e179b6747ae54108f82f8ade8b3c25d76fd30afde6c395822c530196169"
        );
    }

    #[test]
    fn different_secrets_produce_different_signatures() {
        let payload = r#"{"type":"approval.submitted"}"#;
        let sig_a = sign_webhook_payload("secret-a", payload);
        let sig_b = sign_webhook_payload("secret-b", payload);
        assert_ne!(sig_a, sig_b);
    }

    #[test]
    fn different_payloads_produce_different_signatures() {
        let secret = "shared-secret";
        let sig_a = sign_webhook_payload(secret, r#"{"type":"version.created"}"#);
        let sig_b = sign_webhook_payload(secret, r#"{"type":"document.archived"}"#);
        assert_ne!(sig_a, sig_b);
    }

    // ── Constant-time comparison tests (S-01, T108.7) ────────────────

    #[test]
    fn constant_time_eq_hex_equal() {
        let digest = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(constant_time_eq_hex(digest, digest));
    }

    #[test]
    fn constant_time_eq_hex_different() {
        let a = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        let b = "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899";
        assert!(!constant_time_eq_hex(a, b));
    }

    #[test]
    fn constant_time_eq_hex_different_lengths() {
        assert!(!constant_time_eq_hex("abc", "abcd"));
        assert!(!constant_time_eq_hex("", "a"));
    }

    #[test]
    fn constant_time_eq_hex_empty_strings() {
        assert!(constant_time_eq_hex("", ""));
    }
}
