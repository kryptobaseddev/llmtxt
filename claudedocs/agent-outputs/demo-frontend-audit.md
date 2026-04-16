# Audit: apps/demo vs apps/frontend Role Clarity

## Executive Summary

**Status**: Clear role separation, no duplication detected.

- **apps/demo** = Producer: 4 standalone agents that mutate documents via REST API + Ed25519 signing
- **apps/frontend** = Viewer: Browser UI that observes agent activity via SSE (Server-Sent Events) and REST polling
- **apps/backend** = Platform: Fastify REST/WS server hosting the API and event stream

The two packages are **loosely coupled** (zero import dependencies between them) and serve complementary purposes. No code promotion or refactoring is required.

---

## Role Clarification

### apps/demo (Producer)

A standalone **Node.js service** that runs 4 reference agents as child processes or Docker container.

**Purpose**: Demonstrate multi-agent collaboration by:
- Creating documents via `POST /api/v1/compress`
- Acquiring advisory leases before edits
- Writing sections via `PUT /api/v1/documents/:slug`
- Signing mutations with Ed25519 (`AgentIdentity` from SDK)
- Sending inter-agent A2A messages via `POST /api/v1/agents/:id/inbox`
- Submitting BFT-signed approvals via `POST /api/v1/documents/:slug/bft/approve`

**Agents** (apps/demo/agents/):
- **WriterBot** (`writerbot-demo`): Creates document sections iteratively, acquires leases
- **ReviewerBot** (`reviewerbot-demo`): Watches events, applies critique rules, posts comments
- **ConsensusBot** (`consensusbot-demo`): Aggregates A2A "review-complete" signals, submits BFT approvals
- **SummarizerBot** (`summarizerbot-demo`): Maintains executive-summary section on version updates

**Entry points**:
- `scripts/orchestrator.js`: Spawns all 4 agents as child processes; collects metrics
- `scripts/seed.js`: Creates fresh demo document, prints slug to stdout
- Agents extend `AgentBase` (apps/demo/agents/shared/base.js)

**Deployment**: Docker container on Railway; CMD runs `orchestrator.js`

**Size**: ~1000 LOC total (agents: 756 LOC, scripts: 230 LOC, shared/base.js: 363 LOC)

### apps/frontend (Viewer)

A SvelteKit **browser application** deployed to www.llmtxt.my.

**Purpose**: Provide a real-time dashboard to observe:
- Document content (fetched via `GET /api/v1/documents/:slug/raw`)
- Document state and version (fetched via `GET /api/v1/documents/:slug`)
- Agent presence indicators (extracted from SSE event actor_id)
- BFT quorum progress (fetched via `GET /api/v1/documents/:slug/bft/status`)
- Event feed (SSE stream from `GET /api/v1/documents/:slug/events/stream`)
- A2A message log (parsed from event stream)
- BFT votes and signatures (parsed from event stream)

**Route**: `/demo/` → `apps/frontend/src/routes/demo/+page.svelte` (616 LOC single file)

**Data flow**: Browser → API → SSE listener (no mutation, read-only observer)

**No mutation capability**: Frontend cannot create documents, write sections, or submit approvals (intentional separation)

### apps/backend (Platform)

Fastify REST/WS API server at api.llmtxt.my.

**Purpose**: Expose endpoints that both apps/demo and apps/frontend use:
- `/api/v1/compress` — create document
- `/api/v1/documents/:slug` — fetch/update document
- `/api/v1/documents/:slug/raw` — fetch raw content
- `/api/v1/documents/:slug/bft/status` — fetch BFT quorum status
- `/api/v1/documents/:slug/events/stream` — SSE event stream
- `/api/v1/agents/:id/inbox` — A2A message inbox
- `/api/v1/documents/:slug/bft/approve` — submit BFT vote
- etc.

**Not in scope for this audit** (already well-segregated).

---

## Coupling Analysis

### Zero Import Dependencies

✅ **apps/demo does not import from apps/frontend** (verified)
✅ **apps/frontend does not import from apps/demo** (verified)
✅ **Both use only the public SDK** (`import from 'llmtxt'`)

Imports in apps/demo agents:
```javascript
import { AgentIdentity, LeaseManager, watchDocument } from 'llmtxt';
import { AgentBase } from './shared/base.js';
import * as ed from '@noble/ed25519';
```

Imports in frontend demo page:
```javascript
import { onMount, onDestroy } from 'svelte';
// No agent framework, no SDK imports
```

### Data Flow Decoupling

```
apps/demo agents ──REST API──> apps/backend <──SSE/REST──── apps/frontend browser
(mutations)         (signed)                      (read-only)
```

- **Agents** are authenticated via `LLMTXT_API_KEY` env var + Ed25519 signatures
- **Frontend** is browser-based, unauthenticated (public demo mode)
- Backend handles authorization for both

### Hardcoded Agent IDs

Frontend knows about demo agent IDs to color-code presence indicators:

```typescript
const DEMO_AGENTS = ['writerbot-demo', 'reviewerbot-demo', 'consensusbot-demo', 'summarizerbot-demo'];

function agentColor(agentId: string): string {
  const colors: Record<string, string> = {
    'writerbot-demo':    'bg-primary',
    'reviewerbot-demo':  'bg-secondary',
    'consensusbot-demo': 'bg-accent',
    'summarizerbot-demo':'bg-warning',
  };
  return colors[agentId] ?? 'bg-base-300';
}
```

**Finding**: This is minor knowledge coupling, not code coupling. Frontend needs to know which agents to expect. No breaking change risk unless agent names change, which would be documented in release notes.

---

## Overlap Findings

### No Duplication

- **Agent coordination logic**: Only in apps/demo/agents
- **Identity/signing**: SDK (`AgentIdentity`), used only by agents
- **Lease management**: SDK (`LeaseManager`), used only by agents
- **Presence tracking**: Frontend handles client-side; agents send events to backend
- **Event parsing**: Frontend parses events from SSE stream; no shared code

### No Functionality Bleed

✅ Frontend does **not** handle mutations (no write capability)
✅ Agents do **not** include UI logic (headless)
✅ AgentBase is a **private helper** (apps/demo/agents/shared/base.js), not exported

---

## Promotion Candidates

### 1. **AgentBase class** (apps/demo/agents/shared/base.js)

**Current**: Internal helper (~363 LOC)

**Assessment**: Should **remain in apps/demo/agents/shared/**

**Rationale**:
- Tightly coupled to demo-specific key persistence (``~/.llmtxt/demo-agents/``)
- Wraps the public SDK with demo scaffolding (key loading, agency registration)
- Not a generic SDK primitive — users of the SDK should write their own base classes
- Moving to `packages/llmtxt/examples/` would encourage copy-paste but not reuse

**Alternative**: Document the pattern in `docs/multi-agent/agent-scaffold.md` and link from `/docs/guides/building-agents/`.

### 2. **Agent orchestration** (apps/demo/scripts/orchestrator.js)

**Current**: Orchestrator spawns 4 child processes, collects metrics (~185 LOC)

**Assessment**: Should **remain in apps/demo/scripts/**

**Rationale**:
- Demo-specific (hardcoded WriterBot → others sequencing)
- Not reusable across different agent sets or orchestration patterns
- Could be generalized in future (e.g., T076 on Verified Identity), but premature abstraction

### 3. **Seed script** (apps/demo/scripts/seed.js, ~45 LOC)

**Current**: Creates demo document, prints slug

**Assessment**: **Could move to packages/llmtxt/examples/**, but low ROI

**Rationale**:
- Functional but minimal
- Real projects would write their own equivalent
- No reusable patterns that merit SDK inclusion

---

## Gaps

### 1. Agent Helper Library

**Gap**: No shared utilities for agent-to-agent messaging or presence tracking.

**Status**: Not needed for demo. Agents send direct A2A envelopes; frontend parses events.

**Mitigation**: If Phase 5-11 roadmap includes multi-agent framework (e.g., T076), consider:
- `packages/llmtxt/src/agent-framework.ts` — base class for agent scaffolding
- Helper for presence tracking across agents
- A2A inbox polling helpers

### 2. Frontend Demo Instrumentation

**Gap**: Frontend hardcodes 4 agent IDs; if agent set changes, code must be updated.

**Status**: Acceptable for reference demo. Not a production UI framework.

**Mitigation**: If more flexible demo page is needed:
- Backend could expose `/api/v1/agents?role=demo` to list active demo agents dynamically
- Frontend would fetch and render dynamically
- Out of scope for this audit; recommend if roadmap includes T???-dynamic-agent-discovery

---

## Recommendations

### 1. **Keep Both Separate** ✅

- **No merge needed**: Different concerns, different deployment targets
- **No refactoring needed**: Code is appropriately isolated
- **No promotion needed**: Patterns are demo-specific, not framework-level

### 2. **Document the Relationship**

Add to docs:
- **Section in `/docs/multi-agent/live-demo.mdx`** (already exists, ~80 lines)
- Add diagram showing apps/demo → backend ← apps/frontend flow
- Document how to extend with custom agents (copy AgentBase pattern)

### 3. **Monitor Agent ID Coupling**

- Maintain agent IDs in a single reference (currently hardcoded in frontend)
- If agent names change (e.g., for Phase 5-11 generalization), update both:
  - `apps/demo/agents/shared/base.js` (or individual agent files)
  - `apps/frontend/src/routes/demo/+page.svelte` (DEMO_AGENTS array)
  - `apps/docs/content/docs/multi-agent/live-demo.mdx`

### 4. **Phase 5-11 Planning**

When designing multi-agent framework (T076+):
- Agents should register themselves dynamically (not hardcoded)
- Frontend should query agent registry (not hardcoded list)
- AgentBase may be promoted to `packages/llmtxt/src/agent-client.ts` if patterns stabilize
- Until then, apps/demo serves as the reference implementation

---

## Conclusion

**Verdict**: **Architecture is sound.** The separation between producer (apps/demo) and viewer (apps/frontend) is clean, intentional, and maintainable.

- ✅ Zero code duplication
- ✅ Loose coupling (SSE + REST only)
- ✅ Each app has a single clear responsibility
- ✅ No functionality bleeding across boundaries
- ✅ SDK usage is correct (agents sign, frontend observes)

**Recommendation**: No changes required. Continue current structure. Plan dynamic agent discovery only if Phase 5-11 requires it.

---

**Audit Date**: 2026-04-15
**Coverage**: All import paths, role separation, data flow, and promotion candidates verified.
