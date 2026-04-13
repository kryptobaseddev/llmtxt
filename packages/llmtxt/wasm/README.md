# llmtxt-core

Portable Rust primitives for llmtxt content workflows.

`llmtxt-core` is the single source of truth for compression, hashing, signing,
patching, similarity, and version reconstruction used by both:

- native Rust consumers like SignalDock (Axum backend)
- the TypeScript package `llmtxt` via WASM bindings

## Install

```toml
[dependencies]
llmtxt-core = "2026.4"
```

## What It Provides

- zlib-compatible `compress` / `decompress` (RFC 1950)
- SHA-256 content hashing
- token estimation and compression ratios
- HMAC-SHA256 signed URL generation and verification
- unified diff `create_patch` / `apply_patch` for document versioning
- `reconstruct_version` / `squash_patches` for patch stack management
- `multi_way_diff_wasm` for LCS-aligned comparison across up to 5 agent versions
- `cherry_pick_merge_wasm` for section-based merge from multiple versions
- n-gram Jaccard text similarity
- base62 encoding helpers
- organization-scoped signature variants
- WASM-exported functions for TypeScript consumers

## Example

Rust crate modules: `patch.rs`, `diff.rs`, `diff_multi.rs`, `cherry_pick.rs`, `lifecycle.rs`,
`consensus.rs`, `native_signed_url.rs`, `lib.rs`.

```rust
use llmtxt_core::{
    apply_patch, create_patch, reconstruct_version_native,
    generate_signed_url, SignedUrlBuildRequest, hash_content,
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

// Signed URLs
let url = generate_signed_url(&SignedUrlBuildRequest {
    base_url: "https://api.signaldock.io",
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

## Publishing

Published on [crates.io](https://crates.io/crates/llmtxt-core). Also consumable
via WASM through the TypeScript package in `packages/llmtxt`.
