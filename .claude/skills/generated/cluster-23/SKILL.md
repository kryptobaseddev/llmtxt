---
name: cluster-23
description: "Skill for the Cluster_23 area of llmtxt. 9 symbols across 1 files."
---

# Cluster_23

9 symbols | 1 files | Cohesion: 72%

## When to Use

- Working with code in `crates/`
- Understanding how apply_patch, reconstruct_version, squash_patches work
- Modifying cluster_23-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/patch.rs` | apply_patch, reconstruct_version, squash_patches, test_create_and_apply_patch, test_apply_invalid_patch (+4) |

## Entry Points

Start here when exploring this area:

- **`apply_patch`** (Function) — `crates/llmtxt-core/src/patch.rs:11`
- **`reconstruct_version`** (Function) — `crates/llmtxt-core/src/patch.rs:31`
- **`squash_patches`** (Function) — `crates/llmtxt-core/src/patch.rs:81`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `apply_patch` | Function | `crates/llmtxt-core/src/patch.rs` | 11 |
| `reconstruct_version` | Function | `crates/llmtxt-core/src/patch.rs` | 31 |
| `squash_patches` | Function | `crates/llmtxt-core/src/patch.rs` | 81 |
| `test_create_and_apply_patch` | Function | `crates/llmtxt-core/src/patch.rs` | 260 |
| `test_apply_invalid_patch` | Function | `crates/llmtxt-core/src/patch.rs` | 272 |
| `test_reconstruct_version_zero_returns_base` | Function | `crates/llmtxt-core/src/patch.rs` | 278 |
| `test_reconstruct_version_applies_patches` | Function | `crates/llmtxt-core/src/patch.rs` | 285 |
| `test_squash_patches_produces_single_diff` | Function | `crates/llmtxt-core/src/patch.rs` | 302 |
| `test_apply_conflicting_patch` | Function | `crates/llmtxt-core/src/patch.rs` | 340 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Batch_diff_versions → Apply_patch` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Cluster_24 | 5 calls |

## How to Explore

1. `gitnexus_context({name: "apply_patch"})` — see callers and callees
2. `gitnexus_query({query: "cluster_23"})` — find related execution flows
3. Read key files listed above for implementation details
