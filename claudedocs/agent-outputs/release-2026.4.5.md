# Release Record: v2026.4.5

**Date**: 2026-04-16
**Release Lead**: Claude Sonnet 4.6 (Release Lead subagent)
**CalVer**: `2026.4.5` (previous: `2026.4.4`)

---

## Timeline

| Step | Commit / Tag / Run | Conclusion | Time (UTC) |
|------|--------------------|------------|------------|
| Release commit | `fb76013` (`chore(release): v2026.4.5 ...`) | pushed | 2026-04-16T06:27:17Z |
| CI on release commit | Run `24495603692` | SUCCESS | ~2026-04-16T06:29:54Z |
| Tag `core-v2026.4.5` | points to `d57cae5` | pushed | 2026-04-16T06:30:xx |
| Tag `llmtxt-core-v2026.4.5` | points to `d57cae5` | pushed | 2026-04-16T06:30:xx |
| npm release workflow | Run `24495729074` | SUCCESS | 2026-04-16T06:31:08Z |
| Rust release workflow | Run `24495729110` | SUCCESS | 2026-04-16T06:31:08Z |
| npm `llmtxt@2026.4.5` | registry.npmjs.org | VERIFIED | post-workflow |
| crates.io `llmtxt-core@2026.4.5` | crates.io | NOT PUBLISHED | see below |

---

## Verification Evidence

### CI — Release Commit

- **Run**: `24495603692`
- **Branch**: `main`
- **Commit**: `fb76013`
- **Conclusion**: `success`
- **URL**: `https://github.com/kryptobaseddev/llmtxt/actions/runs/24495603692`

### npm Release Workflow

- **Run**: `24495729074`
- **Trigger**: tag `core-v2026.4.5`
- **Conclusion**: `success`
- **URL**: `https://github.com/kryptobaseddev/llmtxt/actions/runs/24495729074`
- **Verified**: `curl https://registry.npmjs.org/llmtxt/latest` returns `"version":"2026.4.5"`

### Rust Release Workflow

- **Run**: `24495729110`
- **Trigger**: tag `llmtxt-core-v2026.4.5`
- **Conclusion**: `success` (GitHub Release created)
- **URL**: `https://github.com/kryptobaseddev/llmtxt/actions/runs/24495729110`
- **GitHub Release**: `https://github.com/kryptobaseddev/llmtxt/releases/tag/llmtxt-core-v2026.4.5`
- **crates.io**: NOT PUBLISHED — `CARGO_REGISTRY_TOKEN` secret is absent from repo secrets (`gh secret list` shows only `NPM_TOKEN`). The workflow's `Publish to crates.io` step has `if: env.CARGO_REGISTRY_TOKEN != ''` guard and was skipped. `cargo package` ran and validated clean. The GitHub Release was created successfully.

---

## Pre-Release Gate Results

| Gate | Command | Result |
|------|---------|--------|
| `cargo fmt --check` | 0 diffs | PASS |
| `ferrous-forge validate` | All checks pass, 86.1% doc coverage | PASS |
| `cargo test --all-features` | All pass | PASS |
| `pnpm -r typecheck` | 0 errors | PASS |
| `pnpm --filter llmtxt test` | 25/25 pass | PASS |
| `pnpm --filter @llmtxt/backend test` | 156/156 pass | PASS |
| `pnpm --filter @llmtxt/backend run lint` | 0 warnings | PASS |
| `pnpm --filter @llmtxt/backend run openapi:gen` | Clean, no drift | PASS |
| `pnpm -r build` | All packages build | PASS |

---

## What This Release Includes

### Round 1+2+3 Multi-Agent Foundation

- **W1**: CRDT/Yrs module (T189+T191), signed Ed25519 identity (T217), append-only distributed event log with hash-chained receipts
- **W2**: Agent presence tracking, exclusive section leases, real-time diff subscription SSE stream
- **W3**: BFT consensus primitives (`bft` module), per-agent scratchpad, A2A envelope routing with signed payloads

### Self-Hosted Observability

- Grafana + Loki + Tempo + Prometheus + OTel collector + GlitchTip on Railway (no paid SaaS)

### OpenAPI + forge-ts

- `openapi:gen` script regenerates `openapi.json`; forge-ts integrated into validate script

### Semantic Embeddings

- Local ONNX-based embedding provider (optional `onnxruntime-node` peer dep)
- pgvector integration in `apps/backend`

### Reference Agents + /demo

- 4 reference agent implementations
- `/demo` page in `apps/frontend`

### Portable SDK

- `LocalBackend` (T321-T331): full `Backend` interface over SQLite/Drizzle
- `RemoteBackend` (T332): HTTP/WS client; REST + SSE + WebSocket
- Backend contract test suite (T333): 25-test harness
- Fastify `localBackend` plugin (T334)
- `llmtxt` CLI (T335+T336): `init`, `create-doc`, `push-version`, `pull`, `watch`, `search`, `keys`, `sync`
- `llmtxt sync` (T337): CRDT state-vector exchange
- CLEO integration example (T338): 4 patterns
- Subpath exports: `llmtxt/local`, `llmtxt/remote`, `llmtxt/cli` (T340)

### Infrastructure Fix

- Migration idempotency (commit `7df5795`): W2 leases + W3 BFT/A2A inbox Postgres migrations hardened with `IF NOT EXISTS` guards; resolves Railway crash-loop on deploy retry

### Dependency Upgrades

- drizzle-orm/kit: `1.0.0-beta.21`
- zod: `^4`

---

## Known Gap: crates.io Not Published

- **Root cause**: `CARGO_REGISTRY_TOKEN` GitHub Actions secret is not configured in the repository
- **Impact**: `llmtxt-core@2026.4.5` is not on crates.io; crates.io still shows `2026.4.4`
- **npm is unaffected**: `llmtxt@2026.4.5` is live on npm with provenance
- **Resolution**: Owner must add `CARGO_REGISTRY_TOKEN` to GitHub repo secrets (Settings > Secrets > Actions), then either re-push the `llmtxt-core-v2026.4.5` tag (after deleting it) or manually trigger `release-rust.yml` via `workflow_dispatch`

---

## Files Modified in Release Commit (fb76013)

- `packages/llmtxt/package.json` — version `2026.4.4` → `2026.4.5`
- `crates/llmtxt-core/Cargo.toml` — version `2026.4.4` → `2026.4.5`
- `crates/llmtxt-core/Cargo.lock` — regenerated via `cargo check`
- `packages/llmtxt/CHANGELOG.md` — `[Unreleased]` → `[2026.4.5] - 2026-04-16` + new `[Unreleased]`
- `CHANGELOG.md` — `[2026.4.5]` entry added
- `crates/llmtxt-core/CHANGELOG.md` — `[2026.4.5]` entry added
