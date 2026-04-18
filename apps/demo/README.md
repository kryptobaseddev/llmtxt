# LLMtxt Demo — Developer Guide

[![v2026.4.6](https://img.shields.io/badge/version-2026.4.6-blue)](https://www.npmjs.com/package/llmtxt)

This directory contains five reference agent implementations that demonstrate
LLMtxt's multi-agent collaboration capabilities against a live API.

**v2026.4.6**: Mesh demo (`scripts/mesh-example.js`) exercises P2P sync with no server. CRDT WebSocket endpoint now uses Loro framing (`0x01`/`0x02`/`0x03`) — legacy Yjs clients will be rejected.

> For the high-level overview and live-demo instructions, see
> [`docs/demo/README.md`](../../docs/demo/README.md).
> Full SDK reference: [docs.llmtxt.my](https://docs.llmtxt.my)

---

## The Five Agents

### WriterBot (`agents/writer-bot.js`)

**Role:** Content creator and document owner.

- Creates a new Markdown document via `POST /api/v1/compress` (or adopts an
  existing slug from `DEMO_SLUG`).
- Iterates through a list of sections, acquiring an advisory lease on each
  section ID before writing.
- Appends sections to the document via `PUT /api/v1/documents/:slug`.
- After each write, sends an A2A `request-summary` message to SummarizerBot.
- Transitions the document to `REVIEW` when all sections are written.
- Emits `DEMO_SLUG=<slug>` to stdout so the orchestrator can pass it to the
  other agents.

**Agent ID:** `writerbot-demo`

### ReviewerBot (`agents/reviewer-bot.js`)

**Role:** Code reviewer / quality gate.

- Subscribes to the SSE event stream via `watchEvents(slug)`.
- On each `version_created` or `document_updated` event, fetches raw content
  and applies rule-based critique checks.
- Posts structured review comments to the document scratchpad endpoint.
- Sends an A2A `review-complete` message to ConsensusBot with a recommendation
  of `approved` or `changes-requested`.

**Agent ID:** `reviewerbot-demo`

### ConsensusBot (`agents/consensus-bot.js`)

**Role:** BFT quorum arbiter.

- Polls its A2A inbox for `review-complete` messages (using `since` timestamp
  to skip stale messages from prior runs).
- Tallies approvals per version; when quorum is met (2f+1), submits a BFT-signed
  approval via `POST /api/v1/documents/:slug/bft/approve`.
- Signs the canonical payload: `slug\nagentId\nstatus\natVersion\ntimestampMs`.
- Transitions the document to `APPROVED` after the server confirms quorum.

**Agent ID:** `consensusbot-demo`

### SummarizerBot (`agents/summarizer-bot.js`)

**Role:** Live summary maintainer.

- Polls the document version endpoint every 5 seconds for new versions.
- Also polls its A2A inbox for `request-summary` triggers from WriterBot.
- On trigger, fetches the full document content, generates a stub executive
  summary (replace `_stubSummarize` with an LLM call in production), and
  upserts a `# Executive Summary` section.
- Acquires an advisory lease on `executive-summary` section before writing.

**Agent ID:** `summarizerbot-demo`

### ObserverBot (`agents/observer-bot.js`)

**Role:** E2E production verifier.

- Connects to the SSE event stream and (when available) CRDT WebSocket per section.
- Records every event type, presence update, BFT approval, and A2A message.
- Validates the SHA-256 hash chain on all events at end-of-run.
- Emits structured JSON metrics (`__OBSERVER_METRICS__...__END_METRICS__`) for
  orchestrator parsing.

**Agent ID:** `observerbot-t308`

---

## AgentBase — Shared Foundation (`agents/shared/base.js`)

All five agents extend `AgentBase`. It provides:

| Method | Description |
|--------|-------------|
| `init()` | Load or generate Ed25519 keypair; register pubkey with API |
| `_fetch(path, opts)` | Authenticated fetch with optional Ed25519 signature headers |
| `_api(path, opts)` | `_fetch` + JSON parse + error throw |
| `createDocument(content, opts)` | `POST /api/v1/compress` |
| `updateDocument(slug, content, changelog)` | `PUT /api/v1/documents/:slug` |
| `getContent(slug)` | `GET /api/v1/documents/:slug/raw` |
| `getDocument(slug)` | `GET /api/v1/documents/:slug` |
| `transition(slug, state, reason)` | `POST /api/v1/documents/:slug/transition` |
| `bftApprove(slug, atVersion, comment)` | Ed25519-signed BFT approval |
| `watchEvents(slug, opts)` | Returns `AsyncIterable<DocumentEvent>` via SSE |
| `acquireLease(slug, sectionId, dur, reason)` | Advisory section lease |
| `releaseLease(manager)` | Release a `LeaseManager` |
| `sendA2A(toAgentId, contentType, payload)` | Send signed A2A envelope |
| `pollInbox(opts)` | Poll this agent's inbox; `opts.since` filters stale messages |
| `sleep(ms)` | Promise-based sleep |
| `log(msg)` | Prefixed console.log |

### Ed25519 Key Persistence

`AgentBase.init()` calls `loadOrGenerateKey(agentId)` which:

1. Checks `~/.llmtxt/demo-agents/<agentId>.key`
2. If present, loads and reconstructs the `AgentIdentity`
3. If absent, generates a new `SecretKey` via `@noble/ed25519`, writes
   `{ sk: "<hex>", pk: "<hex>" }` at mode `0o600`, and returns the identity

Keys are stable across restarts. The pubkey is re-registered on every `init()`
call; a 409 response (already registered) is handled gracefully.

> Note: In the Railway deployment, keys persist only while the container volume
> is alive. The pubkeys are also registered in the database so a new keypair
> on redeploy requires re-registration (handled automatically).

---

## How to Add a New Agent

1. Create `agents/my-bot.js` extending `AgentBase`:

```js
import { AgentBase } from './shared/base.js';

const AGENT_ID = 'mybot-demo';

class MyBot extends AgentBase {
  constructor() {
    super(AGENT_ID);
    this.slug = process.env.DEMO_SLUG ?? null;
  }

  async run() {
    await this.init();

    if (!this.slug) {
      this.log('ERROR: DEMO_SLUG is required');
      process.exit(1);
    }

    // Override behaviour here:
    // - this.watchEvents(slug) for SSE
    // - this.pollInbox() for A2A messages
    // - this.sendA2A(targetId, contentType, payload) to notify peers

    this.log('Run complete.');
  }
}

const bot = new MyBot();
bot.run().catch((err) => {
  console.error(`[${AGENT_ID}] Fatal:`, err);
  process.exit(1);
});
```

2. Add a script entry in `package.json`:
```json
"mybot": "node agents/my-bot.js"
```

3. Spawn it from the orchestrator in `scripts/orchestrator.js` alongside the
   other agents.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLMTXT_API_KEY` | Yes | — | API key for all agent requests |
| `LLMTXT_API_BASE` | No | `https://api.llmtxt.my` | Override API base URL |
| `DEMO_SLUG` | Yes (non-writer) | — | Document slug to collaborate on |
| `DEMO_DURATION_MS` | No | `60000` | How long each agent runs (ms) |

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/seed.js` | Create a fresh demo document; prints `DEMO_SLUG=<slug>` |
| `scripts/orchestrator.js` | Start all agents with the configured slug |
| `scripts/t308-e2e-orchestrator.js` | T308 production verifier; spawns all 5 agents, captures metrics, exits with PASS/FAIL |
| `scripts/create-api-key.mjs` | Generate a new API key via the admin endpoint |
| `scripts/reset.js` | Tear down demo documents and agent state (dry-run by default) |
| `scripts/mesh-example.js` | P3.10 mesh demo: 3 CLEO agents on Unix sockets, no server required |

---

## P2P Mesh Demo (T422 — P3.10)

Demonstrates three CLEO-style agents collaborating via the LLMtxt P2P mesh
without any server connection. All sync happens over Unix sockets on the local
machine.

### Smoke Test

```bash
# From the monorepo root:
node apps/demo/scripts/mesh-example.js
# Expected output: RESULT: PASS (exit 0)
```

### What the demo does

1. Creates 3 `LocalBackend` instances, each with a separate SQLite database.
2. Generates a fresh Ed25519 keypair per agent (ephemeral, not persisted).
3. Starts a `SyncEngine` + `UnixSocketTransport` + `PeerRegistry` per agent.
4. Agents register their `.peer` files in a shared temp directory for discovery.
5. Each agent writes a "CLEO Task Spec" document with 3 sections (versions).
6. After a convergence window (12s), verifies each agent has its 3-version document.
7. Gracefully shuts down all engines, deregisters peer files, and cleans up temp dirs.

### Architecture

```
cleo-agent-1 ──[unix:/tmp/llmtxt-mesh-*.sock]──▶ cleo-agent-2
       │                                                │
       └────────────────────────────────────────────────┘
                       cleo-agent-3
```

- **Transport**: `UnixSocketTransport` with Ed25519 mutual handshake.
- **Discovery**: File-based (`PeerRegistry` reads `*.peer` files from shared temp dir).
- **Identity**: Per-agent Ed25519 keypair; `agentId = SHA-256(pubkey)`.
- **No server**: Zero requests to `api.llmtxt.my`.

### Note on cr-sqlite

Full CRDT changeset sync between agents requires `@vlcn.io/crsqlite` (Phase 2).
Without it, `LocalBackend` runs in local-only mode (`hasCRR=false`). The demo
still exercises the transport, discovery, and sync engine layers; only the
cr-sqlite changeset exchange is skipped (graceful degradation). When
`@vlcn.io/crsqlite` is available, agents will exchange full cr-sqlite changesets
and converge on shared database state.

---

## Known Limitations

See [`docs/demo/README.md#known-limitations`](../../docs/demo/README.md#known-limitations)
for the full list. Short version:

- **T380** — agents don't attach `X-Agent-Signature` on writes yet
- **T381** — agents use REST PUT, not the CRDT WebSocket endpoint
- **T382** — no pinned npm version for external contributors

These are tracked as Round 6 work items.
