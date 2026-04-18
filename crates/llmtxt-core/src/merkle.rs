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

// ── Core native API ──────────────────────────────────────────────────────────

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
        let mut next: Vec<[u8; 32]> = Vec::with_capacity((level.len() + 1) / 2);

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

// ── WASM exports ─────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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
}
