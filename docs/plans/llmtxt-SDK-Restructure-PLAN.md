# Plan: llmtxt SDK Restructure & Collaborative Document Primitives

## Context

The llmtxt project is evolving from a primitives library (`@codluv/llmtxt`) into a full SDK (`llmtxt`) with collaborative document support. signaldock-dev committed a [COLLABORATIVE-DOCUMENTS-SPEC.md](/mnt/projects/signaldock-core/docs/COLLABORATIVE-DOCUMENTS-SPEC.md) defining the three-tier storage architecture (SQL + S3 + Redis) and 15+ new API endpoints. The [SIGNALDOCK-UNIFIED-AGENT-REGISTRY.md](/mnt/projects/cleocode/docs/specs/SIGNALDOCK-UNIFIED-AGENT-REGISTRY.md) reveals the ecosystem is migrating from wasm-bindgen to napi-rs v3.8+, and SignalDock's Rust/Axum server will need MVI endpoints — meaning disclosure/section parsing must eventually exist in Rust too.

**Immediate goal:** Ship the package rename + SDK with collaborative doc types. Lay groundwork for future Rust-side MVI.

## What's Already Done

- [x] `git mv packages/core packages/llmtxt`
- [x] package.json: renamed to `llmtxt`, version `2026.4.0`, subpath exports added
- [x] Release workflow updated (`packages/llmtxt` paths)
- [x] apps/web imports updated from `@codluv/llmtxt` to `llmtxt`
- [x] CHANGELOG updated with 2026.4.0 entry
- [x] SDK modules created: lifecycle.ts, versions.ts, attribution.ts, consensus.ts, storage.ts, retrieval.ts
- [x] exp=0 bug fix committed and released as v2026.3.1

## Rust vs TypeScript Decision

### Stays in Rust (performance-critical, cross-platform, needed by Axum server)
- All existing primitives (compress, hash, sign, patch, diff, similarity, base62, id gen)
- **NEW: `reconstruct_version(base, patches[], target)`** — avoids N WASM boundary crossings
- **NEW: `squash_patches(base, patches[])`** — same reason
- **FUTURE: disclosure/MVI parsing** — the Axum server needs `?mvi=overview` endpoints in Rust. Not in this PR, but the architecture should not prevent it.

### Stays in TypeScript (business logic, Node.js specific, depends on TS-only features)
- Lifecycle state machine (pure if/else, no perf need)
- Consensus/approval evaluation (pure logic)
- Attribution aggregation (depends on generateOverview which is TS today)
- Retrieval planning (depends on overview sections + similarity)
- Storage types (pure types, no logic)
- Client HTTP wrapper (Node.js fetch)
- Validation (Zod dependency)
- Disclosure/MVI (TS today, Rust port is future work)
- Knowledge graph (regex extraction)

### Rationale
The napi-rs migration will eventually eliminate the WASM boundary overhead question. For now, the only Rust additions are `reconstruct_version` and `squash_patches` — these apply N patches sequentially and genuinely benefit from staying in Rust (1 boundary crossing vs N).

## Implementation Steps

### Step 1: Rust — Add version reconstruction primitives

**File:** `crates/llmtxt-core/src/patch.rs`

Add two new functions:
```rust
/// Apply a sequence of patches to base content, returning content at target version.
/// Avoids N WASM boundary crossings by doing all patch applications in Rust.
pub fn reconstruct_version(base: &str, patches: &[String], target: usize) -> Result<String, String>

/// Apply all patches sequentially, then create a single diff from base to final.
pub fn squash_patches(base: &str, patches: &[String]) -> Result<String, String>
```

Add WASM exports with `#[cfg_attr(feature = "wasm", wasm_bindgen)]`. Since wasm_bindgen doesn't support `&[String]`, use a JSON-encoded string array parameter:
```rust
pub fn reconstruct_version(base: &str, patches_json: &str, target: u32) -> Result<String, String>
pub fn squash_patches(base: &str, patches_json: &str) -> Result<String, String>
```

Add tests. Update CHANGELOG. Bump crate version to 2026.4.0.

### Step 2: WASM rebuild

```bash
cd packages/llmtxt && pnpm run build:wasm
```

Update `src/wasm.ts` to export the two new functions.
Update `src/patch.ts` to re-export them.

### Step 3: Update SDK modules to use Rust primitives

**File:** `packages/llmtxt/src/sdk/versions.ts`
- Update `reconstructVersion()` to call WASM `reconstruct_version()` instead of looping in TS
- Update `squashPatches()` to call WASM `squash_patches()` instead of looping in TS
- Keep `validatePatchApplies()`, `computeReversePatch()`, `diffVersions()` as TS (single WASM calls each)

### Step 4: Create SDK barrel export

**File:** `packages/llmtxt/src/sdk/index.ts` (NEW — missing, will break `llmtxt/sdk` import)

```typescript
// Lifecycle
export { DocumentState, DOCUMENT_STATES, StateTransition, TransitionResult,
  isValidTransition, validateTransition, isEditable, isTerminal } from './lifecycle.js';

// Versions
export { VersionEntry, ReconstructionResult, PatchValidationResult, VersionDiffSummary,
  reconstructVersion, validatePatchApplies, squashPatches, computeReversePatch, diffVersions } from './versions.js';

// Attribution
export { VersionAttribution, ContributorSummary,
  attributeVersion, buildContributorSummary } from './attribution.js';

// Consensus
export { ApprovalStatus, Review, ApprovalPolicy, ApprovalResult, DEFAULT_APPROVAL_POLICY,
  evaluateApprovals, markStaleReviews } from './consensus.js';

// Storage
export { StorageType, CompressionMethod, ContentRef, StorageMetadata,
  inlineRef, objectStoreRef, versionStorageKey, shouldUseObjectStore } from './storage.js';

// Retrieval
export { PlannedSection, RetrievalPlan, RetrievalOptions,
  planRetrieval, estimateRetrievalCost } from './retrieval.js';
```

### Step 5: Update main index.ts

**File:** `packages/llmtxt/src/index.ts`

Add SDK re-exports to the main barrel so consumers can also do `import { DocumentState } from 'llmtxt'`:
- Re-export all SDK types (not functions — those come from `llmtxt/sdk`)
- Re-export key SDK functions that are commonly needed alongside primitives

### Step 6: Update types.ts

**File:** `packages/llmtxt/src/types.ts`

Ensure `DocumentMeta` includes the new collaborative fields that consumers will need:
- Add `mode?: DocumentState` (lifecycle state)
- Add `versionCount?: number`
- Add `currentVersion?: number`
- Add `storageKey?: string` (content reference for S3 migration)

### Step 7: pnpm install + build + test

```bash
cd /mnt/projects/llmtxt
pnpm install              # regenerate lockfile after rename
pnpm run build:all        # WASM + TS
pnpm run validate         # typecheck + forge-ts + versionguard
```

### Step 8: Update remaining references

These files still contain `@codluv/llmtxt` or `packages/core`:
- `packages/llmtxt/README.md` — update package name, install instructions, import examples
- `packages/llmtxt/PORTABLE_CORE_CONTRACT.md` — update package references
- `packages/llmtxt/test-vectors.json` — update description field
- `crates/llmtxt-core/README.md` — update TS package reference
- `crates/llmtxt-core/src/lib.rs` — update doc comment
- `docs/ARCHITECTURE.md` — update package references
- `docs/VISION.md` — update package references
- `crates/llmtxt-core/CHANGELOG.md` — add 2026.4.0 entry for new Rust functions

### Step 9: Verify build

```bash
cargo test                            # Rust tests (27+ pass)
cd packages/llmtxt && pnpm run build:all  # WASM + TS clean
pnpm run validate                     # typecheck + tooling
```

### Step 10: Commit

Single commit: `feat: rename to llmtxt, add collaborative document SDK with subpath exports`

## NOT in this PR (Future Work)

1. **Rust MVI/disclosure port** — The Axum server needs `generate_overview()` and `get_section()` in Rust for `?mvi=` endpoints. This is a separate, larger effort.
2. **napi-rs migration** — The ecosystem is moving from wasm-bindgen to napi-rs v3.8+. llmtxt-core will follow when the broader migration happens.
3. **LlmtxtDocument class** — The stateful orchestration object (`doc.open()`, `doc.addVersion()`, `doc.approve()`) requires a `StorageAdapter` interface. This depends on signaldock-dev confirming the storage contract. Defer until the collaborative docs API is more concrete.
4. **npm publish** — Claiming `llmtxt` on npm. Requires owner to run the publish or trigger the workflow.

## Critical Files

| File | Action |
|---|---|
| `crates/llmtxt-core/src/patch.rs` | Add `reconstruct_version`, `squash_patches` |
| `crates/llmtxt-core/src/lib.rs` | Export new functions, update doc comment |
| `crates/llmtxt-core/Cargo.toml` | Bump to 2026.4.0 |
| `packages/llmtxt/src/sdk/index.ts` | CREATE — barrel export for `llmtxt/sdk` |
| `packages/llmtxt/src/sdk/versions.ts` | Update to use Rust primitives |
| `packages/llmtxt/src/wasm.ts` | Add new WASM function exports |
| `packages/llmtxt/src/patch.ts` | Re-export new functions |
| `packages/llmtxt/src/index.ts` | Add SDK type re-exports |
| `packages/llmtxt/src/types.ts` | Add collaborative doc fields |
| `packages/llmtxt/package.json` | Already updated |
| `packages/llmtxt/CHANGELOG.md` | Already updated |
| `.github/workflows/release.yml` | Already updated |

## Verification

1. `cargo test` — all Rust tests pass including new reconstruct/squash tests
2. `pnpm run build:all` — WASM + TS compiles clean
3. `pnpm run validate` — typecheck + forge-ts + versionguard pass
4. `import { DocumentState } from 'llmtxt'` — works (main export)
5. `import { planRetrieval } from 'llmtxt/sdk'` — works (subpath export)
6. `import { generateOverview } from 'llmtxt/disclosure'` — works (subpath export)

