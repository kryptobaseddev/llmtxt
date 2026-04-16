# LLMtxt Demo — Overview

> Last updated: 2026-04-16
> Status: 5/8 capabilities verified in production (T308 Final Run 5).

---

## What the Demo Proves

The demo is a live multi-agent collaboration experiment running against the
production API (`api.llmtxt.my`). It exercises eight capabilities:

| # | Capability | Status (as of 2026-04-16) |
|---|-----------|--------------------------|
| 1 | Signed writes + X-Server-Receipt | PARTIAL-FAIL — receipt header confirmed; agent-side Ed25519 signing incomplete (T380) |
| 2 | CRDT convergence via Y.js WebSocket | FAIL — agents use REST PUT; CRDT WS integration pending (T381) |
| 3 | Event log with SHA-256 hash chain | PASS — 105 events, chain validated intact |
| 4 | Presence tracking (5 agents visible) | PASS — 47 presence updates observed |
| 5 | Advisory leases (section-level concurrency) | PASS — 3 section leases acquired and released without conflicts |
| 6 | Differential subscriptions via SSE | PASS — SSE stream live; 105 events in 241 seconds |
| 7 | BFT quorum (Ed25519-signed approval) | FAIL — pending T380 (agent signing) |
| 8 | A2A messaging (signed envelopes) | PASS — 3 A2A messages delivered; trigger-response chain confirmed |

**Self-hosted observability** is also demonstrated: Grafana, Prometheus, Tempo,
Loki, and GlitchTip run as Railway services and instrument every demo run.

---

## Architecture

```
                    ┌──────────────────────────┐
                    │   orchestrator.js          │
                    │   (scripts/)               │
                    └────────────┬─────────────┘
                                 │ spawn
          ┌──────────────────────┼───────────────────────┐
          │                      │                       │
    ┌─────▼─────┐   ┌────────────▼──────┐   ┌──────────▼──────────┐
    │ WriterBot  │   │   ReviewerBot      │   │   ConsensusBot       │
    │            │   │                    │   │                      │
    │ - creates  │   │ - watches SSE      │   │ - polls A2A inbox    │
    │   document │   │ - posts comments   │   │ - submits BFT vote   │
    │ - acquires │   │ - sends A2A        │   │ - transitions doc    │
    │   leases   │   │   to ConsensusBot  │   │   to APPROVED        │
    │ - sends A2A│   └────────────────────┘   └──────────────────────┘
    │   to       │
    │ Summarizer │   ┌────────────────────┐   ┌──────────────────────┐
    └────────────┘   │  SummarizerBot     │   │   ObserverBot         │
                     │                    │   │                       │
                     │ - watches events   │   │ - SSE event stream    │
                     │ - polls A2A inbox  │   │ - validates hash chain│
                     │ - upserts summary  │   │ - emits JSON metrics  │
                     │   section          │   │                       │
                     └────────────────────┘   └──────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │   api.llmtxt.my         │
                    │   (REST + SSE + WS)     │
                    └────────────┬───────────┘
                                 │
                    ┌────────────▼───────────┐
                    │   Postgres + Redis      │
                    │   (Railway-hosted)      │
                    └────────────┬───────────┘
                                 │
              ┌──────────────────┼──────────────────────┐
              │                  │                       │
        ┌─────▼─────┐    ┌───────▼──────┐   ┌──────────▼──────┐
        │  Grafana   │    │  Tempo        │   │  Loki + GlitchTip│
        │  dashboards│    │  (traces)     │   │  (logs + errors) │
        └────────────┘    └──────────────┘   └─────────────────┘
                                 │
                    ┌────────────▼───────────┐
                    │  www.llmtxt.my/demo     │
                    │  (read-only observer)   │
                    └────────────────────────┘
```

---

## Quick Start — Observer Mode

Visit **https://www.llmtxt.my/demo** — no setup required.

The page shows five live panels:

1. **Document content** — raw Markdown updated on each new version
2. **Agent presence** — activity dots updated from SSE actor IDs
3. **Event feed** — last 20 events via SSE, no page refresh needed
4. **BFT consensus** — quorum progress bar + signed vote list
5. **A2A messages** — inter-agent request log

If the demo is not actively running, restart it via the Railway dashboard:
`llmtxt-demo-agents` service → **Restart** (a new orchestration cycle begins).

You can also trigger a run manually:
```bash
# Seed a fresh document
LLMTXT_API_KEY=<your_key> node apps/demo/scripts/seed.js
# Output: DEMO_SLUG=<8-char-slug>

# Run the orchestrator against it
LLMTXT_API_KEY=<your_key> DEMO_SLUG=<slug> node apps/demo/scripts/orchestrator.js
```

---

## Run Locally — Developer Mode

### Prerequisites

- Node.js 22+
- pnpm
- An API key from api.llmtxt.my

### Setup

```bash
# 1. Install dependencies (from monorepo root)
pnpm install

# 2. Generate or retrieve a demo API key
LLMTXT_API_KEY=<admin_key> node apps/demo/scripts/create-api-key.mjs

# 3. Seed a fresh demo document
cd apps/demo
LLMTXT_API_KEY=<key> node scripts/seed.js
# Output: DEMO_SLUG=AitP8qCx

# 4. Run all 5 agents via the orchestrator
LLMTXT_API_KEY=<key> DEMO_SLUG=AitP8qCx node scripts/t308-e2e-orchestrator.js

# 5. Watch agent logs stream to stdout
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLMTXT_API_KEY` | Yes | — | API key for all agent API calls |
| `LLMTXT_API_BASE` | No | `https://api.llmtxt.my` | Override API base URL |
| `DEMO_SLUG` | Yes (for orchestrator) | — | Document slug to collaborate on |
| `DEMO_DURATION_MS` | No | `60000` | How long each agent runs (ms) |

---

## Where to Look

### Grafana — Performance Dashboards

**URL:** https://grafana-production-85af.up.railway.app

Log in as `admin` (password in Railway → Grafana → `GF_SECURITY_ADMIN_PASSWORD`).

Key dashboards:
- **LLMtxt API** — request rate, latency p50/p99, error rate
- **Node.js** — heap, GC, event loop lag
- **Postgres** — query time, active connections

### GlitchTip — Error Tracking

**URL:** https://glitchtip-production-00c4.up.railway.app

Login: `admin@llmtxt.my` (see `docs/ops/CREDENTIALS.md` for current password).

Look for issues in the `llmtxt-backend` project. 5xx errors from agent runs
appear here within seconds.

### Tempo — Distributed Traces

Accessible via Grafana → Explore → Tempo datasource.

Use TraceQL to find agent requests:
```
{ .service.name = "llmtxt-api" && .http.route =~ "/api/v1/documents.*" }
```

### Loki — Log Aggregation

Accessible via Grafana → Explore → Loki datasource.

Query agent activity:
```
{service_name="llmtxt-api"} |= "writerbot-demo"
```

---

## Known Limitations

The following capabilities are not yet verified. They are tracked as roadmap
items and documented honestly here.

### T380 — Agents Do Not Sign Writes

Demo agents currently do not attach `X-Agent-Signature` headers to mutating
requests. The `AgentBase._fetch()` method has signature infrastructure but the
`buildSignatureHeaders` path is not wired for all PUT requests. This causes:

- Capability 1 (signed writes) to fail the `signedWritesObserved >= 20` check
- Capability 7 (BFT quorum) to fail because signature verification is a
  prerequisite for the server to accept BFT approval payloads from agents

**Coming in Round 6.** See task T380.

### T381 — Agents Do Not Use CRDT WebSocket

WriterBot and ReviewerBot update documents via REST `PUT /api/v1/documents/:slug`.
The CRDT collaborative editing endpoint (`/api/v1/documents/:slug/sections/:id/collab`)
is operational but not wired into the agent write path. As a result:

- `section_crdt_states` and `section_crdt_updates` accumulate zero rows during demo runs
- Capability 2 (CRDT convergence) fails

**Coming in Round 6.** See task T381.

### T382 — No Versioned SDK Published for Demo

The demo agents use `llmtxt: workspace:*` (monorepo local). A published npm
version pinned to the demo's tested release would enable external contributors
to run the demo without cloning the full monorepo.

**Coming in Round 6.** See task T382.
