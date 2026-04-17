# Spec P3: P2P Agent Mesh (Serverless Collaboration)

**Version**: 1.0.0
**Status**: DRAFT — planning only, no implementation
**RFC 2119 Key words**: MUST, MUST NOT, SHOULD, MAY

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

---

## 4. Transport Abstraction

### 4.1 `PeerTransport` Interface

```typescript
interface PeerTransport {
  /** Unique identifier for this transport (e.g., "unix", "http", "ipc") */
  readonly type: string;

  /**
   * Listen for incoming connections.
   * MUST call onChangeset() for each received changeset.
   */
  listen(onChangeset: (peerId: string, changeset: Uint8Array) => void): Promise<void>;

  /**
   * Send a changeset to a specific peer.
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
- Requires: Node.js `net` module. Zero external dependencies.

**HttpTransport** (secondary, for cross-machine)
- Each agent listens on a local HTTP port.
- Changeset exchange: `POST /mesh/changeset` with `Content-Type: application/octet-stream`.
- Response: `200 OK` with the peer's delta since last sync (bidirectional in one round-trip).
- Address format: `http://host:port`.

**Decision record DR-P3-03**: Unix socket transport is the primary implementation
because it requires no firewall configuration and has the lowest overhead on
same-machine collaboration (the primary LLMtxt use case). HTTP transport is
added for cross-machine and CI environments.

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

### 5.2 Convergence Guarantee

Given finite network partitions (partition heals within TTL), all peers MUST
converge to the same state within 2× the sync interval. This is guaranteed by:
- cr-sqlite's CRDT properties (associativity, commutativity, idempotency).
- Loro's CRDT merge (for blob columns, as per P2 spec).
- Full mesh topology: every peer eventually reaches every other peer directly.

---

## 6. Peer Authentication

### 6.1 Mutual Ed25519 Handshake

When two peers connect, they MUST complete a challenge-response handshake:

1. **Initiator** sends: `{ agentId, pubkey, challenge: random_32_bytes }`
2. **Responder** signs the challenge with its private key, sends:
   `{ agentId, pubkey, sig: sign(challenge), challenge: random_32_bytes }`
3. **Initiator** verifies the responder's signature, then signs the responder's
   challenge, sends: `{ sig: sign(responder_challenge) }`
4. Both parties now hold verified peer identities.

**MUST** reject connections where signature verification fails.
**MUST NOT** establish a sync session without a successful handshake.

**Decision record DR-P3-04**: Ed25519 is chosen because it is already
implemented in `crates/llmtxt-core/src/identity.rs` and `crypto.rs`. No new
crypto primitive is introduced.

### 6.2 Allowlist (Optional)

Agents MAY configure a peer allowlist (`~/.llmtxt/trusted-peers.json`). If
configured, the agent MUST reject connections from peers not in the allowlist
even if their signature is valid.

---

## 7. Conflict-Free Presence

### 7.1 Protocol

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

## 8. Agent-to-Agent (A2A) Messages

### 8.1 Routing

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

## 9. CLI Interface

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

## 10. Server-as-Peer (Hybrid Mode)

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

## 11. Security Threat Model

| Threat | Impact | Mitigation |
|---|---|---|
| Malicious peer sends corrupt cr-sqlite changeset | Data corruption | cr-sqlite validates changeset structure internally; reject on parse error |
| Malicious peer sends corrupt Loro blob | CRDT state corruption | Hash the blob before storing; reject blobs that do not match the declared SHA-256 hash |
| Replay attack (old changeset re-sent) | Harmless (cr-sqlite idempotent) but wastes CPU | Track `db_version` per peer; discard changesets older than `lastSyncVersion[peer]` |
| Rogue peer impersonates another agent | State poisoning | Ed25519 handshake (section 6); allowlist optional |
| Peer file injection (attacker writes `.peer` file) | Connection to attacker | Allowlist enforcement; verify peer identity via handshake before accepting any data |
| Presence flood (peer sends thousands of presence msgs) | CPU / memory DoS | Rate-limit presence messages: max 1 per peer per 5 seconds; drop excess |
| A2A message spoofing | Unauthorized task execution | Verify `sig` field against sender's known pubkey before processing payload |
| Changeset size bomb | OOM | Enforce max changeset size: 10 MB. Reject and log oversized changesets. |

**Decision record DR-P3-07**: Integrity verification for Loro blobs:

Every `applyChanges` call that touches a `crdt_state` column MUST:
1. Compute `SHA-256(blob)`.
2. Compare against a `crdt_state_hash` column (added in P3 schema migration).
3. If the hash does not match the blob, reject the changeset and log a
   security warning.
4. After Loro merge, update `crdt_state_hash` with the new blob's hash.

---

## 12. Dependency DAG (Phase 3)

```
P3.1 (Architecture spec — this document, finalized)
  ├─→ P3.2 (Peer discovery: file-based + static config)
  ├─→ P3.3 (Transport abstraction: UnixSocket + HTTP impls)
  └─→ P3.5 (Peer auth: Ed25519 mutual handshake)
        (P3.2 + P3.3 + P3.5 merge here)
        └─→ P3.4 (Mesh sync engine: discovery + transport + sync loop)
              ├─→ P3.6 (Presence: in-memory broadcast, TTL expiry)
              └─→ P3.7 (A2A over mesh: signed, routed, relay)
                    └─→ P3.8 (CLI: mesh start/stop/status/peers/sync)
                          └─→ P3.9 (Multi-peer integration test: 5 peers, 60s writes, hash compare)
                                ├─→ P3.10 (CLEO mesh example: 3 agents, no server)
                                └─→ P3.11 (Server-as-peer: PostgresChangesetAdapter)
                                      └─→ P3.12 (Security: hash integrity for Loro blobs)
                                            └─→ P3.13 (Docs: mesh section in apps/docs)
```

---

## 13. Acceptance Criteria (Epic)

1. Five `LocalBackend` instances with cr-sqlite run on separate Unix sockets;
   each writes independently for 60 seconds; after stopping writes and allowing
   one sync cycle, all five databases produce an identical SHA-256 hash of the
   `documents` + `versions` table contents.
2. A peer with an invalid Ed25519 signature MUST be rejected before any
   changeset exchange begins.
3. A2A message sent by Agent A to Agent B is received and verified by Agent B
   within one sync interval (5 seconds under normal load).
4. Killing one of five peers mid-sync does not corrupt any surviving peer's
   database; the four survivors converge after the dead peer recovers.
5. `llmtxt mesh status` prints peer count, last-sync timestamp, and
   bytes-exchanged per peer.
6. A Loro blob with a mismatched `crdt_state_hash` is rejected with a logged
   security warning; the local state is not modified.
7. All 5 tests in the multi-peer suite (P3.9) pass in CI on Linux (amd64).
