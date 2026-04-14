---
name: cluster-25
description: "Skill for the Cluster_25 area of llmtxt. 5 symbols across 2 files."
---

# Cluster_25

5 symbols | 2 files | Cohesion: 100%

## When to Use

- Working with code in `crates/`
- Understanding how generate_signed_url, verify_signed_url work
- Modifying cluster_25-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `crates/llmtxt-core/src/lib.rs` | test_generate_signed_url_with_path_prefix, test_verify_signed_url_accepts_32_char_signature_and_path_prefix, test_verify_signed_url_exp_zero_never_expires |
| `crates/llmtxt-core/src/native_signed_url.rs` | generate_signed_url, verify_signed_url |

## Entry Points

Start here when exploring this area:

- **`generate_signed_url`** (Function) — `crates/llmtxt-core/src/native_signed_url.rs:53`
- **`verify_signed_url`** (Function) — `crates/llmtxt-core/src/native_signed_url.rs:86`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `generate_signed_url` | Function | `crates/llmtxt-core/src/native_signed_url.rs` | 53 |
| `verify_signed_url` | Function | `crates/llmtxt-core/src/native_signed_url.rs` | 86 |
| `test_generate_signed_url_with_path_prefix` | Function | `crates/llmtxt-core/src/lib.rs` | 465 |
| `test_verify_signed_url_accepts_32_char_signature_and_path_prefix` | Function | `crates/llmtxt-core/src/lib.rs` | 560 |
| `test_verify_signed_url_exp_zero_never_expires` | Function | `crates/llmtxt-core/src/lib.rs` | 580 |

## How to Explore

1. `gitnexus_context({name: "generate_signed_url"})` — see callers and callees
2. `gitnexus_query({query: "cluster_25"})` — find related execution flows
3. Read key files listed above for implementation details
