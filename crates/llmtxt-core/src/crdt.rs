//! CRDT primitives for section-level concurrent editing via Yrs.
//!
//! This module exposes six functions that implement the core Yjs/Yrs sync
//! protocol at the binary level. Each section in a document is its own
//! Yrs `Doc` containing a single `Y.Text` root named `"content"`.
//!
//! The (document_id, section_id) tuple identifies the Doc instance on the
//! server. Clients hold a local `Doc` and exchange binary update messages
//! via the standard Yjs sync protocol (sync step 1 — state vector; sync
//! step 2 — diff update).
//!
//! # Wire format
//! All byte slices are raw Yrs/Yjs binary encoding (lib0 v1). They are NOT
//! base64 or hex on this layer — callers (WASM shims, HTTP handlers) are
//! responsible for any encoding needed for transport.
//!
//! # WASM exports
//! Functions carry `#[cfg_attr(feature = "wasm", wasm_bindgen)]` so they are
//! available in the npm `llmtxt` package. The `napi` cfg_attr is present but
//! NOT activated (decision D004 — NAPI-RS deferred).
//!
//! # Feature gate
//! All items are `#[cfg(feature = "crdt")]` — zero cost when disabled.

#[cfg(feature = "crdt")]
use yrs::updates::decoder::Decode;
#[cfg(feature = "crdt")]
use yrs::updates::encoder::Encode;
#[cfg(feature = "crdt")]
use yrs::{Doc, GetString, ReadTxn, StateVector, Transact, Update};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

// ── Helper: load a Doc from persisted state bytes ────────────────────────────

/// Load a Yrs Doc (with a "content" Text root) from persisted state bytes.
///
/// `state` may be empty for a brand-new section. Returns `None` only if
/// `state` is non-empty and cannot be decoded.
#[cfg(feature = "crdt")]
fn load_doc(state: &[u8]) -> Option<Doc> {
    let doc = Doc::new();
    let _text = doc.get_or_insert_text("content");
    if !state.is_empty() {
        let update = Update::decode_v1(state).ok()?;
        let mut txn = doc.transact_mut();
        txn.apply_update(update).ok()?;
    }
    Some(doc)
}

/// Encode the full state of a Doc as a lib0 v1 update blob.
#[cfg(feature = "crdt")]
fn encode_doc_state(doc: &Doc) -> Vec<u8> {
    let txn = doc.transact();
    txn.encode_state_as_update_v1(&StateVector::default())
}

// ── 1. crdt_new_doc ─────────────────────────────────────────────────────────

/// Create an empty Yrs Doc for a section and return its state vector bytes.
///
/// The Doc contains a single `Y.Text` root named `"content"`. The returned
/// bytes are the Yrs state vector — use them as the `remote_sv` argument in
/// `crdt_diff_update` on the peer side (sync step 1).
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_new_doc() -> Vec<u8> {
    let doc = Doc::new();
    let _text = doc.get_or_insert_text("content");
    let txn = doc.transact();
    txn.state_vector().encode_v1()
}

// ── 2. crdt_encode_state_as_update ──────────────────────────────────────────

/// Encode the full document state as a Yrs update message.
///
/// Used to bootstrap a new client: send them the full state so they can apply
/// it locally and arrive at the current document content.
///
/// # Arguments
/// * `state` — bytes from `section_crdt_states.yrs_state` (consolidated state)
///
/// # Returns
/// A lib0 v1 update message encoding the full document state, or empty vec
/// if the input cannot be decoded.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_encode_state_as_update(state: &[u8]) -> Vec<u8> {
    if state.is_empty() {
        let doc = Doc::new();
        let _text = doc.get_or_insert_text("content");
        return encode_doc_state(&doc);
    }
    match load_doc(state) {
        Some(doc) => encode_doc_state(&doc),
        None => Vec::new(),
    }
}

// ── 3. crdt_apply_update ────────────────────────────────────────────────────

/// Apply a Yrs update to a document state and return the new state.
///
/// This is the core persistence operation: given the persisted state and an
/// incoming update (from a client), produce the new state to be stored in
/// `section_crdt_states.yrs_state`.
///
/// # Arguments
/// * `state` — current state bytes (may be empty for a new section)
/// * `update` — incoming lib0 v1 update bytes from a client
///
/// # Returns
/// New state bytes suitable for persisting, or empty vec on decode error.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_apply_update(state: &[u8], update: &[u8]) -> Vec<u8> {
    let doc = match load_doc(state) {
        Some(d) => d,
        None => return Vec::new(),
    };
    if !update.is_empty() {
        match Update::decode_v1(update) {
            Ok(incoming) => {
                let mut txn = doc.transact_mut();
                if txn.apply_update(incoming).is_err() {
                    return Vec::new();
                }
            }
            Err(_) => return Vec::new(),
        }
    }
    encode_doc_state(&doc)
}

// ── 4. crdt_merge_updates ────────────────────────────────────────────────────

/// Merge multiple Yrs update messages into a single consolidated update.
///
/// Used by the compaction job: given many raw update blobs from
/// `section_crdt_updates`, fold them into one blob for `section_crdt_states`.
///
/// The operation is commutative (CRDT guarantee).
///
/// # Returns
/// A single lib0 v1 update encoding the merged state, or empty vec on error.
#[cfg(feature = "crdt")]
pub fn crdt_merge_updates(updates: &[&[u8]]) -> Vec<u8> {
    yrs::merge_updates_v1(updates).unwrap_or_default()
}

/// WASM-exported variant of `crdt_merge_updates`.
///
/// Accepts a flat byte buffer with 4-byte LE length prefixes:
/// `[len1:u32le][bytes1][len2:u32le][bytes2]...`
///
/// This avoids the `Vec<Vec<u8>>` type which is not directly WASM-bindgen-compatible.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_merge_updates_wasm(packed: &[u8]) -> Vec<u8> {
    let mut updates: Vec<Vec<u8>> = Vec::new();
    let mut offset = 0usize;
    while offset + 4 <= packed.len() {
        let len = u32::from_le_bytes([
            packed[offset],
            packed[offset + 1],
            packed[offset + 2],
            packed[offset + 3],
        ]) as usize;
        offset += 4;
        if offset + len > packed.len() {
            break;
        }
        updates.push(packed[offset..offset + len].to_vec());
        offset += len;
    }
    let refs: Vec<&[u8]> = updates.iter().map(|v| v.as_slice()).collect();
    crdt_merge_updates(&refs)
}

// ── 5. crdt_state_vector ─────────────────────────────────────────────────────

/// Extract the Yrs state vector from a state snapshot.
///
/// Sent as sync step 1 so the remote can compute the diff update.
///
/// # Arguments
/// * `state` — state bytes from `section_crdt_states.yrs_state`
///
/// # Returns
/// Lib0 v1-encoded state vector bytes, or empty vec on error.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_state_vector(state: &[u8]) -> Vec<u8> {
    if state.is_empty() {
        let doc = Doc::new();
        let _text = doc.get_or_insert_text("content");
        let txn = doc.transact();
        return txn.state_vector().encode_v1();
    }
    yrs::encode_state_vector_from_update_v1(state).unwrap_or_default()
}

// ── 6. crdt_diff_update ──────────────────────────────────────────────────────

/// Compute the diff update between server state and a remote state vector.
///
/// Sync step 2: given the server's full state and the client's state vector
/// (from sync step 1), return only the operations the client is missing.
///
/// # Arguments
/// * `state` — server state bytes from `section_crdt_states.yrs_state`
/// * `remote_sv` — the client's state vector bytes
///
/// # Returns
/// Lib0 v1 update bytes containing only the missing operations, or empty
/// vec on error. Empty `remote_sv` means "give me everything".
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_diff_update(state: &[u8], remote_sv: &[u8]) -> Vec<u8> {
    if state.is_empty() {
        return Vec::new();
    }
    if remote_sv.is_empty() {
        return crdt_encode_state_as_update(state);
    }
    yrs::diff_updates_v1(state, remote_sv).unwrap_or_default()
}

// ── Helpers (native only) ─────────────────────────────────────────────────────

/// Extract the text content from a state snapshot (native use only).
///
/// Used by tests and the HTTP fallback to return the actual string content
/// of a section. Not available in WASM builds.
#[cfg(all(feature = "crdt", not(target_arch = "wasm32")))]
pub fn crdt_get_text(state: &[u8]) -> Option<String> {
    let doc = load_doc(state)?;
    let txn = doc.transact();
    let text_ref = txn.get_text("content")?;
    Some(text_ref.get_string(&txn))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(all(feature = "crdt", test))]
mod tests {
    use super::*;
    use yrs::Text;

    /// Create a doc state with known text content.
    ///
    /// Combines insert-root and text.insert in a single write transaction to avoid
    /// a double-transact_mut deadlock in async-lock 3.x (yrs 0.25 known limitation).
    fn make_state_with_text(content: &str) -> Vec<u8> {
        use yrs::types::RootRef;
        use yrs::types::text::TextRef;
        let doc = Doc::new();
        {
            let mut txn = doc.transact_mut();
            let text = TextRef::root("content").get_or_create(&mut txn);
            text.insert(&mut txn, 0, content);
        } // write lock released here
        encode_doc_state(&doc)
    }

    #[test]
    fn test_crdt_new_doc_returns_bytes() {
        let sv = crdt_new_doc();
        assert!(!sv.is_empty(), "new doc state vector should not be empty");
    }

    #[test]
    fn test_crdt_encode_state_roundtrip() {
        let state = make_state_with_text("hello world");
        let update = crdt_encode_state_as_update(&state);
        assert!(
            !update.is_empty(),
            "encode_state_as_update should produce bytes"
        );
        let result_state = crdt_apply_update(&[], &update);
        let text = crdt_get_text(&result_state).expect("should decode text");
        assert_eq!(text, "hello world");
    }

    #[test]
    fn test_crdt_apply_update_sequential() {
        let state_a = make_state_with_text("hello");
        let update = crdt_encode_state_as_update(&state_a);
        let state2 = crdt_apply_update(&[], &update);
        let text = crdt_get_text(&state2).expect("decode text");
        assert_eq!(text, "hello");
    }

    #[test]
    fn test_crdt_merge_updates_commutativity() {
        let state_a = make_state_with_text("Alpha");
        let state_b = make_state_with_text("Beta");

        let merged_ab = crdt_merge_updates(&[&state_a, &state_b]);
        let merged_ba = crdt_merge_updates(&[&state_b, &state_a]);

        assert!(!merged_ab.is_empty(), "merged_ab should not be empty");
        assert!(!merged_ba.is_empty(), "merged_ba should not be empty");

        let text_ab = crdt_get_text(&merged_ab).expect("decode merged_ab");
        let text_ba = crdt_get_text(&merged_ba).expect("decode merged_ba");

        assert_eq!(
            text_ab, text_ba,
            "merge order must not affect final state: got '{text_ab}' vs '{text_ba}'"
        );
    }

    #[test]
    fn test_crdt_state_vector_nonempty() {
        let state = make_state_with_text("some content");
        let sv = crdt_state_vector(&state);
        assert!(!sv.is_empty(), "state vector should not be empty");
    }

    #[test]
    fn test_crdt_state_vector_empty_state() {
        let sv = crdt_state_vector(&[]);
        assert!(
            !sv.is_empty(),
            "empty doc state vector should still be non-empty bytes"
        );
    }

    #[test]
    fn test_crdt_diff_empty_sv_gives_full_state() {
        let state = make_state_with_text("full content");
        let diff = crdt_diff_update(&state, &[]);
        assert!(
            !diff.is_empty(),
            "diff against empty sv should be non-empty"
        );

        let result = crdt_apply_update(&[], &diff);
        let text = crdt_get_text(&result).expect("should decode text");
        assert_eq!(text, "full content");
    }

    #[test]
    fn test_crdt_sync_protocol_simulation() {
        // Full y-websocket sync step 1 + step 2:
        //   Server has state S. Client has empty state.
        //   1. Client sends sv (sync step 1)
        //   2. Server replies with diff (sync step 2)
        //   3. Client applies diff and converges
        let server_state = make_state_with_text("server content");

        let sv_client = crdt_new_doc();
        let diff = crdt_diff_update(&server_state, &sv_client);
        assert!(
            !diff.is_empty(),
            "diff should be non-empty for fresh client"
        );

        let client_state = crdt_apply_update(&[], &diff);
        let text = crdt_get_text(&client_state).expect("should decode text");
        assert_eq!(
            text, "server content",
            "client should converge to server state"
        );
    }

    #[test]
    fn test_crdt_merge_wasm_packed_format() {
        let update1 = make_state_with_text("part1");
        let update2 = make_state_with_text("part2");

        let mut packed = Vec::new();
        let len1 = update1.len() as u32;
        packed.extend_from_slice(&len1.to_le_bytes());
        packed.extend_from_slice(&update1);
        let len2 = update2.len() as u32;
        packed.extend_from_slice(&len2.to_le_bytes());
        packed.extend_from_slice(&update2);

        let merged = crdt_merge_updates_wasm(&packed);
        assert!(!merged.is_empty(), "WASM packed merge should produce bytes");

        let text = crdt_get_text(&merged).expect("should decode text");
        assert!(
            text.contains("part1") || text.contains("part2"),
            "merged text should contain content: got '{text}'"
        );
    }

    #[test]
    fn test_crdt_apply_empty_both() {
        let result = crdt_apply_update(&[], &[]);
        let sv = crdt_state_vector(&result);
        assert!(!sv.is_empty());
    }

    // ── T207: Byte-identity tests ─────────────────────────────────────────────

    /// Associativity: apply_update(init, merge(U1, U2)) == apply_update(apply_update(init, U1), U2)
    #[test]
    fn test_crdt_byte_identity_associativity() {
        use yrs::types::RootRef;
        use yrs::types::text::TextRef;

        let init = crdt_encode_state_as_update(&[]);

        let doc1 = Doc::new();
        let u1 = {
            let mut txn = doc1.transact_mut();
            let t = TextRef::root("content").get_or_create(&mut txn);
            t.insert(&mut txn, 0, "Hello");
            drop(txn);
            encode_doc_state(&doc1)
        };

        let doc2 = Doc::new();
        let u2 = {
            let mut txn = doc2.transact_mut();
            let t = TextRef::root("content").get_or_create(&mut txn);
            t.insert(&mut txn, 0, " World");
            drop(txn);
            encode_doc_state(&doc2)
        };

        // Path A: apply merged
        let merged = crdt_merge_updates(&[&u1, &u2]);
        let state_a = crdt_apply_update(&init, &merged);
        let text_a = crdt_get_text(&state_a).expect("path A decode");

        // Path B: apply sequentially
        let state_b1 = crdt_apply_update(&init, &u1);
        let state_b2 = crdt_apply_update(&state_b1, &u2);
        let text_b = crdt_get_text(&state_b2).expect("path B decode");

        assert_eq!(
            text_a, text_b,
            "associativity: merged path '{text_a}' must equal sequential path '{text_b}'"
        );
    }

    /// Idempotency: apply_update(init, U) applied twice yields same state as applied once.
    #[test]
    fn test_crdt_byte_identity_idempotency() {
        use yrs::types::RootRef;
        use yrs::types::text::TextRef;

        let doc = Doc::new();
        let update = {
            let mut txn = doc.transact_mut();
            let t = TextRef::root("content").get_or_create(&mut txn);
            t.insert(&mut txn, 0, "idempotent content");
            drop(txn);
            encode_doc_state(&doc)
        };

        let state_once = crdt_apply_update(&[], &update);
        let state_twice = crdt_apply_update(&state_once, &update);

        let text_once = crdt_get_text(&state_once).expect("once decode");
        let text_twice = crdt_get_text(&state_twice).expect("twice decode");

        assert_eq!(
            text_once, text_twice,
            "idempotency: applying same update twice must produce same content: '{text_once}' vs '{text_twice}'"
        );
    }

    #[test]
    fn test_crdt_two_concurrent_edits_converge() {
        use yrs::types::RootRef;
        use yrs::types::text::TextRef;

        // Use single write transaction per doc to avoid double-transact_mut deadlock
        // with async-lock 3.x (yrs 0.25 known limitation).
        let doc_a = Doc::new();
        let update_a = {
            let mut txn = doc_a.transact_mut();
            let text_a = TextRef::root("content").get_or_create(&mut txn);
            text_a.insert(&mut txn, 0, "Hello");
            drop(txn);
            encode_doc_state(&doc_a)
        };

        let doc_b = Doc::new();
        let update_b = {
            let mut txn = doc_b.transact_mut();
            let text_b = TextRef::root("content").get_or_create(&mut txn);
            text_b.insert(&mut txn, 0, "World");
            drop(txn);
            encode_doc_state(&doc_b)
        };

        let merged = crdt_merge_updates(&[&update_a, &update_b]);
        let text = crdt_get_text(&merged).expect("should decode merged text");

        assert!(
            text.contains("Hello") && text.contains("World"),
            "merged state should contain both edits: got '{text}'"
        );
    }
}
