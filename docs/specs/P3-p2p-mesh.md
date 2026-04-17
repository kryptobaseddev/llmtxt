# Spec P3: P2P Agent Mesh (Serverless Collaboration)

**Version**: 1.1.0
**Status**: AUTHORITATIVE ARCHITECTURE SOURCE OF TRUTH — validated 2026-04-17
**Validated by**: T413 review — all sections confirmed complete and accurate
**RFC 2119 Key words**: MUST, MUST NOT, SHOULD, MAY

> **Note**: This document is the architecture source of truth for Phase 3 (P2P
> Mesh). All implementation tasks (T414–T425) MUST conform to this spec.
> Security requirements are woven into P3.2 (discovery), P3.3 (transport), and
> P3.4 (sync engine) — not in separate tasks. T415 (P3.3) and T417 (P3.4) are
> the implementation homes for transport-layer and sync-layer security
> respectively. T416 and T424 (standalone security tasks) are cancelled per
> owner mandate 2026-04-17.

---

## 1. Background and Motivation

Phase 2 gives each LLMtxt agent a local cr-sqlite database. Phase 3 connects
these databases into a peer-to-peer mesh — agents collaborate without
api.llmtxt.my acting as coordinator.

**Guiding Star** (from D003): *Never lose work, never duplicate work, never act
on stale information.* The P2P mesh MUST satisfy all three properties:
- **Never lose**: every changeset is acknowledged before being discarded.
- **Never duplicate**: CRDTs guarantee idempotent application; duplicate
  changesets are safe to re-apply.
- **Never stale**: periodic sync (or event-driven sync on mutation) ensures
  agents converge within a bounded time window.

**Why no SaaS**: The owner rejects paid coordination services (Ditto, etc.).
The mesh MUST be self-contained and runnable offline with no external
dependencies beyond what is already in the llmtxt npm package.

**Security requirement**: Security is not a separate phase or an optional
add-on. Ed25519 mutual peer authentication, changeset integrity verification,
and malicious peer rejection are built into the transport, sync engine, and
discovery layers respectively. An unauthenticated peer MUST be rejected before
any data exchange begins.

---

## 2. Topology

### 2.1 Fully-Connected Mesh (Default)

Each agent maintains a direct connection (or connection attempt) to every
known peer. On a 5-agent team this means at most 10 pairs, which is manageable
on a single machine or local network.

```
  Agent A ──── Agent B
    │  \      / │  \
    │   \    /  │   \
  Agent C ──── Agent D
         \    /
          Agent E
```

**Decision record DR-P3-01**: Full mesh is the default topology because it
minimizes relay hops and eliminates coordinator single-point-of-failure. A
hub-and-spoke fallback MAY be added in a future phase for large teams (>10
agents) where O(n²) connections are impractical.

### 2.2 Agent Identity

Each agent is identified by its Ed25519 public key (from the existing identity
infrastructure, T147 / `identity.rs`). The agent ID is the hex-encoded public
key hash.

---

## 3. Discovery Protocol

### 3.1 Discovery Sources (in priority order)

| Source | Mechanism | Use case |
|---|---|---|
| Static config | `~/.llmtxt/mesh.json` | Air-gapped, reproducible dev environments |
| File-based shared directory | `$LLMTXT_MESH_DIR/*.peer` | Same machine or NFS share |
| mDNS/DNS-SD | `_llmtxt._tcp.local` | Local network auto-discovery |
| HTTP rendezvous (optional) | `GET /api/mesh/peers` on api.llmtxt.my | Cross-network discovery |

**Decision record DR-P3-02**: Static config and file-based discovery MUST be
implemented in Phase 3 core. mDNS MAY be added as a plugin. HTTP rendezvous is
opt-in (requires api.llmtxt.my connectivity) and MUST NOT be required for local
mesh operation.

### 3.2 Peer Registration File

Each running agent MUST write a peer file to `$LLMTXT_MESH_DIR`:

```json
{
  "agentId": "hex-pubkey-hash",
  "transport": "unix:/tmp/llmtxt-agent-a.sock",
  "pubkey": "base64-ed25519-pubkey",
  "capabilities": ["sync", "presence", "a2a"],
  "startedAt": "2026-04-17T00:00:00Z"
}
```

The file MUST be named `<agentId>.peer`. On clean shutdown, the agent MUST
delete its peer file. On crash, stale peer files MUST be tolerated: connection
attempts that fail after 3 retries MUST cause the peer to be marked inactive.

**Security constraint for discovery**: Peer advertisement files that do not
include a valid `pubkey` field MUST be rejected. Unsigned peer advertisements
MUST be treated as malicious and MUST NOT be connected to. The discovery layer
MUST verify that any peer's `pubkey` is consistent with its advertised
`agentId` before initiating a connection.

Acceptance criterion: unauthenticated peer advertisements (missing or
inconsistent `pubkey`) MUST be rejected by the discovery layer before any
connection attempt.

---

## 4. Transport Abstraction

### 4.1 `PeerTransport` Interface

```typescript
interface PeerTransport {
  /** Unique identifier for this transport (e.g., "unix", "http", "ipc") */
  readonly type: string;

  /**
   * Listen for incoming connections.
   * MUST complete Ed25519 mutual handshake before calling onChangeset().
   * MUST reject connections that fail the handshake.
   * MUST call onChangeset() for each received, authenticated changeset.
   */
  listen(onChangeset: (peerId: string, changeset: Uint8Array) => void): Promise<void>;

  /**
   * Send a changeset to a specific peer.
   * MUST complete Ed25519 mutual handshake before sending any data.
   * MUST return after the peer acknowledges receipt.
   * MUST throw if the peer is unreachable after maxRetries.
   */
  sendChangeset(peerId: string, peerAddress: string, changeset: Uint8Array): Promise<void>;

  /** Graceful shutdown. */
  close(): Promise<void>;
}
```

### 4.2 Implementations

**UnixSocketTransport** (primary, Phase 3 core)
- Each agent listens on a Unix domain socket.
- Address format: `unix:<absolute-path>` (e.g., `unix:/tmp/llmtxt-abc.sock`).
- Binary framing: `[4-byte msg-length LE][msg-bytes]`.
- Ed25519 mutual handshake MUST complete before any changeset is sent or
  received (see section 4.3).
- Connections that fail the handshake MUST be closed immediately.
- Requires: Node.js `net` module. Zero external dependencies.

**HttpTransport** (secondary, for cross-machine)
- Each agent listens on a local HTTP port.
- Changeset exchange: `POST /mesh/changeset` with `Content-Type: application/octet-stream`.
- Response: `200 OK` with the peer's delta since last sync (bidirectional in one round-trip).
- Address format: `http://host:port`.
- Ed25519 handshake is performed via a preceding `POST /mesh/handshake` before
  any changeset exchange.

**Decision record DR-P3-03**: Unix socket transport is the primary implementation
because it requires no firewall configuration and has the lowest overhead on
same-machine collaboration (the primary LLMtxt use case). HTTP transport is
added for cross-machine and CI environments.

### 4.3 Ed25519 Mutual Handshake (Transport Requirement)

Peer authentication is a transport-layer requirement, not an optional add-on.
Every connection MUST complete the following 3-message challenge-response
handshake before any changeset data is exchanged:

1. **Initiator** sends: `{ agentId, pubkey, challenge: random_32_bytes }`
2. **Responder** signs the challenge with its private key, sends:
   `{ agentId, pubkey, sig: sign(challenge), challenge: random_32_bytes }`
3. **Initiator** verifies the responder's signature, then signs the responder's
   challenge, sends: `{ sig: sign(responder_challenge) }`
4. Both parties now hold verified peer identities.

**MUST** reject connections where signature verification fails.
**MUST NOT** establish a sync session without a successful handshake.
**MUST NOT** send or receive any changeset data before the handshake completes.

**Decision record DR-P3-04**: Ed25519 is chosen because it is already
implemented in `crates/llmtxt-core/src/identity.rs` and `crypto.rs`. No new
crypto primitive is introduced.

Acceptance criterion: unauthenticated peers (invalid or missing signature)
MUST be rejected before any data exchange begins.

### 4.4 Allowlist (Optional)

Agents MAY configure a peer allowlist (`~/.llmtxt/trusted-peers.json`). If
configured, the agent MUST reject connections from peers not in the allowlist
even if their signature is valid.

---

## 5. Sync Engine

### 5.1 Sync Loop

The sync engine MUST run a periodic sync loop (default: every 5 seconds) AND
MUST trigger an immediate sync when the local database is written.

```
for each peer in discoveredPeers:
  try:
    localChanges = backend.getChangesSince(lastSyncVersion[peer])
    if localChanges.length > 0:
      await transport.sendChangeset(peer.id, peer.address, localChanges)
    remoteChanges = await transport.requestChanges(peer.id, peer.address, peer.lastKnownVersion)
    if remoteChanges.length > 0:
      newVersion = await backend.applyChanges(remoteChanges)
      lastSyncVersion[peer] = newVersion
  catch (err):
    recordPeerFailure(peer.id, err)
```

`lastSyncVersion` MUST be persisted to a local `llmtxt_mesh_state` table so
it survives agent restarts.

**Changeset integrity requirement**: Before calling `backend.applyChanges()`,
the sync engine MUST verify changeset integrity (see section 5.2). Unsigned or
corrupted changesets MUST be rejected and the peer failure MUST be recorded.

Acceptance criterion: unsigned changesets MUST be rejected before being applied
to the local database.

### 5.2 Changeset Integrity Verification (Sync Engine Requirement)

Changeset integrity verification is a sync engine requirement, not a separate
phase. Every changeset received from a peer MUST be verified before application:

1. Compute `SHA-256(changeset_bytes)`.
2. Compare against the `crdt_state_hash` declared by the peer in the changeset
   metadata.
3. For `crdt_state` column updates: after Loro merge, compute `SHA-256` of the
   merged blob and store it in the `crdt_state_hash` column.
4. If the hash does not match: reject the changeset, log a security warning, do
   NOT apply any changes to the local database.

Corrupted Loro blobs MUST be detected and rejected before the local CRDT state
is modified.

Acceptance criterion: corrupted Loro blobs MUST be detected and rejected.

### 5.3 Convergence Guarantee

Given finite network partitions (partition heals within TTL), all peers MUST
converge to the same state within 2× the sync interval. This is guaranteed by:
- cr-sqlite's CRDT properties (associativity, commutativity, idempotency).
- Loro's CRDT merge (for blob columns, as per P2 spec).
- Full mesh topology: every peer eventually reaches every other peer directly.

---

## 6. Conflict-Free Presence

### 6.1 Protocol

Presence state (which agent is editing which section, cursor position) is
ephemeral and does NOT use cr-sqlite (presence is not durably stored).

Each agent MUST broadcast its presence to all connected peers every 10 seconds:

```json
{
  "type": "presence",
  "agentId": "hex-pubkey-hash",
  "documentId": "...",
  "sectionId": "...",
  "updatedAt": "ISO-8601",
  "ttl": 30
}
```

Peers MUST store presence state in memory only. Entries expire after `ttl`
seconds if no refresh is received. No central store is required.

---

## 7. Agent-to-Agent (A2A) Messages

### 7.1 Routing

A2A messages (task assignments, approvals, notifications) MUST be delivered via
the mesh transport, not via api.llmtxt.my's HTTP inbox.

Message structure:

```json
{
  "type": "a2a",
  "from": "agentId",
  "to": "agentId",
  "payload": { ... },
  "sig": "base64-ed25519-sig-of-canonical-json",
  "sentAt": "ISO-8601"
}
```

If the target peer is not directly connected, the message MUST be relayed
through any connected peer that knows the target. If no path exists after 3
relay attempts, the message MUST be queued locally and retried when the target
reconnects.

**Decision record DR-P3-05**: A2A routing is best-effort in Phase 3. Guaranteed
delivery (at-least-once with receipt ACK) is deferred to a future epic.

---

## 8. CLI Interface

```
llmtxt mesh start  [--db <path>] [--transport <unix|http>] [--port <n>]
llmtxt mesh stop
llmtxt mesh status                         # peers, sync state, last-sync timestamps
llmtxt mesh peers                          # list discovered peers
llmtxt mesh sync   [--peer <agentId>]      # manual sync (one-shot)
```

`llmtxt mesh start` MUST:
1. Initialize the sync engine and transport.
2. Write the peer file to `$LLMTXT_MESH_DIR`.
3. Begin discovery loop.
4. Print: `Mesh started. Listening on <address>. Discovered N peers.`

---

## 9. Server-as-Peer (Hybrid Mode)

`api.llmtxt.my` MAY be configured as a mesh peer. When configured:
- The server joins the mesh as any other peer, using HTTP transport.
- Changesets received from local agents are applied to the PostgresBackend.
- The PostgresBackend translates Postgres rows to/from cr-sqlite changeset
  format via a `PostgresChangesetAdapter`.
- This enables hybrid architectures: some agents local, some cloud.

**Decision record DR-P3-06**: Server-as-peer is an optional bolt-on in Phase 3.
It MUST NOT be required for local-only mesh operation. The
`PostgresChangesetAdapter` is a Phase 3 deliverable but is explicitly lower
priority than the local-first sync engine.

---

## 10. Security Threat Model

Security is enforced at the layer where each threat originates — discovery,
transport, and sync engine. There are no standalone security tasks; each
security mechanism is a requirement of its parent component.

| Threat | Enforcement Layer | Mitigation |
|---|---|---|
| Malicious peer sends corrupt cr-sqlite changeset | Sync engine | cr-sqlite validates changeset structure internally; reject on parse error |
| Malicious peer sends corrupt Loro blob | Sync engine | SHA-256 hash verification before apply; reject blobs that do not match the declared hash (section 5.2) |
| Replay attack (old changeset re-sent) | Sync engine | Track `db_version` per peer; discard changesets older than `lastSyncVersion[peer]` — harmless due to cr-sqlite idempotency |
| Rogue peer impersonates another agent | Transport | Ed25519 handshake is mandatory at transport layer (section 4.3); no data exchange before handshake |
| Peer file injection (attacker writes `.peer` file) | Discovery | Discovery layer rejects unsigned or pubkey-inconsistent advertisements (section 3.2); handshake confirms identity before data exchange |
| Presence flood (peer sends thousands of presence msgs) | Sync engine | Rate-limit presence messages: max 1 per peer per 5 seconds; drop excess |
| A2A message spoofing | Sync engine | Verify `sig` field against sender's known pubkey before processing payload |
| Changeset size bomb | Transport | Enforce max changeset size: 10 MB. Reject and log oversized changesets. |

**Decision record DR-P3-07**: Integrity verification for Loro blobs is part of
the sync engine's `applyChanges` path (section 5.2), not a separate task.

Every `applyChanges` call that touches a `crdt_state` column MUST:
1. Compute `SHA-256(blob)`.
2. Compare against a `crdt_state_hash` column (added in P3 schema migration).
3. If the hash does not match the blob, reject the changeset and log a
   security warning.
4. After Loro merge, update `crdt_state_hash` with the new blob's hash.

---

## 11. Dependency DAG (Phase 3)

Security requirements are embedded within their parent tasks, not separate tasks.
P3.5 (peer auth) is a requirement of P3.3 (transport). Changeset integrity
is a requirement of P3.4 (sync engine). Discovery security is a requirement
of P3.2 (discovery).

```
P3.1 (Architecture spec — this document, finalized)
  ├─→ P3.2 (Peer discovery: file-based + static config + unsigned-ad rejection)
  ├─→ P3.3 (Transport: UnixSocket + HTTP + Ed25519 mutual handshake built-in)
  └─→ (P3.2 + P3.3 merge here)
        └─→ P3.4 (Mesh sync engine: discovery + transport + sync loop +
                  changeset integrity verification + Loro blob hash check)
              ├─→ P3.6 (Presence: in-memory broadcast, TTL expiry)
              └─→ P3.7 (A2A over mesh: signed, routed, relay)
                    └─→ P3.8 (CLI: mesh start/stop/status/peers/sync)
                          └─→ P3.9 (Multi-peer integration test: 5 peers, 60s writes, hash compare)
                                ├─→ P3.10 (CLEO mesh example: 3 agents, no server)
                                └─→ P3.11 (Server-as-peer: PostgresChangesetAdapter)
                                      └─→ P3.13 (Docs: mesh section in apps/docs)
```

Note: P3.5 (standalone peer auth task) and P3.12 (standalone security task)
are merged into their parent components (P3.3 and P3.4 respectively) per
owner mandate. Those CLEO tasks are updated to reflect these requirements
within the parent task scope.

---

## 12. Acceptance Criteria (Epic)

1. Five `LocalBackend` instances with cr-sqlite run on separate Unix sockets;
   each writes independently for 60 seconds; after stopping writes and allowing
   one sync cycle, all five databases produce an identical SHA-256 hash of the
   `documents` + `versions` table contents.
2. A peer with an invalid Ed25519 signature MUST be rejected before any
   changeset exchange begins. Unauthenticated peers MUST be rejected.
3. A2A message sent by Agent A to Agent B is received and verified by Agent B
   within one sync interval (5 seconds under normal load).
4. Killing one of five peers mid-sync does not corrupt any surviving peer's
   database; the four survivors converge after the dead peer recovers.
5. `llmtxt mesh status` prints peer count, last-sync timestamp, and
   bytes-exchanged per peer.
6. A Loro blob with a mismatched `crdt_state_hash` is rejected with a logged
   security warning; the local state is not modified. Corrupted Loro blobs
   MUST be detected and rejected.
7. All 5 tests in the multi-peer suite (P3.9) pass in CI on Linux (amd64).
8. Unsigned changesets MUST be rejected before being applied to the local
   database.
9. Unsigned peer advertisements MUST be rejected at the discovery layer.
10. All features ship production-ready. No known-broken functionality in the
    release.
