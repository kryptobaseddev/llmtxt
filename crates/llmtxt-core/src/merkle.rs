//! Binary SHA-256 Merkle tree for the tamper-evident audit log (T164).
//!
//! # Conventions
//! - Leaves are 32-byte SHA-256 digests of canonically serialized audit events.
//! - Internal nodes: `SHA-256(left_child || right_child)`.
//! - Odd node duplication: when a level has an odd number of nodes, the last
//!   node is duplicated before pairing (Bitcoin convention).
//! - Empty tree root: `[0u8; 32]`.
//! - Single-leaf root: the leaf itself (no hashing needed).
//!
//! The native and WASM implementations produce byte-identical output.

use sha2::{Digest, Sha256};

/// Compute the SHA-256 Merkle root over a slice of 32-byte leaf hashes.
///
/// Returns `[0u8; 32]` for an empty slice.
/// Returns the leaf unchanged for a single-element slice.
///
/// # Example
/// ```
/// use llmtxt_core::merkle::merkle_root;
///
/// let leaf1 = [1u8; 32];
/// let leaf2 = [2u8; 32];
/// let root = merkle_root(&[leaf1, leaf2]);
/// assert_ne!(root, [0u8; 32]);
///
/// // Single leaf → root equals the leaf.
/// let single = merkle_root(&[[42u8; 32]]);
/// assert_eq!(single, [42u8; 32]);
///
/// // Empty → zero sentinel.
/// let empty = merkle_root(&[]);
/// assert_eq!(empty, [0u8; 32]);
/// ```
pub fn merkle_root(leaves: &[[u8; 32]]) -> [u8; 32] {
    if leaves.is_empty() {
        return [0u8; 32];
    }
    if leaves.len() == 1 {
        return leaves[0];
    }

    // Work on a mutable level buffer.
    let mut level: Vec<[u8; 32]> = leaves.to_vec();

    while level.len() > 1 {
        let mut next: Vec<[u8; 32]> = Vec::with_capacity(level.len().div_ceil(2));

        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            // Duplicate the last node if the level has an odd count.
            let right = if i + 1 < level.len() {
                level[i + 1]
            } else {
                level[i]
            };

            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            next.push(hasher.finalize().into());

            i += 2;
        }

        level = next;
    }

    level[0]
}

/// Verify a Merkle inclusion proof.
///
/// `proof` is a slice of `(sibling_hash, is_right)` pairs, ordered from the
/// leaf level upward to (but not including) the root level.
///
/// - `is_right = true`  → the sibling is to the **right** of the current node.
/// - `is_right = false` → the sibling is to the **left** of the current node.
///
/// Returns `true` if the computed root matches `root`.
///
/// # Example
/// ```
/// use llmtxt_core::merkle::{merkle_root, verify_merkle_proof};
///
/// let leaves = [[1u8; 32], [2u8; 32], [3u8; 32], [4u8; 32]];
/// let root = merkle_root(&leaves);
///
/// // Build proof for leaf index 0.
/// // Level 0: sibling is leaves[1] (right).
/// // Level 1: sibling is hash(leaves[2], leaves[3]) (right).
/// use sha2::{Digest, Sha256};
/// let h01: [u8; 32] = {
///     let mut h = Sha256::new();
///     h.update([1u8; 32]);
///     h.update([2u8; 32]);
///     h.finalize().into()
/// };
/// let h23: [u8; 32] = {
///     let mut h = Sha256::new();
///     h.update([3u8; 32]);
///     h.update([4u8; 32]);
///     h.finalize().into()
/// };
/// let _ = h01; // used internally; not needed to construct the proof
///
/// let sibling_of_leaf0 = [2u8; 32]; // leaves[1]
/// let sibling_of_h01 = h23;         // hash(leaves[2], leaves[3])
///
/// let proof: Vec<([u8; 32], bool)> = vec![
///     (sibling_of_leaf0, true),  // sibling is to the right
///     (sibling_of_h01, true),    // sibling is to the right
/// ];
///
/// assert!(verify_merkle_proof(&root, &[1u8; 32], &proof));
/// assert!(!verify_merkle_proof(&root, &[99u8; 32], &proof));
/// ```
pub fn verify_merkle_proof(root: &[u8; 32], leaf: &[u8; 32], proof: &[([u8; 32], bool)]) -> bool {
    let mut current = *leaf;

    for &(sibling, is_right_sibling) in proof {
        let mut hasher = Sha256::new();
        if is_right_sibling {
            // sibling is to the right → current is left
            hasher.update(current);
            hasher.update(sibling);
        } else {
            // sibling is to the left → current is right
            hasher.update(sibling);
            hasher.update(current);
        }
        current = hasher.finalize().into();
    }

    &current == root
}

/// A single audit log entry for chain verification.
///
/// Fields correspond directly to `audit_logs` table columns (T164 schema).
pub struct AuditEntry<'a> {
    pub id: &'a str,
    pub event_type: &'a str,
    pub actor_id: &'a str,
    pub resource_id: &'a str,
    pub timestamp_ms: u64,
    /// The stored `chain_hash` hex string (64 lowercase hex chars).
    pub stored_chain_hash_hex: &'a str,
}

/// Compute the `payload_hash` for a single audit log entry.
///
/// Canonical serialization: `"{id}|{event_type}|{actor_id}|{resource_id}|{timestamp_ms}"`.
/// NULL fields MUST be passed as the empty string `""`.
///
/// This matches the TypeScript `canonicalEventStr` in `apps/backend/src/middleware/audit.ts`.
/// Returns the 32-byte raw SHA-256 digest.
///
/// # Example
/// ```
/// use llmtxt_core::merkle::hash_audit_entry;
///
/// let h = hash_audit_entry("id-1", "auth.login", "user-a", "", 1_000_000);
/// assert_eq!(h.len(), 32);
/// assert_ne!(h, [0u8; 32]);
/// ```
pub fn hash_audit_entry(
    id: &str,
    event_type: &str,
    actor_id: &str,
    resource_id: &str,
    timestamp_ms: u64,
) -> [u8; 32] {
    let canonical = format!("{id}|{event_type}|{actor_id}|{resource_id}|{timestamp_ms}");
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hasher.finalize().into()
}

/// The 32-byte genesis sentinel: `[0u8; 32]`.
const GENESIS_HASH_BYTES: [u8; 32] = [0u8; 32];

/// Compute `chain_hash = SHA-256(prev_chain_hash_bytes || payload_hash_bytes)`.
fn compute_chain_hash_bytes(prev: &[u8; 32], payload: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(prev);
    hasher.update(payload);
    hasher.finalize().into()
}

/// Verify the audit log hash chain for a slice of entries.
///
/// Entries MUST be ordered by `timestamp ASC` (same order as T164's verify endpoint).
/// Verification starts from the genesis sentinel (`[0u8; 32]`).
///
/// Returns `true` when every stored `chain_hash` exactly matches the recomputed value.
/// Returns `false` on the first mismatch. An empty slice returns `true`.
///
/// # Example
/// ```
/// use llmtxt_core::merkle::{hash_audit_entry, AuditEntry, verify_audit_chain};
/// use sha2::{Digest, Sha256};
///
/// let id1 = "row-1";
/// let payload1 = hash_audit_entry(id1, "auth.login", "alice", "", 1000);
/// let genesis = [0u8; 32];
/// let chain1_raw: [u8; 32] = {
///     let mut h = Sha256::new();
///     h.update(genesis);
///     h.update(payload1);
///     h.finalize().into()
/// };
/// let chain1_hex = hex::encode(chain1_raw);
///
/// let entries = [
///     AuditEntry { id: id1, event_type: "auth.login", actor_id: "alice",
///                  resource_id: "", timestamp_ms: 1000, stored_chain_hash_hex: &chain1_hex },
/// ];
/// assert!(verify_audit_chain(&entries));
/// ```
pub fn verify_audit_chain(entries: &[AuditEntry<'_>]) -> bool {
    let mut prev = GENESIS_HASH_BYTES;

    for entry in entries {
        let payload = hash_audit_entry(
            entry.id,
            entry.event_type,
            entry.actor_id,
            entry.resource_id,
            entry.timestamp_ms,
        );
        let expected_chain = compute_chain_hash_bytes(&prev, &payload);

        let stored_bytes = match hex::decode(entry.stored_chain_hash_hex) {
            Ok(b) if b.len() == 32 => {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(&b);
                arr
            }
            _ => return false,
        };

        if expected_chain != stored_bytes {
            return false;
        }

        prev = expected_chain;
    }

    true
}

/// Sign a Merkle root with an ed25519 private key.
///
/// The signed message is: `"{root_hex}|{date_str}"` (ASCII, pipe-separated).
///
/// Returns `(signature_hex, key_id)` where:
/// - `signature_hex` is 128-char lowercase hex (64-byte ed25519 signature).
/// - `key_id` is the first 16 hex chars of `SHA-256(pubkey_hex)` — a deterministic
///   public fingerprint safe to publish.
///
/// # Errors
/// Returns an error string if `root_hex` is not 64 chars.
///
/// # Example
/// ```
/// use llmtxt_core::merkle::sign_merkle_root;
///
/// let sk = [42u8; 32];
/// let root_hex = "a".repeat(64);
/// let (sig, key_id) = sign_merkle_root(&sk, &root_hex, "2026-04-18").unwrap();
/// assert_eq!(sig.len(), 128);
/// assert_eq!(key_id.len(), 16);
/// ```
pub fn sign_merkle_root(
    sk_bytes: &[u8; 32],
    root_hex: &str,
    date_str: &str,
) -> Result<(String, String), String> {
    use ed25519_dalek::{Signature, Signer, SigningKey};

    if root_hex.len() != 64 {
        return Err(format!("root_hex must be 64 chars, got {}", root_hex.len()));
    }

    let signing_key = SigningKey::from_bytes(sk_bytes);
    let verifying_key = signing_key.verifying_key();
    let pubkey_hex = hex::encode(verifying_key.to_bytes());

    let payload = format!("{root_hex}|{date_str}");
    let sig: Signature = signing_key.sign(payload.as_bytes());
    let sig_hex = hex::encode(sig.to_bytes());

    let mut hasher = Sha256::new();
    hasher.update(pubkey_hex.as_bytes());
    let key_id_full = hex::encode(hasher.finalize());
    let key_id = key_id_full[..16].to_string();

    Ok((sig_hex, key_id))
}

/// Verify a Merkle root signature produced by [`sign_merkle_root`].
///
/// Returns `true` if the signature is valid for the given public key, root, and date.
pub fn verify_merkle_root_signature(
    pk_bytes: &[u8; 32],
    root_hex: &str,
    date_str: &str,
    sig_hex: &str,
) -> bool {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};

    let Ok(verifying_key) = VerifyingKey::from_bytes(pk_bytes) else {
        return false;
    };
    let sig_bytes = match hex::decode(sig_hex) {
        Ok(b) if b.len() == 64 => {
            let mut arr = [0u8; 64];
            arr.copy_from_slice(&b);
            arr
        }
        _ => return false,
    };
    let sig = Signature::from_bytes(&sig_bytes);
    let payload = format!("{root_hex}|{date_str}");
    verifying_key.verify(payload.as_bytes(), &sig).is_ok()
}

/// WASM: compute Merkle root over an array of leaf hashes.
///
/// `leaves_hex_json` — JSON array of 64-character lowercase hex strings,
/// one per leaf (each representing a 32-byte SHA-256 digest).
///
/// Returns a 64-character lowercase hex string of the root, or
/// `{"error":"..."}` on invalid input.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn merkle_root_wasm(leaves_hex_json: &str) -> String {
    let leaf_strs: Vec<String> = match serde_json::from_str(leaves_hex_json) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"invalid JSON: {e}"}}"#),
    };

    let mut leaves: Vec<[u8; 32]> = Vec::with_capacity(leaf_strs.len());
    for s in &leaf_strs {
        let bytes = match hex::decode(s) {
            Ok(b) => b,
            Err(e) => return format!(r#"{{"error":"invalid hex: {e}"}}"#),
        };
        let arr: [u8; 32] = match bytes.try_into() {
            Ok(a) => a,
            Err(_) => return r#"{"error":"leaf must be 32 bytes (64 hex chars)"}"#.to_string(),
        };
        leaves.push(arr);
    }

    hex::encode(merkle_root(&leaves))
}

/// WASM: verify a Merkle inclusion proof.
///
/// `root_hex`  — 64-char hex root.
/// `leaf_hex`  — 64-char hex leaf.
/// `proof_json` — JSON array of `[siblingHex, isRightSibling]` pairs.
///
/// Returns `"true"` or `"false"`, or `{"error":"..."}` on invalid input.
#[cfg(feature = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn verify_merkle_proof_wasm(root_hex: &str, leaf_hex: &str, proof_json: &str) -> String {
    let parse_32 = |s: &str| -> Result<[u8; 32], String> {
        let bytes = hex::decode(s).map_err(|e| format!("invalid hex: {e}"))?;
        bytes
            .try_into()
            .map_err(|_| "must be 32 bytes (64 hex chars)".to_string())
    };

    let root = match parse_32(root_hex) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"root: {e}"}}"#),
    };
    let leaf = match parse_32(leaf_hex) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"leaf: {e}"}}"#),
    };

    // proof_json: [[sibHex, isRight], ...]
    let raw: Vec<(String, bool)> = match serde_json::from_str(proof_json) {
        Ok(v) => v,
        Err(e) => return format!(r#"{{"error":"invalid proof JSON: {e}"}}"#),
    };

    let mut proof: Vec<([u8; 32], bool)> = Vec::with_capacity(raw.len());
    for (hex_str, is_right) in &raw {
        match parse_32(hex_str) {
            Ok(arr) => proof.push((arr, *is_right)),
            Err(e) => return format!(r#"{{"error":"proof sibling: {e}"}}"#),
        }
    }

    if verify_merkle_proof(&root, &leaf, &proof) {
        "true".to_string()
    } else {
        "false".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn sha256(data: &[u8]) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(data);
        h.finalize().into()
    }

    fn pair_hash(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(left);
        h.update(right);
        h.finalize().into()
    }

    #[test]
    fn test_empty_tree() {
        assert_eq!(merkle_root(&[]), [0u8; 32]);
    }

    #[test]
    fn test_single_leaf() {
        let leaf = sha256(b"single event");
        assert_eq!(merkle_root(&[leaf]), leaf);
    }

    #[test]
    fn test_two_leaves() {
        let l1 = sha256(b"event one");
        let l2 = sha256(b"event two");
        let expected = pair_hash(l1, l2);
        assert_eq!(merkle_root(&[l1, l2]), expected);
    }

    #[test]
    fn test_three_leaves_odd_duplication() {
        let l1 = sha256(b"event one");
        let l2 = sha256(b"event two");
        let l3 = sha256(b"event three");

        // Level 0: [l1, l2, l3] → pair (l1,l2) and duplicate l3
        let h12 = pair_hash(l1, l2);
        let h33 = pair_hash(l3, l3); // odd duplication
        let expected = pair_hash(h12, h33);
        assert_eq!(merkle_root(&[l1, l2, l3]), expected);
    }

    #[test]
    fn test_four_leaves() {
        let l1 = sha256(b"e1");
        let l2 = sha256(b"e2");
        let l3 = sha256(b"e3");
        let l4 = sha256(b"e4");

        let h12 = pair_hash(l1, l2);
        let h34 = pair_hash(l3, l4);
        let expected = pair_hash(h12, h34);
        assert_eq!(merkle_root(&[l1, l2, l3, l4]), expected);
    }

    #[test]
    fn test_eight_leaves() {
        let leaves: Vec<[u8; 32]> = (0u8..8).map(|i| sha256(&[i])).collect();
        let root = merkle_root(&leaves);
        assert_ne!(root, [0u8; 32]);

        // Recompute manually for 8 leaves (balanced)
        let h01 = pair_hash(leaves[0], leaves[1]);
        let h23 = pair_hash(leaves[2], leaves[3]);
        let h45 = pair_hash(leaves[4], leaves[5]);
        let h67 = pair_hash(leaves[6], leaves[7]);
        let h0123 = pair_hash(h01, h23);
        let h4567 = pair_hash(h45, h67);
        let expected = pair_hash(h0123, h4567);
        assert_eq!(root, expected);
    }

    #[test]
    fn test_deterministic() {
        let leaves = [sha256(b"a"), sha256(b"b"), sha256(b"c")];
        let r1 = merkle_root(&leaves);
        let r2 = merkle_root(&leaves);
        assert_eq!(r1, r2, "merkle_root must be deterministic");
    }

    #[test]
    fn test_different_order_different_root() {
        let l1 = sha256(b"first");
        let l2 = sha256(b"second");
        let r1 = merkle_root(&[l1, l2]);
        let r2 = merkle_root(&[l2, l1]);
        assert_ne!(r1, r2, "order matters for Merkle root");
    }

    #[test]
    fn test_verify_proof_two_leaves() {
        let l1 = sha256(b"event one");
        let l2 = sha256(b"event two");
        let root = merkle_root(&[l1, l2]);

        // Proof for leaf l1: sibling is l2 (to the right)
        let proof_l1 = vec![(l2, true)];
        assert!(verify_merkle_proof(&root, &l1, &proof_l1));

        // Proof for leaf l2: sibling is l1 (to the left)
        let proof_l2 = vec![(l1, false)];
        assert!(verify_merkle_proof(&root, &l2, &proof_l2));
    }

    #[test]
    fn test_verify_proof_four_leaves_all_indices() {
        let l1 = sha256(b"e1");
        let l2 = sha256(b"e2");
        let l3 = sha256(b"e3");
        let l4 = sha256(b"e4");
        let leaves = [l1, l2, l3, l4];
        let root = merkle_root(&leaves);

        let h12 = pair_hash(l1, l2);
        let h34 = pair_hash(l3, l4);

        // Index 0: sibling l2 (right), sibling h34 (right)
        let p0 = vec![(l2, true), (h34, true)];
        assert!(verify_merkle_proof(&root, &l1, &p0));

        // Index 1: sibling l1 (left), sibling h34 (right)
        let p1 = vec![(l1, false), (h34, true)];
        assert!(verify_merkle_proof(&root, &l2, &p1));

        // Index 2: sibling l4 (right), sibling h12 (left)
        let p2 = vec![(l4, true), (h12, false)];
        assert!(verify_merkle_proof(&root, &l3, &p2));

        // Index 3: sibling l3 (left), sibling h12 (left)
        let p3 = vec![(l3, false), (h12, false)];
        assert!(verify_merkle_proof(&root, &l4, &p3));
    }

    #[test]
    fn test_verify_proof_wrong_leaf_fails() {
        let l1 = sha256(b"event one");
        let l2 = sha256(b"event two");
        let root = merkle_root(&[l1, l2]);

        let wrong_leaf = sha256(b"TAMPERED");
        let proof = vec![(l2, true)];
        assert!(!verify_merkle_proof(&root, &wrong_leaf, &proof));
    }

    #[test]
    fn test_verify_proof_wrong_root_fails() {
        let l1 = sha256(b"event one");
        let l2 = sha256(b"event two");
        let root = merkle_root(&[l1, l2]);

        let mut bad_root = root;
        bad_root[0] ^= 0xFF;

        let proof = vec![(l2, true)];
        assert!(!verify_merkle_proof(&bad_root, &l1, &proof));
    }

    #[test]
    fn test_verify_empty_proof_single_leaf() {
        // A single-leaf tree: root == leaf, proof is empty.
        let leaf = sha256(b"solo event");
        let root = merkle_root(&[leaf]);
        assert_eq!(root, leaf);
        // Empty proof: just check root == leaf directly (valid by definition).
        assert!(verify_merkle_proof(&root, &leaf, &[]));
    }

    #[test]
    fn test_byte_identity_native_wasm_equivalent() {
        // Verify that the native computation is deterministic in a way that
        // a WASM re-implementation would replicate (same algorithm, same output).
        let leaves: Vec<[u8; 32]> = vec![
            sha256(b"audit:auth.login:user1:none:1000"),
            sha256(b"audit:doc.create:agent2:doc-abc:2000"),
            sha256(b"audit:lifecycle.transition:agent3:doc-abc:3000"),
        ];
        let root1 = merkle_root(&leaves);
        let root2 = merkle_root(&leaves);
        assert_eq!(root1, root2, "byte-identical across two calls");
        assert_ne!(root1, [0u8; 32]);
    }

    // ── T107: hash_audit_entry tests ─────────────────────────────────────────

    #[test]
    fn test_hash_audit_entry_deterministic() {
        let h1 = hash_audit_entry("id-1", "auth.login", "alice", "", 1_000_000);
        let h2 = hash_audit_entry("id-1", "auth.login", "alice", "", 1_000_000);
        assert_eq!(h1, h2, "must be deterministic");
    }

    #[test]
    fn test_hash_audit_entry_field_sensitivity() {
        let h1 = hash_audit_entry("id-1", "auth.login", "alice", "", 1_000);
        let h2 = hash_audit_entry("id-2", "auth.login", "alice", "", 1_000);
        let h3 = hash_audit_entry("id-1", "auth.logout", "alice", "", 1_000);
        let h4 = hash_audit_entry("id-1", "auth.login", "alice", "", 2_000);
        assert_ne!(h1, h2, "id change must alter hash");
        assert_ne!(h1, h3, "event_type change must alter hash");
        assert_ne!(h1, h4, "timestamp change must alter hash");
    }

    #[test]
    fn test_hash_audit_entry_null_fields_as_empty() {
        let h = hash_audit_entry("id-1", "auth.login", "", "", 1_000);
        assert_ne!(h, [0u8; 32]);
        let h2 = hash_audit_entry("id-1", "auth.login", "", "", 1_000);
        assert_eq!(h, h2);
    }

    // ── T107: verify_audit_chain tests ───────────────────────────────────────

    fn build_chain(entries: &[(&str, &str, &str, &str, u64)]) -> Vec<String> {
        let mut prev = [0u8; 32]; // genesis
        let mut chain_hashes = Vec::new();
        for (id, event_type, actor_id, resource_id, ts) in entries {
            let payload = hash_audit_entry(id, event_type, actor_id, resource_id, *ts);
            let chain = compute_chain_hash_bytes(&prev, &payload);
            chain_hashes.push(hex::encode(chain));
            prev = chain;
        }
        chain_hashes
    }

    #[test]
    fn test_verify_audit_chain_empty() {
        assert!(verify_audit_chain(&[]), "empty chain is vacuously valid");
    }

    #[test]
    fn test_verify_audit_chain_single_entry() {
        let id = "row-1";
        let et = "auth.login";
        let ac = "alice";
        let ri = "";
        let ts = 1_000u64;
        let hashes = build_chain(&[(id, et, ac, ri, ts)]);
        let entries = [AuditEntry {
            id,
            event_type: et,
            actor_id: ac,
            resource_id: ri,
            timestamp_ms: ts,
            stored_chain_hash_hex: &hashes[0],
        }];
        assert!(verify_audit_chain(&entries));
    }

    #[test]
    fn test_verify_audit_chain_multi_entry() {
        let data: &[(&str, &str, &str, &str, u64)] = &[
            ("row-1", "auth.login", "alice", "", 1_000),
            ("row-2", "document.create", "alice", "doc-abc", 2_000),
            ("row-3", "lifecycle.transition", "bob", "doc-abc", 3_000),
        ];
        let hashes = build_chain(data);
        let entries: Vec<AuditEntry<'_>> = data
            .iter()
            .enumerate()
            .map(|(i, (id, et, ac, ri, ts))| AuditEntry {
                id,
                event_type: et,
                actor_id: ac,
                resource_id: ri,
                timestamp_ms: *ts,
                stored_chain_hash_hex: &hashes[i],
            })
            .collect();
        assert!(verify_audit_chain(&entries), "valid 3-entry chain");
    }

    #[test]
    fn test_verify_audit_chain_tampered_payload() {
        let data: &[(&str, &str, &str, &str, u64)] = &[
            ("row-1", "auth.login", "alice", "", 1_000),
            ("row-2", "document.create", "alice", "doc-abc", 2_000),
        ];
        let hashes = build_chain(data);
        // Tamper: change event_type on row-2 but keep original chain_hash.
        let entries = [
            AuditEntry {
                id: "row-1",
                event_type: "auth.login",
                actor_id: "alice",
                resource_id: "",
                timestamp_ms: 1_000,
                stored_chain_hash_hex: &hashes[0],
            },
            AuditEntry {
                id: "row-2",
                event_type: "TAMPERED_EVENT",
                actor_id: "alice",
                resource_id: "doc-abc",
                timestamp_ms: 2_000,
                stored_chain_hash_hex: &hashes[1],
            },
        ];
        assert!(!verify_audit_chain(&entries), "tampered entry must fail");
    }

    #[test]
    fn test_verify_audit_chain_tampered_chain_hash() {
        let data: &[(&str, &str, &str, &str, u64)] = &[("row-1", "auth.login", "alice", "", 1_000)];
        let hashes = build_chain(data);
        let mut bad_hash = hex::decode(&hashes[0]).unwrap();
        bad_hash[0] ^= 0xFF;
        let bad_hash_hex = hex::encode(bad_hash);
        let entries = [AuditEntry {
            id: "row-1",
            event_type: "auth.login",
            actor_id: "alice",
            resource_id: "",
            timestamp_ms: 1_000,
            stored_chain_hash_hex: &bad_hash_hex,
        }];
        assert!(
            !verify_audit_chain(&entries),
            "corrupt chain_hash must fail"
        );
    }

    // ── T107: sign_merkle_root + verify_merkle_root_signature tests ──────────

    #[test]
    fn test_sign_and_verify_merkle_root() {
        let sk = [7u8; 32];
        let root_hex = "ab".repeat(32);
        let date_str = "2026-04-18";
        let (sig_hex, key_id) = sign_merkle_root(&sk, &root_hex, date_str).unwrap();
        assert_eq!(sig_hex.len(), 128, "signature must be 128 hex chars");
        assert_eq!(key_id.len(), 16, "key_id must be 16 hex chars");

        let signing_key = SigningKey::from_bytes(&sk);
        let pk = signing_key.verifying_key().to_bytes();
        assert!(
            verify_merkle_root_signature(&pk, &root_hex, date_str, &sig_hex),
            "signature must verify with correct pubkey"
        );
    }

    #[test]
    fn test_verify_merkle_root_signature_wrong_date_fails() {
        let sk = [7u8; 32];
        let root_hex = "cd".repeat(32);
        let (sig_hex, _) = sign_merkle_root(&sk, &root_hex, "2026-04-18").unwrap();
        let signing_key = SigningKey::from_bytes(&sk);
        let pk = signing_key.verifying_key().to_bytes();
        assert!(
            !verify_merkle_root_signature(&pk, &root_hex, "2026-04-19", &sig_hex),
            "wrong date must fail verification"
        );
    }

    #[test]
    fn test_verify_merkle_root_signature_wrong_key_fails() {
        let sk = [7u8; 32];
        let root_hex = "ef".repeat(32);
        let date = "2026-04-18";
        let (sig_hex, _) = sign_merkle_root(&sk, &root_hex, date).unwrap();
        let wrong_pk = [99u8; 32];
        assert!(
            !verify_merkle_root_signature(&wrong_pk, &root_hex, date, &sig_hex),
            "wrong key must fail verification"
        );
    }

    #[test]
    fn test_sign_merkle_root_key_id_deterministic() {
        let sk = [7u8; 32];
        let root1 = "aa".repeat(32);
        let root2 = "bb".repeat(32);
        let (_, id1) = sign_merkle_root(&sk, &root1, "2026-04-18").unwrap();
        let (_, id2) = sign_merkle_root(&sk, &root2, "2026-04-18").unwrap();
        assert_eq!(id1, id2, "key_id must be deterministic for the same sk");
    }

    #[test]
    fn test_sign_merkle_root_invalid_root_hex_rejected() {
        let sk = [7u8; 32];
        let result = sign_merkle_root(&sk, "tooshort", "2026-04-18");
        assert!(result.is_err(), "short root_hex must be rejected");
    }
}
