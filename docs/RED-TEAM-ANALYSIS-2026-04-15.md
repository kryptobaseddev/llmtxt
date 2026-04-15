# LLMtxt Red-Team Analysis — 2026-04-15 Supersede

> **Status**: Supersedes `docs/RED-TEAM-ANALYSIS.md` (2026-04-14, 492 lines). The prior analysis remains historically accurate; this document records DELTA since then plus NEW findings from live probing of `api.llmtxt.my` and the post-T111 codebase.
>
> **Methodology**: Adversarial. Live API probing. SOTA peer comparison. No flattery.
>
> **Reviewer self-disclosure**: Spent the prior 12+ hours shipping T111 + fixing a deploy outage. Personal investment in the codebase is high. Actively resisting "this must be good because I just worked on it" bias.

---

## TL;DR — One Honest Answer

**No, this is not the most amazing bleeding-edge state-of-the-art system for multi-agent document collaboration.** It is a competent, thoughtful, well-architected v1 with one genuinely interesting differentiator (progressive disclosure with WASM-everywhere primitives) and a long list of unshipped features that are PREREQUISITE to claiming the title.

| Question | Honest answer |
|---|---|
| Is it the best ever? | No |
| Is it "bleeding edge"? | No — it's a careful v1 of a well-understood pattern with one novel twist |
| Is it state-of-the-art for multi-agent collab? | No — actual SOTA peers (Y.js + Hocuspocus, Convex, Liveblocks, PartyKit, Tiptap collab) ship things LLMtxt promises but does not have |
| Is it shit? | No — it's actually well-engineered for what it is. The problem is the gap between what it IS and what it CLAIMS |
| What is it, honestly? | A clean SDK + WASM-backed primitives + sequential-LWW versioning + section-aware retrieval, with a thoughtful sharing/lifecycle model, deployed and running |

**Composite score (out of 10)**:

| Dimension | 2026-04-14 score | 2026-04-15 score | Delta | Why |
|---|---|---|---|---|
| Architecture (SDK boundary, primitive purity) | 5 | **8** | +3 | T111 shipped — all 22 SSoT violations resolved; SDK is now real |
| Operational reliability | 3 | **5** | +2 | Deploy outage hit + fixed (api_keys duplicate, schema-reset footgun); CI hardened (provenance + idempotent workflows). Still no observability/backups. |
| Security posture | 5 | **5.5** | +0.5 | CI lint rule blocks node:crypto re-introduction. No HSTS/CSP added. No secret rotation shipped. |
| Multi-agent core | 3 | **3** | 0 | T083 (CRDT) STILL unshipped. No presence. No verified agent identity. No turn-taking. |
| Test coverage depth | 4 | **5** | +1 | +156 cargo tests, +byte-identity verification. Backend still 67 tests / 232 assertions — thin. |
| Developer experience (SDK) | 6 | **7.5** | +1.5 | T111 cleaned up the SDK surface; types now exported properly; CHANGELOG present; CI publishes with provenance |
| Real-time collaboration | 3 | **3** | 0 | Still SSE/WS broadcast only. No CRDT, no presence, no cursors, no differential updates. |
| Observability | 1 | **1** | 0 | Zero metrics, zero tracing, zero error tracking, zero alerts. Pino logs only. |
| Documentation / spec | 4 | **5** | +1 | docs.llmtxt.my live; CHANGELOG enforced; RED-TEAM and VISION docs maintained. No OpenAPI spec. |
| **Composite** | **4.2** | **5.3** | **+1.1** | T111 + deploy fix + CI hardening moved the needle, but the multi-agent core is still where it was |

**Where peers actually are**:

| Peer | Composite (estimate) | Why ahead |
|---|---|---|
| Notion (collab+content) | 8.5 | Real-time blocks, comments, mentions, suggestions, embedded media, audit, SSO, mature SDK |
| Liveblocks/Hocuspocus (Y.js infrastructure) | 8.0 | Actual CRDT, presence, cursors, awareness, multi-tenant, observability |
| Convex (real-time DB) | 8.0 | Reactive queries, ACID, scheduled functions, file storage, edge-functions |
| PartyKit (edge real-time) | 7.5 | Edge-native rooms, websockets, party-aware presence, low-latency by design |
| Tiptap collab | 7.5 | Y.js-backed prose editing, conflict-free typing, presence, suggestions |
| Roam/Logseq (graph notes) | 7.0 | Block-graph, backlinks, queries, mature |
| LLMtxt (today) | **5.3** | (see scoring above) |

---

## What Shipped Since 2026-04-14 — Genuine Progress

| Item | Status | Honest assessment |
|---|---|---|
| T111 SDK-first refactor | ✅ shipped (v2026.4.4) | Real architectural win. All 22 SSoT violations resolved. 10 Rust modules, +156 cargo tests, byte-identity tests for every primitive. SDK is now consumable as designed. |
| T142 CI lint rule (ban node:crypto/yjs/automerge) | ✅ shipped | Real regression guard. Future devs cannot re-introduce direct node:crypto without CI rejecting it. |
| T093 schema-reset footgun removed | ✅ shipped (in deploy fix) | Removes a one-time-band-aid that would silently destroy production data on any fresh volume. Should have been removed long ago. |
| api_keys duplicate migration fix | ✅ shipped | Deploys reliable again. Latent bug since 2026-04-14 morning. |
| Release CI hardening | ✅ shipped | release-rust.yml secret-in-if bug fixed; both workflows now idempotent (skip-if-already-published). |
| T112 NAPI-RS bindings | ❌ DEFERRED 2026-04-15 | Speculative optimization (3-10× CPU op speedup) deferred until production benchmark proves WASM is the bottleneck. 10 tasks of work avoided. Reactivation trigger preserved. |

## What is STILL True from 2026-04-14 — Still Real Problems

| Finding from 2026-04-14 | Status now | Why it still hurts |
|---|---|---|
| 2.6 Agent identity is trust-me (anyone can claim any agentId) | UNCHANGED | Cannot legitimately call this "multi-agent" without verified identity. T076 unshipped. |
| 2.7 Semantic diff is decorative (TF-IDF + cosine, no embeddings) | PARTIALLY changed | T125 ported TF-IDF to Rust core (good), but it's still TF-IDF — not contextual embeddings. No vector DB. No similarity search at scale. |
| 2.8 Progressive disclosure is not DIFFERENTIAL | UNCHANGED | Agents fetch the WHOLE section every poll; no "send me only what changed since timestamp X" subscription. |
| 2.9 Conflict resolution is half-implemented | UNCHANGED | Three-way merge exists. CRDT (T083, "biggest single differentiator" per memory) STILL UNSHIPPED. |
| 3.6 Secrets & deployment (no rotation, no vault) | UNCHANGED | T090 unshipped. SESSION_SECRET/API_KEY_SECRET probably long-lived. |
| 3.8 DoS surface (rate limit fine-grained but no body size limits in places) | UNCHANGED | CONTENT_LIMITS exist as constants now (T133) but global request-body limit unverified |
| 4.1 The "multi-agent" claim fails 6/8 basic tests | UNCHANGED | Still trust-me identity, still no turn-taking, still no event ordering guarantees, still no agent capability discovery |
| 5.x Operational readiness (no SLOs, no backups, no observability) | UNCHANGED | Still single SQLite on a Railway volume. No backup script. No metrics endpoint. No error tracking. |

---

## NEW Findings — From Live Probing 2026-04-15

### Live HTTP probe of api.llmtxt.my

| Probe | Result | Concern |
|---|---|---|
| `GET /api/health` | 200 ok | ✅ healthy |
| `GET /api/.env` | 404 | ✅ correctly rejected |
| `GET /openapi.json`, `/api/swagger`, `/api/spec`, `/api/docs` | all 404 | ❌ no public API specification — agents must read source to discover routes |
| `GET /metrics` | 404 | ❌ no Prometheus/metrics endpoint exposed |
| `GET /api/admin`, `/api/internal` | 404 | ✅ not leaked |
| `GET /api/documents/test123` | 401 | ✅ requires auth |
| `GET /api/v1/documents/test123` | 401 | ✅ v1 routes wired |
| `POST /api/documents` | 404 | ⚠️ wrong path? (should be /api/v1/documents, route discoverability is poor) |
| 50 KB JSON body to non-existent route | 404 in 0.19s | ✅ rejected fast — no body parsing on 404 |
| Response security headers | x-frame-options=DENY, x-content-type-options=nosniff, permissions-policy locks down camera/mic/geo, referrer-policy strict | ✅ baseline good |
| HSTS header | NOT visible from origin (Cloudflare may set at edge) | ⚠️ verify Cloudflare HSTS preload is enabled |
| CSP header | NOT present | ❌ no Content-Security-Policy — XSS in stored markdown content depends entirely on frontend sanitization |
| Public CSRF token endpoint | `GET /api/csrf-token` → 200 | ✅ correctly served (anonymous CSRF is valid) |
| Public `.well-known/llm.json` | 404 | ❌ promised LLM discovery endpoint not deployed |

### Code-survey findings

| Concern | Evidence | Honest take |
|---|---|---|
| **Real-time depth** | 8 lines of WebSocket code in `apps/backend/src` | This is broadcast-only, not collaboration. No presence, no awareness, no cursors. |
| **Presence/who-is-here** | Zero matches for `presence|cursor.*pos|who.is|active.user` | Cannot show "Alice is editing section 3 right now" — table-stakes for any modern collab tool. |
| **CRDT** | `crates/llmtxt-core/src/three_way_merge.rs` is NOT a CRDT (it's batch 3-way merge). No Yrs integration. No automerge. | The "Yrs not Y.js" rhetoric in `docs/SSOT.md` describes a future state, not the current code. |
| **Observability** | Zero matches for `sentry\|datadog\|opentelemetry\|newrelic\|grafana` in package.json files | If api.llmtxt.my crashes at 3am, nobody knows until a user complains. |
| **Backup strategy** | Zero matches for `backup\|replicat\|snapshot.*restore\|litestream` | Volume failure on Railway = total data loss for production. |
| **Test depth (backend)** | 67 test cases, 232 assertions across `apps/backend/src/__tests__` | Thin for a "production" multi-agent system. Y.js tests have ~10× this for the CRDT alone. |
| **Test depth (Rust core)** | 278 cargo tests after T111 | Healthy and growing. |

### Process / engineering-discipline findings

| Concern | Evidence | Why this matters |
|---|---|---|
| Migration regen produces silent duplicates | `20260414033829_faulty_impossible_man` had duplicate `CREATE TABLE api_keys` — broke every deploy after 2026-04-14 morning until fixed today | Drizzle-kit generate is not deterministic against complex schema state. Need pre-merge migration tests in CI. |
| `drizzle-kit migrate` exits 0 on error | The migration error was logged but exit code was 0; container's `migrate && start` chain proceeded | Fragile — could start the server in a broken state silently. Need a strict-check wrapper. |
| Manual `npm publish` bypassed OIDC provenance | Today's first attempt published `llmtxt@2026.4.4` without provenance attestation | Permanent gap on that version. Process discipline needed (memory: never publish locally). |
| Docs drift between source and CHANGELOG locations | `release.yml` reads `packages/llmtxt/CHANGELOG.md` but Documentor wrote to root `CHANGELOG.md` and crate `CHANGELOG.md` only — release fell back to generic notes | Need a single CHANGELOG-of-record per package, validated in CI. |
| 38 unpushed commits piled up before today | `git push` revealed 38 commits ahead of origin/main | No CI enforcement on push frequency; release PR review never happened. |

---

## Where Multi-Agent Collaboration Actually Falls Short

Restating the 8 basic tests of "multi-agent" from prior red-team, with current pass/fail:

| Test | Pass? | Evidence |
|---|---|---|
| Verified agent identity | ❌ | T076 unshipped. Anyone can `--agentId alice` and write as alice. |
| Agent capability discovery | ❌ | No `/.well-known/agents` endpoint. Agents don't advertise what they can do. |
| Turn-taking primitives | ❌ | Only autoLock + LWW + 3-way merge. No semantic "I'll take section 3 for the next 60s" lease. |
| Event ordering guarantees | ⚠️ | SSE/WS broadcast exists but no monotonic event sequence per document; no replay from offset. |
| Differential subscriptions | ❌ | Agents poll/receive whole-section payloads. No "send me only what changed since X" delta API. |
| Byzantine resistance | ❌ | A single malicious agent can corrupt approval chains. No quorum, no signatures on submissions. |
| Shared scratchpad | ❌ | No ephemeral coordination space. Comments don't exist. |
| Agent-to-agent messaging | ❌ | No conduit between agents about a document. Webhooks fire to URLs, not to other agents. |

**Score: 0/8 fully pass, 1/8 partial.** This is the core honest gap.

---

## What Would Make LLMtxt Genuinely Bleeding-Edge — Feature Gaps Catalogued

> Each row below corresponds to a NEW or EXPANDED CLEO epic created in the companion task tree. Existing T076-T143 epics noted where overlap exists.

### Layer 1 — Multi-Agent Foundations (cannot claim "multi-agent" without these)

| ID candidate | Title | What it is | Existing epic? |
|---|---|---|---|
| MA-1 | **CRDT collaboration core** | Yrs (Rust) integrated for section content; real-time deltas via WS; conflict-free concurrent edits | EXTENDS T083 |
| MA-2 | **Verified agent identity** | Each agent has an Ed25519 keypair; submissions signed; receipts cryptographic | EXTENDS T076 |
| MA-3 | **Agent capability manifest** | `/.well-known/agents/{id}` returns capabilities, supported ops, schema versions, public key | NEW |
| MA-4 | **Presence + awareness** | Who is editing right now; cursor positions; selection ranges; section-level focus | NEW |
| MA-5 | **Turn-taking leases** | Agent can claim section X for N seconds; auto-release; conflict on overlapping claims | NEW |
| MA-6 | **Differential subscriptions** | `?since=<event_seq>` returns deltas only; agents stream changes from offset | NEW |
| MA-7 | **Event ordering guarantees** | Per-doc monotonic event log; replay from offset; idempotent event IDs | NEW |
| MA-8 | **Byzantine resistance** | Multi-sig approval thresholds; signature on every state transition; tamper-evident chain | EXTENDS T108 |
| MA-9 | **Shared scratchpad / comments** | Ephemeral comments per section; agent-to-agent threads; resolved/open state | NEW |
| MA-10 | **Agent-to-agent direct messaging** | Conduit channel between two agents about a doc; NOT just webhooks-to-URLs | NEW |

### Layer 2 — Operational Reliability (cannot claim "production-ready" without these)

| ID candidate | Title | What it is | Existing epic? |
|---|---|---|---|
| OPS-1 | **Observability stack** | Pino → Loki/Datadog; OpenTelemetry traces; Sentry error tracking; metrics endpoint with histograms | NEW |
| OPS-2 | **Backup + PITR** | Litestream or pgbackrest; daily snapshots to S3; documented restore RTO/RPO | NEW |
| OPS-3 | **Replication / read replicas** | When PG is in use, async replicas; SQLite fallback documented as single-region only | NEW |
| OPS-4 | **SLO/SLI definition** | p50/p95/p99 latency targets; error budget; alert routing | NEW |
| OPS-5 | **Graceful shutdown + drain** | SIGTERM handler; finish in-flight requests; close DB; deregister from LB | NEW |
| OPS-6 | **Migration safety in CI** | Run drizzle-kit migrate on a fresh sqlite in CI for every PR; reject duplicate CREATE TABLE | NEW |
| OPS-7 | **Strict release runbook** | Pre-publish checklist enforced via GH workflow; provenance required; CHANGELOG-of-record validated | NEW |
| OPS-8 | **Chaos / fault injection tests** | Kill DB connection mid-write; partition WS; clock skew; full disk; verify recovery | NEW |
| OPS-9 | **Load tests + benchmarks** | k6/wrk scripts for the hot paths; published baseline ops/sec; regression-tested in CI | NEW |
| OPS-10 | **Secret rotation runbook** | API_KEY_SECRET, SESSION_SECRET, NPM_TOKEN, CARGO_REGISTRY_TOKEN, NEXT_PUBLIC_*; documented + automated where possible | EXTENDS T090 |

### Layer 3 — Security Hardening (table-stakes 2026)

| ID candidate | Title | What it is | Existing epic? |
|---|---|---|---|
| SEC-1 | **CSP + HSTS + COEP** | Add Content-Security-Policy, Cross-Origin-Embedder-Policy, verify HSTS preload at edge | NEW |
| SEC-2 | **Markdown XSS sanitization E2E** | Validate every render path strips dangerous markdown; fuzz with payloads from OWASP cheat sheet | NEW |
| SEC-3 | **Tamper-evident audit log** | Hash chain over audit events; merkle root committed daily to external timestamp | EXTENDS T108 |
| SEC-4 | **Webhook delivery hardening** | Exponential backoff with cap; dead-letter queue; consumer-side replay protection (event ID) | NEW |
| SEC-5 | **Row-level security** | When PG used, RLS policies enforce org/role/visibility at DB layer not just app | NEW |
| SEC-6 | **Anonymous mode threat model** | Document what anon users CAN and CANNOT do; rate-limit aggressively; session expiry contract | NEW |
| SEC-7 | **PII handling + GDPR readiness** | Identify what PII is collected; retention policy; right-to-erasure endpoint; export-my-data endpoint | NEW |
| SEC-8 | **API key scopes are real** | scopes:* is currently a placeholder; implement scope-by-route enforcement | NEW |

### Layer 4 — Developer Experience

| ID candidate | Title | What it is | Existing epic? |
|---|---|---|---|
| DX-1 | **OpenAPI 3.1 spec auto-generated** | Forge-ts from route schemas; `/openapi.json` + Swagger UI at `/docs/api`; Postman collection | EXTENDS T095 |
| DX-2 | **Multi-language SDKs** | Python (PyO3), Go (gRPC or codegen), Rust SDK (already), TS SDK (already) | EXTENDS T097 |
| DX-3 | **CLI for agents** | `llmtxt` CLI: auth, submit version, fetch sections, watch for changes; reusable in CI | NEW |
| DX-4 | **Reference agent implementations** | Worked examples: write-only bot, review bot, consensus bot, summarizer bot — all in `examples/` | NEW |
| DX-5 | **Local dev with realistic data** | Seed script, fixtures, dev-only "spawn 5 fake agents" simulator | NEW |
| DX-6 | **Error message catalog** | Every error code has a docs page with "what happened, why, what to do" | NEW |
| DX-7 | **Forge-ts coverage gate** | TSDoc coverage as a CI gate; doctest as test runner; lock against drift | NEW |

### Layer 5 — Differentiated Capabilities (these would MATTER competitively)

| ID candidate | Title | What it is | Existing epic? |
|---|---|---|---|
| DIFF-1 | **Truly differential progressive disclosure** | `?since=<event_seq>` returns delta-only; agents subscribe to "section X changes only" | EXTENDS prior 2.8 finding |
| DIFF-2 | **Embedding-based semantic search** | Real embeddings (sentence-transformers via WASM or external); vector DB (qdrant/pgvector); search-across-docs | EXTENDS prior 2.7 finding |
| DIFF-3 | **Cross-document graph queries** | "Show me docs that link to docs about X"; backlinks; topic clusters | EXTENDS T122 graph module |
| DIFF-4 | **Block / suggestion mode** | Inline suggestions with accept/reject; preserves history; multi-agent suggestion threads | NEW |
| DIFF-5 | **Snapshot diff with operational semantics** | Not just "line A changed to line B" but "agent X added a clause about Y at T+12s" | NEW |
| DIFF-6 | **Federated documents** | Doc on instance A can reference and selectively pull from instance B; cross-instance auth | NEW |
| DIFF-7 | **Time-travel + branch** | Git-like branches per doc; merge between branches; per-branch agent rosters | EXTENDS existing version system |
| DIFF-8 | **LLM-aware compression** | Adaptive compression dictionaries trained per doc-cluster; better than generic zlib for prose | NEW |

### Layer 6 — Compliance / Trust

| ID candidate | Title | What it is | Existing epic? |
|---|---|---|---|
| COMP-1 | **SOC 2 Type 1 readiness checklist** | Inventory of controls; gap analysis; remediation plan | NEW |
| COMP-2 | **Data residency options** | Multi-region deploy plan; document where each tenant's data lives | NEW |
| COMP-3 | **Audit log retention + export** | 7-year retention with archive tier; legal-hold flag; export to JSON/CSV | NEW |
| COMP-4 | **Right-to-deletion endpoint** | DELETE /api/me cascades to all owned content; 30-day grace; documented | NEW |
| COMP-5 | **Sub-processor list + DPA template** | Public list of sub-processors (Cloudflare, Railway, npm, etc.); DPA available on request | NEW |

---

## Guiding Star

The prior session established **D003**: *"No agent should ever lose work, duplicate work, or act on stale information."*

This is still correct but incomplete for "best multi-agent collab system." Proposing a refinement:

> **The Guiding Star (refined 2026-04-15)**:
> Any agent — human or machine — joining a document at any point in time, from any runtime, must:
> 1. **Know what is true now** (current state, no stale reads, no race-conditioned half-states)
> 2. **Know who else is here** (presence, capabilities, recent activity)
> 3. **Know what changed** (differential since their last seen offset)
> 4. **Be able to contribute safely** (turn-taking, conflict-free merge, signed identity, scoped permissions)
> 5. **Be able to verify nothing has been tampered with** (cryptographic chain, byte-identity primitives across runtimes)
> 6. **Lose nothing on failure** (durable writes, replicated, restore-tested backups)
> 7. **Not impede others** (rate limits, fair scheduling, no head-of-line blocking)

The 7 properties map directly to Layer 1 (1-4), Layer 2 (6, 7), and Layer 3 (5).

A feature is "in scope" if and only if it advances one of these 7 properties **or** is required-prerequisite scaffolding for one that does.

---

## Dependency Order (Ship DAG)

Inter-layer:
```
Layer 1 (Multi-Agent Foundations)
  ├── MA-1 CRDT — load-bearing for MA-4, MA-6, DIFF-1, DIFF-7
  ├── MA-2 Verified Identity — load-bearing for MA-3, MA-8, MA-10, SEC-7
  ├── MA-7 Event ordering — load-bearing for MA-4, MA-6, MA-9, OPS-1 (correlation IDs)
  └── (others depend on these three roots)

Layer 2 (Ops Reliability)
  ├── OPS-1 Observability — load-bearing for OPS-4, OPS-8, every troubleshooting flow
  ├── OPS-6 Migration safety in CI — load-bearing for every future schema change
  └── OPS-2/3 Backup/replication — load-bearing for COMP-2

Layer 3 (Security)
  ├── SEC-3 Tamper-evident audit — depends on MA-2 (signatures)
  ├── SEC-5 Row-level security — depends on PG migration shipping (already done)
  └── (others independent)

Layer 4 (DX) — mostly parallel
Layer 5 (Differentiation) — mostly depends on Layer 1
Layer 6 (Compliance) — depends on Layer 2 + 3
```

Wave plan (proposed, refined later when CLEO epics created):

| Wave | Epics | Why first |
|---|---|---|
| W0 (clear blockers) | T108 P0 security (existing), OPS-6 migration safety in CI, OPS-1 observability MVP | Cannot ship the rest safely without these |
| W1 (multi-agent roots) | MA-1 CRDT, MA-2 verified identity, MA-7 event ordering | Three pillars everything else builds on |
| W2 (presence + diff) | MA-4 presence, MA-6 differential subs, DIFF-1 truly differential disclosure | Now have CRDT + identity + events; can wire presence + delta sub |
| W3 (security hardening) | SEC-1 CSP/HSTS, SEC-3 tamper-evident audit (uses MA-2), SEC-7 PII/GDPR, SEC-8 real scopes | After core works, harden it |
| W4 (DX + spec) | DX-1 OpenAPI, DX-3 CLI, DX-4 reference agents | Now publish what's there |
| W5 (advanced diff/search) | DIFF-2 real embeddings, DIFF-3 cross-doc graph, DIFF-7 time-travel branches | Differentiation features |
| W6 (federation + compliance) | DIFF-6 federation, COMP-1 SOC2, COMP-3 audit retention | Enterprise-readiness |

---

## What I Refuse to Claim

- I will **NOT** call this "the best ever" — it isn't, and saying so would be unprofessional flattery
- I will **NOT** call this "production-ready for serious multi-agent workloads" — observability + backups + verified identity + actual CRDT all unshipped
- I will **NOT** claim T111 fixed everything — T111 fixed the SDK boundary and was a real win, but didn't touch the multi-agent core
- I will **NOT** treat the existence of a `merge.ts` file as evidence of "multi-agent collaboration" — sequential 3-way merge is not collaboration
- I will **NOT** treat docs/SSOT.md's prose about "Yrs not Y.js" as evidence Yrs is integrated — it isn't yet

---

## What I Will Claim (Honestly)

- T111 was real, hard, careful work. The SDK is now genuinely SDK-shaped. WASM-everywhere primitives are byte-identity-verified.
- The progressive-disclosure + section-aware retrieval pattern is genuinely under-served in the broader ecosystem and is a legitimate seed for differentiation.
- The deployment hygiene improvements today (CI hardening, schema-reset removal, idempotent workflows) are real lessons learned and recorded in memory so they don't repeat.
- The roadmap (Phases 5-11 epics + this expansion) is a credible 6-12 month path to genuine SOTA. The work is identifiable. Execution discipline shipped today suggests it's executable.

The honest verdict: **5.3/10 today, with a credible path to 8/10 if Layers 1-3 ship.** Anyone who tells you otherwise is selling something.
