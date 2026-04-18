# T443+T446+T449+T452: Hub-Spoke Topology Tests, Standalone Tests, Mesh Stub, Failure Modes

**Date**: 2026-04-17
**Commit**: 2b90ee876ebb3498419addec356171626eea0b05
**Status**: complete
**Tests**: 455/455 pass (added 43 new tests)

## Tasks Completed

### T443 — Hub-spoke contract tests (T429.3)
File: `packages/llmtxt/src/__tests__/hub-spoke-topology.test.ts`
10 tests across 3 suites:
- 3 spokes each create unique doc; hub.listDocuments() returns all 3
- Spoke A publishes version; spoke B reads it — content/metadata consistent
- Write ordering preserved — 3 sequential spoke writes appear monotonically
- CRDT: spoke A applies update via applyCrdtUpdate; spoke C reads converged state
- Event log: 3 spokes each append event; hub queryEvents returns all 3
- Ephemeral spoke (RemoteBackend): writes to unreachable hub throw (not silent drop)
- HubSpokeBackend: write to unreachable hub throws HubUnreachableError
- RemoteBackend config preserved (baseUrl, apiKey)
- Config validation: missing hubUrl + missing storagePath for persistLocally=true

Note: Full live-server spoke tests require a running HTTP server (out of scope for
packages/llmtxt unit suite). Hub is modeled as a LocalBackend in-process; convergence
behavior is verified via the same SSoT, which matches ephemeral spoke semantics exactly.

### T446 — Standalone contract tests (T429.4)
File: `packages/llmtxt/src/__tests__/standalone-topology.test.ts`
18 tests across 4 suites:
- createBackend returns LocalBackend instance (instanceof checks)
- storagePath and crsqliteExtPath passed through to LocalBackend config
- Minimal config (no optional fields) constructs without error
- No fetch() calls during any standalone operation (intercepted + counted)
- Full offline CRUD, versions, leases, presence, A2A, identity
- Data persists across open/close cycles

### T449 — Mesh backend stub (T429.5)
File: `packages/llmtxt/src/mesh/index.ts`
Re-exports MeshBackend + MeshNotImplementedError from backend/factory.ts.
Provides T386 extension point without changing factory barrel.
Added to `packages/llmtxt/src/index.ts` exports.

### T452 — Failure mode tests (T429.6)
File: `packages/llmtxt/src/__tests__/topology-failure.test.ts`
15 tests across 5 suites:
- Ephemeral spoke throws on all write ops when hub unreachable (not silent drop)
- HubSpokeBackend write throws HubUnreachableError (typed error class)
- HubSpokeBackend reads from local replica while hub is down
- HubUnreachableError: instanceof Error, has code/name/cause/message
- HubWriteQueueFullError: instanceof Error, has code/name/queueSize, references 1000 max
- Split-brain mesh (two MeshBackend instances on separate DBs operate independently)
- MeshBackend open()+createDocument+close() succeeds (stub, no P2P sync)
- WAL recovery: LocalBackend data intact after simulated crash (close+reopen)
- createBackend standalone: data survives close+reopen

## Implementation Additions to factory.ts

- `HubUnreachableError`: typed error with `code='HUB_UNREACHABLE'`, `cause`, wraps all hub write ops
- `HubWriteQueueFullError`: typed error with `code='HUB_WRITE_QUEUE_FULL'`, `queueSize`, references 1000-entry max
- `HubSpokeBackend._hubWrite()`: private helper wrapping all remote write calls in HubUnreachableError catch
- All write methods in HubSpokeBackend now use `_hubWrite()` for typed error surface

## Evidence
- TypeScript: `pnpm tsc --noEmit -p packages/llmtxt` exits 0 (zero errors in new files)
- Tests: 455/455 pass, 0 fail
- Commit: 2b90ee876ebb3498419addec356171626eea0b05
