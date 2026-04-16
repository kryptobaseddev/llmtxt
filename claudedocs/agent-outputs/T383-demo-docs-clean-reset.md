# T383 — Demo Docs + Clean-Reset

**Status:** Complete  
**Date:** 2026-04-16

## Deliverables

All 7 deliverables shipped.

### 1. `docs/demo/README.md`

Top-level demo overview with:
- 8-capability table with PASS/FAIL from T308 Final Run 5
- ASCII architecture diagram: orchestrator -> 5 agents -> api.llmtxt.my -> Postgres/Redis -> observability -> /demo page
- Quick start (observer mode: visit www.llmtxt.my/demo)
- Developer mode setup (env vars, seed.js, orchestrator)
- Observability links (Grafana, GlitchTip, Tempo, Loki)
- Known limitations (T380/T381/T382)

### 2. `docs/demo/clean-reset.md`

Teardown + re-seed procedure:
- When to reset (fresh demo, between runs, after state corruption)
- What gets reset (documents by slug prefix, A2A inbox, nonces; FK cascade covers child tables)
- How to run (`node apps/demo/scripts/reset.js`)
- Prerequisites (DATABASE_URL)
- Manual psql fallback commands

### 3. `apps/demo/scripts/reset.js`

Executable reset script:
- Reads `DATABASE_URL` env var (required)
- `--help` flag prints usage and examples
- Default mode is DRY-RUN (counts only, no mutations)
- `--execute` flag required to actually delete
- `--yes` skips confirmation prompt
- `--slug-prefix=<prefix>` overrides default `demo-` prefix
- Handles T308 known slugs (`AitP8qCx`, `ETlHNZ45`, `1jg483oR`) automatically
- Deletes in FK-safe order: `DELETE FROM documents` (cascade) -> inbox -> nonces
- Logs row counts per table
- Exits 0 on success, 1 on error
- `postgres` added to `apps/demo/package.json`

### 4. `apps/demo/README.md`

Developer-facing agent architecture:
- All 5 agents described (WriterBot, ReviewerBot, ConsensusBot, SummarizerBot, ObserverBot)
- AgentBase method table
- Ed25519 key persistence explained
- How to add a new agent (code template)
- Environment variables reference
- Scripts reference table
- Known limitations link

### 5. `apps/docs/content/docs/demo/getting-started.mdx` + `meta.json`

Fumadocs public docs page:
- 5/8 capability table
- Observer mode quick-start
- Developer mode steps
- Clean reset instructions
- Links to full docs

### 6. `apps/docs/content/docs/multi-agent/live-demo.mdx` (updated)

- Title updated: "4-Agent" -> "5-Agent Collaboration"
- 5/8 capability status table added at top
- Round 6 roadmap links (T380/T381/T382)
- Links to new getting-started page

### 7. `docs/ops/CREDENTIALS.md` — Demo Agents section

- Key generation via `@noble/ed25519`
- Persistence paths (local dev vs Railway)
- Rotation procedure
- API key generation + Railway deployment instructions
- No secrets committed policy confirmation

## Validation

- `node apps/demo/scripts/reset.js --help` exits 0, prints usage
- `node apps/demo/scripts/reset.js` (no DATABASE_URL) exits 1, helpful error
- No real secrets in any committed file
- All 8 output files exist on disk
