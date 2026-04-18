# T399 Research Output: P2-cr-sqlite Spec Validation

**Task**: T399 — P2.1: Research — cr-sqlite Node.js integration with better-sqlite3
**Date**: 2026-04-17
**Status**: Complete
**Spec output**: /mnt/projects/llmtxt/docs/specs/P2-cr-sqlite.md (v1.2.0)
**Commit**: 5b555a9d02bb92d956843c90cf1058cebe74299d

## Summary

Validated spec P2-cr-sqlite.md v1.1 against npm registry, GitHub release assets, better-sqlite3 types, and schema-local.ts. Found and fixed 4 categories of drift. Spec bumped to v1.2.0.

## Key Findings

### 1. @vlcn.io/crsqlite@0.16.3 Package Reality

- **Latest version**: 0.16.3 (published 2024-01-17, stable, no newer release)
- **Binary distribution**: Prebuilts are NOT bundled in the npm tarball. The `install` script downloads from GitHub Releases at: `https://github.com/vlcn-io/cr-sqlite/releases/download/v{version}/crsqlite-{os}-{arch}.zip`
- **ESM-only**: `package.json` has `"type": "module"`. The `nodejs-helper.js` exports `extensionPath` as a named ESM export. `require('@vlcn.io/crsqlite')` MUST NOT be used — throws `ERR_REQUIRE_ESM`.
- **Correct loading pattern**: `import { extensionPath } from '@vlcn.io/crsqlite'` then `db.loadExtension(extensionPath)`

### 2. Platform Matrix (confirmed from GitHub release assets v0.16.3)

| Asset file | Maps to |
|---|---|
| crsqlite-linux-x86_64.zip | linux/amd64 |
| crsqlite-linux-aarch64.zip | linux/arm64 (BONUS — not in v1.1 spec) |
| crsqlite-darwin-aarch64.zip | darwin/arm64 |
| crsqlite-darwin-x86_64.zip | darwin/amd64 |
| crsqlite-win-x86_64.zip | win32/x64 |
| crsqlite-win-i686.zip | win32/ia32 (extra) |
| crsqlite-aarch64-linux-android.zip | Android (extra) |

All 4 originally required platforms confirmed. linux/arm64 is also available (added to spec).

### 3. better-sqlite3 v12.8.0 + Node 24 Compatibility

- Installed: `better-sqlite3@12.8.0`
- Engines: `20.x || 22.x || 23.x || 24.x || 25.x` — Node 24 explicitly supported
- `db.loadExtension(path: string)` signature is stable in @types/better-sqlite3@7.6.13

### 4. CRR Table List — Schema Drift Fixed

**v1.1 had wrong table names** (referenced Postgres schema, not LocalBackend schema-local.ts).

The actual 13 LocalBackend tables from `packages/llmtxt/src/local/schema-local.ts`:
1. `documents`
2. `versions`
3. `state_transitions`
4. `approvals`
5. `section_crdt_states`
6. `section_crdt_updates`
7. `document_events`
8. `agent_pubkeys`
9. `agent_signature_nonces`
10. `section_leases`
11. `agent_inbox_messages`
12. `scratchpad_entries`
13. `section_embeddings`

Removed from spec: `sections`, `agents`, `leases`, `rate_limit_buckets`, `events` (all Postgres-only or non-existent).

### 5. Column-Level CRR Strategy — Updated

- `yrs_state` (not `crdt_state`) is the current column name for the Loro blob; renamed to `crdt_state` only after P1.7 migration ships
- `section_embeddings.embedding_blob` — LWW safe (recompute after merge); stale-vector risk documented
- All column strategies updated to match actual schema column names

### 6. DR-P2-04 Owner Mandate (2026-04-17)

Prominently documented in §4.2 as owner mandate. cr-sqlite LWW MUST NOT be used on `yrs_state`/`crdt_state`. Application-level `doc.import()` (Loro merge) is MANDATORY. Not optional.

## Acceptance Criteria Status

- [x] Finalized docs/specs/P2-cr-sqlite.md with extension loading approach for better-sqlite3 on Node 24 — DONE (v1.2.0)
- [x] CRR column type strategy per table documented — DONE (13 tables, all columns, Loro blob exclusion)
- [x] Platform matrix for @vlcn.io/crsqlite prebuilt binaries confirmed — DONE (linux-x86_64, linux-aarch64, darwin-aarch64, darwin-x86_64, win-x86_64)
