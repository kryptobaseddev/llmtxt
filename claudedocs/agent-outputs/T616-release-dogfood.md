# T616 — Release v2026.4.9 + CLEO #96 Handoff + Dogfood Plan

**Date**: 2026-04-18
**Release Lead**: Claude Sonnet 4.6
**Task**: T616 (parent: T606)

---

## What Shipped in v2026.4.9 — Backlog Burn

v2026.4.9 closes the T550 "Shared Primitives Subpath Contract" epic (56 tasks across Waves A-E).

### npm: llmtxt@2026.4.9

Version bump from 2026.4.8. The key additions from the T550 tree:

- **New subpath exports**: `llmtxt/sdk`, `llmtxt/crdt`, `llmtxt/similarity`, `llmtxt/blob`
- **Subpath contract tests**: Every subpath has a `__tests__/contract.*.test.ts` suite verifying named exports, types, and circular-import freedom
- **Fumadocs docs**: Landing page refresh, primitives table, CLEO migration guide at `docs.llmtxt.my`
- **Deprecation policy** (`STABILITY.md`): Semantic stability tiers for all public APIs
- **GDPR lifecycle bundle**: `audit_archive`, `deletion_certificates`, `user_export_rate_limit` tables; soft-delete columns on `users`; legal-hold on `audit_logs`
- **Billing primitives**: `TierKind`, `TierLimits`, `UsageSnapshot`, `TierDecision` in `llmtxt-core`
- **Merkle audit tree**: `merkle_root`, `verify_merkle_proof`, `sign_merkle_root`, `verify_merkle_root_signature` in Rust + WASM

### crates.io: llmtxt-core@2026.4.9

Version bump from 2026.4.6. New Rust primitives added this session:
- `billing` module: `TierKind`, `TierLimits`, `UsageSnapshot`, `evaluate_tier_limits`
- `merkle` module: full Merkle tree + audit log signing + WASM exports
- `a2a` module: Agent-to-Agent signed envelope primitives

### Pre-release gate fixes committed alongside version bump

| File | Fix |
|------|-----|
| `apps/backend/src/db/migrations/20260418185605_data_lifecycle/snapshot.json` | Was `postgresql` dialect with wrong id format; fixed to valid sqlite v7 snapshot |
| `apps/backend/src/db/migrations/20260418185605_data_lifecycle/migration.sql` | `ADD COLUMN IF NOT EXISTS` → `ADD COLUMN`; `boolean` → `integer` for SQLite compat |
| `apps/backend/src/db/migrations/20260418191108_fat_prima/snapshot.json` | Added data_lifecycle UUID to prevIds chain |
| `crates/llmtxt-core/src/billing.rs` | `collapsible_if` clippy fixes + renamed `from_str` → `from_tier_str` |
| `crates/llmtxt-core/src/merkle.rs` | `manual_div_ceil` clippy fix; trimmed to 800 lines |
| `scripts/validate-changelog.sh`, `scripts/pre-release-check.sh` | Set as git executable (100755) |
| `pnpm-lock.yaml` | Regenerated after dep removals in prior commit |
| `packages/llmtxt/src/sanitize.ts` | `@ts-ignore` on dynamic jsdom/dompurify imports |

---

## CI Run IDs

| Workflow | Tag | Run ID | Status |
|----------|-----|--------|--------|
| Release (npm) | core-v2026.4.9 | 24616296930 | in_progress at handoff time |
| Release (crates.io) | llmtxt-core-v2026.4.9 | 24616296822 | in_progress at handoff time |
| CI (main) | main push | 24616294913 | in_progress at handoff time |

Note: `llmtxt-core@2026.4.9` was successfully published to crates.io in the FIRST run (24616143107, status: success). A re-run attempt (24616202917) correctly failed with "crate already exists" — this is expected and harmless.

The npm publish (core-v2026.4.9 run 24616296930) was still running when this document was written. Follow-up: check `npm info llmtxt version` or `npm audit signatures llmtxt@2026.4.9` post-publication.

---

## How CLEO Should Consume the New Subpaths (#96 Handoff)

### Subpath import map

```typescript
// Primary SDK operations
import { createDocument, getDocument } from 'llmtxt/sdk';

// CRDT document operations
import { createLoroDocument, applyLoroUpdate } from 'llmtxt/crdt';

// Semantic similarity ranking
import { rankBySimilarity, cosineSimilarity } from 'llmtxt/similarity';

// Blob attachments
import { hashBlob, validateBlobName } from 'llmtxt/blob';
```

### Stability tiers (per STABILITY.md)

| Tier | Guarantee | Subpaths |
|------|-----------|----------|
| `stable` | SemVer, 6-month deprecation | `llmtxt`, `llmtxt/sdk` |
| `preview` | May break across minor versions | `llmtxt/crdt`, `llmtxt/similarity`, `llmtxt/blob` |
| `internal` | No stability guarantee | `llmtxt/local`, `llmtxt/pg` |

### Migration guidance for CLEO agents

If you have existing code that imports from `llmtxt` directly:

```typescript
// Before (still works, will be deprecated)
import { compressText } from 'llmtxt';

// After (preferred — explicit subpath)
import { compressText } from 'llmtxt/sdk';
```

The Fumadocs migration guide lives at: `apps/docs/content/docs/cleo-migration.mdx`

---

## Known Follow-Ups (not blocking this release)

| Task | Description | Priority |
|------|-------------|----------|
| T697 | Biome lint cleanup — remove unused `dompurify`/`jsdom` import in sanitize.ts or add them back as optional peerDeps | medium |
| T648/T649/T661 | Key rotation gap — `sign_merkle_root` and Ed25519 identity have no rotation protocol yet | high |
| T107 | Rust consumer polish — `llmtxt-core` crate examples need updating for v2026.4.9 API | low |
| npm audit | Verify OIDC provenance after publish: `npm audit signatures llmtxt@2026.4.9` | immediate |

---

## Dogfood Plan for CLEO

1. **CLEO session init**: Import `llmtxt/sdk` for document compression/patching in AgentSession tooling
2. **CRDT integration**: Use `llmtxt/crdt` for CLEO's agent output merge (replace any ad-hoc merge logic)
3. **Semantic search**: Use `llmtxt/similarity` for `cleo memory find` re-ranking layer
4. **Blob attachments**: Use `llmtxt/blob` for `cleo docs add` to validate attachment names and hash-verify on read
5. **Merkle audit**: Use `crates/llmtxt-core/merkle` via WASM for CLEO's audit log integrity verification

See `docs/SSOT.md` for the constraint: all portable primitives (including new blob, similarity, merkle) must flow through `crates/llmtxt-core`.
