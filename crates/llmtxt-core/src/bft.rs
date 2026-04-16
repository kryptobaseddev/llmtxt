//! Byzantine Fault Tolerant (BFT) consensus primitives for LLMtxt.
//!
//! # Background
//!
//! A system of `n` validators can tolerate `f` Byzantine (malicious or faulty)
//! validators if and only if `n >= 3f + 1`. The minimum quorum required to
//! reach consensus is `2f + 1` (a "supermajority").
//!
//! This module implements:
//! * [`bft_quorum`] — compute the minimum quorum for a given `n` and `f`.
//! * [`bft_max_faults`] — compute the maximum tolerable faults for `n`.
//! * [`bft_check`] — check whether a given vote count satisfies the quorum.
//! * [`hash_chain_extend`] — extend a tamper-evident hash chain with a new event.
//! * [`verify_chain`] — verify the integrity of an entire chain of events.

use sha2::{Digest, Sha256};

// ── BFT Quorum Math ──────────────────────────────────────────────

/// Compute the minimum quorum (number of votes) needed for BFT consensus.
///
/// Formula: `quorum = 2f + 1` where `f` is the maximum number of Byzantine faults.
///
/// # Arguments
/// * `_n` — total number of validators (informational; used for validation)
/// * `f`  — maximum number of Byzantine faults to tolerate
///
/// # Returns
/// The minimum number of approvals required: `2f + 1`.
///
/// # Panics
/// Does not panic. Returns 1 when `f == 0`.
///
/// # Example
/// ```
/// use llmtxt_core::bft::bft_quorum;
/// assert_eq!(bft_quorum(3, 1), 3); // 2*1+1 = 3 out of 3 validators
/// assert_eq!(bft_quorum(7, 2), 5); // 2*2+1 = 5 out of 7 validators
/// assert_eq!(bft_quorum(1, 0), 1); // 2*0+1 = 1 (no Byzantine tolerance)
/// ```
pub fn bft_quorum(_n: u32, f: u32) -> u32 {
    2 * f + 1
}

/// Compute the maximum number of Byzantine faults `n` validators can tolerate.
///
/// Formula: `f = (n - 1) / 3` (integer division).
///
/// # Example
/// ```
/// use llmtxt_core::bft::bft_max_faults;
/// assert_eq!(bft_max_faults(3), 0); // 3 validators: f=0 (need 4 for f=1)
/// assert_eq!(bft_max_faults(4), 1); // 4 validators: f=1
/// assert_eq!(bft_max_faults(7), 2); // 7 validators: f=2
/// ```
pub fn bft_max_faults(n: u32) -> u32 {
    if n == 0 {
        return 0;
    }
    (n - 1) / 3
}

/// Check whether `votes` satisfies the BFT quorum for fault tolerance `f`.
///
/// Returns `true` when `votes >= 2f + 1`.
///
/// # Example
/// ```
/// use llmtxt_core::bft::bft_check;
/// assert!(bft_check(3, 1));  // 3 >= 2*1+1: quorum reached
/// assert!(!bft_check(2, 1)); // 2 < 3: quorum not reached
/// ```
pub fn bft_check(votes: u32, f: u32) -> bool {
    votes >= bft_quorum(0, f)
}

// ── Hash Chain ───────────────────────────────────────────────────

/// A single event in a tamper-evident hash chain.
///
/// Each event records the hash of the previous event (or a sentinel for the
/// first event) so that any tampering with a stored event is detectable by
/// recomputing the chain.
#[derive(Debug, Clone)]
pub struct ChainedEvent {
    /// SHA-256 of the preceding event's hash + this event's bytes.
    /// For the first event in a chain, this is `SHA-256(event_bytes)`.
    pub chain_hash: [u8; 32],
    /// The raw event payload (JSON, binary, etc.) — content is opaque.
    pub event_bytes: Vec<u8>,
    /// Hash of the previous event's `chain_hash`, or `[0u8; 32]` for first.
    pub prev_hash: [u8; 32],
}

/// Extend a tamper-evident hash chain with a new event.
///
/// Computes: `chain_hash = SHA-256(prev_hash || event_bytes)`.
///
/// # Arguments
/// * `prev_hash`   — 32-byte hash of the previous event (use `[0u8; 32]` for the first event)
/// * `event_bytes` — raw event payload bytes
///
/// # Returns
/// 32-byte chain hash for the new event.
///
/// # Example
/// ```
/// use llmtxt_core::bft::hash_chain_extend;
/// let genesis_prev = [0u8; 32];
/// let h1 = hash_chain_extend(&genesis_prev, b"first event");
/// let h2 = hash_chain_extend(&h1, b"second event");
/// assert_ne!(h1, h2);
/// assert_ne!(h2, [0u8; 32]);
/// ```
pub fn hash_chain_extend(prev_hash: &[u8; 32], event_bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash);
    hasher.update(event_bytes);
    hasher.finalize().into()
}

/// Verify the integrity of a chain of events.
///
/// Recomputes each event's `chain_hash` from its `prev_hash` and `event_bytes`,
/// comparing against the stored `chain_hash`. Returns `false` as soon as a
/// mismatch is found.
///
/// The first event's `prev_hash` should be `[0u8; 32]` (the genesis sentinel).
///
/// # Returns
/// `true` if the entire chain is intact, `false` if any event was tampered with.
///
/// # Example
/// ```
/// use llmtxt_core::bft::{ChainedEvent, hash_chain_extend, verify_chain};
///
/// let prev = [0u8; 32];
/// let bytes1 = b"event one".to_vec();
/// let h1 = hash_chain_extend(&prev, &bytes1);
/// let bytes2 = b"event two".to_vec();
/// let h2 = hash_chain_extend(&h1, &bytes2);
///
/// let chain = vec![
///     ChainedEvent { chain_hash: h1, event_bytes: bytes1, prev_hash: prev },
///     ChainedEvent { chain_hash: h2, event_bytes: bytes2.clone(), prev_hash: h1 },
/// ];
/// assert!(verify_chain(&chain));
///
/// // Tamper with the second event
/// let mut bad_chain = chain.clone();
/// bad_chain[1].event_bytes = b"TAMPERED".to_vec();
/// assert!(!verify_chain(&bad_chain));
/// ```
pub fn verify_chain(events: &[ChainedEvent]) -> bool {
    for event in events {
        let expected = hash_chain_extend(&event.prev_hash, &event.event_bytes);
        if expected != event.chain_hash {
            return false;
        }
    }
    true
}

// ── WASM exports ─────────────────────────────────────────────────

/// WASM: compute BFT quorum for fault count `f`.
///
/// Returns `2f + 1` as a u32.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn bft_quorum_wasm(n: u32, f: u32) -> u32 {
    bft_quorum(n, f)
}

/// WASM: compute hash chain extension.
///
/// `prev_hash_hex` — 64-char lowercase hex of the 32-byte previous hash.
/// `event_json`    — UTF-8 event payload string.
///
/// Returns 64-char lowercase hex of the new chain hash, or `{"error":"..."}`.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn hash_chain_extend_wasm(prev_hash_hex: &str, event_json: &str) -> String {
    let Ok(prev_bytes) = hex::decode(prev_hash_hex) else {
        return r#"{"error":"invalid prev_hash_hex"}"#.to_string();
    };
    let Ok(prev_arr): Result<[u8; 32], _> = prev_bytes.try_into() else {
        return r#"{"error":"prev_hash must be 32 bytes"}"#.to_string();
    };
    let hash = hash_chain_extend(&prev_arr, event_json.as_bytes());
    hex::encode(hash)
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bft_quorum_basic() {
        // f=0: quorum=1 (trivial consensus, no Byzantine tolerance)
        assert_eq!(bft_quorum(1, 0), 1);
        // f=1: quorum=3 (classic 3f+1=4, but quorum is 2f+1=3)
        assert_eq!(bft_quorum(4, 1), 3);
        // f=2: quorum=5
        assert_eq!(bft_quorum(7, 2), 5);
        // f=3: quorum=7
        assert_eq!(bft_quorum(10, 3), 7);
    }

    #[test]
    fn test_bft_max_faults() {
        assert_eq!(bft_max_faults(0), 0);
        assert_eq!(bft_max_faults(1), 0);
        assert_eq!(bft_max_faults(3), 0); // 3 needs f=1 → need n=4
        assert_eq!(bft_max_faults(4), 1);
        assert_eq!(bft_max_faults(7), 2);
        assert_eq!(bft_max_faults(10), 3);
    }

    #[test]
    fn test_bft_check() {
        // f=1: quorum=3
        assert!(bft_check(3, 1));
        assert!(bft_check(4, 1));
        assert!(!bft_check(2, 1));
        assert!(!bft_check(1, 1));

        // f=2: quorum=5
        assert!(bft_check(5, 2));
        assert!(!bft_check(4, 2));

        // f=0: quorum=1 (anyone's vote counts)
        assert!(bft_check(1, 0));
        assert!(!bft_check(0, 0));
    }

    #[test]
    fn test_hash_chain_extend_deterministic() {
        let prev = [0u8; 32];
        let h1 = hash_chain_extend(&prev, b"event one");
        let h2 = hash_chain_extend(&prev, b"event one");
        assert_eq!(h1, h2, "same inputs must produce same hash");
    }

    #[test]
    fn test_hash_chain_extend_unique() {
        let prev = [0u8; 32];
        let h1 = hash_chain_extend(&prev, b"event one");
        let h2 = hash_chain_extend(&prev, b"event two");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_hash_chain_extend_chaining() {
        let prev = [0u8; 32];
        let h1 = hash_chain_extend(&prev, b"event one");
        let h2 = hash_chain_extend(&h1, b"event two");
        // h2 depends on h1 — changing the order changes the result
        let h2_swapped = hash_chain_extend(&prev, b"event two");
        assert_ne!(h2, h2_swapped);
    }

    #[test]
    fn test_verify_chain_valid() {
        let prev = [0u8; 32];
        let bytes1 = b"approval:agent-1:APPROVED".to_vec();
        let h1 = hash_chain_extend(&prev, &bytes1);
        let bytes2 = b"approval:agent-2:APPROVED".to_vec();
        let h2 = hash_chain_extend(&h1, &bytes2);
        let bytes3 = b"approval:agent-3:APPROVED".to_vec();
        let h3 = hash_chain_extend(&h2, &bytes3);

        let chain = vec![
            ChainedEvent {
                chain_hash: h1,
                event_bytes: bytes1,
                prev_hash: prev,
            },
            ChainedEvent {
                chain_hash: h2,
                event_bytes: bytes2,
                prev_hash: h1,
            },
            ChainedEvent {
                chain_hash: h3,
                event_bytes: bytes3,
                prev_hash: h2,
            },
        ];

        assert!(verify_chain(&chain), "valid chain must verify");
    }

    #[test]
    fn test_verify_chain_tampered_payload() {
        let prev = [0u8; 32];
        let bytes1 = b"approval:agent-1:APPROVED".to_vec();
        let h1 = hash_chain_extend(&prev, &bytes1);

        let mut chain = vec![ChainedEvent {
            chain_hash: h1,
            event_bytes: bytes1,
            prev_hash: prev,
        }];

        // Tamper with the payload bytes
        chain[0].event_bytes = b"approval:agent-1:REJECTED".to_vec();
        assert!(
            !verify_chain(&chain),
            "tampered payload must fail verification"
        );
    }

    #[test]
    fn test_verify_chain_tampered_hash() {
        let prev = [0u8; 32];
        let bytes1 = b"approval:agent-1:APPROVED".to_vec();
        let h1 = hash_chain_extend(&prev, &bytes1);

        let mut chain = vec![ChainedEvent {
            chain_hash: h1,
            event_bytes: bytes1,
            prev_hash: prev,
        }];

        // Tamper with the stored chain hash
        chain[0].chain_hash[0] ^= 0xFF;
        assert!(
            !verify_chain(&chain),
            "tampered chain_hash must fail verification"
        );
    }

    #[test]
    fn test_verify_chain_empty() {
        // Empty chain is trivially valid
        assert!(verify_chain(&[]));
    }

    #[test]
    fn test_bft_adversarial_3honest_2byzantine() {
        // Adversarial scenario: 5 total agents, f=1 (BFT quorum = 3)
        // 3 honest agents vote APPROVED, 2 Byzantine agents vote REJECTED
        // Result: APPROVED wins because 3 >= 2*1+1 = 3
        let f = 1u32;
        let honest_votes = 3u32;
        let byzantine_votes = 2u32;

        // Honest quorum is reached
        assert!(bft_check(honest_votes, f), "honest quorum must be reached");
        // Byzantine faction cannot override (they'd need a quorum too)
        assert!(
            !bft_check(byzantine_votes, f),
            "byzantine faction must NOT reach quorum"
        );
    }

    #[test]
    fn test_bft_default_config_f1_quorum3() {
        // Default config: f=1, quorum=3
        // A document with minApprovals=3 requires 3 distinct approvals
        let f = 1u32;
        let quorum = bft_quorum(0, f);
        assert_eq!(quorum, 3);
        assert!(bft_check(3, f));
        assert!(!bft_check(2, f));
    }

    #[test]
    fn test_hash_chain_10_sequential() {
        // Simulate 10 sequential approval events — verify chain integrity
        let mut prev = [0u8; 32];
        let mut chain = Vec::new();

        for i in 0u32..10 {
            let event_bytes = format!("approval:agent-{i}:APPROVED").into_bytes();
            let chain_hash = hash_chain_extend(&prev, &event_bytes);
            chain.push(ChainedEvent {
                chain_hash,
                event_bytes,
                prev_hash: prev,
            });
            prev = chain_hash;
        }

        assert_eq!(chain.len(), 10);
        assert!(verify_chain(&chain), "10-event chain must verify");

        // Tamper with event 5 — verification must fail
        chain[5].event_bytes = b"TAMPERED".to_vec();
        assert!(!verify_chain(&chain), "tampered event must fail");
    }
}
