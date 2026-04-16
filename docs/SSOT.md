# SSoT — Single Source of Truth

**One definition. Read this first.**

## The rule

> **All portable primitives live in `crates/llmtxt-core` (Rust).**
> **`packages/llmtxt` is a thin wrapper that exposes them via WASM.**
> **`apps/backend` imports ONLY from `packages/llmtxt`.**

That's it. Everything else derives from this.

## What "portable primitive" means

A function that could be used by ANY consumer (Rust backend, browser, CLI, 3rd-party integrator, Python agent) — not tied to a specific framework, database, or runtime.

**Examples that MUST be in `crates/llmtxt-core`:**

| Kind | Functions |
|------|-----------|
| Crypto | SHA-256 hash, HMAC-SHA256, ed25519 sign/verify |
| Compression | zlib, zstd, dictionary training |
| Canonicalization | deterministic payload bytes for signing |
| Diff / merge | LCS diff, 3-way merge, cherry-pick, patch apply |
| CRDT | Yrs section merge (not Y.js — Yrs is the Rust port) |
| Consensus | approval evaluation, stale detection, reputation math |
| Vector math | cosine similarity, clustering, nearest-neighbor |
| Hash chain | audit-entry hashing, Merkle root |
| Encoding | base62, slug generation, ID generation |
| Schemas | DocumentEvent types, Permission/Role enums, protocol constants |

**Examples that belong in `apps/backend`:**

| Kind | Why |
|------|-----|
| Fastify route handlers | Framework-specific |
| Drizzle queries | ORM-specific |
| better-auth session | Library-specific |
| Redis pub/sub adapter | Infrastructure |
| Rate limit store (Redis) | Infrastructure |
| HTTP middleware wiring | Framework-specific |

**Exceptions (documented in ARCHITECTURE-PRINCIPLES.md):**
- Tokenizers (`gpt-tokenizer`, `@anthropic-ai/tokenizer`) — ML-ecosystem, can't cleanly run in Rust
- Embedding providers (OpenAI/Voyage HTTP clients, ONNX model runners) — SDK-level adapters
- Markdown→HTML rendering for SSR — backend-only feature

## The two-artifact rule

Every new feature produces **two** artifacts:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Rust function in crates/llmtxt-core/src/<module>.rs      │
│    #[cfg_attr(feature = "wasm", wasm_bindgen)]              │
│    pub fn my_primitive(input: &str) -> Result<String, Err>  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ built by wasm-pack
┌─────────────────────────────────────────────────────────────┐
│ 2. TypeScript wrapper in packages/llmtxt/src/wasm.ts        │
│    export function myPrimitive(input: string): string {     │
│      return core.my_primitive(input);  // core = WASM       │
│    }                                                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Consumption in apps/backend/src/routes/*.ts              │
│    import { myPrimitive } from 'llmtxt';                    │
│    // NEVER: import from 'crates/llmtxt-core'               │
│    // NEVER: import from 'node:crypto' for hashing/signing  │
│    // NEVER: re-implement in TypeScript                     │
└─────────────────────────────────────────────────────────────┘
```

## Cross-platform byte-identity (CI-verified)

Every primitive has a test that runs the SAME INPUT through:
- Native Rust (`cargo test`)
- WASM binding (`node --import tsx src/wasm.ts`)

Both must produce **byte-identical output**. CI fails the release if they diverge.

## Why

1. **SignalDock** and any other Rust backend can `cargo add llmtxt-core` and use primitives directly, without depending on the hosted API.
2. **All JS consumers** (browser, Node, Cloudflare Workers, Deno, edge) get the same functions via WASM.
3. **Future Python/Go/Rust SDKs** (T097) compile against the same Rust source.
4. **No drift**: if the TS implementation of `compress` differed from the Rust one, stored blobs would become unreadable by one side.

## How I failed this before

Owner caught two separate violations:

1. **2026-04-14 morning** — Wrote T083 (CRDT) as "integrate Y.js in backend." Y.js is JavaScript-only. Rust consumers would be locked out. **Fix**: Use Yrs (Y.js ported to Rust by same author). Primitive lives in `llmtxt-core`, consumed via WASM.

2. **2026-04-14 afternoon** — Audit found **22 violations** of this rule across shipped and planned code. See `docs/SSOT-AUDIT.md`. Created T111 (SDK-First Refactor) to migrate all 22. T112 (NAPI-RS native bindings) was scoped but deferred 2026-04-15 pending benchmark evidence that WASM is a bottleneck.

## Session recovery

A new Claude session landing on this project should:

1. Read this file first (`docs/SSOT.md`).
2. Run `cleo memory find "SSoT"` — retrieves decision D001 with full context.
3. Run `cleo memory find "guiding star"` — retrieves D003 (never lose work / never duplicate / never stale).
4. Run `cleo orchestrate status --epic T111` — sees the refactor state.
5. Consult the other load-bearing docs:
   - `docs/ARCHITECTURE-PRINCIPLES.md` — the full normative document
   - `docs/SSOT-AUDIT.md` — the 22 violations and their status
   - `docs/VISION.md` — Phases 1-11 roadmap
   - `docs/SHIP-ORDER.md` — dependency DAG and wave schedule
   - `docs/RED-TEAM-ANALYSIS.md` — honest assessment (4.2/10 scored)

That's enough context to resume without losing the plot.

## Documented exceptions

### T102: Local ONNX embedding provider

`packages/llmtxt/src/embeddings.ts` contains `LocalOnnxEmbeddingProvider` — an
exception to the SSoT rule.

**Rationale**: ML model loading is environment-specific.
- Node.js uses `onnxruntime-node` (native NAPI binding, CPU inference).
- Browsers use `onnxruntime-web` (WASM, not yet implemented).

These runtimes cannot be abstracted into a single Rust WASM module because they
require native file-system access (model download, disk cache) and different WASM
compilation targets.

**What stays in crates/llmtxt-core (SSoT)**:
- `cosine_similarity`, `semantic_diff`, `semantic_consensus` — all vector math.
- Exposed via WASM and re-exported from `packages/llmtxt`.

**What is the exception**:
- `packages/llmtxt/src/embeddings.ts` — ONNX model download, tokenisation,
  inference, mean-pooling, L2-normalise, `LocalOnnxEmbeddingProvider`.
- `onnxruntime-node` dependency in `apps/backend/package.json`.

**Reactivation trigger**: If a Rust candle-core or tract ONNX provider is
integrated into `crates/llmtxt-core`, this exception should be resolved and the
TS module removed.

## TL;DR

**SSoT = crates/llmtxt-core. Everything portable lives there. packages/llmtxt wraps it via WASM. apps/backend imports only from the wrapper. Yrs not Y.js. WASM as the sole JS binding (NAPI-RS deferred). Two artifacts per feature. CI verifies byte-identity. Exception: ONNX embedding inference in packages/llmtxt/src/embeddings.ts (see above).**
