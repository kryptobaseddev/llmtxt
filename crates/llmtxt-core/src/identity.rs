//! Agent identity primitives — Ed25519 key generation, signing, and
//! canonical-payload construction for the LLMtxt Verifiable Agent Identity
//! epic (T147).
//!
//! # Canonical payload format
//!
//! ```text
//! METHOD\nPATH_AND_QUERY\nTIMESTAMP_MS\nAGENT_ID\nNONCE_HEX\nBODY_HASH_HEX
//! ```
//!
//! All fields are separated by a single newline (`\n`). `BODY_HASH_HEX` is the
//! lowercase hex encoding of `SHA-256(body_bytes)`.
//!
//! # Security properties
//!
//! * Ed25519 signatures bind the request identity to the exact bytes of the
//!   canonical payload — any single-bit mutation causes verification to fail.
//! * The nonce is caller-supplied (random, ≥ 16 bytes) and must be unique per
//!   agent within the 5-minute timestamp window.  The backend records seen
//!   nonces in `agent_signature_nonces` and rejects replays.
//! * Timestamps outside the window `[now − 5 min, now + 1 min]` are rejected
//!   by the backend middleware to limit the replay surface.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand_core::OsRng;
use sha2::{Digest, Sha256};

// ── Key generation ───────────────────────────────────────────────

/// Generate a fresh Ed25519 keypair.
///
/// Returns `(secret_key_bytes, public_key_bytes)` where each is 32 bytes.
///
/// The secret key is the seed / scalar bytes (not the expanded form).
/// Feed it to [`sign_submission`] unchanged.
pub fn keygen() -> ([u8; 32], [u8; 32]) {
    let sk = SigningKey::generate(&mut OsRng);
    let pk: [u8; 32] = sk.verifying_key().to_bytes();
    let sk_bytes: [u8; 32] = sk.to_bytes();
    (sk_bytes, pk)
}

// ── Canonical payload ────────────────────────────────────────────

/// Compute the SHA-256 digest of the request body bytes.
///
/// Returns 32 raw bytes (not hex-encoded).
pub fn body_hash(body: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(body);
    h.finalize().into()
}

/// Construct the canonical payload that is signed / verified.
///
/// Fields are newline-separated in this order:
/// 1. `method`          — e.g. `"PUT"` (uppercase)
/// 2. `path_and_query`  — e.g. `"/api/v1/documents/abc123"`
/// 3. `timestamp_ms`    — decimal milliseconds since epoch as string
/// 4. `agent_id`        — caller-supplied string identifier
/// 5. `nonce_hex`       — hex-encoded nonce (≥ 16 bytes → ≥ 32 hex chars)
/// 6. `body_hash_hex`   — lowercase hex of `SHA-256(body)` (64 chars)
pub fn canonical_payload(
    method: &str,
    path_and_query: &str,
    timestamp_ms: u64,
    agent_id: &str,
    nonce_hex: &str,
    body_hash_hex: &str,
) -> Vec<u8> {
    format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method, path_and_query, timestamp_ms, agent_id, nonce_hex, body_hash_hex
    )
    .into_bytes()
}

// ── Sign ─────────────────────────────────────────────────────────

/// Sign a canonical payload with the given 32-byte Ed25519 secret key.
///
/// Returns a 64-byte raw signature.
///
/// # Errors
/// Returns `Err(String)` if `sk` is not a valid 32-byte secret key.
pub fn sign_submission(sk: &[u8; 32], payload: &[u8]) -> Result<[u8; 64], String> {
    let signing_key = SigningKey::from_bytes(sk);
    let sig: Signature = signing_key.sign(payload);
    Ok(sig.to_bytes())
}

// ── Verify ───────────────────────────────────────────────────────

/// Verify a 64-byte Ed25519 signature against a canonical payload.
///
/// Returns `true` when the signature is valid for the given public key,
/// `false` for any mismatch (wrong key, tampered payload, malformed bytes).
///
/// # Arguments
/// * `pk`      — 32-byte Ed25519 public key (compressed point)
/// * `payload` — the canonical payload bytes (see [`canonical_payload`])
/// * `sig`     — 64-byte raw Ed25519 signature
pub fn verify_submission(pk: &[u8; 32], payload: &[u8], sig: &[u8; 64]) -> bool {
    let Ok(verifying_key) = VerifyingKey::from_bytes(pk) else {
        return false;
    };
    let signature = Signature::from_bytes(sig);
    verifying_key.verify(payload, &signature).is_ok()
}

// ── WASM exports ─────────────────────────────────────────────────

/// WASM: generate an Ed25519 keypair.
///
/// Returns JSON `{"sk":"<hex64>","pk":"<hex64>"}`.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn identity_keygen() -> String {
    let (sk, pk) = keygen();
    format!(
        r#"{{"sk":"{}","pk":"{}"}}"#,
        hex::encode(sk),
        hex::encode(pk)
    )
}

/// WASM: sign a submission.
///
/// * `sk_hex`  — 64-char hex of the 32-byte secret key
/// * `payload` — raw payload bytes
///
/// Returns 128-char hex of the 64-byte signature, or `{"error":"..."}`.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn identity_sign(sk_hex: &str, payload: &[u8]) -> String {
    let Ok(sk_bytes) = hex::decode(sk_hex) else {
        return r#"{"error":"invalid sk hex"}"#.to_string();
    };
    let Ok(sk_arr): Result<[u8; 32], _> = sk_bytes.try_into() else {
        return r#"{"error":"sk must be 32 bytes"}"#.to_string();
    };
    match sign_submission(&sk_arr, payload) {
        Ok(sig) => hex::encode(sig),
        Err(e) => format!(r#"{{"error":"{}"}}"#, e),
    }
}

/// WASM: verify a submission signature.
///
/// * `pk_hex`  — 64-char hex of the 32-byte public key
/// * `payload` — raw payload bytes
/// * `sig_hex` — 128-char hex of the 64-byte signature
///
/// Returns `"true"` or `"false"`.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn identity_verify(pk_hex: &str, payload: &[u8], sig_hex: &str) -> bool {
    let Ok(pk_bytes) = hex::decode(pk_hex) else {
        return false;
    };
    let Ok(pk_arr): Result<[u8; 32], _> = pk_bytes.try_into() else {
        return false;
    };
    let Ok(sig_bytes) = hex::decode(sig_hex) else {
        return false;
    };
    let Ok(sig_arr): Result<[u8; 64], _> = sig_bytes.try_into() else {
        return false;
    };
    verify_submission(&pk_arr, payload, &sig_arr)
}

/// WASM: build canonical payload bytes.
///
/// Returns the raw UTF-8 bytes of the canonical payload string.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn identity_canonical_payload(
    method: &str,
    path_and_query: &str,
    timestamp_ms: f64,
    agent_id: &str,
    nonce_hex: &str,
    body_hash_hex: &str,
) -> Vec<u8> {
    canonical_payload(
        method,
        path_and_query,
        timestamp_ms as u64,
        agent_id,
        nonce_hex,
        body_hash_hex,
    )
}

/// WASM: compute SHA-256 body hash as lowercase hex.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn identity_body_hash_hex(body: &[u8]) -> String {
    hex::encode(body_hash(body))
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip: generate → sign → verify.
    #[test]
    fn test_keygen_sign_verify_roundtrip() {
        let (sk, pk) = keygen();
        let payload = b"PUT\n/api/v1/documents/abc\n1700000000000\nagent-1\naabbccdd\nhash";
        let sig = sign_submission(&sk, payload).expect("sign must succeed");
        assert!(
            verify_submission(&pk, payload, &sig),
            "valid signature must verify"
        );
    }

    /// Tamper test: flipping a single byte in the payload must cause verification to fail.
    #[test]
    fn test_tamper_body_fails() {
        let (sk, pk) = keygen();
        let payload = b"PUT\n/api/v1/documents/abc\n1700000000000\nagent-1\naabbccdd\nhash";
        let sig = sign_submission(&sk, payload).expect("sign must succeed");

        let mut tampered = payload.to_vec();
        tampered[0] ^= 0x01; // flip one bit
        assert!(
            !verify_submission(&pk, &tampered, &sig),
            "tampered payload must not verify"
        );
    }

    /// Wrong-key test: a signature made with key A must not verify under key B.
    #[test]
    fn test_wrong_key_fails() {
        let (sk_a, _pk_a) = keygen();
        let (_sk_b, pk_b) = keygen();
        let payload = b"POST\n/api/v1/documents\n1700000000001\nagent-2\ndeadbeef\nhash2";
        let sig = sign_submission(&sk_a, payload).expect("sign must succeed");
        assert!(
            !verify_submission(&pk_b, payload, &sig),
            "signature from key-A must not verify under key-B"
        );
    }

    /// Empty-body test: SHA-256 of empty slice is a known constant.
    #[test]
    fn test_body_hash_empty() {
        let h = body_hash(b"");
        // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb924...
        assert_eq!(h[0], 0xe3);
        assert_eq!(h[1], 0xb0);
    }

    /// Sign and verify with an empty body (hash of empty).
    #[test]
    fn test_sign_verify_empty_body() {
        let (sk, pk) = keygen();
        let bh = body_hash(b"");
        let bh_hex = hex::encode(bh);
        let payload = canonical_payload(
            "POST",
            "/api/v1/documents",
            1700000000000,
            "agent-3",
            "0011223344556677",
            &bh_hex,
        );
        let sig = sign_submission(&sk, &payload).expect("sign must succeed");
        assert!(
            verify_submission(&pk, &payload, &sig),
            "empty-body canonical payload must verify"
        );
    }

    /// Canonical payload ordering test.
    #[test]
    fn test_canonical_payload_format() {
        let p = canonical_payload(
            "GET",
            "/api/v1/doc",
            1700000000042,
            "ag-1",
            "noncehex",
            "bodyhash",
        );
        let s = String::from_utf8(p).unwrap();
        let parts: Vec<&str> = s.splitn(6, '\n').collect();
        assert_eq!(parts[0], "GET");
        assert_eq!(parts[1], "/api/v1/doc");
        assert_eq!(parts[2], "1700000000042");
        assert_eq!(parts[3], "ag-1");
        assert_eq!(parts[4], "noncehex");
        assert_eq!(parts[5], "bodyhash");
    }
}
