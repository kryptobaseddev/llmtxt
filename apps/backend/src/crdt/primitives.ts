/**
 * CRDT primitives — thin re-export from the llmtxt SDK.
 *
 * Per SSoT (docs/SSOT.md): all CRDT primitives live in crates/llmtxt-core
 * (Rust / Yrs) and are exposed via packages/llmtxt. This file is the backend
 * boundary — it does not import yjs directly; all operations go through the
 * SDK abstraction layer.
 *
 * When crates/llmtxt-core is built with `--features crdt` (wasm-pack
 * build:wasm), the SDK will delegate to WASM automatically; this file
 * requires no changes at that point.
 */

export {
  crdt_new_doc,
  crdt_encode_state_as_update,
  crdt_apply_update,
  crdt_merge_updates,
  crdt_state_vector,
  crdt_diff_update,
  crdt_get_text,
  crdt_make_state,
  crdt_make_incremental_update,
  crdt_apply_to_local_doc,
} from 'llmtxt/crdt-primitives';
