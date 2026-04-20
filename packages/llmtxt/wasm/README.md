# llmtxt-core

[![v2026.4.6](https://img.shields.io/badge/version-2026.4.6-blue)](https://crates.io/crates/llmtxt-core)

Portable Rust primitives for llmtxt content workflows.

`llmtxt-core` is the single source of truth for compression, hashing, signing,
patching, similarity, and CRDT used by both:

- native Rust consumers like the LLMtxt backend (Axum)
- the TypeScript package `llmtxt` via WASM bindings

**v2026.4.6**: CRDT layer migrated from `yrs` to `loro` 1.0 (binary-incompatible clean break). Added `hash_blob` for content-addressed binary attachments and `canonical_frontmatter` for deterministic document export.

## Install

```toml
[dependencies]
llmtxt-core = "2026.4"
```

## What It Provides

- zlib-compatible `compress` / `decompress` (RFC 1950)
- SHA-256 content hashing (`hash_content`) and binary blob hashing (`hash_blob`)
- token estimation and compression ratios
- HMAC-SHA256 signed URL generation and verification
- unified diff `create_patch` / `apply_patch` for document versioning
- `reconstruct_version` / `squash_patches` for patch stack management
- n-gram Jaccard text similarity
- base62 encoding helpers
- organization-scoped signature variants
- **Loro CRDT** (replaces Yrs): `crdt_new_doc`, `crdt_encode_state_as_update`, `crdt_apply_update`, `crdt_merge_updates`, `crdt_state_vector`, `crdt_diff_update`
- `canonical_frontmatter` serializer for deterministic document export frontmatter
- `blob_name_validate` for attachment name validation (path traversal prevention)
- WASM-exported functions for TypeScript consumers

## Example

```rust
use llmtxt_core::{
    apply_patch, create_patch, reconstruct_version_native,
    generate_signed_url, SignedUrlBuildRequest, hash_content, hash_blob,
};

// Patching
let original = "hello\n";
let modified = "hello world\n";
let patch = create_patch(original, modified);
let rebuilt = apply_patch(original, &patch)?;
assert_eq!(rebuilt, modified);

// Version reconstruction (apply N patches in one call)
let patches = vec![patch];
let at_v1 = reconstruct_version_native(original, &patches, 1)?;
assert_eq!(at_v1, modified);

// Content integrity
let hash = hash_content("hello");
assert_eq!(hash.len(), 64); // SHA-256 hex

// Binary blob content addressing
let png_bytes = std::fs::read("diagram.png")?;
let blob_hash = hash_blob(&png_bytes);  // SHA-256 hex, used as storage key
assert_eq!(blob_hash.len(), 64);

// Signed URLs
let url = generate_signed_url(&SignedUrlBuildRequest {
    base_url: "https://api.llmtxt.my",
    path_prefix: "attachments",
    slug: "xK9mP2nQ",
    agent_id: "agent-1",
    conversation_id: "conv-1",
    expires_at: 1_800_000_000_000,
    secret: "derived-secret",
    sig_length: 32,
})?;
# Ok::<(), String>(())
```

## Loro CRDT (v2026.4.6)

The CRDT layer uses `loro` 1.0 (replacing `yrs`). The six WASM-exported function names are unchanged but the binary encoding is **bitwise incompatible** with lib0/Yrs format.

```rust
use llmtxt_core::{crdt_new_doc, crdt_apply_update, crdt_merge_updates, crdt_diff_update};

// New empty document state (Loro snapshot bytes)
let state = crdt_new_doc();

// Apply an update blob
let new_state = crdt_apply_update(&state, &update_bytes)?;

// Merge multiple concurrent updates
let merged = crdt_merge_updates(&[update_a, update_b])?;

// Get diff from a remote version vector
let diff = crdt_diff_update(&state, &remote_version_vector)?;
```

Wire protocol: 1-byte prefix `0x01` = SyncStep1 (Loro VersionVector), `0x02` = SyncStep2 (Updates blob), `0x03` = Update, `0x04` = AwarenessRelay. The old y-sync `0x00`/`0x01`/`0x02`/`0x03` framing is retired.

Migration spec: [docs/specs/P1-loro-migration.md](../../docs/specs/P1-loro-migration.md).

## Canonical Frontmatter (v2026.4.6)

Used by `backend.exportDocument()` to produce deterministic document exports:

```rust
use llmtxt_core::canonical_frontmatter;

let frontmatter = canonical_frontmatter(
    "My Document Title",
    "my-document-title",
    3,             // version
    "APPROVED",    // lifecycle state
    &["agent-alice", "agent-bob"],  // contributors (sorted lexicographically)
    "2cf24dba...", // SHA-256 of body content
    "2026-04-17T19:00:00.000Z",     // exported_at ISO 8601
)?;
```

Output is byte-stable across machines and backend implementations (LocalBackend, RemoteBackend, PostgresBackend).

## Publishing

Published on [crates.io](https://crates.io/crates/llmtxt-core). Also consumable
via WASM through the TypeScript package in `packages/llmtxt`.
