# llmtxt-core

Portable Rust primitives for llmtxt content workflows.

`llmtxt-core` is the single source of truth for compression, hashing, signing,
patch creation/application, and other low-level text utilities used by both:

- native Rust consumers like SignalDock
- the TypeScript package `@codluv/llmtxt` via WASM bindings

## Install

```toml
[dependencies]
llmtxt-core = "0.3"
```

During active development you can also pin the GitHub repository directly.

```toml
[dependencies]
llmtxt-core = { git = "https://github.com/kryptobaseddev/llmtxt.git", package = "llmtxt-core" }
```

## What It Provides

- zlib-compatible `compress` / `decompress`
- SHA-256 content hashing
- token estimation and compression ratios
- signed URL generation and verification
- unified diff `create_patch` / `apply_patch` for attachment versioning
- base62 encoding helpers
- WASM-exported functions for TypeScript consumers

## Example

```rust
use llmtxt_core::{apply_patch, create_patch, generate_signed_url, SignedUrlBuildRequest};

let original = "hello\n";
let modified = "hello world\n";
let patch = create_patch(original, modified);
let rebuilt = apply_patch(original, &patch)?;
assert_eq!(rebuilt, modified);

let url = generate_signed_url(&SignedUrlBuildRequest {
    base_url: "https://api.example.com",
    path_prefix: "attachments",
    slug: "xK9mP2nQ",
    agent_id: "agent-1",
    conversation_id: "conv-1",
    expires_at: 1_800_000_000_000,
    secret: "derived-secret",
    sig_length: 32,
})?;
println!("{url}");
# Ok::<(), String>(())
```

## Publishing

This crate is designed to be consumable both directly from Rust and indirectly
through the WASM-backed TypeScript package in `packages/core`.
