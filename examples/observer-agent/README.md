# observer-agent

A standalone reference agent that passively monitors a document's event stream
and verifies hash chain integrity. It uses both the SSE event stream and
CRDT WebSocket subscriptions — writing nothing to the document.

## What it does

1. Generates an ephemeral Ed25519 keypair via `llmtxt/identity` (for registration).
2. Registers the public key with the API.
3. Opens CRDT section subscriptions via `subscribeSection` from `llmtxt/crdt` (optional).
4. Subscribes to `watchDocument()` SSE stream (from `llmtxt`).
5. For every event received: logs type, payload summary, and checks hash chain continuity.
6. At end of run: fetches the server's event log and does a full chain verification.
7. Prints a structured final report; exits 1 in `--verify-mode strict` if chain breaks found.

## Prerequisites

- Node.js >= 22
- An LLMtxt API key from https://llmtxt.my/settings

## Setup

```bash
cp .env.example .env
# Edit .env and set LLMTXT_API_KEY

npm install
```

## Run

```bash
# Basic observation (5-minute window, lenient mode)
node index.js --slug my-doc

# Strict mode: exits 1 immediately on chain break
node index.js --slug my-doc --verify-mode strict

# Also subscribe to specific sections via CRDT WebSocket
node index.js --slug my-doc --sections "introduction,summary,architecture"

# Shorter window (60 seconds)
node index.js --slug my-doc --timeout 60000
```

## Expected output

```
[observer-agent] Generating Ed25519 identity...
[observer-agent] Agent ID    : observer-agent-a1b2c3d4
[observer-agent] Pubkey      : a1b2c3d4e5f60718...
[observer-agent] Document    : my-doc
[observer-agent] Verify mode : lenient
[observer-agent] Timeout     : 300000ms

[observer-agent] Pubkey registered.
[observer-agent] CRDT[introduction] subscribeSection() opened (loro-sync-v1)
[observer-agent] CRDT[summary] subscribeSection() opened (loro-sync-v1)

[observer-agent] Connecting to SSE stream for "my-doc"...
[observer-agent] Event #1: document.created | {"slug":"my-doc","createdBy":"writer-agent..."}
[observer-agent] Event #2: section.edited | {"sectionId":"introduction","agent":"writer..."}
[observer-agent] CRDT[introduction] delta: 342 bytes, text_len=280, total_crdt=342
[observer-agent] Event #3: version_created | {"versionNumber":1}
[observer-agent] Event #4: state.changed | {"from":"DRAFT","to":"REVIEW"}
[observer-agent] CRDT subscriptions closed.

[observer-agent] === Final Report ===
[observer-agent] Server event log: 4 events, chain_valid=true
[observer-agent] Total SSE events        : 4
[observer-agent] Version events          : 1
[observer-agent] Transition events       : 1
[observer-agent] Other events            : 2
[observer-agent] Chain breaks (client)   : 0 / 4 checked
[observer-agent] Chain valid (client)    : true
[observer-agent] Chain valid (server)    : true
[observer-agent] CRDT messages           : 1
[observer-agent] CRDT bytes total        : 342
[observer-agent] Section hashes (SHA-256 prefix):
[observer-agent]   introduction: a3f7c2d1e8b94f02... (280 chars)

[observer-agent] RESULT: PASS (verify-mode=lenient)
```

## Verify modes

| Mode | Behaviour on chain break |
|------|--------------------------|
| `lenient` (default) | Logs a warning, continues, exits 0 |
| `strict` | Logs an error, aborts the SSE loop, exits 1 |

Use `strict` in CI pipelines where chain integrity is a hard requirement.

## Key SDK imports

| Import | Purpose |
|--------|---------|
| `createIdentity` from `llmtxt/identity` | Generate Ed25519 keypair |
| `watchDocument` from `llmtxt` | Subscribe to SSE event stream |
| `subscribeSection` from `llmtxt/crdt` | CRDT WebSocket subscription |
| `identity.buildSignatureHeaders(...)` | Sign pubkey registration |

## CLI options

| Flag | Short | Description |
|------|-------|-------------|
| `--slug` | `-s` | Document slug to observe (required) |
| `--verify-mode` | `-v` | `strict` or `lenient` (default: lenient) |
| `--timeout` | `-t` | Observation window in ms (default: 300000) |
| `--sections` | `-x` | Comma-separated section IDs for CRDT watch |
| `--help` | `-h` | Show help |
