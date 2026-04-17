//! CRDT primitives for section-level concurrent editing via Loro.
//!
//! This module exposes six functions that implement the core sync protocol
//! at the binary level. Each section in a document is its own [`LoroDoc`]
//! containing a single [`LoroText`] root named `"content"`.
//!
//! The (document_id, section_id) tuple identifies the Doc instance on the
//! server. Clients hold a local Doc and exchange binary blobs using the
//! Loro snapshot / update binary format (incompatible with the old Yrs
//! lib0 v1 encoding — see spec §3.3 for details).
//!
//! # Wire format
//! All byte slices are raw Loro binary (magic header `loro` + checksum +
//! mode bytes). They are NOT base64 or hex on this layer — callers (WASM
//! shims, HTTP handlers) are responsible for any encoding needed for transport.
//!
//! # WASM exports
//! Functions carry `#[cfg_attr(feature = "wasm", wasm_bindgen)]` so they are
//! available in the npm `llmtxt` package. The `napi` cfg_attr is present but
//! NOT activated (decision D004 — NAPI-RS deferred).
//!
//! # Feature gate
//! All items are `#[cfg(feature = "crdt")]` — zero cost when disabled.

#[cfg(feature = "crdt")]
use loro::{ExportMode, LoroDoc, VersionVector};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

// ── Helper: create and optionally import a LoroDoc ──────────────────────────

/// Create a new [`LoroDoc`] with a `"content"` LoroText root.
///
/// If `state` is non-empty it is imported into the doc. Returns `None` when
/// `state` is non-empty but cannot be decoded (corrupt bytes).
#[cfg(feature = "crdt")]
fn load_doc(state: &[u8]) -> Option<LoroDoc> {
    let doc = LoroDoc::new();
    // Eagerly create the "content" text container so it is always present.
    let _ = doc.get_text("content");
    if !state.is_empty() {
        doc.import(state).ok()?;
    }
    Some(doc)
}

/// Export the full snapshot of a [`LoroDoc`] as bytes.
///
/// Uses [`ExportMode::Snapshot`] which encodes the complete state and history.
/// On an empty doc this is the canonical "new doc" blob.
#[cfg(feature = "crdt")]
fn export_snapshot(doc: &LoroDoc) -> Vec<u8> {
    doc.export(ExportMode::Snapshot).unwrap_or_default()
}

// ── 1. crdt_new_doc ─────────────────────────────────────────────────────────

/// Create an empty Loro doc for a section and return its snapshot bytes.
///
/// The doc contains a single `LoroText` root named `"content"`. The returned
/// bytes are an opaque Loro snapshot blob. Callers MUST treat this as a state
/// blob — it is NOT a Y.js state vector (incompatible format).
///
/// Use the returned bytes as the initial `state` argument to
/// [`crdt_encode_state_as_update`] or [`crdt_apply_update`].
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_new_doc() -> Vec<u8> {
    let doc = LoroDoc::new();
    let _ = doc.get_text("content");
    export_snapshot(&doc)
}

// ── 2. crdt_encode_state_as_update ──────────────────────────────────────────

/// Encode the full document state as a Loro snapshot blob.
///
/// Used to bootstrap a new client: send them the full state so they can import
/// it locally and arrive at the current document content.
///
/// # Arguments
/// * `state` — bytes from `section_crdt_states.crdt_state` (consolidated state).
///   May be empty to obtain the canonical empty-doc snapshot.
///
/// # Returns
/// A Loro snapshot blob, or empty vec if `state` is non-empty and corrupt.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_encode_state_as_update(state: &[u8]) -> Vec<u8> {
    match load_doc(state) {
        Some(doc) => export_snapshot(&doc),
        None => Vec::new(),
    }
}

// ── 3. crdt_apply_update ────────────────────────────────────────────────────

/// Apply a Loro update (or snapshot) to a document state and return the new state.
///
/// This is the core persistence operation: given the persisted state and an
/// incoming update from a client, produce the new state to store in
/// `section_crdt_states.crdt_state`.
///
/// Loro `import` is idempotent — applying the same update twice yields the
/// same result (CRDT property).
///
/// # Arguments
/// * `state`  — current state bytes (may be empty for a new section).
/// * `update` — incoming Loro update or snapshot bytes from a client.
///
/// # Returns
/// New snapshot bytes suitable for persisting, or empty vec on decode error.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_apply_update(state: &[u8], update: &[u8]) -> Vec<u8> {
    let doc = match load_doc(state) {
        Some(d) => d,
        None => return Vec::new(),
    };
    if !update.is_empty() && doc.import(update).is_err() {
        return Vec::new();
    }
    export_snapshot(&doc)
}

// ── 4. crdt_merge_updates ────────────────────────────────────────────────────

/// Merge multiple Loro update/snapshot blobs into a single consolidated snapshot.
///
/// Used by the compaction job: given many raw update blobs from
/// `section_crdt_updates`, fold them into one blob for `section_crdt_states`.
///
/// Convergence is guaranteed by Loro CRDT invariants — the result is the same
/// regardless of input order (commutativity property).
///
/// # Returns
/// A single Loro snapshot encoding the merged state, or empty vec on error.
#[cfg(feature = "crdt")]
pub fn crdt_merge_updates(updates: &[&[u8]]) -> Vec<u8> {
    let doc = LoroDoc::new();
    let _ = doc.get_text("content");
    for &update in updates {
        if !update.is_empty() && doc.import(update).is_err() {
            return Vec::new();
        }
    }
    export_snapshot(&doc)
}

/// WASM-exported variant of [`crdt_merge_updates`].
///
/// Accepts a flat byte buffer with 4-byte LE length prefixes:
/// `[len1:u32le][bytes1][len2:u32le][bytes2]...`
///
/// This avoids the `Vec<Vec<u8>>` type which is not directly
/// wasm-bindgen-compatible.
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

/// Extract the Loro [`VersionVector`] from a state snapshot.
///
/// The returned bytes are encoded via [`VersionVector::encode`] — they are
/// **not** Y.js state vector bytes and MUST be decoded with
/// [`VersionVector::decode`] on the receiving end. Peers using this in the
/// sync protocol MUST NOT pass these bytes to any Yrs / lib0 decoder.
///
/// # Arguments
/// * `state` — state bytes from `section_crdt_states.crdt_state`.
///
/// # Returns
/// Loro VersionVector bytes, or empty vec on error.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_state_vector(state: &[u8]) -> Vec<u8> {
    match load_doc(state) {
        Some(doc) => doc.oplog_vv().encode(),
        None => Vec::new(),
    }
}

// ── 6. crdt_diff_update ──────────────────────────────────────────────────────

/// Compute the diff update between server state and a remote VersionVector.
///
/// Sync step 2: given the server's full state and the client's VersionVector
/// (from sync step 1 — encoded via [`crdt_state_vector`]), return only the
/// operations the client is missing.
///
/// # Arguments
/// * `state`     — server state bytes from `section_crdt_states.crdt_state`.
/// * `remote_sv` — the client's Loro VersionVector bytes (from [`crdt_state_vector`]).
///   Empty `remote_sv` means "give me everything" (full snapshot).
///
/// # Returns
/// Loro update bytes containing only the missing operations, or empty vec on
/// error. Empty `remote_sv` returns the full snapshot.
#[cfg(feature = "crdt")]
#[cfg_attr(feature = "wasm", wasm_bindgen)]
pub fn crdt_diff_update(state: &[u8], remote_sv: &[u8]) -> Vec<u8> {
    if state.is_empty() {
        return Vec::new();
    }
    if remote_sv.is_empty() {
        return crdt_encode_state_as_update(state);
    }
    let doc = match load_doc(state) {
        Some(d) => d,
        None => return Vec::new(),
    };
    let vv = match VersionVector::decode(remote_sv) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    doc.export(ExportMode::updates_owned(vv))
        .unwrap_or_default()
}

// ── Helpers (native only) ─────────────────────────────────────────────────────

/// Extract the plain-text content from a Loro state snapshot (native use only).
///
/// Reads the `"content"` LoroText root and returns its string value.
/// Used by tests and the HTTP fallback. Not available in WASM builds.
#[cfg(all(feature = "crdt", not(target_arch = "wasm32")))]
pub fn crdt_get_text(state: &[u8]) -> Option<String> {
    let doc = load_doc(state)?;
    Some(doc.get_text("content").to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(all(feature = "crdt", test))]
mod tests {
    use super::*;

    /// Create a Loro doc state with known text content.
    fn make_state_with_text(content: &str) -> Vec<u8> {
        let doc = LoroDoc::new();
        doc.get_text("content").insert(0, content).unwrap();
        doc.commit();
        export_snapshot(&doc)
    }

    #[test]
    fn test_crdt_new_doc_returns_bytes() {
        let snapshot = crdt_new_doc();
        assert!(!snapshot.is_empty(), "new doc snapshot should not be empty");
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
        // Each doc has a distinct peer ID so merging is non-trivial.
        let doc_a = LoroDoc::new();
        doc_a.get_text("content").insert(0, "Alpha").unwrap();
        doc_a.commit();
        let state_a = export_snapshot(&doc_a);

        let doc_b = LoroDoc::new();
        doc_b.get_text("content").insert(0, "Beta").unwrap();
        doc_b.commit();
        let state_b = export_snapshot(&doc_b);

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
        // An empty LoroDoc has an empty VersionVector; encode() of an empty VV
        // is still valid (non-zero) bytes (postcard encoding of an empty map).
        assert!(
            !sv.is_empty(),
            "empty doc VV encode should be non-empty bytes"
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
        // Full sync step 1 + step 2:
        //   Server has state S. Client has empty state.
        //   1. Client sends its VV (crdt_state_vector on empty doc from crdt_new_doc)
        //   2. Server replies with diff (crdt_diff_update)
        //   3. Client applies diff and converges
        let server_state = make_state_with_text("server content");

        let client_snapshot = crdt_new_doc();
        let client_vv = crdt_state_vector(&client_snapshot);
        let diff = crdt_diff_update(&server_state, &client_vv);
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

    // ── Byte-identity / convergence tests ────────────────────────────────────

    /// Associativity: merging then applying equals sequential applies.
    #[test]
    fn test_crdt_byte_identity_associativity() {
        let init = crdt_encode_state_as_update(&[]);

        let doc1 = LoroDoc::new();
        doc1.get_text("content").insert(0, "Hello").unwrap();
        doc1.commit();
        let u1 = export_snapshot(&doc1);

        let doc2 = LoroDoc::new();
        doc2.get_text("content").insert(0, " World").unwrap();
        doc2.commit();
        let u2 = export_snapshot(&doc2);

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

    /// Idempotency: applying the same update twice yields the same content.
    #[test]
    fn test_crdt_byte_identity_idempotency() {
        let doc = LoroDoc::new();
        doc.get_text("content")
            .insert(0, "idempotent content")
            .unwrap();
        doc.commit();
        let update = export_snapshot(&doc);

        let state_once = crdt_apply_update(&[], &update);
        let state_twice = crdt_apply_update(&state_once, &update);

        let text_once = crdt_get_text(&state_once).expect("once decode");
        let text_twice = crdt_get_text(&state_twice).expect("twice decode");

        assert_eq!(
            text_once, text_twice,
            "idempotency: applying same update twice must produce same content: '{text_once}' vs '{text_twice}'"
        );
    }

    /// Two concurrent edits from independent peers must converge.
    #[test]
    fn test_crdt_two_concurrent_edits_converge() {
        let doc_a = LoroDoc::new();
        doc_a.get_text("content").insert(0, "Hello").unwrap();
        doc_a.commit();
        let update_a = export_snapshot(&doc_a);

        let doc_b = LoroDoc::new();
        doc_b.get_text("content").insert(0, "World").unwrap();
        doc_b.commit();
        let update_b = export_snapshot(&doc_b);

        let merged = crdt_merge_updates(&[&update_a, &update_b]);
        let text = crdt_get_text(&merged).expect("should decode merged text");

        assert!(
            text.contains("Hello") && text.contains("World"),
            "merged state should contain both edits: got '{text}'"
        );
    }

    /// Verify crdt_new_doc snapshot contains Loro magic header bytes ("loro").
    #[test]
    fn test_crdt_new_doc_loro_magic_header() {
        let snapshot = crdt_new_doc();
        // Loro binary format starts with magic bytes 0x6c 0x6f 0x72 0x6f ("loro")
        assert!(
            snapshot.len() >= 4,
            "snapshot must be at least 4 bytes for magic header"
        );
        assert_eq!(
            &snapshot[..4],
            b"loro",
            "Loro snapshot must start with 'loro' magic header"
        );
    }
}
