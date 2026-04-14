---
name: tests
description: "Skill for the Tests area of llmtxt. 15 symbols across 5 files."
---

# Tests

15 symbols | 5 files | Cohesion: 77%

## When to Use

- Working with code in `crates/`
- Understanding how compute_sections_modified, compute_sections_modified_native, as_str work
- Modifying tests-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/patch.rs` | sections_map, compute_sections_modified, compute_sections_modified_native, test_compute_sections_modified_basic, test_compute_sections_modified_new_section (+3) |
| `crates/llmtxt-core/tests/cross_language_vectors.rs` | test_lifecycle_vectors, test_consensus_vectors, test_patch_diff_vectors |
| `crates/llmtxt-core/src/lifecycle.rs` | as_str, fmt |
| `crates/llmtxt-core/tests/multi_version_diff_test.rs` | test_10_version_chain_with_arbitrary_diffs |
| `crates/llmtxt-core/src/diff.rs` | test_structured_diff_additions |

## Entry Points

Start here when exploring this area:

- **`compute_sections_modified`** (Function) — `crates/llmtxt-core/src/patch.rs:215`
- **`compute_sections_modified_native`** (Function) — `crates/llmtxt-core/src/patch.rs:221`
- **`as_str`** (Function) — `crates/llmtxt-core/src/lifecycle.rs:33`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `compute_sections_modified` | Function | `crates/llmtxt-core/src/patch.rs` | 215 |
| `compute_sections_modified_native` | Function | `crates/llmtxt-core/src/patch.rs` | 221 |
| `as_str` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 33 |
| `test_10_version_chain_with_arbitrary_diffs` | Function | `crates/llmtxt-core/tests/multi_version_diff_test.rs` | 6 |
| `sections_map` | Function | `crates/llmtxt-core/src/patch.rs` | 187 |
| `test_compute_sections_modified_basic` | Function | `crates/llmtxt-core/src/patch.rs` | 386 |
| `test_compute_sections_modified_new_section` | Function | `crates/llmtxt-core/src/patch.rs` | 395 |
| `test_compute_sections_modified_removed_section` | Function | `crates/llmtxt-core/src/patch.rs` | 404 |
| `test_compute_sections_modified_no_changes` | Function | `crates/llmtxt-core/src/patch.rs` | 413 |
| `test_compute_sections_modified_wasm_json` | Function | `crates/llmtxt-core/src/patch.rs` | 420 |
| `test_lifecycle_vectors` | Function | `crates/llmtxt-core/tests/cross_language_vectors.rs` | 14 |
| `test_consensus_vectors` | Function | `crates/llmtxt-core/tests/cross_language_vectors.rs` | 74 |
| `test_patch_diff_vectors` | Function | `crates/llmtxt-core/tests/cross_language_vectors.rs` | 144 |
| `fmt` | Function | `crates/llmtxt-core/src/lifecycle.rs` | 54 |
| `test_structured_diff_additions` | Function | `crates/llmtxt-core/src/diff.rs` | 306 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Is_valid_transition_str → As_str` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Wasm | 1 calls |
| Cluster_33 | 1 calls |

## How to Explore

1. `gitnexus_context({name: "compute_sections_modified"})` — see callers and callees
2. `gitnexus_query({query: "tests"})` — find related execution flows
3. Read key files listed above for implementation details
