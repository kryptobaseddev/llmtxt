# T417 + T418 + T419: Mesh Sync Engine + Presence + A2A

**Date**: 2026-04-17
**Commit**: b059fbf96fc493f01ab954b5578434a43f3a13af
**Status**: complete
**Tests**: 15/15 new tests pass; 455/455 full suite pass

## Summary

Three mesh layer modules implemented and shipped:

### T417 — P3.4 Mesh Sync Engine (`packages/llmtxt/src/mesh/sync-engine.ts`)

SyncEngine class wrapping cr-sqlite changeset exchange with mandatory security:

- Periodic sync loop (default 5s, configurable via `syncIntervalMs`)
- Immediate sync on dirty flag set by backend 'write' events
- Per-peer state isolation: one peer failure does not block others
- Graceful drain: `stop()` awaits all in-flight syncs before closing transport
- Changeset envelope: 1-byte type prefix (0x01) + JSON with from/changesetB64/integrityHash/sig/sinceVersion

Security enforced (spec §5.1, §5.2, §10):
- Ed25519 signature verified before `applyChanges` — unsigned changesets REJECTED
- SHA-256(changeset_bytes) compared to peer-declared integrityHash — tampered changesets REJECTED
- Oversized changesets (>10 MB) REJECTED before parsing
- Peer failure counter: after `maxPeerFailures` consecutive failures, peer marked inactive

### T418 — P3.6 Presence (`packages/llmtxt/src/mesh/presence.ts`)

PresenceManager class with in-memory TTL registry:

- Broadcasts own presence to all peers every 10s (configurable)
- Inbound presence stored with `receivedAt` timestamp for TTL calculation
- `getPresence(documentId?)` evicts expired entries on each call
- Rate limiting: max 1 message per peer per 5s window; excess dropped + logged

Message type byte: 0x02

### T419 — P3.7 A2A Messenger (`packages/llmtxt/src/mesh/a2a.ts`)

MeshMessenger class for signed agent-to-agent routing:

- Outbound: Ed25519-signed canonical JSON envelope (type/from/to/payload/sentAt sorted alphabetically)
- Inbound: signature verified against sender pubkey (from field = pubkeyHex) before delivery
- Direct path: sends to peer if in discovery list
- Relay path: wraps in `{type:"relay",inner:envelope}` and forwards to any connected peer (1-hop per spec)
- Queue: after MAX_RELAY_ATTEMPTS (3) with no path, queued locally; `retryQueued()` flushes on reconnect
- Size limit: payload >1 MB rejected at send with Error

Message type byte: 0x10

## Key Findings

1. Security rejections are async (Ed25519 verify is async); tests must set up the listener BEFORE triggering inbound and await `setTimeout(100ms)` for the promise chain to resolve.
2. CLEO test-run JSON expects Jest format: `numTotalTests`, `numPassedTests`, `numFailedTests` — not `summary.pass`.
3. Backend EventEmitter cast must go through `unknown` to avoid TS strict overlap check.
4. Optional extension methods (getMeshState/setMeshState) must also cast through `unknown` to avoid TS2352 errors.
5. The `tool:tsc` evidence runs tsc without a project file from cwd (root) — use `tool:pnpm-build` for qaPassed instead.

## Files

- `packages/llmtxt/src/mesh/sync-engine.ts` (new)
- `packages/llmtxt/src/mesh/presence.ts` (new)
- `packages/llmtxt/src/mesh/a2a.ts` (new)
- `packages/llmtxt/src/__tests__/sync-engine.test.ts` (new, 6 tests)
- `packages/llmtxt/src/__tests__/presence.test.ts` (new, 4 tests)
- `packages/llmtxt/src/__tests__/a2a.test.ts` (new, 5 tests)
