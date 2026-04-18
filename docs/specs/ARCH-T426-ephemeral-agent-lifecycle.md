# Spec T426: Ephemeral Agent Lifecycle

**Version**: 1.0.0
**Status**: DRAFT — planning only, no implementation
**RFC 2119 Key words**: MUST, MUST NOT, SHOULD, MAY
**Owner mandate**: Production-ready only. No migrations. Security built-in.

---

## 1. Background and Motivation

LLMtxt agents currently have no formal lifecycle. An agent connects, performs
work, and terminates. Cleanup is implicit — leases, presence entries, and
nonces expire via TTL. For low-scale workloads this is tolerable. For
100+ concurrent ephemeral workers (the swarm scenario), implicit cleanup
creates a growing pool of orphaned state that drains slowly and unpredictably:

- **Orphaned leases** block other agents from acquiring sections until TTL fires.
- **Stale presence** entries mislead other agents about who is active.
- **In-flight inbox messages** are never drained, accumulating indefinitely.
- **No audit trail** — there is no record of what an agent contributed, when,
  or for how long. Forensic analysis and billing hooks are impossible.
- **Single-tenant temp storage** is never cleaned up if a process crashes.

The guiding star for LLMtxt is: *never lose work, never duplicate work, never
go stale*. The absence of a formal lifecycle violates all three when agents
crash or abandon sessions.

This spec formalizes the `AgentSession` class in `packages/llmtxt` that gives
every agent — ephemeral or persistent — an explicit, auditable lifecycle.

---

## 2. Scope

### In scope

- `AgentSession` class in `packages/llmtxt/src/sdk/` (TypeScript)
- `open()`, `contribute()`, `close()` method contracts
- Session state machine: `idle → open → active → closing → closed`
- Contribution receipt format and persistence
- Crash recovery contract (TTL-based, no new server primitives)
- Hub-and-spoke topology documentation (RemoteBackend vs. LocalBackend
  selection policy)
- Swarm integration test: 50 ephemeral workers, zero orphaned state
- CLI commands: `llmtxt session start` / `llmtxt session end`
- Fumadocs page at `apps/docs/content/docs/multi-agent/session-lifecycle.mdx`

### Out of scope

- Server-side session registry (sessions are client-side state; crash recovery
  uses existing TTLs already present on leases, presence, and nonces)
- Changes to `Backend` interface (no new server routes required)
- Persistent agent `.db` management beyond what LocalBackend already owns
- P2P mesh or cr-sqlite concerns (separate epics T385, T386)

---

## 3. `AgentSession` API Contract

### 3.1 Constructor

```typescript
interface AgentSessionOptions {
  /** Backend to operate through. */
  backend: Backend;

  /**
   * Agent identity. MUST be the same identity registered via
   * backend identity primitives.
   */
  agentId: string;

  /**
   * Cryptographically random session ID (128-bit entropy minimum).
   * If omitted, AgentSession MUST generate one using crypto.randomUUID()
   * or equivalent. MUST be unguessable.
   */
  sessionId?: string;

  /**
   * Human-readable label for this session. Used in receipts.
   * Defaults to agentId + timestamp ISO string.
   */
  label?: string;
}

class AgentSession {
  constructor(options: AgentSessionOptions);
}
```

**MUST NOT** use sequential or predictable session IDs. Predictable session
IDs allow session hijacking in multi-agent environments.

### 3.2 `open()`

```typescript
async open(): Promise<void>
```

**MUST** transition state from `idle` to `open`, then to `active`.

**MUST** perform the following initialization steps atomically where possible:

1. Validate that `backend` is reachable (attempt a lightweight health probe).
2. For LocalBackend (single-tenant): allocate a temp SQLite file in a
   deterministic path derived from `sessionId` under `os.tmpdir()`. The path
   MUST NOT collide with other sessions.
3. Record session start timestamp (monotonic clock, `Date.now()` is acceptable
   as a floor).
4. SHOULD register presence via `backend.updatePresence()` to signal activity.

**MUST** throw `AgentSessionError` with code `SESSION_ALREADY_OPEN` if called
when state is not `idle`.

**MUST NOT** be called concurrently (not re-entrant).

### 3.3 `contribute()`

```typescript
async contribute<T>(
  fn: (backend: Backend) => Promise<T>
): Promise<T>
```

**MUST** only be called when state is `active`. Throws `AgentSessionError`
with code `SESSION_NOT_ACTIVE` otherwise.

**MUST** wrap the caller's function `fn` and:

1. Pass the session's `backend` instance to `fn`.
2. Track every `documentId` returned by write operations internally. The
   `AgentSession` MAY intercept backend write calls via a proxy to extract
   document IDs, or require callers to return `{ documentId }` shaped objects
   — see implementation note in T426.3.
3. Increment an internal `eventCount` for each successful write.
4. Propagate any error thrown by `fn` without swallowing it.

**MUST NOT** modify `eventCount` or `documentIds` if `fn` throws.

### 3.4 `close()`

```typescript
async close(): Promise<ContributionReceipt>
```

**MUST** transition state from `active` → `closing` → `closed`.

**MUST** perform the following teardown steps in order:

1. Perform a final sync flush: call `backend.flushPendingWrites()` if the
   method exists (MAY be a no-op on RemoteBackend).
2. Drain inbox: call `backend.pollInbox(agentId)` until empty, discarding
   received messages (they were not claimed during the session — draining
   prevents indefinite accumulation).
3. Release all leases acquired during the session by calling
   `backend.releaseLease()` for each tracked resource.
4. For LocalBackend single-tenant: delete the temp `.db` file allocated in
   `open()`.
5. Deregister presence via `backend.removePresence()`.
6. Emit a `ContributionReceipt` and persist it (see Section 4).
7. Return the `ContributionReceipt`.

**MUST** attempt all teardown steps even if earlier steps fail. Failures MUST
be collected and surfaced as `AgentSessionError` with code
`SESSION_CLOSE_PARTIAL` after all steps complete, attaching the partial
`ContributionReceipt` and an array of `CloseStepError`.

**MUST** be idempotent — calling `close()` on an already-closed session MUST
return the previously emitted receipt without re-executing teardown steps.

### 3.5 State Machine

```
┌────────────────────────────────────────────────────┐
│                   AgentSession                     │
│                                                    │
│   idle ──open()──► open ──(init done)──► active   │
│                                            │       │
│                                       contribute() │
│                                            │       │
│                                        ◄──┘        │
│                                            │       │
│                                       close()      │
│                                            │       │
│                                            ▼       │
│                                         closing    │
│                                            │       │
│                                   (teardown done)  │
│                                            │       │
│                                            ▼       │
│                                          closed    │
│                                                    │
│   Any state ──crash──► (TTL cleanup via backend)  │
└────────────────────────────────────────────────────┘
```

State transitions MUST be protected by an internal mutex to prevent concurrent
`close()` calls from executing teardown twice.

---

## 4. Contribution Receipt

### 4.1 Schema

```typescript
interface ContributionReceipt {
  /** Session ID (128-bit random, URL-safe base62 encoded). */
  sessionId: string;

  /** Agent identity ID. */
  agentId: string;

  /** Unique document IDs written during the session. */
  documentIds: string[];

  /** Total successful write operations performed via contribute(). */
  eventCount: number;

  /** Session duration in milliseconds (close timestamp - open timestamp). */
  sessionDurationMs: number;

  /** ISO 8601 UTC timestamp of session open. */
  openedAt: string;

  /** ISO 8601 UTC timestamp of session close. */
  closedAt: string;

  /**
   * Ed25519 signature over the canonical receipt payload.
   * MUST be present when backend is RemoteBackend (cross-network).
   * MAY be omitted for LocalBackend (same-process).
   *
   * Signature covers: SHA-256(sessionId + agentId + documentIds.sort().join(',') +
   *                   eventCount + openedAt + closedAt)
   */
  signature?: string;
}
```

### 4.2 Signing Requirement

When `AgentSession` is constructed with a `RemoteBackend`, the receipt
**MUST** be signed using the agent's Ed25519 private key (already managed by
the identity system). This provides non-repudiation: any backend can verify
that the receipt was produced by the stated agent.

For `LocalBackend`, signing is **RECOMMENDED** but not required (same-process
trust boundary).

### 4.3 Persistence

The `AgentSession` **MUST** persist the receipt to:
- `backend.appendEvent()` on the first `documentId` in the receipt (if any),
  with `type: 'session.closed'` and the receipt as `payload`.
- A local append-only log at `<storagePath>/session-receipts.jsonl` when using
  `LocalBackend`.

If no documents were touched, the receipt MUST still be emitted but
persistence to `appendEvent` is OPTIONAL (nothing to attach to).

---

## 5. Crash Recovery Contract

`AgentSession` relies exclusively on **existing TTL mechanisms** already
present in the backend. No new server-side session registry is introduced.

| Resource | TTL mechanism | Default expiry |
|---|---|---|
| Leases | `leases.expiresAt` (already reaper-swept) | ≤ 300 s (max acquire) |
| Presence | `presenceTtlMs` in BackendConfig | 30 s |
| A2A inbox messages | `expiresAt` on InboxMessage (if set) | Policy-defined |
| Nonces | `nonces` table TTL (existing) | Policy-defined |

**MUST NOT** introduce new server-side cleanup sweepers as part of this epic.

**Crash recovery guarantee**: If an agent process dies without calling
`close()`, all lease and presence state WILL be cleaned up within
`max(leaseMaxDuration, presenceTtlMs)` of the crash — currently at most 330 s
under default config.

**Known gap (acknowledged, not deferred)**: A2A inbox messages addressed to
the crashed agent accumulate until sender TTLs fire. This is acceptable for
the swarm scenario where workers are ephemeral and messages are typically
fire-and-forget. Senders SHOULD set short TTLs on ephemeral-worker-addressed
messages.

---

## 6. Hub-and-Spoke Topology

This section documents the storage selection policy that MUST be followed for
ephemeral vs. persistent agents. (Full topology spec lives in T429.)

| Agent type | Backend | `.db` ownership |
|---|---|---|
| Persistent hub | `LocalBackend` | Owns a durable `.db` at a stable path |
| Ephemeral worker | `RemoteBackend` | No `.db`; all state via hub API |
| Ephemeral worker (offline-capable) | `LocalBackend` | Allocates temp `.db` in `os.tmpdir()` for session duration only; `close()` deletes it |

**MUST NOT** give ephemeral workers a persistent `.db` path. Persistent paths
defeat the cleanup guarantee.

**SHOULD** prefer `RemoteBackend` for ephemeral workers unless offline
capability is required. `RemoteBackend` has zero local state to clean up.

---

## 7. Security Requirements

| Requirement | Rationale |
|---|---|
| Session IDs MUST use 128-bit entropy (crypto.randomUUID or equivalent) | Prevents session enumeration / hijacking |
| Receipts MUST be signed (Ed25519) when cross-network | Non-repudiation; prevents forged contribution claims |
| Temp `.db` files MUST be created with mode 0600 | Prevents other local users from reading agent state |
| `agentId` MUST match the authenticated identity in backend | Prevents contribution spoofing |

These requirements apply from day 1. There is no "phase 2" for security.

---

## 8. Dependency DAG

```
T426 (this epic)
├── depends on T385 (RemoteBackend — needed for hub-and-spoke workers)
├── depends on T429 (Hub-and-Spoke Topology — topology contract)
│
├── T426.1: AgentSession skeleton (TS types + state machine)
│   ├── T426.2: open() implementation → T426.1
│   ├── T426.3: contribute() implementation → T426.1
│   │   ├── T426.4: close() implementation → T426.3
│   │   │   ├── T426.5: Crash recovery contract + integration test → T426.4
│   │   │   ├── T426.7: Swarm integration test → T426.4, T426.6
│   │   │   └── T426.8: CLI session start/end commands → T426.4
│   │   └── T426.6: ContributionReceipt emission + persistence → T426.3
│   │       └── T426.7 (also depends on T426.6, see above)
│   └── T426.9: Docs (depends on all T426.1-T426.8)
```

---

## 9. Acceptance Criteria (Epic-Level)

All of the following MUST be true before T426 is considered complete:

1. `AgentSession` class is exported from `packages/llmtxt/src/sdk/index.ts`
   with TypeScript types for `ContributionReceipt`, `AgentSessionOptions`,
   and `AgentSessionError`.
2. `open()`, `contribute()`, and `close()` pass unit tests covering the happy
   path, error states, and the idempotent re-close case.
3. `close()` releases all leases acquired during the session (verified by
   querying lease state after close).
4. `close()` drains the A2A inbox (verified by polling after close returns
   empty).
5. A single-tenant `LocalBackend` session leaves no temp `.db` file after
   `close()` completes.
6. `ContributionReceipt` is signed when `RemoteBackend` is used, and the
   signature validates using the agent's public key.
7. A process-kill crash test confirms that lease and presence state is
   cleared within 330 s of forced termination (no explicit server changes,
   TTL-only).
8. A swarm test spawns 50 `AgentSession` workers against a shared hub,
   performs concurrent writes, calls `close()` on each, and asserts zero
   orphaned leases and zero orphaned presence entries.
9. `llmtxt session start` and `llmtxt session end` CLI commands exist and
   produce a receipt JSON on stdout.
10. Fumadocs docs page at
    `apps/docs/content/docs/multi-agent/session-lifecycle.mdx` covers the
    lifecycle, receipt format, and crash recovery contract.

---

## 10. Production Constraints

Per owner mandate (ORC-008):

- **No migrations** — `AgentSession` is pure SDK code; no new DB tables.
- **Greenfield** — this feature did not exist before; no backward compatibility
  burden.
- **Security built-in** — all security requirements in Section 7 apply from
  the first commit. No deferred hardening.
- **No "phase 2" deferrals** — every acceptance criterion above ships in this
  epic or is explicitly filed as a blocking follow-on task.

---

*Generated by RCASD agent on 2026-04-17. Spec owner: T426.*
