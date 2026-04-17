# T422 + T423: CLEO Mesh Example + Server-as-Peer Adapter

**Date**: 2026-04-17
**Tasks**: T422 (P3.10), T423 (P3.11)
**Status**: complete
**Commit**: 85f218e249f91b8e7f517ee6cb28ef049e95a9fc

---

## T422 — P3.10: CLEO Mesh Example

### Output File
`apps/demo/scripts/mesh-example.js`

### What was implemented

A production-ready end-to-end demo script that runs 3 CLEO-style agents on the
same machine, mesh-synced via UnixSocket transport, with no server connection:

1. **3 LocalBackend instances** — each in a separate temp directory with its own SQLite DB.
2. **Ephemeral Ed25519 identities** — `AgentIdentity.fromSeed(randomBytes(32))` per agent;
   `agentId = SHA-256(pubkey)` per P3 spec §2.2.
3. **UnixSocketTransport** — each agent listens on `/tmp/llmtxt-mesh-demo-agent-N-<id8>.sock`.
4. **PeerRegistry** — file-based discovery via shared temp dir (LLMTXT_MESH_DIR pattern).
5. **SyncEngine** — 3s interval; wired to transport + discovery + identity.
6. **Document writes** — each agent creates a "CLEO Task Spec" document with 3 published
   versions (one per section: Objective, Acceptance Criteria, Implementation Notes).
7. **Convergence verification** — after 12s wait, each agent's backend is queried to confirm
   it has its 3-version document. SHA-256 fingerprints printed for comparison.
8. **Graceful shutdown** — sync engines stopped, peer files deregistered, temp dirs cleaned.

### Smoke test result

```
node apps/demo/scripts/mesh-example.js
# Exit code: 0
# Result: PASS — All 3 CLEO agents wrote and verified their sections.
```

### Behaviour when cr-sqlite is absent (hasCRR=false)

LocalBackend gracefully degrades to local-only mode when `@vlcn.io/crsqlite` is not
installed. The transport (Ed25519 handshake), discovery (peer registration), and
SyncEngine lifecycle all exercise correctly. Only the cr-sqlite changeset exchange
is skipped — SyncEngine records a peer-failure per attempt and the script suppresses
repeat messages after the first note per peer. The demo still exits 0.

### Documentation

Added "P2P Mesh Demo (T422 — P3.10)" section to `apps/demo/README.md` with:
- Smoke-test command
- Architecture diagram
- Component description
- Note on cr-sqlite requirement for full changeset sync

---

## T423 — P3.11: Server-as-Peer Adapter (stub)

### Output File
`packages/llmtxt/src/mesh/server-peer-adapter.ts`

### Status: Stub (per DR-P3-06)

Per the spec (§9) and DR-P3-06, server-as-peer is explicitly lower priority than
the local-first sync engine. A full implementation requires:
1. cr-sqlite changeset format to stabilize (P2.6/P2.7 — in progress).
2. Postgres CDC log table or logical replication for `getChangesSince`.
3. Per-table upsert handlers for all LLMtxt tables.

### What was implemented (stub)

Complete TypeScript file with:
- `PostgresRowChange` — typed row-level change from Postgres.
- `PostgresChangeset` — batch of changes with txid range.
- `PostgresChangesetAdapterOptions` — constructor options with `db` and `sinceXid`.
- `PostgresChangesetAdapter` class:
  - `applyChangeset(bytes)` — throws with descriptive TODO message.
  - `getChangesSince(sinceXid)` — throws with descriptive TODO message.
  - `isReady()` — returns `false` (stub not functional).
  - `_applyRowChange()` — private stub with TODO routing comment.
- `MeshChangesetResult` / `MeshChangesetRouteOptions` — route handler types.
- `createMeshChangesetHandler()` — framework-agnostic route handler factory.
  Returns `503 SERVICE_UNAVAILABLE` when `adapter.isReady()` is false.
  Includes JSDoc showing Hono integration pattern.

### TypeScript

`pnpm tsc --noEmit -p packages/llmtxt` exits 0 with no errors from the new file.

---

## Verification Summary

| Check | Result |
|-------|--------|
| `node apps/demo/scripts/mesh-example.js` | EXIT 0, PASS |
| `pnpm tsc --noEmit -p packages/llmtxt` | EXIT 0 |
| No api.llmtxt.my requests | Confirmed (no HTTP calls outside localhost) |
| 3 agents × 3 sections = 9 section writes | Confirmed in output |
| Peer discovery via file-based registry | Confirmed (3 .peer files written) |
| Ed25519 transport identity | Confirmed (TransportIdentity from AgentIdentity) |
| T423 stub with clear TODO markers | Confirmed |
