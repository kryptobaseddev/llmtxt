/**
 * CRDT primitives — Yrs-compatible operations using the yjs npm package.
 *
 * This module mirrors the six WASM exports from crates/llmtxt-core/src/crdt.rs
 * at the Node.js layer. It uses the `yjs` npm package (already a backend dep)
 * instead of the WASM build because the `crdt` feature gate is not yet enabled
 * in the packaged WASM binary. When crates/llmtxt-core is built with
 * `--features crdt` (wasm-pack build:wasm), callers can migrate to the WASM
 * exports; this module API is intentionally identical.
 *
 * Every section is modelled as a single Yrs `Doc` with a root `Y.Text` named
 * "content". State is stored as lib0 v1 binary (Buffer), exactly matching
 * the `yrs_state` column in section_crdt_states.
 *
 * All six functions are synchronous and pure (no side effects).
 */

import * as Y from 'yjs';

// ── 1. crdt_new_doc ──────────────────────────────────────────────────────────

/**
 * Create an empty Yrs Doc and return its initial state vector bytes.
 * Sent as sync step 1 to bootstrap a new client.
 */
export function crdt_new_doc(): Buffer {
  const doc = new Y.Doc();
  doc.getText('content'); // initialise root
  return Buffer.from(Y.encodeStateVector(doc));
}

// ── 2. crdt_encode_state_as_update ──────────────────────────────────────────

/**
 * Encode the full doc state as a lib0 v1 update message.
 * Used to send a snapshot to new clients (sync step 2 bootstrap).
 *
 * @param state - bytes from section_crdt_states.yrs_state (may be empty for new section)
 */
export function crdt_encode_state_as_update(state: Buffer): Buffer {
  const doc = new Y.Doc();
  doc.getText('content');
  if (state.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(state));
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

// ── 3. crdt_apply_update ────────────────────────────────────────────────────

/**
 * Apply a lib0 v1 update message to a state snapshot, returning the new state.
 * Core persistence operation: called before writing to section_crdt_states.
 *
 * @param state - current state bytes (may be empty for new section)
 * @param update - incoming lib0 v1 update bytes from a client
 * @returns New state bytes ready for section_crdt_states.yrs_state
 */
export function crdt_apply_update(state: Buffer, update: Buffer): Buffer {
  const doc = new Y.Doc();
  doc.getText('content');
  if (state.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(state));
  }
  Y.applyUpdate(doc, new Uint8Array(update));
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

// ── 4. crdt_merge_updates ───────────────────────────────────────────────────

/**
 * Merge multiple update blobs into a single consolidated update.
 * Used by the compaction job to fold section_crdt_updates into section_crdt_states.
 * Commutative (CRDT guarantee).
 *
 * @param updates - array of lib0 v1 update Buffers from section_crdt_updates
 * @returns Single lib0 v1 update encoding the merged state
 */
export function crdt_merge_updates(updates: Buffer[]): Buffer {
  if (updates.length === 0) {
    const doc = new Y.Doc();
    doc.getText('content');
    return Buffer.from(Y.encodeStateAsUpdate(doc));
  }
  const merged = Y.mergeUpdates(updates.map((u) => new Uint8Array(u)));
  return Buffer.from(merged);
}

// ── 5. crdt_state_vector ────────────────────────────────────────────────────

/**
 * Extract the state vector from a state snapshot.
 * Sent as sync step 1 so the remote can compute the diff update.
 *
 * @param state - bytes from section_crdt_states.yrs_state (may be empty)
 */
export function crdt_state_vector(state: Buffer): Buffer {
  const doc = new Y.Doc();
  doc.getText('content');
  if (state.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(state));
  }
  return Buffer.from(Y.encodeStateVector(doc));
}

// ── 6. crdt_diff_update ─────────────────────────────────────────────────────

/**
 * Compute the diff update between server state and a remote state vector.
 * Sync step 2: returns only the operations the remote is missing.
 *
 * @param state - server state bytes from section_crdt_states.yrs_state
 * @param remoteSv - the client's state vector bytes (empty = "give me everything")
 */
export function crdt_diff_update(state: Buffer, remoteSv: Buffer): Buffer {
  const doc = new Y.Doc();
  doc.getText('content');
  if (state.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(state));
  }
  const sv = remoteSv.length > 0 ? new Uint8Array(remoteSv) : Y.encodeStateVector(new Y.Doc());
  return Buffer.from(Y.encodeStateAsUpdate(doc, sv));
}

// ── 7. crdt_get_text ────────────────────────────────────────────────────────

/**
 * Extract the plain text string from a state snapshot.
 * Used by HTTP fallback endpoints and tests.
 *
 * @param state - bytes from section_crdt_states.yrs_state (may be empty)
 */
export function crdt_get_text(state: Buffer): string {
  const doc = new Y.Doc();
  const text = doc.getText('content');
  if (state.length > 0) {
    Y.applyUpdate(doc, new Uint8Array(state));
  }
  return text.toString();
}
