---
name: cluster-34
description: "Skill for the Cluster_34 area of llmtxt. 15 symbols across 1 files."
---

# Cluster_34

15 symbols | 1 files | Cohesion: 95%

## When to Use

- Working with code in `crates/`
- Understanding how evaluate_approvals_native, evaluate_approvals work
- Modifying cluster_34-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/consensus.rs` | evaluate_approvals_native, evaluate_approvals, default_policy, review, test_single_approval_meets_default_policy (+10) |

## Entry Points

Start here when exploring this area:

- **`evaluate_approvals_native`** (Function) — `crates/llmtxt-core/src/consensus.rs:73`
- **`evaluate_approvals`** (Function) — `crates/llmtxt-core/src/consensus.rs:225`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `evaluate_approvals_native` | Function | `crates/llmtxt-core/src/consensus.rs` | 73 |
| `evaluate_approvals` | Function | `crates/llmtxt-core/src/consensus.rs` | 225 |
| `default_policy` | Function | `crates/llmtxt-core/src/consensus.rs` | 256 |
| `review` | Function | `crates/llmtxt-core/src/consensus.rs` | 266 |
| `test_single_approval_meets_default_policy` | Function | `crates/llmtxt-core/src/consensus.rs` | 277 |
| `test_no_reviews_pending` | Function | `crates/llmtxt-core/src/consensus.rs` | 285 |
| `test_rejection_overrides_approval` | Function | `crates/llmtxt-core/src/consensus.rs` | 296 |
| `test_stale_review_for_old_version` | Function | `crates/llmtxt-core/src/consensus.rs` | 311 |
| `test_timed_out_review` | Function | `crates/llmtxt-core/src/consensus.rs` | 319 |
| `test_unanimous_policy` | Function | `crates/llmtxt-core/src/consensus.rs` | 338 |
| `test_latest_review_wins` | Function | `crates/llmtxt-core/src/consensus.rs` | 364 |
| `test_wasm_evaluate_approvals` | Function | `crates/llmtxt-core/src/consensus.rs` | 398 |
| `test_percentage_threshold_51_percent` | Function | `crates/llmtxt-core/src/consensus.rs` | 418 |
| `test_percentage_threshold_20_percent` | Function | `crates/llmtxt-core/src/consensus.rs` | 446 |
| `test_percentage_overrides_count` | Function | `crates/llmtxt-core/src/consensus.rs` | 468 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Test_no_reviews_pending → Delete` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Wasm | 1 calls |
| Tests | 1 calls |

## How to Explore

1. `gitnexus_context({name: "evaluate_approvals_native"})` — see callers and callees
2. `gitnexus_query({query: "cluster_34"})` — find related execution flows
3. Read key files listed above for implementation details
