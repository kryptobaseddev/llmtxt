# LLMtxt Ship Order — Dependency Waves

> **Guiding Star**: No agent should ever lose work, duplicate work, or act on stale information.
>
> **Source**: `docs/RED-TEAM-ANALYSIS.md` → `docs/VISION.md` Phases 5-11 → 32 CLEO epics (T076-T110).

## Dependency Graph

```
FOUNDATIONAL (must precede every other Phase 5-11 epic):
├── T111 SDK-First Refactor (Wave A crypto fixes — 1-2 weeks)
└── T112 NAPI-RS Native Bindings (parallel with T111)
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
| **T112** | **NAPI-RS Native Bindings** | **Establishes NAPI alongside WASM before Wave B refactors land — same Rust source, two binding outputs** |

T111 and T112 are foundational because every Phase 5-11 epic specifies "X in crates/llmtxt-core, wrapped via WASM/NAPI in packages/llmtxt." That contract must work before any new primitives ship. T111 first proves the existing primitives migrate cleanly; T112 ensures Node consumers (apps/backend) get native speed.

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
