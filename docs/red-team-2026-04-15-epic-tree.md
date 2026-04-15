# Red-Team 2026-04-15 Epic Tree

Generated from `docs/RED-TEAM-ANALYSIS-2026-04-15.md`. All ~48 epics created in CLEO.

## Wave Map

### W0 — Clear Blockers (ship before anything else)

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T144 | L2-Ops | OPS-6: Migration safety in CI | — |
| T145 | L2-Ops | OPS-1: Observability stack (Pino, OTel, Sentry, metrics) | — |

> Note: T108 (P0 security) was already created in prior session. Wired as dep for MA-8/SEC-3.
> Note: T093 (schema reset removal) was already shipped in the deploy fix.

---

### W1 — Multi-Agent Roots (three pillars everything else builds on)

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T146 | L1-MA | MA-1: CRDT Yrs Phase 2 — real-time deltas + WS sync | T083, T144, T145 |
| T147 | L1-MA | MA-2: Verified agent identity Phase 2 — Ed25519 signatures | T076, T144 |
| T148 | L1-MA | MA-7: Per-document monotonic event log with replay | T144, T145 |

---

### W2 — Presence + Diff (wire presence + delta subscription)

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T149 | L1-MA | MA-4: Presence + awareness (cursor positions, section focus) | T146, T148 |
| T150 | L1-MA | MA-5: Turn-taking section leases | T148 |
| T151 | L1-MA | MA-6: Differential subscriptions (?since=seq) | T146, T148 |
| T152 | L1-MA | MA-8: Byzantine resistance — multi-sig + tamper-evident chain | T108, T147 |
| T153 | L1-MA | MA-9: Shared scratchpad — per-section comments + threads | T148 |
| T154 | L1-MA | MA-10: Agent-to-agent direct messaging conduit | T147, T148 |
| T087 | L1-MA | MA-3: Agent Capability Manifest (EXISTING — addDepends T147) | T076, T147 |

---

### W3 — Security Hardening

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T162 | L3-Sec | SEC-1: CSP + HSTS + COEP headers | — |
| T163 | L3-Sec | SEC-2: Markdown XSS sanitization E2E fuzz | — |
| T164 | L3-Sec | SEC-3: Tamper-evident audit log — hash chain | T108, T147 |
| T165 | L3-Sec | SEC-4: Webhook delivery hardening (backoff, DLQ, replay protection) | — |
| T166 | L3-Sec | SEC-5: Row-level security (PostgreSQL RLS) | T085 |
| T167 | L3-Sec | SEC-6: Anonymous mode threat model | — |
| T168 | L3-Sec | SEC-7: PII handling + GDPR readiness | T147 |
| T085 | L3-Sec | SEC-8: API key scopes are real (EXISTING — dep T076) | T076 |

---

### W4 — DX + Spec

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T169 | L4-DX | DX-1: OpenAPI 3.1 spec auto-generated | T095 |
| T170 | L4-DX | DX-2: Multi-language SDKs Phase 2 (Python PyO3, Go codegen) | T097, T169 |
| T171 | L4-DX | DX-3: LLMtxt CLI for agents | T169 |
| T172 | L4-DX | DX-4: Reference agent implementations (4 bots) | T171, T147 |
| T173 | L4-DX | DX-5: Local dev — seed script, fixtures, fake-agents simulator | — |
| T174 | L4-DX | DX-6: Error message catalog | T169 |
| T175 | L4-DX | DX-7: Forge-ts TSDoc coverage gate | — |

---

### W4 (parallel) — Ops Reliability

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T155 | L2-Ops | OPS-2: Backup + PITR (Litestream S3) | T145 |
| T156 | L2-Ops | OPS-3: Replication / read replicas | T155 |
| T157 | L2-Ops | OPS-4: SLO/SLI definition | T145 |
| T092 | L2-Ops | OPS-5: Graceful shutdown + drain (EXISTING — addDepends T145) | T145 |
| T158 | L2-Ops | OPS-7: Strict release runbook | — |
| T159 | L2-Ops | OPS-8: Chaos + fault injection tests | T145, T148 |
| T160 | L2-Ops | OPS-9: Load tests + benchmarks | T145 |
| T161 | L2-Ops | OPS-10: Secret rotation runbook Phase 2 | T090 |

---

### W5 — Advanced Diff + Search

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T176 | L5-Diff | DIFF-1: Truly differential progressive disclosure | T146, T151 |
| T177 | L5-Diff | DIFF-2: Embedding-based semantic search | T146 |
| T178 | L5-Diff | DIFF-3: Cross-document graph queries | T177 |
| T179 | L5-Diff | DIFF-4: Block + suggestion mode | T146, T148 |
| T180 | L5-Diff | DIFF-5: Snapshot diff with operational semantics | T147, T148 |
| T183 | L5-Diff | DIFF-8: LLM-aware compression (adaptive Zstd dicts) | T100, T178 |

---

### W6 — Federation + Compliance

| T# | Layer | Title | Dep |
|----|-------|-------|-----|
| T181 | L5-Diff | DIFF-6: Federated documents (cross-instance, selective pull) | T147, T169 |
| T182 | L5-Diff | DIFF-7: Time-travel + branches | T148 |
| T184 | L6-Comp | COMP-1: SOC 2 Type 1 readiness checklist | T164, T155, T145, T161 |
| T185 | L6-Comp | COMP-2: Data residency options | T155, T168 |
| T186 | L6-Comp | COMP-3: Audit log retention + export | T164, T155 |
| T187 | L6-Comp | COMP-4: Right-to-deletion endpoint | T168, T186 |
| T188 | L6-Comp | COMP-5: Sub-processor list + DPA template | — |

---

## Merge/EXISTING Notes

| Analysis ID | Disposition | Existing T# | Reason |
|---|---|---|---|
| MA-1 EXTENDS T083 | New T146 (Phase 2) | T083 | T083 is Phase 1 Rust bindings; T146 is end-to-end WS integration |
| MA-2 EXTENDS T076 | New T147 (Phase 2) | T076 | T076 is foundational schema; T147 is enforcement |
| MA-3 | EXISTING T087 | T087 | T087 already covers this — added T147 dep |
| MA-8 EXTENDS T108 | New T152 | T108 | T108 is P0 security fixes; T152 adds Byzantine quorum logic |
| OPS-5 | EXISTING T092 | T092 | T092 covers graceful shutdown — added T145 dep |
| SEC-3 EXTENDS T108 | New T164 | T108 | T108 is remediation; T164 adds tamper-evident Merkle chain |
| SEC-8 | EXISTING T085 | T085 | T085 already covers API key scope enforcement |
| DX-1 EXTENDS T095 | New T169 | T095 | T095 is the spec; T169 ensures live /openapi.json + Swagger UI |
| DX-2 EXTENDS T097 | New T170 | T097 | T097 is Phase 1; T170 adds Python PyO3 + Go codegen |
| OPS-10 EXTENDS T090 | New T161 | T090 | T090 is KMS design; T161 is the runbook + automation |
| DIFF-8 | New T183 | T100 (dep) | T100 covers Zstd base; T183 adds per-cluster adaptive dicts |

## Judgment Calls (flag for orchestrator review)

1. **MA-3 T087** — The existing T087 has `priority: medium` but the analysis assigns MA-3 no specific priority. Left as medium. Flag if this should be elevated.
2. **OPS-5 T092** — T092 exists with `size: small`. The analysis calls OPS-5 "graceful shutdown + drain" which T092 fully covers. Only added T145 dep. No acceptance criteria modified.
3. **SEC-8 T085** — T085 already covers enforced scopes (`priority: critical`). No new epic created. The analysis table lists it as a gap but CLEO already tracks it.
4. **DIFF-6 deps** — DIFF-6 (federation) was assigned deps T147 and T169 (not T146). Federation requires identity for cross-instance auth but does not strictly require CRDT to be fully shipped. Flag if CRDT should also be a dep.
5. **DIFF-7 dep** — DIFF-7 (branches/time-travel) depends only on T148 (event log). Some implementations may also need T146 (CRDT). Flag if T146 should be added.

---

*Total new epics created: 44 (plus 4 existing epics with addDepends updates: T087, T092, T085, and no-op T093 already done)*
*Total epic updates (addDepends only): 4*
*Combined epic footprint: 48 items tracked*
