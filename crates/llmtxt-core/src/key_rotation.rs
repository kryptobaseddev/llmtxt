//! Key rotation primitives for per-agent ed25519 key lifecycle management.
//!
//! This module extends the ed25519 identity system with versioned key
//! management: generate versioned keypairs, compute deterministic key IDs,
//! wrap/unwrap private keys with a KEK (key-encrypting key), and enforce
//! the rotation grace-window policy.
//!
//! # Key Lifecycle
//!
//! ```text
//! active → retiring (grace_window_secs remain) → retired
//!                                              ↘ revoked (immediate)
//! ```
//!
//! # Secret Wrapping
//!
//! Private keys are wrapped with AES-256-GCM using a caller-supplied KEK.
//! The KEK is NEVER stored — it comes from the environment or a KMS.
//! The wrapped ciphertext is safe to store in the database.
//!
//! # Thread Safety
//!
//! All functions are pure (no internal state). Callers own the state.

use crate::identity::{keygen, sign_submission, verify_submission};
use sha2::{Digest, Sha256};

// ── Key ID ────────────────────────────────────────────────────────

/// Compute a deterministic 16-char hex key ID from a 32-byte public key.
///
/// The key ID is the first 8 bytes (16 hex chars) of SHA-256(pubkey_bytes).
/// It is stable across key versions — each keypair gets a unique ID.
pub fn key_id_from_pubkey(pubkey: &[u8; 32]) -> String {
    let hash = Sha256::digest(pubkey);
    hex::encode(&hash[..8])
}

// ── Versioned keygen ─────────────────────────────────────────────

/// Generate a fresh versioned ed25519 keypair.
///
/// Returns `(key_id, secret_key_bytes, public_key_bytes, version)`.
/// `version` is a monotonically increasing integer starting at 1; callers
/// supply the previous version (0 for first key) and this function increments.
pub fn generate_versioned_keypair(prev_version: u32) -> (String, [u8; 32], [u8; 32], u32) {
    let (sk, pk) = keygen();
    let key_id = key_id_from_pubkey(&pk);
    let version = prev_version + 1;
    (key_id, sk, pk, version)
}

// ── Secret Wrap/Unwrap (AES-256-GCM) ─────────────────────────────

/// Wrap (encrypt) a 32-byte secret key with a 32-byte KEK using AES-256-GCM.
///
/// Returns `Ok(ciphertext_bytes)` where the output is:
/// `[nonce: 12 bytes][ciphertext: 32 bytes][tag: 16 bytes]` = 60 bytes total.
///
/// The nonce is randomly generated. Two wraps of the same key produce different
/// ciphertexts. This is the standard AES-GCM pattern.
///
/// # Errors
/// Returns `Err(String)` if the KEK is not exactly 32 bytes.
///
/// # Security
/// - NEVER store the KEK. It must come from the environment or a KMS.
/// - NEVER reuse a nonce for the same KEK. This implementation generates
///   nonces from `OsRng` so reuse probability is negligible for sane volumes.
#[cfg(not(target_arch = "wasm32"))]
pub fn wrap_secret(plaintext: &[u8; 32], kek: &[u8; 32]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::rand_core::RngCore;
    use aes_gcm::aead::{Aead, KeyInit, OsRng};
    use aes_gcm::{Aes256Gcm, Nonce};

    let cipher =
        Aes256Gcm::new_from_slice(kek).map_err(|e| format!("AES-GCM key init failed: {e}"))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| format!("AES-GCM encrypt failed: {e}"))?;

    // Output: nonce (12) || ciphertext+tag (32+16=48)
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Unwrap (decrypt) a wrapped secret key using the KEK.
///
/// Expects `wrapped` to be the output of [`wrap_secret`]:
/// `[nonce: 12 bytes][ciphertext+tag: 48 bytes]` = 60 bytes.
///
/// # Errors
/// Returns `Err(String)` on decryption failure, wrong key, or malformed input.
#[cfg(not(target_arch = "wasm32"))]
pub fn unwrap_secret(wrapped: &[u8], kek: &[u8; 32]) -> Result<[u8; 32], String> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    if wrapped.len() < 12 + 16 {
        return Err(format!(
            "wrapped secret too short: {} bytes (expected ≥ 28)",
            wrapped.len()
        ));
    }

    let cipher =
        Aes256Gcm::new_from_slice(kek).map_err(|e| format!("AES-GCM key init failed: {e}"))?;

    let nonce = Nonce::from_slice(&wrapped[..12]);
    let plaintext = cipher
        .decrypt(nonce, &wrapped[12..])
        .map_err(|_| "AES-GCM decryption failed — wrong KEK or corrupted ciphertext".to_string())?;

    let len = plaintext.len();
    plaintext
        .try_into()
        .map_err(|_| format!("decrypted value is not 32 bytes (got {len})"))
}

// ── Grace window policy ───────────────────────────────────────────

/// Key status for lifecycle enforcement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyStatus {
    /// Key is active — signatures are accepted and new requests may use it.
    Active,
    /// Key is retiring — signatures are still accepted (grace window). No new requests.
    Retiring,
    /// Key is retired — signatures are rejected.
    Retired,
    /// Key was explicitly revoked — signatures are rejected immediately.
    Revoked,
}

/// Determine whether a key should be accepted for signature verification.
///
/// # Arguments
/// * `status`              — The current key status.
/// * `rotated_at_ms`       — Unix ms when rotation was initiated (0 = not yet rotated).
/// * `grace_window_secs`   — Grace window duration in seconds (e.g. 172800 = 48 h).
/// * `now_ms`              — Current Unix millisecond timestamp.
///
/// Returns `true` if the key should be accepted, `false` if rejected.
pub fn is_key_accepted(
    status: &KeyStatus,
    rotated_at_ms: u64,
    grace_window_secs: u64,
    now_ms: u64,
) -> bool {
    match status {
        KeyStatus::Active => true,
        KeyStatus::Retiring => {
            // Accept if still within grace window
            let grace_end_ms = rotated_at_ms + grace_window_secs * 1000;
            now_ms < grace_end_ms
        }
        KeyStatus::Retired | KeyStatus::Revoked => false,
    }
}

/// Compute how many milliseconds remain in the grace window.
///
/// Returns `None` if the key is not in `Retiring` status or has no `rotated_at`.
/// Returns `Some(0)` if the grace window has already expired.
pub fn grace_remaining_ms(rotated_at_ms: u64, grace_window_secs: u64, now_ms: u64) -> u64 {
    let grace_end_ms = rotated_at_ms + grace_window_secs * 1000;
    grace_end_ms.saturating_sub(now_ms)
}

// ── Re-exports from identity module ──────────────────────────────

/// Sign a canonical payload with a (wrapped) key that has been unwrapped.
/// This is a thin re-export to keep callers from depending on `identity` directly.
pub fn sign_with_key(sk: &[u8; 32], payload: &[u8]) -> Result<[u8; 64], String> {
    sign_submission(sk, payload)
}

/// Verify a signature against a stored public key.
pub fn verify_with_key(pk: &[u8; 32], payload: &[u8], sig: &[u8; 64]) -> bool {
    verify_submission(pk, payload, sig)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_id_from_pubkey_deterministic() {
        let (_, _, pk, _) = generate_versioned_keypair(0);
        let id1 = key_id_from_pubkey(&pk);
        let id2 = key_id_from_pubkey(&pk);
        assert_eq!(id1, id2, "key ID must be deterministic");
        assert_eq!(id1.len(), 16, "key ID must be 16 hex chars");
    }

    #[test]
    fn test_key_id_from_pubkey_unique() {
        let (id1, _, pk1, _) = generate_versioned_keypair(0);
        let (id2, _, pk2, _) = generate_versioned_keypair(0);
        assert_ne!(pk1, pk2, "two keypairs must have different public keys");
        assert_ne!(id1, id2, "two keypairs must have different key IDs");
    }

    #[test]
    fn test_versioned_keypair_version_increment() {
        let (_, _, _, v1) = generate_versioned_keypair(0);
        let (_, _, _, v2) = generate_versioned_keypair(v1);
        let (_, _, _, v3) = generate_versioned_keypair(v2);
        assert_eq!(v1, 1);
        assert_eq!(v2, 2);
        assert_eq!(v3, 3);
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_wrap_unwrap_roundtrip() {
        let kek: [u8; 32] = [0x42u8; 32];
        let (_, sk, _, _) = generate_versioned_keypair(0);
        let wrapped = wrap_secret(&sk, &kek).expect("wrap must succeed");
        assert_eq!(wrapped.len(), 60, "wrapped output must be 60 bytes (12+48)");
        let recovered = unwrap_secret(&wrapped, &kek).expect("unwrap must succeed");
        assert_eq!(recovered, sk, "unwrapped key must match original");
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_wrap_produces_different_ciphertexts() {
        let kek: [u8; 32] = [0x11u8; 32];
        let (_, sk, _, _) = generate_versioned_keypair(0);
        let c1 = wrap_secret(&sk, &kek).expect("wrap 1");
        let c2 = wrap_secret(&sk, &kek).expect("wrap 2");
        assert_ne!(
            c1, c2,
            "two wraps of same key must produce different ciphertexts (random nonce)"
        );
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_unwrap_wrong_kek_fails() {
        let kek: [u8; 32] = [0x42u8; 32];
        let wrong_kek: [u8; 32] = [0x43u8; 32];
        let (_, sk, _, _) = generate_versioned_keypair(0);
        let wrapped = wrap_secret(&sk, &kek).expect("wrap");
        assert!(
            unwrap_secret(&wrapped, &wrong_kek).is_err(),
            "wrong KEK must fail to unwrap"
        );
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_unwrap_truncated_input_fails() {
        let kek: [u8; 32] = [0xaau8; 32];
        assert!(
            unwrap_secret(&[0u8; 10], &kek).is_err(),
            "truncated input must fail"
        );
    }

    #[test]
    fn test_is_key_accepted_active() {
        assert!(is_key_accepted(&KeyStatus::Active, 0, 172800, 1000));
    }

    #[test]
    fn test_is_key_accepted_retiring_in_window() {
        let rotated_at_ms = 1_000_000_000_000u64;
        let grace_secs = 172800u64; // 48 h
        let now_ms = rotated_at_ms + 1_000; // 1 second after rotation
        assert!(
            is_key_accepted(&KeyStatus::Retiring, rotated_at_ms, grace_secs, now_ms),
            "retiring key in grace window must be accepted"
        );
    }

    #[test]
    fn test_is_key_accepted_retiring_outside_window() {
        let rotated_at_ms = 1_000_000_000_000u64;
        let grace_secs = 3600u64; // 1 h
        let now_ms = rotated_at_ms + 3_600_001; // 1 ms past grace
        assert!(
            !is_key_accepted(&KeyStatus::Retiring, rotated_at_ms, grace_secs, now_ms),
            "retiring key past grace window must be rejected"
        );
    }

    #[test]
    fn test_is_key_accepted_revoked() {
        assert!(!is_key_accepted(&KeyStatus::Revoked, 0, 172800, 0));
    }

    #[test]
    fn test_is_key_accepted_retired() {
        assert!(!is_key_accepted(&KeyStatus::Retired, 0, 172800, 0));
    }

    #[test]
    fn test_grace_remaining_ms() {
        let rotated_at_ms = 1_000_000_000_000u64;
        let grace_secs = 3600u64;
        let now_ms = rotated_at_ms + 1000;
        let remaining = grace_remaining_ms(rotated_at_ms, grace_secs, now_ms);
        assert_eq!(
            remaining,
            3_600_000 - 1000,
            "grace remaining must be correct"
        );
    }

    #[test]
    fn test_grace_remaining_ms_expired() {
        let rotated_at_ms = 1_000_000_000_000u64;
        let grace_secs = 3600u64;
        let now_ms = rotated_at_ms + 4_000_000; // way past
        let remaining = grace_remaining_ms(rotated_at_ms, grace_secs, now_ms);
        assert_eq!(remaining, 0, "expired grace window must return 0");
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn test_sign_verify_with_wrapped_key() {
        let kek: [u8; 32] = [0x77u8; 32];
        let (_, sk, pk, _) = generate_versioned_keypair(0);
        let wrapped = wrap_secret(&sk, &kek).expect("wrap");
        let recovered_sk = unwrap_secret(&wrapped, &kek).expect("unwrap");
        let payload = b"test-canonical-payload";
        let sig = sign_with_key(&recovered_sk, payload).expect("sign");
        assert!(
            verify_with_key(&pk, payload, &sig),
            "signature from unwrapped key must verify"
        );
    }
}
