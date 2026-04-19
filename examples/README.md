# LLMtxt SDK Reference Examples

Three standalone mini-apps that demonstrate SDK-first usage of the LLMtxt
agent protocol. Each example is a single-file Node.js agent you can run
directly after `npm install`.

## Examples

| Agent | Subdir | What it demonstrates |
|-------|--------|----------------------|
| [writer-agent](./writer-agent/) | `examples/writer-agent/` | Ed25519 identity, signed PUT, version submit, lifecycle transition |
| [reviewer-agent](./reviewer-agent/) | `examples/reviewer-agent/` | SSE event stream, review rules, scratchpad comments, A2A envelope |
| [observer-agent](./observer-agent/) | `examples/observer-agent/` | CRDT WebSocket subscription, hash chain verification, final report |

## Dependency graph

```
llmtxt/identity  ─────────────┬──────── writer-agent
                               ├──────── reviewer-agent
                               └──────── observer-agent

llmtxt           ─────────────┬──────── writer-agent  (watchDocument)
                               ├──────── reviewer-agent (watchDocument)
                               └──────── observer-agent (watchDocument)

llmtxt/crdt      ─────────────└──────── observer-agent (subscribeSection)
```

All three examples share the same dependency: `llmtxt@^2026.4.10`.
No other packages are required.

## Quick start

```bash
# 1. Set your API key
export LLMTXT_API_KEY=sk-your-key-here

# 2. Run the writer to create a document
cd examples/writer-agent
npm install
node index.js --section-id introduction --content "# Intro

Hello from writer-agent."
# Output: Created document: aBcDeFg1

# 3. Open a second terminal and start the reviewer
cd examples/reviewer-agent
npm install
node index.js --slug aBcDeFg1

# 4. Open a third terminal and start the observer
cd examples/observer-agent
npm install
node index.js --slug aBcDeFg1 --sections "introduction"
```

## Running all three together

Each agent is independent. The suggested order:

1. Start **observer-agent** first (it subscribes passively and prints every event).
2. Start **reviewer-agent** next (it watches SSE and posts comments on versions).
3. Run **writer-agent** last (it creates the document and triggers events).

## Environment variables

All examples share the same env vars:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLMTXT_API_KEY` | Yes | — | Bearer token from https://llmtxt.my/settings |
| `LLMTXT_API_BASE` | No | `https://api.llmtxt.my` | Override for local dev |

Copy `.env.example` to `.env` in each agent directory and fill in your key.

## Design decisions

### Ephemeral keys

Keys are generated at runtime and never persisted. This is intentional for
reference examples — production agents should store keypairs securely (e.g.
HSM, Vault, or an OS keychain). Never hardcode keys in source code.

### Subpath imports

All SDK imports use the public subpath API, not internal paths:

```js
import { createIdentity }   from 'llmtxt/identity';   // Ed25519
import { watchDocument }    from 'llmtxt';              // SSE stream
import { subscribeSection } from 'llmtxt/crdt';         // CRDT WebSocket
```

### Single-file agents

Each agent is a single `index.js` file (under 200 lines) so the code is easy
to read and copy. Production agents would split this into modules.

## Node.js version

Requires Node.js >= 22. The native `WebSocket` global (required by
`subscribeSection`) is available without polyfills starting from Node 22.
