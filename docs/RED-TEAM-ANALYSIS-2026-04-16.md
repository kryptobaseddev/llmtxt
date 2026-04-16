# LLMtxt Red-Team Analysis — 2026-04-16

> **Status**: Supersedes `docs/RED-TEAM-ANALYSIS-2026-04-15.md` (scored 5.3/10).
>
> **Methodology**: Test-first. All claims derived from `pnpm --filter backend test` output (144/144 pass) and `cargo test --all-features` output (328/328 pass). Adversarial framing maintained. No flattery.
>
> **Sprint scope assessed**: W1 (CRDT/Yrs WS sync, Ed25519 signed writes, document event log), W2 (Presence/awareness, turn-taking leases, differential subscriptions), W3 (Byzantine-tolerant consensus, shared scratchpad, A2A message envelope), plus Backup/DR strategy and Observability (OTel, Sentry, pino-loki, prom-client).

---

## Multi-Agent Test Suite Results

Each row maps to one of the 8 capability areas from the prior red-team's "0/8 fully pass" verdict.

| # | Capability | Test file(s) | Pass | Fail | Notes |
|---|---|---|:---:|:---:|---|
| 1 | CRDT concurrent editing | `crdt.test.ts` | 9 | 0 | Two-agent convergence, byte-identity, state-vector diff, merge-updates all pass. CRDT primitives via Yrs (via SDK). WS sync route (`ws-crdt.ts`) ships full yjs-sync-v1 protocol with persist-before-broadcast. |
| 2 | Signed writes + identity verification | `agent-identity.test.ts` | 10 | 0 | Ed25519 keypair per agent. Tampered sig → 401. Replayed nonce → 401. Revoked key → 401. Skew > 5 min → 401. SIGNATURE_REQUIRED flag. 10 concurrent signed writes verified. |
| 3 | Event log integrity + replay | `document-events.test.ts` | 8 | 0 | Monotonic seq (5 concurrent appends, no gaps). SHA-256 hash chain. Idempotency key dedup. `since=` cursor. `Last-Event-ID` resume. BFT event types in canonical log. |
| 4 | Presence / awareness | `presence-registry.test.ts` + `ws-awareness.test.ts` | 11 | 0 | Registry: upsert, expiry (30 s TTL), cursorOffset. WS awareness handler: multi-agent in same doc, broadcast excludes sender, malformed update safe. REST endpoint at `GET /documents/:slug/presence`. |
| 5 | Turn-taking leases | `leases-integration.test.ts` | 7 | 0 | acquireLease, conflict on overlap, release, renewLease by non-holder returns null, TTL expiry, release-and-reacquire. Advisory (not hard lock) — documented clearly. Expiry job + SSE events on acquire/release. |
| 6 | Differential subscriptions | `subscriptions-bandwidth.test.ts` + `path-matcher.test.ts` | 14 | 0 | Delta payload >= 5x smaller than full. No-op case (null delta). Path pattern matching with params and wildcards. `since=<seq>` SSE backfill + live bus fan-out. `Accept: application/vnd.llmtxt.diff+json` diff mode. |
| 7 | Byzantine consensus | `bft-adversarial.test.ts` | 9 | 0 | bftQuorum(f=1)=3. 3 honest votes reach quorum. 2 Byzantine votes do not. Double-vote (APPROVED then REJECTED) detected + key slashed. Hash chain integrity for 10 events. Tamper at position 5 detected. End-to-end: 3+2 scenario consensus holds. |
| 8 | A2A message envelope | `a2a-vectors.test.ts` + `scratchpad.test.ts` | 16 | 0 | Cross-implementation test vectors (TS signs, Rust canonical format matches). Tampered payload fails. Wrong key fails. Canonical format: `from\nto\nnonce\ntimestamp_ms\ncontent_type\npayload_hash_hex`. Scratchpad: 3-agent chat, thread filtering, subscribe, TTL purge, cursor. |

**Result: 8/8 capability areas pass. 84 dedicated tests across the 8 suites, 0 failures.**

### Full Suite Totals

| Runtime | Tests | Pass | Fail |
|---|---:|---:|---:|
| Node.js backend (`pnpm --filter backend test`) | 144 | 144 | 0 |
| Rust core (`cargo test --all-features`, crates/llmtxt-core) | 328 | 328 | 0 |
| **Grand total** | **472** | **472** | **0** |

Rust breakdown: 316 unit tests + 3 cross-language vector tests + 2 multi-version diff tests + 7 doc-tests.

---

## Layer-by-Layer Scoring

### Weights (unchanged from 2026-04-15)

| Layer | Weight |
|---|:---:|
| MA — Multi-Agent Core | 30% |
| OPS — Operational Reliability | 20% |
| SEC — Security | 15% |
| DX — Developer Experience | 15% |
| DIFF — Differentiated Capabilities | 12% |
| COMP — Compliance / Trust | 8% |

---

### MA — Multi-Agent Core (was 3/10)

**Score: 6.5/10** (+3.5)

| Feature | 2026-04-15 | 2026-04-16 | Evidence |
|---|:---:|:---:|---|
| CRDT concurrent editing | No | Yes | Yrs via SDK; `ws-crdt.ts` yjs-sync-v1 protocol; persist-before-broadcast; Redis pub/sub for cross-process fan-out; compaction trigger on WS close. |
| Verified agent identity | No | Yes | Ed25519 per-agent keypair; `SIGNATURE_REQUIRED` flag; nonce replay protection; `/.well-known/agents/:id` key discovery; key revocation. |
| Agent capability manifest | No | Partial | `/.well-known/agents/:id` returns pubkey + fingerprint. Does NOT yet return capability list or supported op schemas. |
| Presence + awareness | No | Yes | `PresenceRegistry` (in-process, 30 s TTL); WS awareness handler (y-sync awareness protocol); cursorOffset stored; REST endpoint. Not yet durable across restarts. |
| Turn-taking leases | No | Yes | Advisory section leases with TTL, conflict detection, renew, release, expiry job, SSE events. Not hard locks — cooperative only. |
| Differential subscriptions | Partial | Yes | `since=<seq>` SSE from DB + live bus. `Accept: .diff+json` content-delta mode. Path pattern matching. Bandwidth regression test: 5x smaller delta verified. |
| Event ordering guarantees | Partial | Yes | Per-doc monotonic `event_seq_counter` (atomic DB UPDATE); SHA-256 hash chain; `Last-Event-ID` replay; idempotency key dedup. |
| Byzantine resistance | No | Yes | BFT quorum (2f+1); Ed25519 signed approvals; hash chain over approval events; double-vote detection + key slash; BFT route at `/documents/:slug/bft/approve`. |
| Shared scratchpad | No | Yes | Redis Streams (in-memory fallback when REDIS_URL absent); thread_id filtering; TTL purge; cursor-based resume; `POST /scratchpad`, `GET /scratchpad`. |
| Agent-to-agent messaging | No | Yes | A2A message envelope (from/to/nonce/timestamp_ms/content_type/payload+sig); HTTP inbox at `/agents/:id/inbox` (POST + GET); 48 h TTL; signature verification on delivery. |

**Why not higher**: CRDT presence is in-process only (no Redis fan-out for awareness across pods). Agent capability manifest is pubkey-only, not full capability schema. CRDT compaction is implemented but compaction restores sections sequentially on WS connect (no optimistic sync). No integrated "agent roster" per document. Leases are advisory only with no enforcement at the write path.

---

### OPS — Operational Reliability (was 5/10)

**Score: 6.5/10** (+1.5)

| Feature | 2026-04-15 | 2026-04-16 | Evidence |
|---|:---:|:---:|---|
| Observability stack | No | Partial | OTel SDK + auto-instrumentations in `instrumentation.ts`; OTLP/HTTP exporter (env-gated); Sentry error tracking (DSN-gated); pino → Loki (LOKI_HOST env); prom-client `/api/metrics`. PII scrubbing on Authorization/Cookie spans. |
| Prometheus metrics endpoint | No | Yes | `GET /api/metrics` — HTTP duration histogram, request counter, domain event counters (document, approval, version, webhook). Default process metrics (CPU, GC, event loop). |
| Health + readiness probes | Partial | Yes | `GET /api/health` (liveness, no I/O, <50 ms); `GET /api/ready` (SELECT 1 on active DB). Both exempt from auth + rate limiting. |
| Backup + DR | No | Partial | `pg-backup.sh`: pg_dump + age encryption + S3/R2 upload. 7-day retention logic. Restore drill documented. Ops runbook (408 lines). NOT yet automated as a cron/Railway cron job — manual trigger only. |
| Postgres migration | Yes | Yes | Idempotent migrations; CI migration-check job; schema-reset footgun removed. |
| Graceful shutdown | No | No | SIGTERM handler not wired. In-flight requests may be dropped on redeploy. |
| SLO/SLI definition | No | No | No p50/p95/p99 targets. No error budget. No alert routing. Metrics exist but no thresholds set. |
| Chaos / fault injection | No | No | No chaos tests. No partition tests. No clock-skew tests. |
| Load tests | No | No | No k6/wrk scripts. No baseline ops/sec published. |
| Secret rotation | No | No | T090 unshipped. SESSION_SECRET/API_KEY_SECRET are long-lived. |

**Why not higher**: Observability is wired but entirely env-gated — in production without OTEL_EXPORTER_OTLP_ENDPOINT set, spans are discarded (no-op). Backup is a script, not a scheduled job. Graceful shutdown missing. No load tests or SLOs. Redis for scratchpad is in-memory fallback (not durable). Presence registry is in-process (single pod only).

---

### SEC — Security (was 5.5/10)

**Score: 6.5/10** (+1.0)

| Feature | 2026-04-15 | 2026-04-16 | Evidence |
|---|:---:|:---:|---|
| Signed writes + nonce replay | No | Yes | Ed25519; 5-minute timestamp window; nonce stored in DB; SIGNATURE_REQUIRED env flag. |
| BFT consensus (tamper-evident chain) | No | Yes | Hash chain over approval events; double-vote detection; key revocation on Byzantine behavior. |
| Key discovery + revocation | No | Yes | `/.well-known/agents/:id`; `revokedAt` column; revocation check on every verification. |
| CSP + HSTS | No | No | CSP header still absent from HTTP responses. HSTS depends on Cloudflare edge (not set in app). |
| Markdown XSS sanitization | No | No | No fuzz testing of stored markdown render paths. Frontend sanitization assumed. |
| Row-level security | No | No | T085 (SEC-5) still unshipped. App-layer RBAC only. |
| API key scopes enforced | Partial | Partial | `scopes` column exists. Enforcement is app-layer route-by-route, not a systematic scope registry. `scopes:*` is still effectively a wildcard with no fine-grained enforcement. |
| Secret rotation | No | No | SESSION_SECRET and API_KEY_SECRET are long-lived. No rotation runbook. |
| GDPR / PII | No | No | No right-to-erasure endpoint. No PII retention policy. |

**Why not higher**: The security posture improved in depth (signed writes + BFT are real) but the attack surface improvements (CSP, RLS, secret rotation, XSS fuzz) are still zero. Adding signed writes while leaving CSP absent is an asymmetric improvement — the strongest attacks (XSS, SSRF, stolen long-lived API key) are still unmitigated.

---

### DX — Developer Experience (was 7.5/10)

**Score: 7.5/10** (0)

| Feature | 2026-04-15 | 2026-04-16 | Evidence |
|---|:---:|:---:|---|
| SDK exports (CRDT, identity, A2A, leases) | Partial | Yes | `packages/llmtxt/src/crdt-primitives.ts`, `identity.ts`, `leases.ts`, `awareness.ts`, `subscriptions.ts` all export from WASM/SDK layer. |
| OpenAPI spec | No | No | `/openapi.json` still 404 on production. No Swagger UI. forge-ts type checks but no spec generation wired. |
| CLI for agents | No | No | No `llmtxt` CLI. |
| Reference agent implementations | No | No | No `examples/` directory with worked bots. |
| SDK docs (docs.llmtxt.my) | Yes | Yes | Fumadocs deployed. |
| CHANGELOG enforced | Yes | Yes | CI validates CHANGELOG entries. |
| Error message catalog | No | No | Error codes in code but no docs page. |

**Why not higher than 7.5**: SDK is now cleanly shaped (T111 win held) and exports the new CRDT/identity/A2A primitives. But the DX story for an external developer remains: no OpenAPI spec → no code-gen, no Postman collection. No CLI means agents must roll their own HTTP client. No reference implementations means "how do I build a review bot?" has no answer. The gap between "SDK exists" and "SDK is usable by a new developer in one hour" is still large.

---

### DIFF — Differentiated Capabilities (was 3/10)

**Score: 5.5/10** (+2.5)

| Feature | 2026-04-15 | 2026-04-16 | Evidence |
|---|:---:|:---:|---|
| Truly differential progressive disclosure | No | Yes | `since=<seq>` SSE cursor. `Accept: .diff+json` content delta (section text diff included). 5x bandwidth reduction verified in regression test. |
| CRDT-backed concurrent editing | No | Yes | Yrs-based CRDT (per SSoT: Rust crate owns primitives); WS sync. This is the biggest competitive differentiator vs sequential LWW. |
| Embedding-based semantic search | No | No | Still TF-IDF (ported to Rust in T125 — that's good, but not contextual embeddings). No pgvector. No vector DB. |
| Cross-document graph queries | Partial | Partial | Graph module exists (`routes/graph.ts`); backlinks wired. Not yet queryable as "show me docs about X". |
| Block / suggestion mode | No | No | T172 (DIFF-4) unshipped. |
| LLM-aware compression | No | No | T183 (DIFF-8) unshipped. Generic zlib/Brotli only. |
| Time-travel + branch | No | No | Sequential versioning only. No git-like branches. |

**Why not higher**: CRDT + differential subscriptions are real wins. But the "genuinely different from all peers" claims still rest on progressive disclosure (which peers like Liveblocks also do) and WASM-everywhere primitives (which is an architecture win, not a user-facing feature). Embeddings + vector search = still TF-IDF. Suggestion mode = zero. Federation = zero. These are the features that would make a competitor nervous.

---

### COMP — Compliance / Trust (was unscored, estimated 1/10)

**Score: 2/10** (+1)

| Feature | 2026-04-15 | 2026-04-16 | Evidence |
|---|:---:|:---:|---|
| Audit log retention | No | Partial | Append-only event log with hash chain and seq. No 7-year archive tier. No legal-hold flag. No export endpoint. |
| Right-to-deletion | No | No | T180 (COMP-4) unshipped. |
| SOC 2 readiness | No | No | No control inventory. No gap analysis. |
| Data residency | No | No | Single Railway region. No multi-region plan. |
| Sub-processor list | No | No | Not published. |
| DPA template | No | No | Not available. |

**Why not higher**: The hash-chained event log is a meaningful trust building block (a regulator can verify no events were deleted). Everything else is untouched. This layer was always going to be last — it requires a mature ops and security posture first. The honest position is: LLMtxt is not enterprise-ready and should not be sold as such.

---

## Composite Score

| Layer | Weight | 2026-04-15 | 2026-04-16 | Delta |
|---|:---:|:---:|:---:|:---:|
| MA — Multi-Agent Core | 30% | 3.0 | **6.5** | +3.5 |
| OPS — Operational Reliability | 20% | 5.0 | **6.5** | +1.5 |
| SEC — Security | 15% | 5.5 | **6.5** | +1.0 |
| DX — Developer Experience | 15% | 7.5 | **7.5** | 0 |
| DIFF — Differentiated Capabilities | 12% | 3.0 | **5.5** | +2.5 |
| COMP — Compliance / Trust | 8% | 1.0 | **2.0** | +1.0 |
| **Composite** | **100%** | **4.58** | **6.0** | **+1.42** |

Calculation:
- 6.5 × 0.30 = 1.950
- 6.5 × 0.20 = 1.300
- 6.5 × 0.15 = 0.975
- 7.5 × 0.15 = 1.125
- 5.5 × 0.12 = 0.660
- 2.0 × 0.08 = 0.160
- **Total: 6.17/10** (rounds to **6.2/10**)

> Note: The 2026-04-15 analysis headline used a different layer set (Architecture, Operational reliability, Security, Multi-agent core, Test coverage depth, Developer experience, Real-time collaboration, Observability, Documentation) and equal weights, producing 5.3/10. This document uses the 6-layer weighted framework from the full analysis. The 2026-04-15 score recalculated on the same 6-layer weighted framework was ~4.6/10. Delta from this sprint is therefore ~+1.6 on a consistent basis.

---

## Comparison to 2026-04-15 Baseline

| Area | 2026-04-15 verdict | 2026-04-16 verdict |
|---|---|---|
| CRDT | "Yrs in docs/SSOT.md is future state, not code" | CRDT is code. Yrs primitives via SDK. yjs-sync-v1 WS handler ships. |
| Verified identity | "Trust-me agentId" | Ed25519 keypairs, nonce replay, key revocation, SIGNATURE_REQUIRED flag. |
| Presence | "Zero matches for presence" | PresenceRegistry, awareness handler, cursorOffset, REST endpoint. |
| Leases | "Only autoLock + LWW" | Advisory section leases with TTL, conflict, release, expiry job. |
| Event ordering | "No monotonic sequence" | Monotonic per-doc seq counter, hash chain, Last-Event-ID replay. |
| Differential subs | "Agents poll whole sections" | `since=<seq>` cursor, diff mode, 5x bandwidth reduction verified. |
| Byzantine resistance | "A single malicious agent can corrupt" | BFT quorum 2f+1, signed approvals, double-vote detection, key slash. |
| A2A messaging | "No conduit between agents" | A2A envelope, HTTP inbox, scratchpad, test vectors. |
| Observability | "Zero metrics, zero tracing, zero error tracking" | OTel + Sentry + pino-loki + prom-client. All env-gated — zero-cost if unset. |
| Backup | "Volume failure = total data loss" | pg-backup.sh (pg_dump + age encryption + S3). Manual trigger, not automated cron. |
| Multi-agent test score | 0/8 | **8/8** |
| Composite | 5.3/10 (prior methodology) | **6.2/10** |

---

## Remaining Gaps (Honest List)

These are the gaps that prevent claiming "bleeding-edge" or "production-ready for serious multi-agent workloads." Ordered by impact.

### P0 — Still blocks "production-ready" claim

1. **Graceful shutdown missing.** No SIGTERM handler. Railway redeploys drop in-flight requests. Every other item on this list is secondary to this for production reliability.
2. **Backup not automated.** `pg-backup.sh` exists and is correct, but it runs only on manual trigger. A cron failure means no backup. Needs Railway cron or GitHub Actions schedule.
3. **Presence is in-process only.** `PresenceRegistry` is a Node.js Map — a second Railway replica would have an invisible presence set. Redis fan-out needed before horizontal scaling.
4. **Observability is env-gated, not wired by default.** Without OTEL_EXPORTER_OTLP_ENDPOINT, all spans are discarded. A production deploy without the env var is effectively unobserved.

### P1 — Blocks "multi-agent" competitive claim

5. **Agent capability manifest is pubkey only.** `/.well-known/agents/:id` returns `{pubkey_hex, fingerprint}` but not capabilities, supported operations, or schema versions. Agents cannot discover what each other can do.
6. **Advisory leases have no write-path enforcement.** A non-holder agent can still write to a leased section. Cooperative only — a buggy or malicious agent ignores leases entirely.
7. **CRDT presence not replicated across WS pods.** Awareness is per-process. Multi-pod awareness requires Redis pub/sub fan-out for awareness messages (not just CRDT updates).
8. **No "agent roster" per document.** No durable record of which agents are subscribed to or authorized for a given document's collaboration session.

### P2 — Blocks competitive differentiation

9. **Semantic search is still TF-IDF.** Contextual embeddings (sentence-transformers, pgvector) are unshipped. TF-IDF is not competitive with embedding-based retrieval in 2026.
10. **No suggestion / track-changes mode.** Inline suggestions with accept/reject are table-stakes for document collaboration. Unshipped.
11. **No OpenAPI spec.** Agents must read source code to discover routes. Code-gen, Postman, external integrations are all blocked.
12. **No reference agent implementations.** "How do I build a review bot?" has no example answer. This is the #1 DX gap for adoption.

### P3 — Enterprise readiness (longer horizon)

13. **CSP header absent.** Any XSS in stored markdown content is not mitigated at the HTTP layer.
14. **Secret rotation undocumented + unautomated.** SESSION_SECRET and API_KEY_SECRET are long-lived. No rotation runbook.
15. **Row-level security not implemented.** App-layer RBAC only. PG RLS as defense-in-depth is unshipped.
16. **No right-to-erasure endpoint.** GDPR non-compliant.
17. **No SLO definition.** No p95 targets. No error budget. No alert thresholds.

---

## What I Refuse to Claim

- I will NOT call this "the best ever." It is now a significantly more capable v1 with real CRDT, real identity, and real multi-agent primitives — but peers (Hocuspocus, Liveblocks, Convex) have multi-year production history, more integrations, and more SDKs.
- I will NOT claim the 8/8 test passage means production-multi-agent workloads are safe. The tests validate the primitives. They do not validate distributed behavior under failure, multi-pod presence, or adversarial load.
- I will NOT claim observability is "shipped" in the sense that anyone can observe the production system today. It is wired and waiting for env vars.

## What I Will Claim (Honestly)

- All 8 multi-agent capability primitives now have real implementations with real passing tests. This is a genuine 8/8 improvement from 0/8.
- The CRDT story is now real: Yrs via SDK, WS sync protocol, persist-before-broadcast, Redis pub/sub fan-out for CRDT updates. This is the hardest item in the prior gap list and it shipped.
- The identity story is now real: Ed25519 signing, nonce replay protection, key discovery, key revocation.
- The event log is now genuinely useful: monotonic sequence, hash chain, cursor replay, idempotency.
- 472/472 tests pass. Zero failures.
- Composite score: **6.2/10** (up from ~4.6/10 on the same framework, or up from 5.3/10 on the prior simpler framework).
- LLMtxt is no longer "a promising v1 with a multi-agent gap." It is a working multi-agent document collaboration system that needs production hardening.
