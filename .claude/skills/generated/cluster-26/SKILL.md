---
name: cluster-26
description: "Skill for the Cluster_26 area of llmtxt. 9 symbols across 1 files."
---

# Cluster_26

9 symbols | 1 files | Cohesion: 91%

## When to Use

- Working with code in `crates/`
- Understanding how from_str_name, allowed_targets, is_valid_transition work
- Modifying cluster_26-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/lifecycle.rs` | from_str_name, allowed_targets, is_valid_transition, is_terminal, is_valid_transition_str (+4) |

## Entry Points

Start here when exploring this area:

- **`from_str_name`** (Function) — `crates/llmtxt-core/src/lifecycle.rs:22`
- **`allowed_targets`** (Function) — `crates/llmtxt-core/src/lifecycle.rs:43`
- **`is_valid_transition`** (Function) — `crates/llmtxt-core/src/lifecycle.rs:61`
- **`is_terminal`** (Function) — `crates/llmtxt-core/src/lifecycle.rs:75`
- **`is_valid_transition_str`** (Function) — `crates/llmtxt-core/src/lifecycle.rs:85`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `from_str_name` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 22 |
| `allowed_targets` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 43 |
| `is_valid_transition` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 61 |
| `is_terminal` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 75 |
| `is_valid_transition_str` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 85 |
| `is_editable_str` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 98 |
| `is_terminal_str` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 105 |
| `validate_transition` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 114 |
| `test_validate_transition_json` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 297 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Is_valid_transition_str → As_str` | cross_community | 3 |
| `Is_valid_transition_str → Allowed_targets` | intra_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Tests | 2 calls |

## How to Explore

1. `gitnexus_context({name: "from_str_name"})` — see callers and callees
2. `gitnexus_query({query: "cluster_26"})` — find related execution flows
3. Read key files listed above for implementation details
