# T112 Decomposition — NAPI-RS Native Bindings for Node.js Consumers

**Date**: 2026-04-15
**Decomposed by**: Team Lead (LOOM Decomposition stage)
**Epic**: T112 — NAPI-RS Native Bindings for Node.js Consumers
**Child tasks created**: 10 (T115, T118, T120, T124, T126, T129, T131, T135, T138, T141)

---

## Summary

Epic T112 adds NAPI-RS as a second binding layer alongside the existing WASM build of `crates/llmtxt-core`. The design is: one Rust source, two binding outputs (WASM via wasm-pack, native via napi build), one runtime-detected SDK surface in `packages/llmtxt`.

10 atomic child tasks were created across 3 waves. All waves flow W1 → W2 → W3. Within each wave, tasks that do not share file paths are parallel-safe.

---

## Wave Structure

### Wave 1 — Cargo Foundation (parallelizable with T111)

| ID | Title | Size | Blocks |
|----|-------|------|--------|
| T115 | T112.1: Add napi feature flag to llmtxt-core Cargo.toml | small | T118, T120 |
| T118 | T112.2: Add #[cfg_attr(feature = napi, napi)] attributes to all public WASM-exported functions | medium | T120 |

**Wave 1 notes**: T115 is the foundation — nothing else can proceed without it. T118 annotates all 23 public functions currently carrying `#[cfg_attr(feature = "wasm", wasm_bindgen)]`. Only file touched: `crates/llmtxt-core/src/lib.rs` and `crates/llmtxt-core/Cargo.toml`. These tasks are independent of T111 (which works in new modules, not lib.rs annotations).

### Wave 2 — Build Pipeline + Packaging

| ID | Title | Size | Blocks |
|----|-------|------|--------|
| T120 | T112.3: Set up napi build pipeline producing per-platform .node binaries | medium | T124 |
| T124 | T112.4: Create @llmtxt/native npm package with prebuilt binary distribution | medium | T126 |
| T126 | T112.5: Runtime loader in packages/llmtxt — prefer NAPI on Node, fall back to WASM | small | T129, T131, T141 |

**Wave 2 notes**: T120 → T124 → T126 is a strict sequential chain within Wave 2. T120 sets up the napi CLI manifest in `crates/llmtxt-core/package.json`. T124 creates `packages/llmtxt-native/` (the `@llmtxt/native` package). T126 creates `packages/llmtxt/src/loader.ts`. T135 (CI matrix) also depends on T120 but can be written in parallel with T124 since it only touches `.github/workflows/`.

### Wave 3 — Validation + CI + Docs

| ID | Title | Size | Depends on |
|----|-------|------|------------|
| T129 | T112.6: Byte-identity test suite | medium | T126 |
| T131 | T112.7: Benchmark suite | medium | T126 |
| T135 | T112.8: CI matrix — 5 platform binaries | medium | T120 |
| T138 | T112.9: Documentation | small | T131 |
| T141 | T112.10: SDK-invariance test | small | T126 |

**Wave 3 notes**: T129, T131, T135, T141 can all be worked in parallel (they touch different files). T138 (docs) must wait for T131 (benchmarks) since it incorporates benchmark results into `docs/performance.md`.

---

## Dependency Graph

```
T115 (Cargo.toml napi feature)
  └─► T118 (cfg_attr annotations on 23 functions)
        └─► T120 (napi build pipeline)
              ├─► T124 (@llmtxt/native package)
              │     └─► T126 (runtime loader)
              │           ├─► T129 (byte-identity tests)
              │           ├─► T131 (benchmarks)
              │           │     └─► T138 (docs)
              │           └─► T141 (SDK-invariance test)
              └─► T135 (CI matrix)  ← parallel with T124
```

---

## Public Functions Requiring `#[napi]` Annotation (T118)

Sourced from `crates/llmtxt-core/src/lib.rs` grep of `#[cfg_attr(feature = "wasm", wasm_bindgen)]`:

1. `three_way_merge_wasm` — returns JSON string
2. `multi_way_diff_wasm` — returns JSON string
3. `cherry_pick_merge_wasm` — returns JSON string
4. `semantic_diff_wasm` — returns JSON string
5. `semantic_consensus_wasm` — returns JSON string
6. `encode_base62(num: u64)` — **NOTE**: u64 requires BigInt handling in napi-rs
7. `decode_base62(s: &str) -> u64` — **NOTE**: returns u64, BigInt on JS side
8. `compress(data: &str) -> Result<Vec<u8>, String>`
9. `decompress(data: &[u8]) -> Result<String, String>`
10. `generate_id() -> String`
11. `hash_content(data: &str) -> String`
12. `calculate_tokens(text: &str) -> u32`
13. `calculate_compression_ratio(original_size: u32, compressed_size: u32) -> f64`
14. `compute_signature` — 5 params
15. `compute_signature_with_length` — 6 params
16. `compute_org_signature` — 6 params
17. `compute_org_signature_with_length` — 7 params
18. `derive_signing_key(api_key: &str) -> String`
19. `is_expired(expires_at_ms: f64) -> bool`
20. `text_similarity(a: &str, b: &str) -> f64`
21. `text_similarity_ngram(a: &str, b: &str, n: usize) -> f64`
22. `compute_diff` — returns `DiffResult` struct (needs `#[napi(object)]`)
23. `structured_diff` — returns JSON string

Plus patch functions in `lib.rs` (create_patch, apply_patch, reconstruct_version, squash_patches — to be confirmed by T118 implementer).

---

## Open Questions

### 1. napi-rs version
As of 2026-04, napi-rs is at `@napi-rs/cli@3.x` and `napi@2.x`. The implementer of T115 should verify the latest stable versions at https://napi.rs before adding to Cargo.toml. The `napi` Cargo crate version should match the `@napi-rs/cli` npm version major.

### 2. linux-x64-musl
linux-musl is required for Alpine-based Docker containers (common in Railway/Fly deployments). T112.3 includes it as a required target. Cross-compilation via `cross` or a musl Docker builder (ghcr.io/rust-cross/rust-musl-cross) is recommended. The implementer should test musl locally before CI setup.

### 3. windows-arm64
NOT included in scope. Windows ARM64 (Surface Pro X, Snapdragon) is niche. Can be added in a follow-up task if demanded. The 5 targets listed (linux-x64-gnu, linux-x64-musl, darwin-arm64, darwin-x64, windows-x64-msvc) cover the vast majority of production deployments.

### 4. Prebuilt binary hosting
Binary hosting strategy: npm optionalDependencies (same pattern as `@napi-rs/canvas`, `lightningcss`, `swc`). Each platform sub-package (`@llmtxt/native-linux-x64-gnu`, etc.) is published separately on npm. The `@llmtxt/native` umbrella package lists them all as `optionalDependencies` — npm/pnpm only installs the one matching the current platform. GitHub Releases is a secondary artifact store (CI uploads all 5 binaries there). No separate CDN or S3 is needed.

### 5. BigInt handling for u64 parameters
`encode_base62(num: u64)` and `decode_base62(s: &str) -> u64` use u64 which maps to JavaScript BigInt in napi-rs. The WASM binding uses `BigInt(num)` casting in `wasm.ts`. The napi binding will expose the same BigInt contract. T118 implementer must verify napi-rs `u64` handling and add `#[napi(js_name = "encodeBase62")]` if needed for naming consistency.

---

## Prior Art References

- napi-rs official docs: https://napi.rs/docs/introduction/getting-started
- `@napi-rs/canvas` source: https://github.com/Brooooooklyn/canvas — canonical reference for directory layout, CI matrix, npm publish workflow
- `lightningcss` napi binding: https://github.com/parcel-bundler/lightningcss — simpler example, similar to llmtxt-core scope
- `swc` (SWC Core): https://github.com/swc-project/swc — large-scale production example
- `oxc-resolver`: https://github.com/oxc-project/oxc-resolver — clean small example
- napi-rs version matrix: https://napi.rs/docs/introduction/support-matrix

---

## Acceptance Criteria Coverage (T112 epic → child task mapping)

| T112 Epic Acceptance Criterion | Covered by |
|-------------------------------|-----------|
| Cargo.toml gains 'napi' feature flag | T115 |
| All #[wasm_bindgen] functions get #[napi] attribute | T118 |
| napi build produces per-platform .node binaries | T120 |
| @llmtxt/native npm package publishes prebuilt binaries | T124 |
| packages/llmtxt gains runtime loader | T126 |
| Byte-identical output verified across all three paths | T129 |
| Benchmark suite shows native > WASM > TS | T131 |
| CI builds all 5 platforms on release tags | T135 |
| Documentation: performance comparison table | T138 + T131 |
| SDK consumers get zero API change | T126 + T141 |
| Existing WASM consumers unaffected | T141 |
