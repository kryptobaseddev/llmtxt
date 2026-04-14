---
name: cluster-35
description: "Skill for the Cluster_35 area of llmtxt. 4 symbols across 1 files."
---

# Cluster_35

4 symbols | 1 files | Cohesion: 100%

## When to Use

- Working with code in `crates/`
- Understanding how mark_stale_reviews_native, mark_stale_reviews work
- Modifying cluster_35-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/consensus.rs` | mark_stale_reviews_native, mark_stale_reviews, test_mark_stale_reviews, test_wasm_mark_stale |

## Entry Points

Start here when exploring this area:

- **`mark_stale_reviews_native`** (Function) — `crates/llmtxt-core/src/consensus.rs:200`
- **`mark_stale_reviews`** (Function) — `crates/llmtxt-core/src/consensus.rs:244`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `mark_stale_reviews_native` | Function | `crates/llmtxt-core/src/consensus.rs` | 200 |
| `mark_stale_reviews` | Function | `crates/llmtxt-core/src/consensus.rs` | 244 |
| `test_mark_stale_reviews` | Function | `crates/llmtxt-core/src/consensus.rs` | 387 |
| `test_wasm_mark_stale` | Function | `crates/llmtxt-core/src/consensus.rs` | 409 |

## How to Explore

1. `gitnexus_context({name: "mark_stale_reviews_native"})` — see callers and callees
2. `gitnexus_query({query: "cluster_35"})` — find related execution flows
3. Read key files listed above for implementation details
