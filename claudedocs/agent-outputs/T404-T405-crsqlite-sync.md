# T404 + T405: LocalBackend cr-sqlite Changeset Sync

**Date**: 2026-04-17
**Commit**: 28dec89
**Status**: complete
**Tasks**: T404 (P2.6 getChangesSince), T405 (P2.7 applyChanges)

## What Was Implemented

### T404 — LocalBackend.getChangesSince(dbVersion: bigint)

- Wraps `SELECT * FROM crsql_changes WHERE db_version > ?` using raw better-sqlite3
- Serializes rows using a compact self-describing binary wire format (DR-P2-03)
- Wire format: 4-byte row count LE + per-row 9-column encoding with type tags (null/int/real/text/blob)
- Returns empty Uint8Array (not null) when no changes exist
- Throws CrSqliteNotLoadedError when hasCRR=false (graceful degradation)

### T405 — LocalBackend.applyChanges(changeset: Uint8Array)

- Deserializes the changeset wire format
- Applies all rows via `INSERT INTO crsql_changes` in a single synchronous better-sqlite3 transaction
- Post-processing loop for DR-P2-04: detects section_crdt_states.crdt_state column updates, fetches local blob, calls crdt_merge_updates([local, remote]) via WASM, writes merged result back
- Invalid Loro blobs: logs warning and retains local blob — transaction does NOT abort
- Recomputes documents.version_count for all affected document IDs (spec §6 of P2-crr-column-strategy.md)
- Returns new crsql_db_version() as bigint
- Idempotent: applying same changeset twice is safe

### Backend Interface Extension

- `getChangesSince` and `applyChanges` added to the Backend interface
- Stub implementations in RemoteBackend, PgBackend, HubSpokeBackend, MeshBackend, PgContractAdapter, and test mocks

### Test File

`packages/llmtxt/src/__tests__/local-backend-sync.test.ts`

- (a) getChangesSince throws when hasCRR=false
- (a) getChangesSince(0n) returns non-empty Uint8Array after write (conditional on cr-sqlite)
- (a) getChangesSince returns empty result for future db_version
- (b) throws CrSqliteNotLoadedError when hasCRR=false
- (b) two backends sync via getChangesSince + applyChanges (conditional)
- (b) applyChanges is idempotent (conditional)
- (c) crdt_state Loro merge proof — merged bytes != simple LWW from either input (DR-P2-04, conditional)
- (c) invalid crdt_state blob retains local blob without corrupting transaction

## Key Implementation Notes

- `require('../crdt-primitives.js')` is used inside the better-sqlite3 transaction for synchronous WASM access (ESM modules cannot be dynamically imported inside synchronous callbacks)
- crdt_apply_update and crdt_state_vector calls are wrapped in try/catch — test fixtures often use non-Loro raw bytes
- The `documents.version_count` recomputation follows the authoritative derivation rule from P2-crr-column-strategy.md §6
- Wire format column order matches `SELECT * FROM crsql_changes`: table, pk, cid, val, col_version, db_version, site_id, cl, seq

## Test Results

332/332 tests pass (0 fail). TypeScript clean. Biome clean.
