# LLMtxt Architecture Principles

> **The SDK is the product. The hosted app is one instance of it.**
>
> This document is normative. Every epic, every PR, every sub-agent prompt must conform.

## Principle 1 — Rust SSoT for Portable Primitives

All primitives that must produce **byte-identical output across consumers** live in `crates/llmtxt-core`.

### What qualifies as a "portable primitive"

| Kind | Examples | Must be in core? |
|------|----------|-----------------|
| Cryptographic | `hash_content`, `compute_signature`, `sign_ed25519`, `verify_ed25519` | **YES** |
| Compression | `zlib_compress`, `zstd_compress`, `train_dictionary` | **YES** |
| Canonicalization | `canonicalize(payload)` for signing | **YES** |
| Diff/merge | `lcs_diff`, `three_way_merge`, `cherry_pick_merge`, `apply_patch` | **YES** |
| CRDT | Y-doc ops (via Yrs) | **YES** (via Yrs crate) |
| Consensus math | `evaluate_approvals`, `mark_stale_reviews` | **YES** |
| Vector math | `cosine_similarity`, `semantic_diff_native`, `semantic_consensus_native` | **YES** |
| Hash chain | `hash_audit_entry`, `merkle_root`, `verify_chain` | **YES** |
| ID/encoding | `generate_id`, `encode_base62`, `decode_base62` | **YES** |

### What does NOT belong in core

| Kind | Examples | Why excluded |
|------|----------|-------------|
| HTTP routing | Fastify routes | Backend-specific |
| DB queries | Drizzle schema, CRUD | Backend-specific |
| Auth session management | better-auth, cookies | Backend + framework specific |
| Rate limiting policy | Per-tier limits | Deploy-specific |
| ML model execution | Tokenizers, embeddings | Ecosystem-specific (TS/Python libs) |
| Integration adapters | OpenAI API client, webhook senders | I/O bound, upstream-API specific |

### The test for "does this belong in Rust core"

Ask: **Could a Rust backend (SignalDock, any integrator) reasonably want to use this function directly without going through the hosted API?**
- YES → `crates/llmtxt-core`
- NO → `apps/backend`

## Principle 2 — packages/llmtxt is the Single Public Surface

### Layered consumption model (WASM-only binding)

```
                     ┌──────────────────────────────────────────────────┐
                     │              crates/llmtxt-core                  │
                     │   (Rust SSoT — pure primitives, no I/O)          │
                     │   #[wasm_bindgen]   plain Rust API               │
                     └──────────────────────┬───────────────────────────┘
                                            │
                  ┌─────────────────────────┼─────────────────────────┐
                  │                         │                         │
                  ▼                         ▼                         ▼
       ┌──────────────────┐    ┌────────────────────┐    
       │ Native Rust      │    │  @llmtxt/wasm      │    
       │ (SignalDock,     │    │  (wasm-bindgen)    │    
       │ direct crate use)│    │  universal         │    
       └──────────────────┘    └─────────┬──────────┘    
                                         │
                                         ▼
                          ┌─────────────────────────────┐
                          │     packages/llmtxt         │
                          │  (npm, WASM consumer)       │
                          │  - uses WASM on all targets │
                          │  - identical API surface    │
                          └──────────────┬──────────────┘
                                         │
                    ┌────────────────┬───┴──────────┬──────────────┬─────────────┐
                    ▼                ▼              ▼              ▼             ▼
           ┌────────────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────┐  ┌─────────────┐
           │  apps/backend  │  │ apps/frontend│  │  CLI /    │  │  Deno    │  │  Browser    │
           │  (Node)        │  │  (browser)   │  │  MCP / 3p │  │  / edge  │  │  apps       │
           │  → uses WASM   │  │  → uses WASM │  │  → WASM   │  │  → WASM  │  │  → WASM     │
           └────────────────┘  └──────────────┘  └───────────┘  └──────────┘  └─────────────┘
```

**NAPI-RS bindings deferred 2026-04-15.** WASM is the sole JS binding until production benchmarks prove a hot-path operation (compress / diff / CRDT merge / HMAC) is a bottleneck. See [WASM-only binding decision](../feedback_wasm_only_binding.md) — native bindings will be added when reactivation trigger is met.

### Native binding strategy

| Target | Binding | When | Performance |
|--------|---------|------|-------------|
| `crates/llmtxt-core` (pure Rust) | None (just `Cargo.toml` dep) | Any Rust consumer | Native, fastest |
| `@llmtxt/wasm` via wasm-bindgen | `#[wasm_bindgen]` attribute, `wasm-pack` | All JS consumers (Node, browser, Deno, edge) | Universal, sufficient for current workloads |
| `@llmtxt/native` via NAPI-RS | **RESERVED** (deferred 2026-04-15) | Reactivate when benchmarks justify | Native, 3-10× faster (unproven necessity) |
| `llmtxt-py` via PyO3 (future) | `#[pyfunction]` attribute, `maturin build` | Python consumers | Native, fastest for Python |

`packages/llmtxt` imports WASM directly:
```typescript
import core from '@llmtxt/wasm';
export * from core;  // identical API surface
```

NAPI-RS bindings are deferred. Reactivation trigger: benchmark evidence that WASM is a bottleneck on a hot-path operation (compress / diff / CRDT merge / HMAC). The cost-benefit is unfavorable without measured need: YAGNI (per PRINCIPLES.md).

### Rules

1. **`apps/backend` imports ONLY from `packages/llmtxt`**, never directly from `crates/llmtxt-core`, never from `@llmtxt/wasm` directly, never from `yjs`/`yrs`/crypto libs.
2. **`packages/llmtxt` imports from `@llmtxt/wasm`**, never re-implements primitives in TypeScript.
3. **WASM API surface mirrors the Rust API surface 1:1.** No TypeScript-only helpers without a matching Rust function. WASM exposes the same functions with the same signatures.
4. **Cross-platform byte-identity is CI-verified.** Same input → same output across Rust native and WASM. Test suite runs both; release blocks on divergence.
5. **Breaking changes in `crates/llmtxt-core` bump `packages/llmtxt` major version.**
6. **Frontend uses `packages/llmtxt` like any other consumer.** No reaching into backend; no separate browser-only implementation.

### Red flags (reject at review)

- `import { createHash, createHmac, ... } from 'node:crypto'` in `apps/backend/**` for anything except `randomUUID`, `randomBytes` (general randomness use is fine; cryptographic hashing/signing is NOT — that's the Rust core's job)
- `import { ... } from 'yjs'`, `import { ... } from 'automerge'`, `import { ... } from 'yrs'` anywhere in `apps/backend/**` or `packages/llmtxt/src/**` (these primitives belong in `crates/llmtxt-core`)
- Re-implementing a function that already exists in `crates/llmtxt-core` just because it's inconvenient to reach via WASM
- Adding TypeScript-only "helpers" that have no Rust equivalent (they will drift)
- `import { ... } from '@llmtxt/wasm'` outside `packages/llmtxt/src/` (consumers should never know the binding in use)
- Pure algorithm files in `packages/llmtxt/src/*.ts` that aren't WASM wrappers (the audit uncovered `disclosure.ts`, `similarity.ts`, `graph.ts`, `validation.ts` as historical violations — see `docs/SSOT-AUDIT.md`)

## Principle 3 — apps/backend is a Deployment, Not a Product

The hosted api.llmtxt.my is **one possible deployment** of the SDK. It exists to:
- Provide a reference HTTP transport
- Host the canonical public instance
- Drive the frontend at www.llmtxt.my

It does **NOT** own any logic that another backend integrator would want. Everything agent-facing is in the SDK.

### What this means practically

- **RBAC policy** (who can do what): SDK exposes `Permission`, `Role`, `evaluatePermissions(user, doc)` — backend wires DB lookups.
- **Consensus evaluation**: SDK owns the math. Backend owns the DB rows.
- **Compression**: SDK owns the byte format. Backend owns the storage blob.
- **CRDT merge**: SDK owns the merge function. Backend owns the persistent state.
- **Signed URLs**: SDK owns the canonical format + signature. Backend owns the secret.

### Why this matters

- **SignalDock** can self-host on Rust without running our Node server
- **Edge-deployed agents** can do CRDT merge in-browser via WASM without round-tripping
- **3rd-party platforms** can embed llmtxt without becoming a customer
- **Future us** can rewrite the backend in Go/Rust/Elixir without changing the protocol

## Principle 4 — Wire Compatibility Is a Promise

Two consumers using `llmtxt-core` (directly in Rust, or via WASM) must produce byte-identical output for the same input.

### Verification

Every primitive with wire implications has a cross-platform test:

```rust
#[test]
fn compress_wire_compat() {
    let input = "Hello, world!";
    let native = llmtxt_core::compress(input).unwrap();
    let expected = hex::decode("789c48cdc9c95728cf2fca4951040019010405").unwrap();
    assert_eq!(native, expected);
}
```

And a matching test in `packages/llmtxt`:

```typescript
test('compress wire compat', async () => {
  const result = await compress('Hello, world!');
  expect(Buffer.from(result).toString('hex')).toBe('789c48cdc9c95728cf2fca4951040019010405');
});
```

**CI requirement**: both tests must pass. If they ever diverge, the release is blocked.

## Principle 5 — No ML Inside the Core

Machine learning is model-ecosystem specific. The Rust core holds the **math** (cosine similarity, cluster assignment, consensus scoring) but never the **model** (no ONNX runtime in `llmtxt-core`, no transformer weights, no tokenizer libraries).

### Where ML lives

| Layer | What |
|-------|------|
| `crates/llmtxt-core` | Pure math: cosine similarity, clustering, ranking |
| `packages/llmtxt` | Provider abstractions + adapters (OpenAI, Voyage, local ONNX) |
| `apps/backend` | Orchestration: pick provider, cache results, serve via routes |

### Why

- Rust has `candle-core` but the ecosystem is smaller
- Most agents run in Python; their SDK is Python
- Tokenizer bindings are not uniformly available in Rust
- Embedding providers are HTTP APIs — already cross-platform

Consequence: Rust consumers who need embeddings bring their own (via `candle-rs` + ONNX, or HTTP API calls).

## Principle 6 — Backwards Compatibility as a Feature

Every change to `crates/llmtxt-core` is reviewed for wire compatibility first, performance second, ergonomics third.

### Policy

- Adding a function: **MINOR** version bump
- Adding a parameter (non-breaking default): **MINOR**
- Changing output bytes for existing input: **MAJOR** — requires migration note in VISION
- Removing a function: **MAJOR** + 12-month deprecation

### The zlib precedent

`compress()` was shipped with zlib. Even when we add zstd (T100), the zlib function stays because old blobs depend on it. We add new codec functions alongside.

## Principle 7 — The Frontend Is a Consumer

`apps/frontend` is not special. It imports from `packages/llmtxt` the same way any other consumer does. It does not reach into `apps/backend` source.

### Consequence

Every feature that the frontend needs (diff rendering, merge UI, CRDT viewer) gets its primitives from the SDK. If the SDK doesn't have what the frontend needs, the SDK is the gap, not the backend.

## Enforcement

- **Code review**: every PR touching `apps/backend/src/**` is checked for forbidden imports (`yjs`, `yrs`, `automerge`, direct crypto for hashing/signing).
- **CI lint rule**: AST scan for banned imports in backend (ship in T089 ops work).
- **Epic prompt template**: every sub-agent prompt for a primitive epic includes this file as required reading.
- **Sub-agent guardrail**: before spawning any code-writing agent for a primitive, the orchestrator prompt must quote the relevant principle.

## See Also

- `docs/VISION.md` — Phases 5-11 roadmap (each epic must conform to these principles)
- `docs/SHIP-ORDER.md` — wave schedule with dependency DAG
- `docs/RED-TEAM-ANALYSIS.md` — critique that drove this structure
