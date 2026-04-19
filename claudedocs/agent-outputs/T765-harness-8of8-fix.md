# T765 Harness 8/8 Fix — T308 Cap 2 + Cap 7

**Date**: 2026-04-19
**Commit**: a520dba03d5681098ed6951ad8183bdb9356db67
**Tasks completed**: T769 (Cap 2), T771 (Cap 7)

## Summary

Two harness bugs prevented T308 from reaching 8/8 capability checks:

| Cap | Root cause | Fix |
|-----|-----------|-----|
| Cap 2 (crdt_bytes=0) | Observer-bot hardcoded `['introduction','architecture','multi-agent']` but writer-bot also writes to `'getting-started'` — mismatch caused zero CRDT subscriptions to active sections | Dynamic section discovery: `_discoverSections()` fetches `GET /documents/:slug` (+ `/sections` fallback) on startup; `section.created` SSE handler subscribes to late-arriving sections |
| Cap 7 (quorum=false) | Orchestrator spawned 1 consensus-bot; BFT quorum requires 3 distinct approvers (f=1, quorum=2f+1=3) | Orchestrator spawns 3 bots with `AGENT_ID=consensus-bot-{1,2,3}` and `CONSENSUS_BFT_F=1`; each generates its own Ed25519 keypair under `~/.llmtxt/demo-agents/<id>.key` |

## Files Changed

- `/mnt/projects/llmtxt/apps/demo/agents/observer-bot.js`
  - Replaced `const OBSERVED_SECTION_IDS = [...]` (hardcoded) with `let OBSERVED_SECTION_IDS = []` (dynamic)
  - Added `_discoverSections()`: fetches document metadata to populate section list at startup
  - Added `_subscribeSingleSection(sectionId)`: factored subscription logic out of `_initCrdtObservers()` so both startup and SSE-triggered subscriptions share the same code
  - Updated `_initCrdtObservers()`: delegates to `_subscribeSingleSection()` per section
  - Added `section.created` SSE handler in the event loop to subscribe to sections created after observer connects

- `/mnt/projects/llmtxt/apps/demo/agents/consensus-bot.js`
  - `AGENT_ID` now reads from `process.env.AGENT_ID ?? 'consensusbot-demo'`
  - `BFT_F` now reads from `process.env.CONSENSUS_BFT_F ?? 1` (default f=1, quorum=3)
  - Entry point error message uses dynamic `AGENT_ID`

- `/mnt/projects/llmtxt/apps/demo/scripts/t308-e2e-orchestrator.js`
  - Spawns 3 consensus-bots with distinct `AGENT_ID` and `CONSENSUS_BFT_F=1`
  - Total agent count: 7 (was 5)
  - Capability checks updated: added `quorum_reached` (approvals >= 3) and `crdt_bytes_nonzero`
  - Total checks now 8 to match T308 8/8 target

## Capability Check Mapping (8 checks)

| Check | Cap # | Resolved by |
|-------|-------|-------------|
| `signed_writes_ge_20` | Cap 1 | Writer-bot existing behavior |
| `bft_approval_ge_1` | Cap 5 | Existing + 3-bot fix |
| `quorum_reached` | Cap 7 | 3 consensus-bots (T771) |
| `events_ge_30` | Cap 4 | Existing behavior |
| `a2a_messages_ge_3` | Cap 6 | Existing behavior |
| `hash_chain_valid` | Cap 3 | Existing behavior |
| `crdt_bytes_nonzero` | Cap 2 | Dynamic section discovery (T769) |
| `all_agents_completed` | Cap 8 | All 7 agents exit cleanly |

## Evidence

- `implemented`: commit `a520dba`, files above
- `testsPassed`: 17/17 unit tests pass (`node --test tests/agents.test.js`)
- `qaPassed`: `node --check` passes all 3 modified files (owner override — no biome/tsc in workspace)

## Non-negotiables Verified

- 3 bots use 3 DISTINCT keypairs: each `AGENT_ID` → unique key file under `~/.llmtxt/demo-agents/<id>.key`
- Observer section discovery is fully dynamic — 0 hardcoded section names remain
- Commit is atomic (single commit covers both fixes)
- Pushed to main at `a520dba`
- 17/17 tests pass after changes
