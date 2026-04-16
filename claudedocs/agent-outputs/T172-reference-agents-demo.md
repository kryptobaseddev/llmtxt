# T172: Reference Agent Implementations — Live Demo

**Status**: complete
**Date**: 2026-04-15

---

## Summary

Four reference agent implementations plus a live demo frontend page were delivered for T172.
All code uses only the public `llmtxt` SDK — no internal backend imports.
12/12 unit tests pass. 0 TypeScript errors in the frontend.

---

## Deliverables

### C1: Four Agent Implementations + Shared Base (apps/demo/)

#### Shared base: `apps/demo/agents/shared/base.js`
- `AgentBase` class: per-agent Ed25519 keypair loaded from `~/.llmtxt/demo-agents/<id>.key`
- Pubkey registration (idempotent; 409 is tolerated)
- Signed fetch helper via `identity.buildSignatureHeaders`
- Document CRUD: `createDocument`, `updateDocument`, `getContent`, `getDocument`, `transition`
- BFT approval: `bftApprove` (signs canonical `slug\nagentId\nstatus\natVersion\ntimestamp`)
- Lease management: `acquireLease` / `releaseLease` via `LeaseManager` from SDK
- A2A envelope: `sendA2A` (signs `from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex`)
- A2A inbox: `pollInbox`
- Event streaming: `watchEvents` wraps `watchDocument` from SDK

#### `apps/demo/agents/writer-bot.js` — WriterBot
- Creates a Markdown document using `POST /api/v1/compress`
- Acquires advisory leases before each section edit
- Pushes 4 sections iteratively (Introduction, Architecture, Multi-Agent, Getting Started)
- Broadcasts DEMO_SLUG to stdout for orchestrator capture
- Sends A2A `request-summary` to SummarizerBot after each write
- Transitions document to REVIEW on completion

#### `apps/demo/agents/reviewer-bot.js` — ReviewerBot
- Watches event stream via `watchDocument` for `version_created` events
- Applies 3 critique rules: missing code examples, short sections, missing links
- Posts structured JSON comments to `/api/v1/documents/:slug/scratchpad`
- Sends `review-complete` A2A message to ConsensusBot with recommendation

#### `apps/demo/agents/consensus-bot.js` — ConsensusBot
- Polls A2A inbox for `review-complete` messages
- Counts approvals; quorum formula: 2f+1 (default f=0 → quorum=1)
- Submits BFT-signed approval via `POST /api/v1/documents/:slug/bft/approve`
- Checks BFT status and transitions document to APPROVED when quorum confirmed

#### `apps/demo/agents/summarizer-bot.js` — SummarizerBot
- Watches events + polls A2A inbox for `request-summary` messages
- Generates deterministic summary from headings and first sentences
- Acquires lease on `executive-summary` section before writing
- Upserts `# Executive Summary` heading in the document

#### `apps/demo/scripts/orchestrator.js`
- Spawns WriterBot first, waits for DEMO_SLUG from stdout
- Starts ReviewerBot, ConsensusBot, SummarizerBot in parallel with shared DEMO_SLUG
- Collects metrics from stdout: section edits, A2A messages, BFT approvals
- Validates: sectionEdits >= 5, a2a >= 3, approvals >= 1

#### `apps/demo/scripts/seed.js`
- Creates a fresh demo document and prints `DEMO_SLUG=<slug>` to stdout
- Used for pre-seeding before connecting frontend observer

### C2: Railway Deploy Config

#### `apps/demo/Dockerfile`
- Node 22 Alpine; multi-stage (deps → build → runtime)
- Compiles SDK TypeScript, copies demo scripts
- `CMD ["node", "scripts/orchestrator.js"]`

#### `apps/demo/railway.toml`
- Dockerfile builder, context = monorepo root
- `restartPolicyType = "on_failure"` — natural cron via Railway restart

### C3: Frontend /demo Page

#### `apps/frontend/src/routes/demo/+page.svelte`
Five-panel Svelte 5 page (read-only observer, no API key required):

1. **Document content** — raw Markdown updated on version events and every 10s
2. **Agent presence** — activity dots for all 4 agents, updated from event stream actor IDs
3. **Event feed** — last 20 events via manual SSE fetch (no EventSource)
4. **BFT consensus** — quorum progress bar + signed vote list
5. **A2A messages** — inter-agent request log

- Connects via `GET /api/v1/documents/:slug/events/stream` (SSE)
- Content saved to `localStorage['llmtxt:demo-slug']` for reconnect
- "Live Demo" nav link added to `+layout.svelte`

### C4: Docs + Tests

#### `apps/docs/content/docs/multi-agent/live-demo.mdx`
- Added to `meta.json` pages list
- Covers: 4 agents, identity flow, A2A format, local run, Railway deploy, frontend observer, design decisions (Mode A vs B)

#### `apps/demo/tests/agents.test.js`
- 12 tests using Node.js built-in test runner
- Mocks global `fetch` — no live API required
- Tests: identity generation + persistence, key reuse, document creation, BFT approval signing, A2A envelope construction, critique rules, section parsing, quorum math
- Result: 12/12 pass

---

## Verification Results

| Check | Result |
|-------|--------|
| `node --check` all agent scripts | Pass |
| `node --test tests/agents.test.js` | 12/12 pass |
| `pnpm --filter frontend check` | 0 errors, 12 pre-existing warnings |
| `pnpm install --filter demo` | Success |

---

## Files Created/Modified

New files:
- `/mnt/projects/llmtxt/apps/demo/package.json`
- `/mnt/projects/llmtxt/apps/demo/Dockerfile`
- `/mnt/projects/llmtxt/apps/demo/railway.toml`
- `/mnt/projects/llmtxt/apps/demo/agents/shared/base.js`
- `/mnt/projects/llmtxt/apps/demo/agents/writer-bot.js`
- `/mnt/projects/llmtxt/apps/demo/agents/reviewer-bot.js`
- `/mnt/projects/llmtxt/apps/demo/agents/consensus-bot.js`
- `/mnt/projects/llmtxt/apps/demo/agents/summarizer-bot.js`
- `/mnt/projects/llmtxt/apps/demo/scripts/orchestrator.js`
- `/mnt/projects/llmtxt/apps/demo/scripts/seed.js`
- `/mnt/projects/llmtxt/apps/demo/tests/agents.test.js`
- `/mnt/projects/llmtxt/apps/frontend/src/routes/demo/+page.svelte`
- `/mnt/projects/llmtxt/apps/docs/content/docs/multi-agent/live-demo.mdx`

Modified files:
- `/mnt/projects/llmtxt/apps/docs/content/docs/multi-agent/meta.json` (added live-demo)
- `/mnt/projects/llmtxt/apps/frontend/src/routes/+layout.svelte` (added nav link)
- `/mnt/projects/llmtxt/pnpm-lock.yaml` (updated by pnpm install)

---

## Known Limitations / Follow-up

1. **A2A events not in SSE stream**: The backend's event stream may not emit `a2a_message_sent` events — the A2A panel will show empty until T172 frontend wire-up is verified against live API. The agents send/poll A2A correctly; the frontend just won't display them unless the backend includes those event types in the SSE stream.

2. **BFT status endpoint shape**: The `GET /documents/:slug/bft/status` response shape is inferred from backend code; if the field names differ (e.g. `totalApprovals` vs `approvalCount`), the quorum bar may show 0 until reconciled with live API.

3. **Scratchpad endpoint**: ReviewerBot posts comments to `/api/v1/documents/:slug/scratchpad` — this endpoint must exist in the backend. If it returns 404, comments are logged as non-fatal errors.

4. **Mode B (browser WASM)**: Deferred as designed. The frontend page is already structured for Mode A (read-only observer). Mode B would require compiling llmtxt WASM for browser target and Web Worker wiring.
