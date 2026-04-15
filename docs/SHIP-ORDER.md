# LLMtxt Ship Order — Dependency Waves

> **Guiding Star**: No agent should ever lose work, duplicate work, or act on stale information.
>
> **Source**: `docs/RED-TEAM-ANALYSIS.md` → `docs/VISION.md` Phases 5-11 → 32 CLEO epics (T076-T110).

## Dependency Graph

```
FOUNDATIONAL (must precede every other Phase 5-11 epic):
└── T111 SDK-First Refactor (Wave A crypto fixes — 1-2 weeks)
       │
       └── once stable, Phase 5-11 work proceeds against proven SSoT contract

CRITICAL-PATH ROOT DEPS (no blockers, but inherit T111+T112 contract):
├── T076 Verifiable Agent Identity ─────┬──── T085 API Key Scopes
│                                       ├──── T086 Signing Key Rotation ───┬── T106 Signed Receipts
│                                       │                                  └── T107 Tamper-Evident Audit
│                                       ├──── T087 Capability Manifest
│                                       └──── T105 Agent Reputation
│
├── T077 External Event Bus ────────────┬──── T078 Cursor-Based Event Replay
│                                       ├──── T082 Differential Subscriptions
│                                       ├──── T109 Cost-Weighted Rate Limit
│                                       └──── T110 Distributed Rate Limit
│
├── T095 OpenAPI 3.1 Spec ──────────────── T097 Multi-Language SDKs
│
├── T102 Real Semantic Embeddings ──────── T103 Stored Embeddings (pgvector)
│
INDEPENDENT (parallel-ready):
├── T083 CRDT Section-Level Merge (Y.js)
├── T084 Presence & Turn-Taking
├── T088 Shared Scratchpad
├── T089 OpenTelemetry
├── T090 Secret Rotation & KMS
├── T091 Backup & DR
├── T092 Graceful Shutdown
├── T093 Remove Schema Reset Sentinel
├── T094 GDPR Data Export/Delete
├── T096 Native MCP Server
├── T098 CLI Tool
├── T099 llms.txt Standard Compliance
├── T100 Zstd Compression
├── T101 Multi-Tokenizer
├── T104 Streaming Responses (NDJSON)
└── T108 Red-Team P0 Security Remediation
```

## Wave Schedule

### Wave 0 — Emergency Fixes + SDK Foundation (ship next 2 weeks)

Priority: drop everything else until these land. Every day they stay open is risk.

| # | Epic | Why now |
|---|------|---------|
| T093 | Remove Schema Reset Sentinel | One misconfigured redeploy = total data loss |
| T108 | Red-Team P0 Security Remediation | Body-parser limit mismatch, ReDoS, graph DoS, default secret fail-fast |
| **T111** | **SDK-First Refactor (Wave A: HIGH crypto fixes)** | **22 SSoT violations found in audit; 4 are wire-critical crypto** |
| T112 | NAPI-RS Native Bindings | **DEFERRED 2026-04-15** — reactivate on benchmark evidence |

T111 is foundational because every Phase 5-11 epic specifies "X in crates/llmtxt-core, wrapped via WASM in packages/llmtxt." That contract must work before any new primitives ship. T111 first proves the existing primitives migrate cleanly. T112 (native bindings) was scoped as a parallel effort but is deferred pending benchmark evidence that WASM is a bottleneck on a hot-path operation.

### Wave 1 — Identity & Event Bus Foundation (6-8 week window)

Everything downstream depends on these. No other work.

| # | Epic | Gates |
|---|------|-------|
| T076 | Verifiable Agent Identity | Unlocks T085, T086, T087, T105 |
| T077 | External Event Bus | Unlocks T078, T082, T109, T110 |
| T090 | Secret Rotation & KMS | Prerequisite for production deploy of T076 |

### Wave 2 — Identity Buildout + Real-Time Depth (parallel with Wave 1 tail)

Can start as soon as T076/T077 merge.

| # | Epic | Depends | Why |
|---|------|---------|-----|
| T085 | API Key Scopes | T076 | Ship shipped claim actually works |
| T086 | Signing Key Rotation | T076 | Enables T106, T107 |
| T087 | Agent Capability Manifest | T076 | Orchestrators need it |
| T078 | Cursor-Based Event Replay | T077 | Agents reconnect without loss |
| T082 | Differential Subscriptions | T077 | Eliminate poll-after-notify |
| T110 | Distributed Rate Limiting | T077 | Multi-instance correctness |

### Wave 3 — CRDT + Coordination (biggest single differentiator)

This is the "multi-agent collaboration" claim made real.

| # | Epic | Why |
|---|------|-----|
| T083 | CRDT Section-Level Merge (Y.js) | THE gap. Auto-merge non-conflicting concurrent writes |
| T084 | Presence & Turn-Taking | Advisory locks, yield, presence |
| T088 | Shared Scratchpad | Ephemeral coordination channel |

### Wave 4 — Operational Maturity (ship alongside anything above)

| # | Epic | Why |
|---|------|-----|
| T089 | OpenTelemetry | Debugging is impossible without traces |
| T091 | Backup & DR | "Never lose work" requires recovery path |
| T092 | Graceful Shutdown | Deploys cause visible failures today |
| T094 | GDPR Export/Delete | Legal requirement |

### Wave 5 — Ecosystem Reach

| # | Epic | Depends | Why |
|---|------|---------|-----|
| T095 | OpenAPI 3.1 Spec | — | Unlocks T097 SDK generation |
| T096 | Native MCP Server | — | Every agent framework supports MCP |
| T097 | Multi-Language SDKs | T095 | Reach Python, Go, Rust communities |
| T098 | CLI Tool | — | GitOps, shell scripts, CI |
| T099 | llms.txt Compliance | — | Standard conformance |

### Wave 6 — Performance & Semantics

| # | Epic | Depends | Why |
|---|------|---------|-----|
| T100 | Zstd + Dictionary | — | 2-5× better compression on similar docs |
| T101 | Multi-Tokenizer | — | Honest token counts for non-GPT agents |
| T102 | Real Embeddings | — | Semantic consensus actually semantic |
| T103 | Stored Embeddings | T102 | pgvector cache |
| T104 | NDJSON Streaming | — | TTFB on large responses |
| T109 | Cost-Weighted Rate Limit | T077 | `/merge` ≠ `/health` in cost |

### Wave 7 — Byzantine Trust

| # | Epic | Depends | Why |
|---|------|---------|-----|
| T105 | Agent Reputation | T076 | Sybil resistance |
| T106 | Signed Receipts | T086 | Agents provably authored |
| T107 | Tamper-Evident Audit | T086 | Regulated-industry readiness |

## Size Distribution

| Size | Count | Wave spread |
|------|-------|------------|
| small | 10 | Spread across all waves |
| medium | 16 | Heavy in Waves 2, 5, 6 |
| large | 6 | Concentrated in Waves 1, 3 |

## Priority Distribution

| Priority | Count | Notes |
|----------|-------|-------|
| critical | 5 | T076, T077, T085, T093, T108 — any open >2 weeks is tech debt |
| high | 10 | Waves 2, 4 core |
| medium | 11 | Waves 3, 5, 6 |
| low | 6 | Waves 6, 7 — valuable but not blocking |

## Parallelism Windows

| Wave | Agents can run | Notes |
|------|----------------|-------|
| W0 | 2 in parallel | T093 + T108 independent |
| W1 | 3 in parallel | T076, T077, T090 fully independent |
| W2 | 6 in parallel | All depend only on W1 |
| W3 | 3 in parallel | All independent |
| W4 | 4 in parallel | All independent |
| W5 | 4 in parallel (then +1 after T095) | T097 depends on T095 |
| W6 | 5 in parallel (+1 after T102) | T103 depends on T102 |
| W7 | 3 in parallel | Sequential chain T076 → T086 → {T106, T107}, T105 parallel |

## Success Metrics Per Phase

| Phase | Metric | Baseline | Target |
|-------|--------|----------|--------|
| 5 (Identity) | Sybil-attack resistance | 0% | 100% writes signature-verified |
| 6 (Real-time) | Event loss under reconnect | 100% | 0% |
| 6 (Real-time) | Cross-instance delivery | 0% | 100% within 500ms |
| 7 (CRDT) | Silent write loss on concurrent edit | 100% LWW | 0% for different sections; resolved for same |
| 8 (Ops) | Deploys with user-visible failures | Unmeasured | <1% (canary rollout) |
| 8 (Ops) | RTO | Undefined | ≤1 hour |
| 9 (Ecosystem) | Languages with SDKs | 1 | 4 (TS, Py, Go, Rust) |
| 9 (Ecosystem) | MCP clients compatible | 0 | Claude Desktop + Cursor verified |
| 10 (Perf) | Compression ratio improvement | 1.0× zlib | ≥1.5× zstd+dict |
| 10 (Perf) | Token count accuracy (non-GPT) | 80% | 99% |
| 11 (Trust) | Client-verifiable writes | 0% | 100% with receipts |
| 11 (Trust) | Audit tampering detection | N/A | 100% detection rate |

## Anti-Goals (things NOT on the roadmap, and why)

| Not-goal | Why excluded |
|----------|-------------|
| Agent runtime / execution engine | LLMtxt is a content substrate, not a runtime |
| Binary file storage | Out of scope; signed-URL S3 redirection is enough |
| OT-based live cursors | CRDT (T083) handles the hard case; cursors are UX polish |
| Messaging / chat protocol | Not the role; slugs are passed *by* messaging systems |
| Built-in LLM inference | Embedding provider is the only ML integration |
| Consensus as literal blockchain | Reputation + signed receipts is sufficient; don't burn trees |

## Wave 0+ from 2026-04-15 Red-Team Analysis

> **Source**: `docs/RED-TEAM-ANALYSIS-2026-04-15.md` § Dependency Order and § Layer-by-Layer Feature Catalog
>
> This section refines the Wave sequence below, mapping to the 6-layer roadmap (Layers 1–6, Waves W0–W6).

### Dependency Tree (Refined 2026-04-15)

**Three-root dependency structure:**

```
LAYER 1 ROOTS (Multi-Agent Foundations):
  ├── MA-1: CRDT ──────┬─→ MA-4 (presence), MA-6 (diff subs), DIFF-1, DIFF-7
  │                   └─→ MA-9 (scratchpad), MA-10 (direct message)
  │
  ├── MA-2: Verified Identity ──┬─→ MA-3 (capability manifest), MA-8 (Byzantine)
  │                             ├─→ SEC-3 (tamper-evident), T086 (key rotation)
  │                             └─→ T105 (reputation)
  │
  └── MA-7: Event Ordering ─┬─→ MA-4, MA-6, MA-9, OPS-1 (trace correlation)
                           └─→ SEC-4 (webhook delivery)

LAYER 2 ROOTS (Ops Reliability):
  ├── OPS-1: Observability ──────→ OPS-4 (SLI), OPS-8 (chaos), troubleshooting flows
  ├── OPS-6: Migration Safety CI ──→ all future schema work
  └── OPS-2/3: Backup/Replication ──→ COMP-2 (residency)

LAYER 3 ROOTS (Security):
  ├── SEC-3: Tamper-Evident ──→ depends on MA-2 (signatures)
  └── SEC-5: RLS ──→ already using PostgreSQL (shipped in Phase 2)
```

**Cross-layer dependencies:**

| Feature | Root dependencies | Why order matters |
|---------|------------------|---|
| MA-4 (presence) | MA-1 + MA-7 | CRDT + event log required to track presence diffs |
| MA-6 (diff subs) | MA-1 + MA-7 | CRDT + event log required to compute deltas |
| DIFF-1 (truly differential disclosure) | MA-6 + DIFF-2? | Subscribers need CRDT changes + optionally embeddings |
| T085 (API scopes) | MA-2 (identity) | Know WHO before enforcing scope |
| T086 (key rotation) | MA-2 (identity) | Build on signature infrastructure |
| SEC-3 (tamper-evident) | MA-2 + MA-7 | Need signatures (MA-2) and event monotonicity (MA-7) |
| COMP-1 (SOC2) | OPS-1, OPS-2, SEC-3, SEC-7 | Control inventory after ops + security foundation |

### Wave Schedule — Refined 2026-04-15

| Wave | Epics | Dependency reason | Ship window |
|------|-------|---|---|
| **W0** | T093 (schema-reset removal), T108 (P0 security), OPS-1 (observability MVP), OPS-6 (migration CI), OPS-7 (release discipline) | Cannot ship anything safely. Observability required for debugging Wave 1. Migration safety required before any schema change. Release discipline required before publishing. T093 removes production footgun. | Week 1–2 |
| **W1** | MA-1 (CRDT), MA-2 (verified identity), MA-7 (event ordering), T076, T077, T090 (secrets), OPS-10 (rotation runbook) | Three pillars: CRDT + identity + event log. Everything downstream depends on these. Secret rotation prerequisite before shipping identity in production. | Week 3–10 |
| **W2** | MA-3 (capability manifest), T085 (scope enforcement), MA-4 (presence), MA-6 (diff subs), T082 (differential subscriptions), T078 (cursor-based replay), T110 (distributed rate limit), SEC-8 (scope enforcement) | All depend on W1 roots (MA-1, MA-2, MA-7). Can parallelize. Order within W2: T085/SEC-8 first (simple, unlocks developer trust), then MA-4/MA-6 (complex, need all W1 roots). | Week 10–16 |
| **W3** | MA-5 (turn-taking), MA-9 (scratchpad), MA-10 (direct messaging), SEC-1 (CSP), SEC-2 (XSS hardening), SEC-4 (webhook hardening), SEC-5 (RLS), SEC-6 (anon threat model) | Coordination features (MA) now have foundation (W1). Security hardening (SEC) applies post-foundation. All independent in W3. | Week 17–22 |
| **W4** | OPS-2 (backup), OPS-3 (replication), OPS-5 (graceful shutdown), OPS-8 (chaos), OPS-9 (load tests), SEC-7 (PII/GDPR), COMP-4 (right-to-delete) | Ops maturity and legal readiness. Can run in parallel; no hard ordering. | Week 23–28 |
| **W5** | T095 (OpenAPI), DX-1–7 (SDK, CLI, examples, docs), DIFF-7 (time-travel), T096 (MCP), T098 (CLI), T099 (llms.txt) | DX-1 (OpenAPI) gates T097 (SDK generation). Others parallel. Focus: publish the platform as-is post-W1. | Week 29–36 |
| **W6** | DIFF-2 (embeddings), DIFF-3 (graph), DIFF-4 (suggestions), DIFF-5 (operational diff), DIFF-6 (federation), DIFF-8 (LLM compression), COMP-1–5 (SOC2, residency, retention, DPA) | Advanced semantics + compliance. All depend on W1 (identity, CRDT, events) being proven. | Week 37–48 |

### Risk & Contingency

| Risk | Mitigation |
|------|-----------|
| W1 takes longer than 8 weeks | Parallelize MA-1, MA-2, MA-7 strictly; hire for CRDT expertise if needed; consider Y.js community support |
| MA-1 (CRDT) scope creeps | Scope MA-1 to section content only; defer presence cursors to MA-4; defer branching logic to DIFF-7 |
| W0 observability MVP too thin | Start with Pino → Loki only; defer Sentry + full OTel to W4 |
| Deploy safety (W0) insufficient | Add migration dry-run to CI; pre-deploy smoke tests; documented rollback playbook |

### Success Criteria Per Wave

| Wave | Success means | Validation |
|------|---|---|
| W0 | Observability is live; CI rejects duplicate migrations; release is auditable; T093 ships | Logs flow to Loki; CI enforces migration checks; 3x release with provenance; no data loss on deploy |
| W1 | CRDT auto-merges concurrent edits; agent identity is signature-verified; event log survives reconnect | Cargo tests + WASM tests pass; API gate enforces signature verification; WS subscribers recover from offset |
| W2 | Agents can see presence; API scopes are enforced; delta subscriptions work without full re-fetch | Agent presence test; scope violation returns 403; delta payload <50% of full section |
| W3 | Turn-taking prevents overlapping section claims; security headers are deployed; anon mode is bounded | Lease conflict detected; CSP blocks inline scripts; anon quota is enforced per RFC |
| W4 | Backup restore tested; chaos test kills DB and system recovers; GDPR export produces valid JSON | RTO ≤1hr measured; kill-DB test passes; export contains all user data; no orphaned records |
| W5 | OpenAPI spec is live; Python/Go SDKs are published; agents can list docs and diff sections via CLI | `/openapi.json` loads in Swagger; sdks on PyPI/pkg.go.dev; `llmtxt ls` and `llmtxt diff` work |
| W6 | Embeddings are live; docs can reference other docs; SOC2 gap list is public | Semantic diff shows similarity >0.8 for paraphrases; backlinks render; SOC2 roadmap published |
