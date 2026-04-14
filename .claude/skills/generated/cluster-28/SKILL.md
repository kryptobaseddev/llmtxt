---
name: cluster-28
description: "Skill for the Cluster_28 area of llmtxt. 4 symbols across 1 files."
---

# Cluster_28

4 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `crates/`
- Understanding how compress, decompress work
- Modifying cluster_28-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/lib.rs` | compress, decompress, test_compress_decompress_roundtrip, test_compress_empty |

## Entry Points

Start here when exploring this area:

- **`compress`** (Function) — `crates/llmtxt-core/src/lib.rs:105`
- **`decompress`** (Function) — `crates/llmtxt-core/src/lib.rs:121`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `compress` | Function | `crates/llmtxt-core/src/lib.rs` | 105 |
| `decompress` | Function | `crates/llmtxt-core/src/lib.rs` | 121 |
| `test_compress_decompress_roundtrip` | Function | `crates/llmtxt-core/src/lib.rs` | 414 |
| `test_compress_empty` | Function | `crates/llmtxt-core/src/lib.rs` | 422 |

## How to Explore

1. `gitnexus_context({name: "compress"})` — see callers and callees
2. `gitnexus_query({query: "cluster_28"})` — find related execution flows
3. Read key files listed above for implementation details
