# Architecture Spec: Hub-and-Spoke Topology

**RFC 2119 Specification**
**Task**: T429
**Version**: 1.0.0
**Date**: 2026-04-17
**Status**: Approved — owner pre-decided architecture

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be
interpreted as described in RFC 2119.

---

## 1. Motivation

LLMtxt's existing `Backend` interface has three concrete implementations
(`LocalBackend`, `RemoteBackend`, `PostgresBackend`) but no first-class concept
of how those implementations are composed for a given deployment. A single-agent
development workflow, a 100-agent swarm writing to a shared hub, and a
peer-to-peer team of persistent agents all have fundamentally different
connectivity requirements — yet the SDK currently offers no guidance on which
backend to use and why.

For 100+ agent scenarios this ambiguity is a correctness risk:
- Ephemeral swarm workers that mistakenly open their own local `.db` files
  produce isolated state that never converges with the rest of the team.
- Persistent agents that use `RemoteBackend` exclusively lose offline-first
  capability and cannot participate in P2P sync.
- Without a topology config contract, `AgentSession` (T426) cannot decide which
  backend to construct on startup.

This spec formalizes three topology modes, defines the config contract, specifies
routing semantics (where reads and writes go in each mode), assigns convergence
ownership, and defines how T385 (cr-sqlite) and T386 (P2P mesh) compose with
each topology.

---

## 2. Topology Definitions

### 2.1 Standalone

One agent, one local `.db` file, zero network dependency.

```
┌──────────────────────────────────┐
│  Agent                           │
│  ┌────────────────────────────┐  │
│  │  LocalBackend              │  │
│  │  .llmtxt/agent.db          │  │
│  │  (optionally cr-sqlite)    │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**Use when**: Single developer or single agent, no collaboration required,
offline-first operation, local testing and development.

### 2.2 Hub-and-Spoke

One hub (PostgresBackend or a designated LocalBackend) is the Single Source of
Truth. N spokes are RemoteBackend clients that write to and read from the hub.
Ephemeral swarm workers are spokes with no local `.db` file.

```
                    ┌──────────────────────────────┐
                    │  Hub (SSoT)                  │
                    │  PostgresBackend             │
                    │  (or designated LocalBackend)│
                    └──────────────────────────────┘
                       /        |         \
                      /         |          \
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │ Spoke A  │ │ Spoke B  │ │ Spoke C  │
             │ Remote   │ │ Remote   │ │ Remote   │
             │ Backend  │ │ Backend  │ │ Backend  │
             │ (swarm)  │ │ (swarm)  │ │ persist.)│
             └──────────┘ └──────────┘ └──────────┘
```

Spokes are either:
- **Ephemeral (swarm workers)**: `RemoteBackend` only, no local `.db`. They
  connect, write, and disconnect. The hub holds all state.
- **Persistent with hub sync**: `LocalBackend` (cr-sqlite) + `RemoteBackend`
  pointing at hub. The persistent agent also maintains a local replica synced
  to the hub. Hub IS still the SSoT; the local replica is a cache.

**Use when**: 100+ ephemeral agent scenarios, CI pipelines, swarm workers,
shared production deployments, cases where centralized convergence and audit
trail are required.

### 2.3 Mesh

N persistent peers, each with their own cr-sqlite LocalBackend. No central hub
is required. Peers sync directly with each other via the P2P transport defined
in T386.

```
  Agent A (LocalBackend) ──── Agent B (LocalBackend)
         │  \                     / │
         │   \                   /  │
         │    Agent C (Local)───/   │
         │          \               │
  Agent D (Local) ────── Agent E (Local)
```

The server (`api.llmtxt.my`, PostgresBackend) MAY participate as a mesh peer
in hybrid mode (P3 Phase 3 spec, DR-P3-06).

**Use when**: Offline-first P2P collaboration, air-gapped environments, small
teams of persistent agents (up to ~10 peers before O(n²) connections become
expensive), scenarios where no central coordinator is acceptable.

---

## 3. Topology Selection Contract

### 3.1 Config Schema

The following TypeScript type MUST be added to
`packages/llmtxt/src/topology.ts` as the canonical topology config:

```typescript
/**
 * TopologyConfig — selects which deployment topology to use.
 * Validated by Zod at construction time.
 */
export type TopologyMode = 'standalone' | 'hub-spoke' | 'mesh';

export interface StandaloneConfig {
  topology: 'standalone';
  /** Path for the local .db file. Defaults to '.llmtxt'. */
  storagePath?: string;
  /** Optional path to agent identity keypair. */
  identityPath?: string;
  /** Set true to enable cr-sqlite (T385). Default: false. */
  crsqlite?: boolean;
  /** Path to crsqlite extension (optional, see P2-cr-sqlite.md). */
  crsqliteExtPath?: string;
}

export interface HubSpokeConfig {
  topology: 'hub-spoke';
  /**
   * URL of the hub API instance (e.g. 'https://api.llmtxt.my').
   * REQUIRED — validation MUST fail fast if absent.
   */
  hubUrl: string;
  /**
   * API key for authenticating with the hub.
   * MUST be present for write operations.
   */
  apiKey?: string;
  /**
   * Ed25519 private key hex for signing writes (alternative to apiKey).
   * If both are supplied, Ed25519 signed writes take precedence.
   */
  identityPath?: string;
  /**
   * When true, this spoke maintains a local cr-sqlite replica.
   * Requires T385 (cr-sqlite) to be installed.
   * Default: false (ephemeral swarm worker mode — no .db file).
   */
  persistLocally?: boolean;
  /** Required when persistLocally=true. Path to local .db file. */
  storagePath?: string;
}

export interface MeshConfig {
  topology: 'mesh';
  /** Path for the local cr-sqlite .db file. REQUIRED for mesh. */
  storagePath: string;
  /** Optional path to agent identity keypair. Defaults to storagePath/identity.json. */
  identityPath?: string;
  /**
   * Known peers at startup. Each entry is a transport address.
   * Format: 'unix:/path/to/sock' | 'http://host:port'
   */
  peers?: string[];
  /**
   * Directory where peer advertisement files are written and read.
   * Defaults to $LLMTXT_MESH_DIR or '/tmp/llmtxt-mesh'.
   */
  meshDir?: string;
  /** Transport to listen on. Default: 'unix'. */
  transport?: 'unix' | 'http';
  /** Port for http transport. Default: 7642. */
  port?: number;
}

export type TopologyConfig = StandaloneConfig | HubSpokeConfig | MeshConfig;
```

### 3.2 When to Use Each Topology

| Scenario | Topology |
|---|---|
| Single developer / local testing | `standalone` |
| CI pipeline with shared state | `hub-spoke` (ephemeral worker) |
| Swarm of 100+ task workers | `hub-spoke` (ephemeral workers) |
| Persistent agent syncing to production | `hub-spoke` (persistLocally=true) |
| Offline-first peer team (≤10 agents) | `mesh` |
| Production deployment needing audit trail | `hub-spoke` |
| Air-gapped no-network environment | `standalone` or `mesh` |

### 3.3 Validation Rules (fail-fast)

- `hub-spoke` with no `hubUrl` MUST throw `TopologyConfigError` at
  `createBackend()` time with message: `"hub-spoke topology requires hubUrl"`.
- `hub-spoke` with `persistLocally=true` and no `storagePath` MUST throw
  `TopologyConfigError`: `"hub-spoke with persistLocally=true requires storagePath"`.
- `mesh` with no `storagePath` MUST throw `TopologyConfigError`:
  `"mesh topology requires storagePath (cr-sqlite)"`.
- `standalone` is always valid (defaults are applied).
- Unknown `topology` value MUST throw `TopologyConfigError`:
  `"unknown topology: <value>"`.

---

## 4. Backend Factory

A `createBackend(config: TopologyConfig): Backend` factory function MUST be
exported from `packages/llmtxt/src/topology.ts`:

```typescript
import { LocalBackend } from './local/index.js';
import { RemoteBackend } from './remote/index.js';
import type { Backend } from './core/backend.js';
import type { TopologyConfig } from './topology.js';

export function createBackend(config: TopologyConfig): Backend {
  // Validate config (throws TopologyConfigError on invalid input)
  validateTopologyConfig(config);

  switch (config.topology) {
    case 'standalone':
      return new LocalBackend({
        storagePath: config.storagePath,
        identityPath: config.identityPath,
        crsqliteExtPath: config.crsqliteExtPath,
      });

    case 'hub-spoke':
      if (config.persistLocally) {
        // Persistent spoke: LocalBackend + background sync to hub
        // The LocalBackend is the local replica; RemoteBackend is used
        // for sync operations. Returns a HubSpokeBackend composite.
        return new HubSpokeBackend({
          local: new LocalBackend({
            storagePath: config.storagePath!,
            identityPath: config.identityPath,
          }),
          remote: new RemoteBackend({
            baseUrl: config.hubUrl,
            apiKey: config.apiKey,
            identityPath: config.identityPath,
          }),
        });
      }
      // Ephemeral worker: pure RemoteBackend, no local .db
      return new RemoteBackend({
        baseUrl: config.hubUrl,
        apiKey: config.apiKey,
        identityPath: config.identityPath,
      });

    case 'mesh':
      // Returns a MeshBackend (LocalBackend + P2P sync engine from T386)
      return new MeshBackend({
        local: new LocalBackend({
          storagePath: config.storagePath,
          identityPath: config.identityPath,
        }),
        peers: config.peers ?? [],
        meshDir: config.meshDir,
        transport: config.transport ?? 'unix',
        port: config.port,
      });
  }
}
```

**Note**: `HubSpokeBackend` and `MeshBackend` are composite implementations.
They are thin wrappers; all Backend interface methods delegate to the local or
remote backend based on routing semantics (§5). These classes MUST implement
the full `Backend` interface.

---

## 5. Routing Semantics

### 5.1 Standalone — Routing

All reads and writes go to the single `LocalBackend`. No network traffic.

| Operation | Route |
|---|---|
| All reads | LocalBackend |
| All writes | LocalBackend |
| Convergence | Not required (single writer) |

### 5.2 Hub-and-Spoke — Routing

#### Ephemeral spokes (no local .db)

All operations go directly to hub via `RemoteBackend`. No local state is
maintained.

| Operation | Route |
|---|---|
| All reads | RemoteBackend → hub |
| All writes | RemoteBackend → hub |
| Convergence | Hub owns all merges |

#### Persistent spokes (persistLocally=true)

Reads are served from local replica when available (offline-first). Writes go
to hub immediately and are replicated back to local on acknowledgment.

| Operation | Route |
|---|---|
| Read (document, version, events) | LocalBackend (replica, stale ok) |
| Write (createDocument, publishVersion) | RemoteBackend → hub (authoritative write) |
| CRDT applyCrdtUpdate | Hub (authoritative) + propagated to local on next sync |
| subscribeStream / subscribeSection | LocalBackend (in-process for latency) |
| Lease acquire/renew/release | RemoteBackend → hub (distributed lock requires SSoT) |
| Presence | LocalBackend (local in-process, hub for global view) |
| A2A / Scratchpad | RemoteBackend → hub |

The `HubSpokeBackend` MUST queue writes when the hub is unreachable (see §7.1)
and flush on reconnect. Queued writes MUST be persisted in the local SQLite
to survive agent restart.

### 5.3 Mesh — Routing

All operations go to local `LocalBackend`. The P2P sync engine (T386) runs as
a background process and propagates changes to peers asynchronously.

| Operation | Route |
|---|---|
| All reads | LocalBackend (local) |
| All writes | LocalBackend (local) |
| Lease acquire | LocalBackend (local clock; see §7.3 for split-brain) |
| Convergence | Background P2P sync (cr-sqlite changesets, T385+T386) |
| CRDT merge | Application-level Loro merge on applyChanges (P2-cr-sqlite.md §4.2) |

---

## 6. Convergence Ownership

### 6.1 Standalone

No convergence is needed. The single LocalBackend is always internally
consistent. CRDT merge (Loro) applies when a single agent updates sections
via `applyCrdtUpdate`.

### 6.2 Hub-and-Spoke

The hub IS the SSoT. Convergence semantics:

- The hub MUST apply CRDT updates using `merge_updates` from `llmtxt-core`
  WASM (as per `backend-interface.md §7`). Hub merges all concurrent spoke
  writes.
- Spokes MUST NOT independently merge CRDT updates with each other. All CRDT
  convergence flows through the hub.
- On write conflict (two spokes publish versions at the same logical clock):
  the hub MUST serialize via its own transaction. PostgresBackend uses
  `BEGIN IMMEDIATE`-equivalent serializable transactions for this.
- cr-sqlite (T385) is NOT required on the hub. The hub's PostgresBackend handles
  convergence via the existing Postgres transaction model.
- For persistent spokes (persistLocally=true): the local replica receives
  hub state on background sync. Local reads MAY serve slightly stale data
  (eventually consistent with hub).

### 6.3 Mesh

Any peer may trigger convergence. Convergence semantics:

- cr-sqlite (T385) MUST be enabled on all mesh peers. Changesets are
  exchanged via the P2P transport (T386).
- Each peer independently applies received changesets via `applyChanges`.
  cr-sqlite's CRDT properties (associativity, commutativity, idempotency)
  guarantee eventual consistency.
- Loro blob columns (`crdt_state`) MUST NOT use cr-sqlite LWW. Application-level
  Loro merge MUST be called after each `applyChanges` that touches a blob
  column (P2-cr-sqlite.md DC-P2-04).
- Lease conflicts in mesh are Last-Write-Wins (cr-sqlite default). Consumers
  relying on distributed locks SHOULD use hub-spoke topology instead.
- Convergence time: all peers converge within 2× sync interval after partition
  heals (per P3-p2p-mesh.md §5.3).

---

## 7. Failure Modes

### 7.1 Hub Unreachable (Hub-and-Spoke)

When the hub is unreachable:
- Ephemeral spokes MUST fail writes immediately with a
  `HubUnreachableError`. They MUST NOT silently drop writes.
- Persistent spokes SHOULD queue writes in local SQLite (`hub_write_queue`
  table). The queue MUST be bounded (max 1000 entries; overflow MUST reject
  new writes with `HubWriteQueueFullError`).
- Queued writes MUST be flushed in FIFO order when hub reconnects.
- Reads from persistent spokes continue from local replica (stale but available).
- The spoke MUST emit a `hub:unreachable` event every 30 seconds while
  disconnected, and a `hub:reconnected` event on reconnect.

### 7.2 Split-Brain Mesh

A mesh network partition (subset of peers unreachable):
- Each partition continues operating independently. Writes are applied locally.
- When the partition heals, cr-sqlite changeset exchange converges both
  partitions. cr-sqlite's CRDT properties guarantee no data loss.
- Loro blob convergence follows the P2-cr-sqlite.md §4.2 application-level
  merge path.
- There is NO explicit split-brain detection in Phase 3. Monotonically
  increasing `db_version` per peer is sufficient for cr-sqlite convergence.
- Persistent locks (leases) in mesh are best-effort LWW. Applications that
  require strong mutual exclusion MUST use hub-spoke topology (hub holds the
  lock).

### 7.3 Standalone Exit

- No network state to clean up. Call `backend.close()` which flushes WAL and
  closes the SQLite handle.
- If the process crashes without `close()`: WAL journaling ensures database
  integrity on next `open()`. better-sqlite3's WAL mode handles this.
- cr-sqlite state is durable; partially applied changesets are rolled back by
  SQLite's ACID guarantees.

---

## 8. Authentication

Hub-and-spoke and mesh MUST authenticate all remote operations. Two mechanisms
are supported (matching existing infrastructure from T076/T373):

### 8.1 API Key (Hub-and-Spoke)

Spokes MUST send `Authorization: Bearer <apiKey>` on every HTTP request to the
hub. The hub MUST reject unauthenticated requests with HTTP 401.

### 8.2 Ed25519 Signed Writes (Hub-and-Spoke)

When `identityPath` is configured on the spoke, all write operations MUST
include an Ed25519 signature over the canonical request body. The hub MUST
verify the signature using `verify_signature` from `llmtxt-core` WASM
before persisting any write.

This reuses the existing Ed25519 infrastructure:
- Key registration: `backend.registerAgentPubkey(agentId, pubkeyHex)`.
- Nonce replay prevention: `backend.recordSignatureNonce(agentId, nonce)`.
- Verification: `llmtxt-core/src/identity.rs verify_signature`.

If both `apiKey` and `identityPath` are supplied, Ed25519 signed writes
take precedence and `apiKey` is used as fallback only.

### 8.3 Ed25519 Mutual Handshake (Mesh)

All mesh transport connections MUST complete the 3-message Ed25519 mutual
handshake defined in P3-p2p-mesh.md §4.3 before any changeset is exchanged.
Unauthenticated or handshake-failed peers MUST be rejected immediately.

---

## 9. Integration with T385 (cr-sqlite LocalBackend)

T385 adds cr-sqlite CRDT sync capability to `LocalBackend`. The topology
config determines when cr-sqlite is activated:

| Topology | cr-sqlite Required? | Notes |
|---|---|---|
| `standalone` | Optional | Enable via `crsqlite: true` in config |
| `hub-spoke` (ephemeral) | No | RemoteBackend; no local .db |
| `hub-spoke` (persistent) | Recommended | Local replica syncs to hub via cr-sqlite changesets |
| `mesh` | REQUIRED | Mesh sync engine exchanges cr-sqlite changesets |

T385 MUST depend on T429 (this spec) for the topology contract:
- The `BackendConfig.crsqliteExtPath` field is already defined in `backend.ts`.
- T385 adds `getChangesSince()` and `applyChanges()` to `LocalBackend`.
- `createBackend()` with `topology: 'standalone'` and `crsqlite: true` MUST
  pass the `crsqliteExtPath` to `LocalBackend`.
- `createBackend()` with `topology: 'mesh'` MUST require T385 (throw
  `CrSqliteRequiredError` at `MeshBackend.open()` if cr-sqlite extension is
  not loadable).

**Dependency**: `cleo dep add T385 T429` — T385 depends on T429 topology
contract being finalized before T385 can implement `createBackend()` integration.

---

## 10. Integration with T386 (P2P Mesh)

T386 implements the mesh sync engine (peer discovery, Unix/HTTP transport,
sync loop). The topology config determines when the mesh engine is activated:

| Topology | Mesh Engine? | Notes |
|---|---|---|
| `standalone` | No | Single agent, no peers |
| `hub-spoke` | No | Hub-spoke uses HTTP to hub, not peer mesh |
| `mesh` | REQUIRED | MeshBackend wraps LocalBackend + mesh sync engine |

T386 MUST depend on T429 (this spec) for the topology contract:
- T386 implements `MeshBackend` class that `createBackend({ topology: 'mesh' })`
  returns.
- `MeshConfig.peers`, `meshDir`, `transport`, `port` fields in `TopologyConfig`
  are consumed by T386's peer discovery and transport layers.
- The `MeshBackend.open()` call MUST start the sync engine (peer discovery
  loop + transport listener).
- The `MeshBackend.close()` call MUST cleanly shut down the sync engine,
  delete the peer advertisement file, and close all peer connections.

**Dependency**: `cleo dep add T386 T429` — T386 depends on T429 topology
contract for the `MeshConfig` shape and `MeshBackend` interface contract.

---

## 11. Child Task Acceptance Criteria

### T429.1 — Topology Config Schema

- `packages/llmtxt/src/topology.ts` exports `TopologyConfig`, `TopologyMode`,
  `StandaloneConfig`, `HubSpokeConfig`, `MeshConfig` types.
- Zod schemas exported: `standaloneConfigSchema`, `hubSpokeConfigSchema`,
  `meshConfigSchema`, `topologyConfigSchema`.
- `validateTopologyConfig(config)` throws `TopologyConfigError` with the
  exact messages specified in §3.3.
- `packages/llmtxt/src/index.ts` re-exports all topology types.
- TypeScript compiles with zero errors (`tsc --noEmit`).
- Biome lint passes with zero errors.

### T429.2 — Backend Factory

- `createBackend(config: TopologyConfig): Backend` is exported from
  `packages/llmtxt/src/topology.ts`.
- For `standalone`: returns a `LocalBackend`.
- For `hub-spoke` (ephemeral): returns a `RemoteBackend`.
- For `hub-spoke` (persistLocally=true): returns a `HubSpokeBackend` composite
  implementing the full `Backend` interface.
- For `mesh`: returns a `MeshBackend` stub (T386 fills the implementation;
  stub throws `MeshNotImplementedError` with a clear message pointing to T386).
- All validation rules from §3.3 are enforced.
- TypeScript compiles with zero errors.

### T429.3 — Hub-and-Spoke Contract Tests

- 1 hub (`LocalBackend` or `PostgresBackend`) + 3 ephemeral `RemoteBackend`
  spokes.
- Each spoke writes a unique document.
- Hub lists all 3 documents — all present.
- Spoke A publishes version; spoke B reads the version — consistent.
- Spoke writes during hub outage are queued (persistent spoke) or fail fast
  (ephemeral spoke).
- Tests run in CI (Node.js, pnpm test).

### T429.4 — Standalone Contract Tests

- `createBackend({ topology: 'standalone' })` returns a working `LocalBackend`.
- All existing `backend-contract.test.ts` tests pass using `createBackend`
  instead of direct `new LocalBackend(...)`.
- No network calls are made (verified by intercepting `fetch`).
- Tests run in CI.

### T429.5 — Mesh Topology Stub

- `createBackend({ topology: 'mesh', storagePath: '...' })` returns a
  `MeshBackend` instance.
- `MeshBackend` implements the full `Backend` interface.
- All `Backend` methods delegate to the internal `LocalBackend`.
- `open()` and `close()` succeed without errors (sync engine stub, no-op).
- A `mesh:sync-engine-not-started` warning is emitted on `open()` until T386
  provides the real implementation.
- TypeScript compiles with zero errors.

### T429.6 — Failure Mode Tests

- **Hub unreachable (ephemeral)**: `RemoteBackend` fails fast with
  `HubUnreachableError` when hub is down.
- **Hub unreachable (persistent)**: `HubSpokeBackend` queues write, flushes
  on reconnect, queue survives agent restart.
- **Queue overflow**: 1001st write with hub down returns `HubWriteQueueFullError`.
- **Standalone exit**: `close()` after `LocalBackend` crash-writes (WAL)
  succeeds on next `open()`.
- All failure mode tests are automated (Jest/Vitest).

### T429.7 — Docs + ADR

- `apps/docs/content/docs/architecture/topology.mdx` created.
- Content includes: topology diagram (mermaid), when-to-use guide, config
  examples for each topology, routing semantics table.
- ADR file: `.cleo/adrs/ADR-T429-hub-spoke-topology.md` created and registered
  via `cleo adr` commands.
- Doc page builds without errors (`pnpm build` in `apps/docs`).

### T429.8 — Config Validation + Error Messages

- `validateTopologyConfig` is called at the start of `createBackend`.
- All §3.3 error messages are tested with exact string matching.
- Errors include actionable guidance: e.g., `"hub-spoke topology requires
  hubUrl. Provide { topology: 'hub-spoke', hubUrl: 'https://api.example.com' }"`.
- Zod parse errors surface field-level messages (which field is missing/wrong).
- TypeScript compile-time errors for mismatched config shapes (discriminated
  union enforced by TypeScript).

---

## 12. Dependency DAG

```
T429.1 (Topology config schema + Zod types)
  └─→ T429.8 (Config validation + error messages) [sibling to T429.1, can land together]
        └─→ T429.2 (Backend factory: createBackend dispatches by topology)
              ├─→ T429.3 (Hub-spoke contract tests: 1 hub + 3 spokes converge)
              ├─→ T429.4 (Standalone contract tests: createBackend wraps LocalBackend)
              └─→ T429.5 (Mesh topology stub: MeshBackend shell for T386 to fill)
                    └─→ T429.6 (Failure mode tests: hub unreachable, queue, WAL)
                          └─→ T429.7 (Docs + ADR: topology.mdx + ADR-T429.md)
```

**External dependencies**:
- T385 (cr-sqlite) depends on T429 for the topology config contract (T385
  cannot finalize `createBackend` cr-sqlite integration until T429.1+T429.2).
- T386 (P2P mesh) depends on T429 for the `MeshConfig` shape and
  `MeshBackend` stub interface (T386 fills the stub provided by T429.5).
- T426 (AgentSession) uses `createBackend(config)` to instantiate its backend;
  depends on T429.1+T429.2 being complete.

---

## 13. SSoT Enforcement

All portable primitives used in the topology layer MUST follow the SSoT rule
(D001):

| Operation | SSoT |
|---|---|
| Ed25519 signature verification | `crates/llmtxt-core/src/identity.rs` |
| Content hash (write signing) | `crates/llmtxt-core/src/crypto.rs` |
| CRDT merge (Loro blobs) | `crates/llmtxt-core/src/crdt.rs` |
| Nonce replay prevention | `packages/llmtxt/src/core/backend.ts` `recordSignatureNonce` |

`topology.ts` MUST NOT import `node:crypto`, `yjs`, or `automerge` directly.

---

## 14. Open Questions (File as Resolution Tasks)

The following ambiguities are out-of-scope for T429 and MUST be resolved in
follow-up tasks. Do NOT block T429.1–T429.8 on these.

1. **HubSpokeBackend write conflict semantics**: When a persistent spoke queues
   a write locally and the hub already has a later version, what merge strategy
   applies? (LWW? Reject with conflict error? Three-way merge?) File as a child
   task under T429 for resolution before T429.3 ships.

2. **PostgresBackend as hub for cr-sqlite**: How does a PostgresBackend hub
   translate Postgres rows into cr-sqlite changeset format for persistent spokes?
   This is addressed in P3-p2p-mesh.md §9 (PostgresChangesetAdapter) but is
   explicitly lower priority. Track as T386 dependency, not T429.

3. **`HubSpokeBackend` sync interval**: How frequently does the local replica
   sync to the hub in the background? Default recommendation? Track in T429.3
   acceptance criteria revision.
