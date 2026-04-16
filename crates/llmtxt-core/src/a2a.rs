//! Agent-to-Agent (A2A) message envelope primitives.
//!
//! Defines a canonical, signed message envelope that agents can use to
//! communicate in a tamper-evident, verifiable way — regardless of transport
//! (scratchpad, HTTP inbox, future channels).
//!
//! # Format (canonical bytes)
//!
//! ```text
//! from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex
//! ```
//!
//! All fields separated by a single `\n`. The signature covers these bytes
//! exactly.  `payload_hash_hex` is the lowercase hex SHA-256 of the raw
//! payload bytes.
//!
//! # Security properties
//! * Ed25519 signature binds `from`, `to`, `nonce`, `timestamp`, and payload hash.
//! * The nonce prevents replay attacks within the same timestamp window.
//! * Receivers SHOULD verify the signature against the sender's registered pubkey.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ── Types ─────────────────────────────────────────────────────────

/// Canonical A2A message envelope.
///
/// Transmitted as JSON; the `signature` field is over the canonical bytes
/// (see [`A2AMessage::canonical_bytes`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AMessage {
    /// Sender agent identifier.
    pub from: String,
    /// Recipient agent identifier (or `"*"` for broadcast).
    pub to: String,
    /// Random nonce — hex, ≥ 16 bytes → ≥ 32 hex chars.
    pub nonce: String,
    /// Milliseconds since Unix epoch.
    pub timestamp_ms: u64,
    /// Ed25519 signature over canonical bytes (128-char lowercase hex of 64 bytes).
    pub signature: String,
    /// MIME-like content type descriptor, e.g. `"application/json"` or `"text/plain"`.
    pub content_type: String,
    /// Raw payload bytes (arbitrary, opaque to the envelope layer).
    #[serde(with = "serde_bytes_as_base64")]
    pub payload: Vec<u8>,
}

/// Serde helper: serialize Vec<u8> as base64, deserialize from base64.
mod serde_bytes_as_base64 {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // Use standard base64 alphabet
        let b64 = encode_base64(bytes);
        b64.serialize(s)
    }

    pub fn deserialize<'de, D>(d: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(d)?;
        decode_base64(&s).map_err(serde::de::Error::custom)
    }

    fn encode_base64(input: &[u8]) -> String {
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let cap = input.len().div_ceil(3) * 4;
        let mut out = String::with_capacity(cap);
        for chunk in input.chunks(3) {
            let b0 = chunk[0] as usize;
            let b1 = if chunk.len() > 1 {
                chunk[1] as usize
            } else {
                0
            };
            let b2 = if chunk.len() > 2 {
                chunk[2] as usize
            } else {
                0
            };
            out.push(CHARS[b0 >> 2] as char);
            out.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
            if chunk.len() > 1 {
                out.push(CHARS[((b1 & 0xF) << 2) | (b2 >> 6)] as char);
            } else {
                out.push('=');
            }
            if chunk.len() > 2 {
                out.push(CHARS[b2 & 0x3F] as char);
            } else {
                out.push('=');
            }
        }
        out
    }

    fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
        let input = input.trim_end_matches('=');
        let mut out = Vec::with_capacity(input.len() * 3 / 4);
        let mut buf = 0u32;
        let mut bits = 0u8;
        for ch in input.bytes() {
            let v = match ch {
                b'A'..=b'Z' => ch - b'A',
                b'a'..=b'z' => ch - b'a' + 26,
                b'0'..=b'9' => ch - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                _ => return Err(format!("invalid base64 char: {ch}")),
            } as u32;
            buf = (buf << 6) | v;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
                buf &= (1 << bits) - 1;
            }
        }
        Ok(out)
    }
}

// ── Canonical bytes ───────────────────────────────────────────────

impl A2AMessage {
    /// Build the canonical bytes that are signed / verified.
    ///
    /// Format: `from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex`
    ///
    /// `payload_hash_hex` is the lowercase hex SHA-256 of `self.payload`.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let payload_hash = {
            let mut h = Sha256::new();
            h.update(&self.payload);
            hex::encode(h.finalize())
        };
        format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            self.from, self.to, self.nonce, self.timestamp_ms, self.content_type, payload_hash
        )
        .into_bytes()
    }

    /// Sign this message with a 32-byte Ed25519 secret key.
    ///
    /// Sets `self.signature` to the 128-char lowercase hex of the 64-byte signature.
    ///
    /// # Errors
    /// Returns `Err(String)` if the key is invalid.
    pub fn sign(&mut self, sk: &[u8; 32]) -> Result<(), String> {
        let payload = self.canonical_bytes();
        let signing_key = SigningKey::from_bytes(sk);
        let sig: Signature = signing_key.sign(&payload);
        self.signature = hex::encode(sig.to_bytes());
        Ok(())
    }

    /// Verify this message's signature against a 32-byte Ed25519 public key.
    ///
    /// Returns `true` if the signature is valid for the stored `from`, `to`,
    /// `nonce`, `timestamp_ms`, `content_type`, and `payload`.
    pub fn verify(&self, pk: &[u8; 32]) -> bool {
        let Ok(verifying_key) = VerifyingKey::from_bytes(pk) else {
            return false;
        };
        let Ok(sig_bytes) = hex::decode(&self.signature) else {
            return false;
        };
        let Ok(sig_arr): Result<[u8; 64], _> = sig_bytes.try_into() else {
            return false;
        };
        let signature = Signature::from_bytes(&sig_arr);
        let payload = self.canonical_bytes();
        verifying_key.verify(&payload, &signature).is_ok()
    }

    /// Build a new unsigned envelope (signature is empty — call [`sign`] before sending).
    ///
    /// [`sign`]: A2AMessage::sign
    pub fn build(
        from: impl Into<String>,
        to: impl Into<String>,
        nonce: impl Into<String>,
        timestamp_ms: u64,
        content_type: impl Into<String>,
        payload: Vec<u8>,
    ) -> Self {
        A2AMessage {
            from: from.into(),
            to: to.into(),
            nonce: nonce.into(),
            timestamp_ms,
            signature: String::new(),
            content_type: content_type.into(),
            payload,
        }
    }
}

// ── WASM exports ─────────────────────────────────────────────────

/// WASM: build and sign an A2A message.
///
/// Parameters:
/// * `from_id`      — sender agent identifier
/// * `to_id`        — recipient agent identifier
/// * `nonce_hex`    — 32-char hex nonce (16 random bytes)
/// * `timestamp_ms` — milliseconds since epoch
/// * `content_type` — e.g. `"application/json"`
/// * `payload_b64`  — base64-encoded payload bytes
/// * `sk_hex`       — 64-char hex of the 32-byte secret key
///
/// Returns JSON-serialized [`A2AMessage`], or `{"error":"..."}`.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn a2a_build_and_sign(
    from_id: &str,
    to_id: &str,
    nonce_hex: &str,
    timestamp_ms: f64,
    content_type: &str,
    payload_b64: &str,
    sk_hex: &str,
) -> String {
    let Ok(sk_bytes) = hex::decode(sk_hex) else {
        return r#"{"error":"invalid sk_hex"}"#.to_string();
    };
    let Ok(sk_arr): Result<[u8; 32], _> = sk_bytes.try_into() else {
        return r#"{"error":"sk must be 32 bytes"}"#.to_string();
    };

    // Decode base64 payload
    let payload = match decode_b64_simple(payload_b64) {
        Ok(b) => b,
        Err(e) => return format!(r#"{{"error":"invalid payload_b64: {e}"}}"#),
    };

    let mut msg = A2AMessage::build(
        from_id,
        to_id,
        nonce_hex,
        timestamp_ms as u64,
        content_type,
        payload,
    );

    if let Err(e) = msg.sign(&sk_arr) {
        return format!(r#"{{"error":"sign failed: {e}"}}"#);
    }

    serde_json::to_string(&msg)
        .unwrap_or_else(|e| format!(r#"{{"error":"serialize failed: {e}"}}"#))
}

/// WASM: verify an A2A message JSON against a public key.
///
/// Returns `"true"` or `"false"`.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn a2a_verify(msg_json: &str, pk_hex: &str) -> bool {
    let Ok(msg): Result<A2AMessage, _> = serde_json::from_str(msg_json) else {
        return false;
    };
    let Ok(pk_bytes) = hex::decode(pk_hex) else {
        return false;
    };
    let Ok(pk_arr): Result<[u8; 32], _> = pk_bytes.try_into() else {
        return false;
    };
    msg.verify(&pk_arr)
}

#[cfg(feature = "wasm")]
fn decode_b64_simple(input: &str) -> Result<Vec<u8>, String> {
    let input = input.trim_end_matches('=');
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u8;
    for ch in input.bytes() {
        let v = match ch {
            b'A'..=b'Z' => ch - b'A',
            b'a'..=b'z' => ch - b'a' + 26,
            b'0'..=b'9' => ch - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(format!("invalid base64 char: {ch}")),
        } as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::keygen;

    #[test]
    fn test_a2a_build_sign_verify_roundtrip() {
        let (sk, pk) = keygen();
        let mut msg = A2AMessage::build(
            "agent-alice",
            "agent-bob",
            "aabbccdd00112233aabbccdd00112233",
            1_700_000_000_000,
            "application/json",
            br#"{"action":"ping"}"#.to_vec(),
        );
        msg.sign(&sk).expect("sign must succeed");
        assert!(!msg.signature.is_empty(), "signature must be set");
        assert!(msg.verify(&pk), "valid signature must verify");
    }

    #[test]
    fn test_a2a_tampered_payload_fails() {
        let (sk, pk) = keygen();
        let mut msg = A2AMessage::build(
            "agent-alice",
            "agent-bob",
            "aabbccdd00112233aabbccdd00112233",
            1_700_000_000_000,
            "application/json",
            b"original payload".to_vec(),
        );
        msg.sign(&sk).expect("sign must succeed");
        // Tamper with payload
        msg.payload = b"tampered payload".to_vec();
        assert!(!msg.verify(&pk), "tampered payload must not verify");
    }

    #[test]
    fn test_a2a_wrong_key_fails() {
        let (sk_a, _pk_a) = keygen();
        let (_sk_b, pk_b) = keygen();
        let mut msg = A2AMessage::build(
            "agent-alice",
            "agent-bob",
            "deadbeef00112233deadbeef00112233",
            1_700_000_000_001,
            "text/plain",
            b"hello".to_vec(),
        );
        msg.sign(&sk_a).expect("sign with key A");
        assert!(
            !msg.verify(&pk_b),
            "signature from key-A must not verify under key-B"
        );
    }

    #[test]
    fn test_a2a_canonical_bytes_deterministic() {
        let msg = A2AMessage {
            from: "alice".to_string(),
            to: "bob".to_string(),
            nonce: "nonce123".to_string(),
            timestamp_ms: 1_700_000_000,
            signature: "".to_string(),
            content_type: "application/json".to_string(),
            payload: b"{}".to_vec(),
        };
        let b1 = msg.canonical_bytes();
        let b2 = msg.canonical_bytes();
        assert_eq!(b1, b2, "canonical_bytes must be deterministic");
    }

    #[test]
    fn test_a2a_canonical_bytes_format() {
        let msg = A2AMessage {
            from: "alice".to_string(),
            to: "bob".to_string(),
            nonce: "nonce123".to_string(),
            timestamp_ms: 1_700_000_000,
            signature: "".to_string(),
            content_type: "text/plain".to_string(),
            payload: b"hello".to_vec(),
        };
        let bytes = msg.canonical_bytes();
        let s = String::from_utf8(bytes).unwrap();
        let parts: Vec<&str> = s.splitn(6, '\n').collect();
        assert_eq!(parts[0], "alice");
        assert_eq!(parts[1], "bob");
        assert_eq!(parts[2], "nonce123");
        assert_eq!(parts[3], "1700000000");
        assert_eq!(parts[4], "text/plain");
        // parts[5] is sha256("hello") hex
        assert_eq!(
            parts[5],
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_a2a_serde_roundtrip() {
        let (sk, pk) = keygen();
        let mut msg = A2AMessage::build(
            "agent-1",
            "agent-2",
            "0011223344556677",
            42_000,
            "application/json",
            br#"{"key":"value"}"#.to_vec(),
        );
        msg.sign(&sk).expect("sign must succeed");

        let json = serde_json::to_string(&msg).expect("serialize");
        let parsed: A2AMessage = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(parsed.from, "agent-1");
        assert_eq!(parsed.to, "agent-2");
        assert!(parsed.verify(&pk), "deserialized message must verify");
    }
}
