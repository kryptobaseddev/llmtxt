---
name: cluster-33
description: "Skill for the Cluster_33 area of llmtxt. 8 symbols across 1 files."
---

# Cluster_33

8 symbols | 1 files | Cohesion: 78%

## When to Use

- Working with code in `crates/`
- Understanding how structured_diff, structured_diff_native work
- Modifying cluster_33-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/diff.rs` | structured_diff, structured_diff_native, test_structured_diff_identical, test_structured_diff_removals, test_structured_diff_mixed (+3) |

## Entry Points

Start here when exploring this area:

- **`structured_diff`** (Function) — `crates/llmtxt-core/src/diff.rs:155`
- **`structured_diff_native`** (Function) — `crates/llmtxt-core/src/diff.rs:164`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `structured_diff` | Function | `crates/llmtxt-core/src/diff.rs` | 155 |
| `structured_diff_native` | Function | `crates/llmtxt-core/src/diff.rs` | 164 |
| `test_structured_diff_identical` | Function | `crates/llmtxt-core/src/diff.rs` | 292 |
| `test_structured_diff_removals` | Function | `crates/llmtxt-core/src/diff.rs` | 321 |
| `test_structured_diff_mixed` | Function | `crates/llmtxt-core/src/diff.rs` | 336 |
| `test_structured_diff_empty_to_content` | Function | `crates/llmtxt-core/src/diff.rs` | 347 |
| `test_structured_diff_content_to_empty` | Function | `crates/llmtxt-core/src/diff.rs` | 355 |
| `test_structured_diff_json_serialization` | Function | `crates/llmtxt-core/src/diff.rs` | 363 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tests | 2 calls |
| Cluster_32 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "structured_diff"})` — see callers and callees
2. `gitnexus_query({query: "cluster_33"})` — find related execution flows
3. Read key files listed above for implementation details
