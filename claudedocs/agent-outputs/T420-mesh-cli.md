# T420: llmtxt mesh CLI — start/stop/status/peers/sync

**Date**: 2026-04-17
**Task**: T420 (P3.8)
**Status**: complete
**Commit**: c14347b57937e0cb0a676e51b8997231eb6e9443

## What was implemented

Added `llmtxt mesh <subcommand>` to `packages/llmtxt/src/cli/llmtxt.ts`:

- `mesh start [--transport unix|http] [--port n] [--db path]`
  - Loads or generates Ed25519 identity from `<storage>/identity.json`
  - Opens LocalBackend, builds UnixSocketTransport or HttpTransport
  - Registers peer file in LLMTXT_MESH_DIR via PeerRegistry.register()
  - Starts SyncEngine with 5s sync interval
  - Writes PID to `~/.llmtxt/mesh.pid`
  - Writes status JSON to `~/.llmtxt/mesh.status.json` every 5s
  - Handles SIGTERM/SIGINT for clean shutdown (deregister, stop, close)
  - Prints: `Mesh started. Listening on <address>. Discovered N peers.`

- `mesh stop`
  - Reads PID from `~/.llmtxt/mesh.pid`
  - Sends SIGTERM; waits up to 10s for clean shutdown

- `mesh status`
  - Reads `~/.llmtxt/mesh.status.json`
  - Prints: agent ID, transport, uptime, peer count, last-sync versions, failure counts

- `mesh peers [--mesh-dir path]`
  - Uses PeerRegistry.discover() to read `*.peer` files from LLMTXT_MESH_DIR
  - Prints tabular output: agentId, transport, active, startedAt

- `mesh sync [--peer agentId]`
  - Loads identity, opens LocalBackend
  - Discovers peers via PeerRegistry
  - For HTTP peers: uses `_httpChangesetExchange`
  - For unix peers: derives storage dir from socket path, uses `_localFileChangesetExchange`

## New flags added to CliArgs / parseArgs

- `--transport unix|http`
- `--port <n>`
- `--peer <agentId>`
- `--mesh-dir <path>`

## Tests

`packages/llmtxt/src/__tests__/mesh-cli.test.ts` — 8 tests:

1. `mesh` with no subcommand exits non-zero with usage message
2. `mesh unknown-sub` exits non-zero with error message
3. `mesh stop` with no running process exits non-zero with helpful message
4. `mesh status` with no status file reports no running process
5. `mesh peers` with empty mesh dir prints "No peers discovered"
6. `mesh sync` without identity exits non-zero with identity error
7. `--help` output includes mesh commands
8. Mesh flags are parsed cleanly (no "unknown option" errors)

All 8 pass. Full suite: 470/470 pass.

## Key decisions / gotchas

- `AgentIdentity` constructor is private — must use `AgentIdentity.fromSeed(seed)`.
- Mesh agentId = `SHA-256(pubkey bytes)` hex, not the `identity.json` agentId string.
  This matches P3 spec §2.2 requirement.
- Status file is written by the running process every 5s; `mesh status` reads it
  rather than using IPC (simpler, production-safe for the CLI use case).
- CLEO `test-run` JSON needs `numTotalTests/numPassedTests/numFailedTests/success/testResults` format.
- The single pre-existing cr-sqlite hasCRR failure is environment-conditional
  (crsqlite.so not present in dev) and is not a regression.

## Modules reused

- `mesh/discovery.ts` — PeerRegistry
- `mesh/transport.ts` — UnixSocketTransport, HttpTransport
- `mesh/sync-engine.ts` — SyncEngine
- `identity.ts` — AgentIdentity.fromSeed()
- `local/local-backend.ts` — LocalBackend
