---
name: cluster-24
description: "Skill for the Cluster_24 area of llmtxt. 10 symbols across 1 files."
---

# Cluster_24

10 symbols | 1 files | Cohesion: 79%

## When to Use

- Working with code in `crates/`
- Understanding how create_patch, reconstruct_version_native, squash_patches_native work
- Modifying cluster_24-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/patch.rs` | create_patch, reconstruct_version_native, squash_patches_native, diff_versions, diff_versions_native (+5) |

## Entry Points

Start here when exploring this area:

- **`create_patch`** (Function) — `crates/llmtxt-core/src/patch.rs:19`
- **`reconstruct_version_native`** (Function) — `crates/llmtxt-core/src/patch.rs:53`
- **`squash_patches_native`** (Function) — `crates/llmtxt-core/src/patch.rs:71`
- **`diff_versions`** (Function) — `crates/llmtxt-core/src/patch.rs:102`
- **`diff_versions_native`** (Function) — `crates/llmtxt-core/src/patch.rs:126`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `create_patch` | Function | `crates/llmtxt-core/src/patch.rs` | 19 |
| `reconstruct_version_native` | Function | `crates/llmtxt-core/src/patch.rs` | 53 |
| `squash_patches_native` | Function | `crates/llmtxt-core/src/patch.rs` | 71 |
| `diff_versions` | Function | `crates/llmtxt-core/src/patch.rs` | 102 |
| `diff_versions_native` | Function | `crates/llmtxt-core/src/patch.rs` | 126 |
| `batch_diff_versions` | Function | `crates/llmtxt-core/src/patch.rs` | 147 |
| `test_reconstruct_version_native` | Function | `crates/llmtxt-core/src/patch.rs` | 317 |
| `test_squash_patches_native` | Function | `crates/llmtxt-core/src/patch.rs` | 328 |
| `test_diff_versions` | Function | `crates/llmtxt-core/src/patch.rs` | 350 |
| `test_diff_versions_between_non_zero` | Function | `crates/llmtxt-core/src/patch.rs` | 368 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Batch_diff_versions → Apply_patch` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_23 | 2 calls |

## How to Explore

1. `gitnexus_context({name: "create_patch"})` — see callers and callees
2. `gitnexus_query({query: "cluster_24"})` — find related execution flows
3. Read key files listed above for implementation details
