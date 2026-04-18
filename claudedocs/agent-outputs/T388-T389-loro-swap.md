# T388 + T389: Yrs to Loro Core Swap

**Date**: 2026-04-17
**Commit**: 414f169
**Status**: complete

## Summary

Atomic swap of the CRDT library in `crates/llmtxt-core` from `yrs = "0.25"` (Yrs, the Rust port of Y.js) to `loro = "1.0"` (Loro 1.10.8 resolved). All 6 public WASM export function names are preserved unchanged.

## Changes

### T388 — Cargo.toml (P1.2)

- Removed: `yrs = { version = "0.25", optional = true }`
- Added: `loro = { version = "1.0", optional = true }`
- Updated: `crdt = ["dep:yrs"]` -> `crdt = ["dep:loro"]`
- Cargo.lock updated with Loro 1.10.8 and its transitive deps

### T389 — crdt.rs rewrite (P1.3)

Full module rewrite. All 6 functions plus helpers:

| Function | Loro implementation |
|---|---|
| `crdt_new_doc` | `LoroDoc::new(); get_text("content"); export(Snapshot)` |
| `crdt_encode_state_as_update` | `load_doc(state); export(Snapshot)` |
| `crdt_apply_update` | `load_doc(state); import(update); export(Snapshot)` |
| `crdt_merge_updates` | `LoroDoc::new(); for u: import(u); export(Snapshot)` |
| `crdt_state_vector` | `load_doc(state); oplog_vv().encode()` |
| `crdt_diff_update` | `load_doc(state); VersionVector::decode(sv); export(Updates{from:vv})` |
| `crdt_merge_updates_wasm` | packed-buffer wrapper, unchanged |
| `crdt_get_text` | `load_doc(state); get_text("content").to_string()` |

Key API decisions validated against Loro 1.10.8 source:
- `ExportMode::Snapshot` (not `ExportMode::all_updates()`) for full state serialization
- `ExportMode::updates_owned(vv)` for diff export with owned VersionVector
- `VersionVector::encode()` (postcard serialization) and `VersionVector::decode()` for VV bytes
- `doc.oplog_vv()` returns current oplog VersionVector
- `doc.import(&bytes)` is an instance method, returns `Result<ImportStatus, LoroError>`

## Test Results

```
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 326 filtered out
```

All 14 CRDT tests pass:
- test_crdt_new_doc_returns_bytes
- test_crdt_new_doc_loro_magic_header (new — validates 0x6c6f726f magic header)
- test_crdt_encode_state_roundtrip
- test_crdt_apply_update_sequential
- test_crdt_merge_updates_commutativity
- test_crdt_state_vector_nonempty
- test_crdt_state_vector_empty_state
- test_crdt_diff_empty_sv_gives_full_state
- test_crdt_sync_protocol_simulation
- test_crdt_merge_wasm_packed_format
- test_crdt_apply_empty_both
- test_crdt_byte_identity_associativity
- test_crdt_byte_identity_idempotency
- test_crdt_two_concurrent_edits_converge

## Quality Gates

- `cargo build --features crdt --release`: exit 0
- `cargo test --features crdt --lib crdt`: 14/14 pass
- `cargo fmt --check`: clean
- `ferrous-forge validate`: Clippy clean, fmt clean, security audit clean
- `cargo tree --features crdt | grep yrs`: zero output (confirmed yrs removed)

## Acceptance Criteria Status

| AC | Status |
|---|---|
| `loro = "1.0"` in Cargo.toml under crdt feature gate | PASS |
| yrs and y-sync removed from Cargo.toml and Cargo.lock | PASS |
| `cargo build --features crdt` compiles without errors | PASS |
| crdt_new_doc returns Loro snapshot bytes (magic header `loro`) | PASS |
| crdt_apply_update returns new Loro snapshot; error returns empty vec | PASS |
| crdt_merge_updates commutativity holds | PASS |
| crdt_state_vector returns Loro VersionVector bytes | PASS |
| crdt_diff_update returns missing operations for given VersionVector | PASS |
| crdt_get_text extracts plain text from LoroText root "content" | PASS |

## Pre-existing Unrelated Failure

`blob::tests::test_hash_blob_known_vector_abc` fails with a SHA-256 mismatch in `src/blob.rs` — this is from a parallel agent (T458) and predates this PR. It is unrelated to crdt.rs changes.

## Next Steps (unblocked by this commit)

- T390: WASM rebuild — pnpm --filter llmtxt run build:wasm
- T391: crdt-primitives.ts update
- T393: DB reset (truncate CRDT tables, rename column)
- T394: Byte-identity integration tests
