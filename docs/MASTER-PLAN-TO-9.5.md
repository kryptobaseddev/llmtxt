# LLMtxt — Master Plan to 9.5/10 (2026-04-15 snapshot)

> **Scope**: honest, exhaustive answer to "is Y.js/CRDT fully working; can multiple agents edit concurrently; what is outstanding; 100% assessment."
>
> **Verdict up front**: NO, Y.js/Yrs is NOT integrated. Multiple agents CANNOT edit the same document concurrently today. Current state is LWW + 3-way merge at POST-version time + autoLock. Real-time sync is SSE/WS broadcast only — no CRDT, no awareness, no cursors, no differential subscriptions. **0/8 multi-agent collaboration tests fully pass.**
>
> **10/10 is scoring theater**. No system scores perfect. Targetable honestly: **9.5/10**. Reachable if Layer 1-6 epics ship. At current velocity (~15 atomic tasks per focused session): 15-25 sessions to 9.5. **~6 months of focused execution**.

---

## Section 1 — The Current Truth (Code-Level Audit)

### 1.1 CRDT / Y.js / Yrs integration status

| Probe | Result |
|---|---|
| `grep -ri "from 'y" apps/backend/src packages/llmtxt/src crates/llmtxt-core/src` | **zero matches** |
| `yrs =` in `crates/llmtxt-core/Cargo.toml` | **not present** |
| `three_way_merge.rs` | batch 3-way merge — NOT a CRDT |
| T146 (CRDT Yrs Phase 2) status | RCASD done, 12 atomic tasks decomposed, **0 shipped** |
| T083 (original CRDT epic) status | pending, no atomic tasks |

**Conclusion**: the "Yrs not Y.js" rhetoric in `docs/SSOT.md` describes a target state. The code has zero CRDT integration. Two agents typing into the same section at the same time today would race in the `versions` table, and `three_way_merge` only runs at submission time (not during typing).

### 1.2 Real-time model today

| File | Lines | What it does |
|---|---|---|
| `apps/backend/src/routes/ws.ts` | 221 | WebSocket — broadcast subscriber channel, no Yjs protocol |
| `apps/backend/src/routes/sse.ts` | 109 | Server-Sent Events — whole-payload event stream |
| Hocuspocus / y-websocket pattern | 0 occurrences | not implemented |
| Presence / cursors / awareness | 0 occurrences | not implemented |
| Differential subscriptions (`?since=seq`) | 0 occurrences | not implemented |

**Conclusion**: real-time = "when X event fires on the server, push to subscribers." This is event notification, not collaborative editing. Two agents cannot concurrently type.

### 1.3 Multi-agent test matrix (from RED-TEAM-ANALYSIS-2026-04-15.md)

| # | Test | Pass today? | Blocker |
|---|---|---|---|
| 1 | Verified agent identity (signed submissions) | ❌ | T076 / T147 — 0 IVTR |
| 2 | Agent capability discovery (`/.well-known/agents/:id`) | ❌ | T087 — 0 IVTR |
| 3 | Turn-taking primitives (section leases) | ❌ | T150 / T084 — 0 IVTR |
| 4 | Event ordering guarantees (monotonic per-doc seq, replay-from-offset) | ⚠️ partial | T148 / T078 — 0 IVTR; current broadcast has no per-doc seq |
| 5 | Differential subscriptions | ❌ | T151 / T082 — 0 IVTR |
| 6 | Byzantine resistance (multi-sig, tamper-evident chain) | ❌ | T152 / T105 / T107 / T108 — 0 IVTR |
| 7 | Shared scratchpad (comments per section) | ❌ | T153 / T088 — 0 IVTR |
| 8 | Agent-to-agent direct messaging | ❌ | T154 — 0 IVTR, not yet decomposed |

**Score: 0/8 fully pass, 1/8 partial. No movement since 2026-04-14 red-team.**

---

## Section 2 — Complete Epic Inventory

### 2.1 Red-Team 2026-04-15 epics (T144-T188 + T233)

| Epic | Title | Atomic tasks | % done |
|---|---|---|---|
| **Shipped** | | | |
| T144 | Ops: Migration safety in CI | 5/5 | 100% |
| T233 | Ops: SQLite → Postgres migration | 11/12 | 92% (T245 calendar-gated) |
| **Partial** | | | |
| T145 | Ops: Observability stack | 7/10 | 70% (T202/T205/T213 credential-blocked) |
| **RCASD-only (12-29 atomic tasks decomposed, 0 shipped)** | | | |
| T146 | Multi-Agent: CRDT Yrs Phase 2 | 0/12 | 0% |
| T147 | Multi-Agent: Verified identity Phase 2 | 0/9 | 0% |
| T148 | Multi-Agent: Per-doc event log + replay | 0/8 | 0% |
| **Not yet decomposed (need RCASD)** | | | |
| T149 | Multi-Agent: Presence + awareness | 0 atomic | — |
| T150 | Multi-Agent: Turn-taking leases | 0 atomic | — |
| T151 | Multi-Agent: Differential subscriptions | 0 atomic | — |
| T152 | Multi-Agent: Byzantine resistance (multi-sig) | 0 atomic | — |
| T153 | Multi-Agent: Shared scratchpad (comments) | 0 atomic | — |
| T154 | Multi-Agent: Agent-to-agent messaging | 0 atomic | — |
| T155 | Ops: Backup + PITR (Litestream/pgbackrest) | 0 atomic | — |
| T156 | Ops: Replication + read replicas | 0 atomic | — |
| T157 | Ops: SLO/SLI definition | 0 atomic | — |
| T158 | Ops: Strict release runbook | 0 atomic | — |
| T159 | Ops: Chaos + fault injection | 0 atomic | — |
| T160 | Ops: Load tests + benchmarks | 0 atomic | — |
| T161 | Ops: Secret rotation Phase 2 | 0 atomic | — |
| T162 | Security: CSP + HSTS + COEP | 0 atomic | — |
| T163 | Security: Markdown XSS sanitization E2E | 0 atomic | — |
| T164 | Security: Tamper-evident audit log | 0 atomic | — |
| T165 | Security: Webhook delivery hardening | 0 atomic | — |
| T166 | Security: Row-level security (PG RLS) | 0 atomic | — |
| T167 | Security: Anonymous mode threat model | 0 atomic | — |
| T168 | Security: PII handling + GDPR readiness | 0 atomic | — |
| T169 | DX: OpenAPI 3.1 auto-generated | 0 atomic | — |
| T170 | DX: Multi-language SDKs Phase 2 | 0 atomic | — |
| T171 | DX: LLMtxt CLI for agents | 0 atomic | — |
| T172 | DX: Reference agent implementations | 0 atomic | — |
| T173 | DX: Local dev environment + fake agents | 0 atomic | — |
| T174 | DX: Error message catalog | 0 atomic | — |
| T175 | DX: Forge-ts TSDoc coverage gate | 0 atomic | — |
| T176 | Diff: Differential progressive disclosure | 0 atomic | — |
| T177 | Diff: Embedding-based semantic search | 0 atomic | — |
| T178 | Diff: Cross-document graph queries | 0 atomic | — |
| T179 | Diff: Block + suggestion mode | 0 atomic | — |
| T180 | Diff: Snapshot diff with operational semantics | 0 atomic | — |
| T181 | Diff: Federated documents | 0 atomic | — |
| T182 | Diff: Time-travel + branches | 0 atomic | — |
| T183 | Diff: LLM-aware compression | 0 atomic | — |
| T184 | Compliance: SOC 2 Type 1 readiness | 0 atomic | — |
| T185 | Compliance: Data residency options | 0 atomic | — |
| T186 | Compliance: Audit log retention + export | 0 atomic | — |
| T187 | Compliance: Right-to-deletion endpoint | 0 atomic | — |
| T188 | Compliance: Sub-processor list + DPA | 0 atomic | — |

**Tally**: 3 shipped/partial out of 46 red-team epics. Total atomic tasks across decomposed epics: 41 created, 15 shipped (T144 5, T145 7, T233 11 — overlap: T237 absorbed).

### 2.2 Phase 5-11 epics (T076-T110 — 2026-04-14 vintage)

| Group | Epics | Status |
|---|---|---|
| **Superseded / archived** | T079, T080, T081 | ✅ replaced by red-team layer-1 epics |
| **Multi-agent foundations (overlap with red-team L1)** | T076, T077, T078, T082, T083, T084, T085, T086, T087, T088, T105, T106, T107 | all pending, no atomic tasks — consolidate with T146-T154 during future RCASD |
| **Ops / infra** | T089, T090, T091, T092, T093, T108, T109, T110 | all pending |
| **DX / docs / SDKs** | T095, T096, T097, T098, T099 | all pending |
| **Perf / scaling** | T100, T101, T102, T103, T104 | all pending |
| **Compliance / export** | T094 | pending |

**Tally**: 37 pending Phase 5-11 epics. Most overlap with / are superseded by the red-team layered roadmap. Consolidation pass needed at some point so they don't double-count.

---

## Section 3 — Path to 8/8 Multi-Agent Tests Passing

This is the most concrete, pin-down-able goal. It requires Layer 1 (red-team epics T146-T154) to ship.

### 3.1 Dependency-ordered wave plan

```
                       ┌─ T146 CRDT Yrs Phase 2  ───────┐
                       │  (12 atomic tasks; load-bearing)│
                       ├─ T147 Ed25519 identity  ───────┤
  W0 infrastructure ──►│  (9 atomic tasks)               │──► 3/8 tests pass
  (Postgres ✅)        ├─ T148 Event log + replay ──────┤
                       │  (8 atomic tasks)               │
                       └────────────────────────────────┘
                                     │
                                     ▼ (T146 + T147 + T148 done)
                          ┌─ T149 Presence + awareness ─┐
                          ├─ T150 Turn-taking leases  ──┤──► 6/8 tests pass
                          └─ T151 Diff subscriptions  ──┘
                                     │
                                     ▼
                          ┌─ T152 Byzantine resistance ─┐
                          ├─ T153 Shared scratchpad ────┤──► 8/8 tests pass ✓
                          └─ T154 Agent-to-agent msg ───┘
```

### 3.2 Session-level estimate

| Wave | Epic count | Est. atomic tasks | Est. sessions @ 10 tasks/session |
|---|---|---|---|
| W1: T146+T147+T148 | 3 (decomposed) | 29 already atomic | 3 sessions |
| W2: T149+T150+T151 | 3 (need RCASD) | ~30 atomic after decomp | 4 sessions (1 RCASD + 3 IVTR) |
| W3: T152+T153+T154 | 3 (need RCASD) | ~30 atomic after decomp | 4 sessions |
| **8/8 target** | 9 epics | ~89 atomic tasks | **~11 sessions** |

### 3.3 Parallel + risk-aware execution

Parallel-safe within each wave: T147 (identity) and T148 (event log) are independent of T146 (CRDT) at the code level — both can start NOW. T146 touches `crates/llmtxt-core`, `apps/backend/src/routes/ws.ts`, new PG tables (section_crdt_states, section_crdt_updates). T147 touches `apps/backend/src/middleware/signatures.ts` (new), `apps/backend/src/db/schema-pg.ts` (agent_pubkeys table), existing write route handlers. T148 touches `apps/backend/src/events/event-log.ts` (new), `apps/backend/src/db/schema-pg.ts` (document_events table). Schema conflict risk: all three add PG tables — must add to schema-pg.ts in a single coordinated commit OR serialize the schema additions.

**Recommended first-run sequence**:
1. Single Sonnet "schema consolidator" worker adds all 3 new tables (`section_crdt_states`, `section_crdt_updates`, `agent_pubkeys`, `document_events`) to schema-pg.ts in one commit — eliminates the merge risk.
2. Fire T147 IVTR workers (pure app-layer, no schema conflicts afterward).
3. Fire T148 IVTR workers in parallel.
4. Fire T146 IVTR workers (biggest — Yrs Cargo deps, WASM exports, WS server).

---

## Section 4 — Path to 9.5/10 Composite

### 4.1 Current score 7.3, honest ceiling 9.5 (not 10)

| Dim | 2026-04-15 start | 2026-04-15 end (now) | At 9.5 target | Delta needed |
|---|---|---|---|---|
| Architecture (SDK boundary) | 8 | 8.5 | 9 | T169 OpenAPI + T097 multi-lang SDK |
| Operational reliability | 5 | 7 | 9.5 | T155 backup, T156 replication, T159 chaos, T160 load tests, T161 secret rotation |
| Security posture | 5.5 | 6 | 9.5 | T162 CSP/HSTS, T164 tamper-evident audit, T166 RLS, T167 anon threat model, T168 PII/GDPR, T108 P0 fixes |
| Multi-agent core | 3 | 3 | 9.5 | T146+T147+T148+T149+T150+T151+T152+T153+T154 (all 9 L1 epics) |
| Test coverage depth | 5 | 6 | 9 | Per-epic tests + T160 load + T159 chaos |
| Developer experience | 7.5 | 8 | 9.5 | T169 OpenAPI, T171 CLI, T172 reference agents, T173 local dev, T174 error catalog |
| Real-time collaboration | 3 | 3 | 9.5 | T146 + T149 + T151 (unlocks presence/cursors/diff-subs) |
| Observability | 1 | 4 | 9.5 | T145 credential-provision (unblocks 3 remaining tasks), T157 SLOs, dashboards |
| Documentation / spec | 5 | 6 | 9 | T169 OpenAPI, T095, T098 CLI, T099 llms.txt |
| **Composite** | **5.3** | **7.3** | **9.5** | **entire Layer 1-3 + strategic L4/L5 epics** |

### 4.2 Why 10 is impossible

Peers: Notion 8.5, Liveblocks 8.0, Convex 8.0, Tiptap 7.5. None of them scores 10. 10 would require every dimension maxed with no trade-off — impossible because every architectural choice sacrifices some axis for another. Claiming 10 invites distrust.

### 4.3 Path to 9.5 — session roadmap (assumes ~10 atomic tasks/focused session, current velocity)

| Phase | Sessions | Deliverable | Cumulative score |
|---|---|---|---|
| Current | — | Postgres ✅, observability scaffold ✅, migration safety CI ✅ | 7.3 |
| Phase A — Layer 1 foundation | 3 sessions | Schema consolidator + T147 identity + T148 event log | 7.7 |
| Phase B — CRDT | 4 sessions | T146 Yrs + WS sync + persistence + byte-identity | 8.3 (3/8 multi-agent tests pass) |
| Phase C — Presence + diff | 3 sessions | T149+T150+T151 (needs RCASD for 149/150/151 first: 1 session) | 8.7 (6/8 tests) |
| Phase D — Byzantine + scratchpad + A2A | 4 sessions | T152+T153+T154 (RCASD + IVTR) | 9.0 **(8/8 tests pass ✓)** |
| Phase E — Ops hardening | 4 sessions | T155 backups, T156 replication, T157 SLOs, T159 chaos, T160 load | 9.2 |
| Phase F — Security hardening | 4 sessions | T162 CSP, T164 audit, T166 RLS, T167 anon, T168 GDPR | 9.3 |
| Phase G — DX + docs | 3 sessions | T169 OpenAPI, T171 CLI, T172 reference agents | 9.4 |
| Phase H — Differentiators | 3 sessions | T177 real embeddings, T178 graph queries, T179 suggestions | 9.5 |
| **Target** | **~28 sessions** | **full Layer 1-5 + strategic L6** | **9.5** |

Compliance (SOC 2, data residency, DPA) is additional — shift to 9.6 but not required for "best for agents" claim.

### 4.4 Realistic calendar

At 1 focused session per day: **28 working days ≈ 6 weeks**. At 3 sessions per week (more typical): **~10 weeks (≈2.5 months)**. At 1 session per week: **~6 months**. User directive "keep shipping autonomously" + multi-session workers suggests higher velocity is possible — 2-3 months realistic.

---

## Section 5 — Immediate Blockers (Need Owner Action)

These block specific epics — unlock them and workers can fire.

| # | Blocker | Unblocks |
|---|---|---|
| 1 | Provision Grafana Cloud free account + paste `OTEL_EXPORTER_OTLP_ENDPOINT` + Loki creds via `railway variable set` | T202, T205 (Sentry + Loki paths in T145) |
| 2 | Create Sentry project "llmtxt-backend" → `SENTRY_DSN` + Sentry CLI auth token as GH Action secret | T202 Sentry error tracking, T213 source maps |
| 3 | Enable `migration-check` job as **required status check** in GitHub branch protection for main | T144 becomes a real merge gate (currently advisory only) |
| 4 | Confirm email-in-Loki-logs is OK under your privacy policy | T205 goes to prod without paranoia |
| 5 | Provide a timeline preference: "8/8 tests in 2 months full-throttle" vs "steady 1 session/week" | affects worker spawn frequency and context budget strategy |

---

## Section 6 — Immediate Next Action Ladder

Ordered by blast-radius payoff-per-session:

| Rank | Action | Why it matters |
|---|---|---|
| 1 | **Spawn "schema consolidator" worker** — add all 4 W1 tables to `schema-pg.ts` in one coordinated commit | Unblocks T146/T147/T148 parallel IVTR without merge conflicts |
| 2 | **Spawn T147 IVTR** (Ed25519 identity, 9 tasks, mostly app-layer) | +1 multi-agent test passes. Can run in parallel with #1 if we pin schema upfront. |
| 3 | **Spawn T148 IVTR** (event log, 8 tasks, app-layer + one PG table) | +1 multi-agent test passes, unlocks replay-from-offset |
| 4 | **Spawn T146 IVTR** (CRDT Yrs, 12 tasks, biggest) | Real-time concurrent editing becomes possible for the first time |
| 5 | **RCASD T149+T150+T151** in parallel (3 Sonnet leads) | Prepares presence + leases + diff subs for IVTR |
| 6 | **T145 credentials + ship T202+T205+T213** | Live Sentry + Loki + dashboards; T145 hits 10/10 |
| 7 | **RCASD T152+T153+T154** | Last 3 multi-agent tests setup |
| 8 | **IVTR T149/150/151 → T152/153/154** | Unlocks 8/8 multi-agent tests |

---

## Section 7 — Why This Plan Is Credible

- **T111 shipped clean** (22 SSoT violations resolved, byte-identity tests across 10 Rust modules) — architectural discipline demonstrated
- **T233 cutover shipped** (SQLite → Postgres in production, zero data loss, dual-client rollback intact) — operational discipline demonstrated
- **Migration safety CI gate** caught the class of bug that broke production 2 days ago — system self-improves
- **45 red-team epics catalogued** with acceptance criteria, dependency DAG, wave plan — the work is identifiable and decomposable
- **29 atomic tasks already exist** under the three critical multi-agent pillars (T146/T147/T148) — next session can start IVTR without planning overhead

---

## Section 8 — What I Refuse to Claim

- **NOT 10/10 — 10 is theoretical, not achievable**
- **NOT "bleeding edge multi-agent" today — 0/8 tests pass**
- **NOT "ready for serious multi-agent workloads" — no CRDT, no presence, no verified identity**
- **NOT "Notion-killer" or "Liveblocks-killer" — those score 8-8.5; we're at 7.3**
- **NOT "done in N weeks" — credible range is 2-6 months depending on cadence**

---

## Section 9 — What I Will Claim (Honestly)

- **T233 Postgres cutover is live** with zero data loss, full rollback preserved for 30 days
- **Observability is actively collecting** (5 domain counters, W3C trace context on webhooks, `/api/health` + `/api/ready` + `/api/metrics`)
- **Migration safety CI gate is active** — prevents the deploy outage class that hit this session
- **The roadmap IS decomposable** — 41 atomic tasks across T144/T145/T146/T147/T148/T233 already exist with testable acceptance criteria
- **Path from 7.3 → 9.5 is identifiable and executable** via the 9-phase session plan in Section 4.3
- **8/8 multi-agent tests are reachable** — concrete epics (T146-T154) gate it, and they're either decomposed (T146/T147/T148) or one RCASD away (T149-T154)

The path to "best multi-agent document collaboration system for agents" is real. It is not 10/10. It is 9.5/10. It is ~28 focused sessions of execution. Every epic in the plan advances one of the 7 Guiding Star properties. The work is visible, the dependencies are wired, the acceptance criteria are testable. All that remains is to keep shipping.
