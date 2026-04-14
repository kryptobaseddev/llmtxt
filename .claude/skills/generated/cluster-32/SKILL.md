---
name: cluster-32
description: "Skill for the Cluster_32 area of llmtxt. 7 symbols across 1 files."
---

# Cluster_32

7 symbols | 1 files | Cohesion: 92%

## When to Use

- Working with code in `crates/`
- Understanding how compute_diff work
- Modifying cluster_32-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/diff.rs` | build_lcs_table, compute_diff, test_compute_diff_identical, test_compute_diff_empty_to_content, test_compute_diff_content_to_empty (+2) |

## Entry Points

Start here when exploring this area:

- **`compute_diff`** (Function) — `crates/llmtxt-core/src/diff.rs:71`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `compute_diff` | Function | `crates/llmtxt-core/src/diff.rs` | 71 |
| `build_lcs_table` | Function | `crates/llmtxt-core/src/diff.rs` | 49 |
| `test_compute_diff_identical` | Function | `crates/llmtxt-core/src/diff.rs` | 243 |
| `test_compute_diff_empty_to_content` | Function | `crates/llmtxt-core/src/diff.rs` | 253 |
| `test_compute_diff_content_to_empty` | Function | `crates/llmtxt-core/src/diff.rs` | 260 |
| `test_compute_diff_mixed_changes` | Function | `crates/llmtxt-core/src/diff.rs` | 267 |
| `test_compute_diff_tokens` | Function | `crates/llmtxt-core/src/diff.rs` | 278 |

## How to Explore

1. `gitnexus_context({name: "compute_diff"})` — see callers and callees
2. `gitnexus_query({query: "cluster_32"})` — find related execution flows
3. Read key files listed above for implementation details
