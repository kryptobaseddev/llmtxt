# LLMtxt v2026.4.9 — Honest Scorecard

**Date**: 2026-04-17
**Reviewer**: Claude Sonnet 4.6 (subagent, no authorship bias)
**Methodology**: Adversarial. Every score requires concrete evidence. Evidence levels are
distinguished as: code-only / CI-green / prod-deployed / demo-verified.
**Sources**: `docs/RED-TEAM-ANALYSIS.md` (2026-04-14), `docs/RED-TEAM-ANALYSIS-2026-04-15.md`,
`docs/RED-TEAM-ANALYSIS-2026-04-16.md`, CHANGELOG `packages/llmtxt/CHANGELOG.md`,
live test run (618 backend pass / 0 fail — verified), git log, source inspection.

> **Trajectory**: 4.2 (2026-04-14) → 5.3 (2026-04-15) → 6.2 (2026-04-16) → **see below** (2026-04-17 / v2026.4.9)

---

## Part 1 — Guiding Star Scorecard (D003 + refined 7 properties)

The 7 properties come from CLEO memory D003 (durability / de-duplication / freshness) and the
expanded 7 properties first formulated in the 2026-04-15 red-team.

| # | Property | Score | Justification |
|---|----------|:-----:|---------------|
| 1 | **Never lose work** — durability, merge, audit, receipts, backups | **6.5/10** | Tamper-evident Merkle audit log with RFC 3161 TSA anchoring (T164, CI-green). CRDT Loro merge (T384, CI-green). `pg-backup.sh` with automated nightly GitHub Actions cron (`backup-nightly.yml`, code-only — secrets must be wired in Railway for prod activation). Graceful SIGTERM handler drains in-flight requests (T092, CI-green, `graceful-shutdown.test.ts`). Gap: backup tested in CI but Railway cron secret env vars not verified as set in production. No restore-drill evidence beyond the workflow file. Hash chain integrity tested (`audit-chain.test.ts`) but TSA token issuance is CI-green only — no prod-deployed evidence. |
| 2 | **Never duplicate work** — presence, locks, turn-taking, CRDT, dedup | **6.0/10** | CRDT Yrs/Loro sections prevent duplicate writes at CRDT merge level (T384/T388, CI-green). Advisory section leases with conflict detection (leases-integration.test.ts, 7/7 pass). Idempotency-key dedup on event log (document-events.test.ts). Gap: leases are advisory — a non-cooperating agent ignores them entirely; no enforcement at write path confirmed by source inspection of `routes/leases.ts`. Presence registry is in-process only (single-pod); a second Railway replica would have invisible presence set (REDIS_URL needed, env-gated). |
| 3 | **Never stale** — freshness, progressive disclosure, differential subscriptions | **7.0/10** | Differential subscriptions with `since=<seq>` SSE cursor; `Accept: application/vnd.llmtxt.diff+json` delta mode; 5x bandwidth reduction regression test (subscriptions-bandwidth.test.ts, 14/14 pass). Progressive disclosure (token-budget planner) shipped since v1. LLM-first content negotiation for `text/plain` + `text/markdown` (T014, code-shipped). Gap: no push-based delta delivery (agents must poll the SSE stream; no webhook delta-only variant). TF-IDF semantic search still not embedding-based — stale results on semantic queries. pgvector + ONNX embeddings wired in code but pgvector extension must be separately activated in production DB. |
| 4 | **Verify identity of actors** — signed writes, Ed25519 | **7.5/10** | Ed25519 per-agent keypair; nonce replay protection (5-min window); `SIGNATURE_REQUIRED` flag; `/.well-known/agents/:id` key discovery; key revocation via `revokedAt`; per-agent key rotation with 7-day old-key retention (T086/T090, CI-green, `agent-identity.test.ts` 10/10, `key-rotation.test.ts`). A2A envelope carries sig verification (a2a-vectors.test.ts, 16/16). Gap: `/.well-known/agents/:id` returns `{pubkey_hex, fingerprint}` only — no capability schema, no supported-operations list. Agent roster per-document not tracked durably. |
| 5 | **Verify nothing tampered** — hash chain, Merkle, RFC 3161 timestamp | **7.0/10** | SHA-256 hash chain over all audit-log entries; Merkle root published to `audit_roots`; RFC 3161 TSA token stored per root; `GET /audit/:id/verify` returns Merkle proof + TSA token; cross-language Rust audit-verifier example in `examples/` (T164/T107, `audit-chain.test.ts`). BFT approval chain has double-vote detection + key slash (bft-adversarial.test.ts, 9/9). CI workflow `audit-chain-verify.yml` runs verification. Gap: TSA token issuance hits an external TSA server — if prod runs without a TSA endpoint configured, tokens silently fail; not verified as prod-wired. |
| 6 | **Lose nothing on failure** — DLQ, retries, backoff | **5.5/10** | Webhook DLQ with exponential backoff, max-retry cap, dead-letter audit log (T165, `webhook-hardening.test.ts`). Scratchpad falls back to in-memory EventEmitter when REDIS_URL absent (acknowledged in source — warns loudly). CRDT pub/sub falls back to in-process EventEmitter when REDIS_URL absent. Nightly backup cron wired (`backup-nightly.yml`). Gap: scratchpad messages are lost on pod restart without Redis (in-memory fallback is explicitly not durable). No DLQ for SSE subscription drops — if a subscriber disconnects mid-event, it must replay from `Last-Event-ID` but there is no max-retention guarantee on the server event buffer. No chaos tests or partition tests. |
| 7 | **Don't impede others** — SLO, rate limits, fairness | **6.0/10** | Fine-grained rate limiting (progressive throttle, anon 10 req/min with abuse fingerprinting, T167). Body limit enforcement tested (`body-limit.test.ts`, `routes/disclosure.ts` 1 KB search cap T468, graph 500-node cap T469). Graceful shutdown drain (T092) prevents mid-request drops on redeploy. `GET /api/ready` health probe. SLO dashboard JSON exists (`ops/grafana/dashboards/slo.json`) and `slo-report.yml` CI workflow present. Prometheus `/api/metrics` endpoint wired (code-shipped). Gap: SLO p50/p95/p99 thresholds are defined as docs/JSON but there is no evidence they are wired to live Grafana alerts in production. `OTEL_EXPORTER_OTLP_ENDPOINT` is env-gated and not confirmed set in Railway prod — without it all traces are discarded. |

**Guiding Star Average: 6.5/10**

Calculation: (6.5 + 6.0 + 7.0 + 7.5 + 7.0 + 5.5 + 6.0) / 7 = **45.5 / 7 = 6.50**

---

## Part 2 — Bleeding-Edge Rubric (competitive landscape)

Peers for comparison: Liveblocks/Hocuspocus (CRDT infrastructure), Convex (real-time DB),
PartyKit (edge rooms), Tiptap collab (Y.js prose), Notion (collab+content).

| # | Dimension | Score | Justification |
|---|-----------|:-----:|---------------|
| 1 | **Multi-agent native design** — built for agents first, not bolted on | **6.0/10** | 8/8 multi-agent capability tests pass (CRDT, signed identity, event log, presence, leases, differential subs, BFT, A2A) in CI as of v2026.4.5. Progressive disclosure with token budgeting is a genuine agent-first primitive. CHANGELOG v2026.4.9 adds 7 subpath exports under stability contract. Gap: leases are advisory only with no write-path enforcement; agent capability manifest is pubkey only (no op schemas); no durable agent roster per document; no federation across deployments. Competitors like Liveblocks ship first-class room presence that actually prevents concurrent edits — LLMtxt's cooperative leases require all agents to behave. |
| 2 | **Open standards** — OpenAPI, signed provenance, portable subpaths, no lock-in | **7.0/10** | OpenAPI 3.1 spec generated at build time via forge-ts; Swagger UI at `/api/docs/api`; schema validated in CI (T169, code-shipped). Ed25519 standard (not proprietary). `/.well-known/agents/:id` follows well-known conventions. 7 versioned subpath exports under STABILITY.md contract (T550, CI-green with `subpath-contract.yml`). A2A envelope follows canonical format with cross-language test vectors. npm package `llmtxt` (unscoped) published with OIDC provenance. Gap: OpenAPI spec existence at `/api/docs/api` confirmed in source but production URL `api.llmtxt.my/docs/api` not probed in this session — 2026-04-15 red-team found `/openapi.json` was 404; v2026.4.9 claims this is fixed but evidence is code-shipped only. No Postman collection published. |
| 3 | **Transparency / auditability** — cryptographic audit log with external anchor | **7.5/10** | Merkle hash chain on every audit entry; RFC 3161 TSA anchoring; `GET /audit/:id/verify` Merkle proof endpoint; cross-language Rust audit-verifier in examples (T164/T107). BFT chain with signed approvals and key slash on Byzantine behavior. Hash-verify-on-read for blob attachments (T428). Dedicated `audit-chain-verify.yml` CI workflow. This is a genuine differentiator — few competitors publish tamper-evident logs with TSA anchoring. Gap: TSA token issuance requires external TSA server; prod wiring unverified. Legal-hold flag and 7-year archive tier not shipped. |
| 4 | **Real-time collaboration** — CRDT, presence, BFT consensus | **6.5/10** | Loro CRDT (T384/T388) for sections, replacing Yrs; yjs-sync-v1 WS handler with persist-before-broadcast; Redis pub/sub fan-out for CRDT (when REDIS_URL set). Presence registry with 30-s TTL and REST endpoint. WS awareness handler (y-sync awareness protocol). BFT quorum consensus with signed approvals. Gap: presence is in-process only (no Redis fan-out for awareness — only CRDT updates have Redis fan-out); a second pod creates a split presence view. No cursor positions beyond `cursorOffset` integer. No suggestion/track-changes mode. Compare to Liveblocks: multi-pod presence, cursors with user metadata, undo stacks, conflict-free by design. LLMtxt is 1–2 releases behind on the UX layer of collab. |
| 5 | **Content intelligence** — progressive disclosure, semantic search, diff semantics | **6.0/10** | Section-aware retrieval with token-budget planner (greedy knapsack). Multi-way LCS diff (T083 Rust). Three-way merge. Cross-document graph with backlinks. `Accept: .diff+json` differential mode. Similarity search via TF-IDF ported to Rust (T125). pgvector + ONNX embeddings wired in schema and jobs (T102/T103) with automatic fallback if extension absent. Gap: TF-IDF is not 2026-competitive — contextual embeddings (sentence-transformers) are industry standard. pgvector embeddings exist in migration and job code but whether the pgvector extension is actually enabled in Railway prod DB is unverified. No suggestion mode / block-level editing. No LLM-aware compression (T183 unshipped). |
| 6 | **Ecosystem maturity** — SDK quality, docs, examples, CLI, contract tests | **6.5/10** | 7 subpath exports under stability contract with CI guard (`check-subpath-exports.sh`). Backend contract test suite (25-test parameterised harness). `llmtxt` CLI binary (`init`, `create-doc`, `push-version`, `pull`, `watch`, `search`, `keys`, `sync`). CLEO integration example (`apps/examples/cleo-integration/`). Fumadocs docs site live at `docs.llmtxt.my`. CHANGELOG enforced in CI. STABILITY.md + deprecation policy (T612). Gap: only 1 reference example (`cleo-integration`) — no generic `review-bot`, `observer-bot`, or `writer-bot` in an `examples/` directory accessible to external developers. OpenAPI Postman artifact not published. Error code catalog not documented. CLI covers core ops but no `demo` or `test` subcommands. |
| 7 | **Deployment story** — local, hub-spoke, P2P mesh, standalone | **7.0/10** | LocalBackend (SQLite, zero-dep), RemoteBackend (HTTP/WS thin client), hub-spoke topology with blob integration test (T429/T465, 5-agent test), 5-peer mesh with convergence verified (T420/T421), Ed25519 mutual handshake on P2P transport (T414/T415). `llmtxt mesh` CLI subcommands (start/stop/status/peers/sync). AgentSession state machine (T426). Gap: cr-sqlite CRR integration (T385) ships as single-tenant only — production-ready per CHANGELOG mandate but no multi-tenant CRR in prod. Mesh is tested in CI but not deployed as a live demo endpoint. Loro is "greenfield" — no migration path from prior Yrs state documented for existing users. |
| 8 | **Security posture** — RLS, KMS, CSP/HSTS, tamper-evident log | **7.0/10** | CSP + HSTS + COEP/COOP headers added (T162/T163, `security-headers.test.ts`). XSS sanitization via DOMPurify with 50+ OWASP payload fuzz suite (T163, `xss-sanitize.test.ts`, 54/54 pass). RLS enabled on 21 tenant-scoped tables (T534–T540, `rls-isolation.test.ts`). KMS abstraction with `LocalKms` + `AwsKmsAdapter` (T086/T090). Per-agent key rotation with 7-day overlap. Merkle audit chain. GDPR erasure + retention (T168). Gap: `SIGNATURE_REQUIRED` is an opt-in env flag — not enforced by default (unauthenticated agent writes still possible without it). No fuzz testing beyond XSS. Secret rotation runbook exists but not automated (no cron). RLS is at the Postgres layer but app-layer RBAC and RLS may diverge silently (no coverage test that deliberately bypasses RBAC and checks RLS catches it). |
| 9 | **Compliance readiness** — SOC 2, GDPR, DPA | **5.5/10** | GDPR: `GET /me/export` signed ZIP archive, `DELETE /me` right-to-erasure with 30-s PII pseudonymization, configurable retention cron, erasure audit log (T094/T168, `user-data-routes.test.ts`). SOC 2 Type 1 readiness self-assessment doc (`docs/compliance/soc2-type1-readiness.md`) with control mapping. DPA template (`docs/legal/dpa-template.md`). Sub-processor list (`docs/legal/sub-processors.md`). Data residency env var `DATA_RESIDENCY_REGION`. Gap: SOC 2 readiness doc is a self-assessment — no independent auditor engaged. GDPR `DELETE /me` is 30-s pseudonymization, not true deletion; blob deletion is queued asynchronously — timing guarantee unclear. No GDPR DPA with customers signed. No cookie consent management wired. Retention cron is wired in code but prod schedule not verified. |
| 10 | **Performance / efficiency** — latency, throughput, token-efficient for LLMs | **5.0/10** | WASM-backed primitives (compression, CRDT ops, hash, slugify, similarity) avoid JS overhead. TF-IDF runs in Rust. Prometheus `/api/metrics` with HTTP duration histograms. Graceful shutdown prevents request drops on redeploy. zlib compression on stored content. Gap: No load tests published (no k6/wrk baseline). No p50/p95 latency numbers from production ever published. SLO dashboard JSON exists but is wired to self-hosted Grafana (env-gated) — whether it reflects live prod data is unverified. Still on zlib — not zstd (2026-04-14 red-team identified zstd as 1.3-1.5x better). No streaming API for large documents. Token-budget planner is greedy knapsack, not ML-optimized. |

**Bleeding-Edge Average: 6.45/10**

Calculation: (6.0 + 7.0 + 7.5 + 6.5 + 6.0 + 6.5 + 7.0 + 7.0 + 5.5 + 5.0) / 10 = **64.0 / 10 = 6.40**

---

## Part 3 — Composite

| Rubric | Score |
|--------|:-----:|
| Guiding Star (7 properties) | **6.5/10** |
| Bleeding-Edge Competitive (10 dimensions) | **6.4/10** |
| **Weighted Composite** (50/50) | **6.5/10** |

**Overall verdict**: LLMtxt v2026.4.9 is a competent, well-structured multi-agent document
platform that has closed the majority of its v1 gaps — 8/8 multi-agent capability areas now have
CI-green test coverage, RLS + CSP + GDPR + OpenAPI all shipped in this release cycle — but it
remains a mid-tier entrant against SOTA peers (Liveblocks, Convex, Hocuspocus) due to advisory-only
leases, env-gated observability that is unverified in production, and no evidence of real throughput
numbers or external audit. It does not yet deliver on "best and most bleeding-edge LLM agent
multi-collaboration tool in the world."

**Score trajectory (consistent 6-layer weighted basis)**:
4.2 (2026-04-14) → 5.3 (2026-04-15) → 6.2 (2026-04-16) → **6.5 (2026-04-17 / v2026.4.9)**

---

## Part 4 — What Would Move This to 9.0/10

Ordered by expected score impact per effort.

### P0 — Each of these is worth ~0.3-0.5 points

1. **Lease enforcement at write path** (epic needed — extend T083/leases): A non-cooperating
   agent can still write to a leased section. Until section lease violations return 409 at the
   write route, the leasing primitive is trust-based. Score impact: Guiding Star property 2 from
   6.0 → 8.0.

2. **Redis fan-out for presence/awareness** (T083 extension): Without Redis pub/sub for awareness
   messages, a second Railway pod splits presence state. This blocks horizontal scaling — the
   single-pod limit caps both reliability and load. Score impact: Guiding Star properties 2+7,
   bleeding-edge dimension 4.

3. **Verify observability in production** (ops task): Confirm `OTEL_EXPORTER_OTLP_ENDPOINT`,
   `SENTRY_DSN`, `LOKI_HOST` are set in Railway env. Run a test request and verify the span
   appears in Grafana/Tempo. Until this is demo-verified, the entire observability layer is
   code-only. Score impact: all OPS-related dimensions.

4. **Restore drill with evidence** (ops task): `restore-drill-monthly.yml` exists — run it
   manually once, record timing and data-integrity check output, append to runbook. Without a
   completed drill, "backup" is not the same as "recoverable". Score impact: Guiding Star
   property 1 from 6.5 → 7.5+.

### P1 — Each worth ~0.2-0.3 points

5. **Agent capability manifest** (extend T223 / well-known-agents route): Add `capabilities`,
   `supported_ops`, and `schema_version` fields to `/.well-known/agents/:id`. Enables
   agent-to-agent capability discovery — currently `pubkey_hex` only. Score impact: bleeding-edge
   dimension 1.

6. **Zstd over zlib** (small Rust task in crates/llmtxt-core): 1.3-1.5x better ratio, 8x faster
   decompression. Identified in 2026-04-14 red-team, still unshipped. Score impact: bleeding-edge
   dimension 10.

7. **Load test baseline** (k6/wrk task): One k6 script against `POST /v1/documents` +
   `GET /v1/documents/:slug` that publishes p50/p95/p99. Without numbers, the performance claim
   is marketing. Score impact: bleeding-edge dimension 10 from 5.0 → 7.0.

8. **Reference agent implementations** (extend examples/): A `review-bot`, `writer-bot`, and
   `observer-bot` under `apps/examples/` with README. "How do I build a review bot?" currently
   has no answer for an external developer. Score impact: bleeding-edge dimension 6 from 6.5 →
   8.0.

### P2 — Needed for 9.0+ claim

9. **Contextual embeddings replacing TF-IDF** (epic T102/T103 follow-on): Deploy pgvector
   extension in Railway prod, activate ONNX embedding job, verify similarity search results.
   TF-IDF is not 2026-competitive. Score impact: bleeding-edge dimension 5 from 6.0 → 8.0.

10. **Independent SOC 2 Type 1 audit** (compliance epic): Engage a licensed CPA firm. The
    self-assessment exists and is well-structured — the control mapping is done. An external audit
    converts that into a certifiable claim. Score impact: bleeding-edge dimension 9 from 5.5 →
    8.5.

11. **Suggestion / track-changes mode** (epic T172): Inline suggestions with accept/reject are
    table-stakes for document collaboration in 2026. Every major peer (Notion, Google Docs,
    Liveblocks) ships this. Score impact: bleeding-edge dimensions 4+5.

12. **Enforce `SIGNATURE_REQUIRED` by default** (security task): The Ed25519 identity system is
    real and well-tested, but opt-in. Default-on would make the identity property a hard
    guarantee rather than a flag. Score impact: bleeding-edge dimension 8 and Guiding Star
    property 4.

---

## Evidence Quality Notes

| Claim in CHANGELOG | Evidence level | Honest note |
|--------------------|:-------------:|-------------|
| 618 backend tests pass | **demo-verified** | `pnpm --filter backend test` run in this session: 618/618 |
| Rust core tests | **code-only** | Cargo test runner returned ferrous-forge error (cwd issue); count taken from CHANGELOG claim of 328/328 as of v2026.4.6; T550 subpath contract tests CI-green per `subpath-contract.yml` |
| OpenAPI `/api/docs/api` live | **code-shipped** | Route wired in `src/routes/docs.ts` and `src/index.ts`; 2026-04-15 probe found 404 — not re-probed in this session |
| RFC 3161 TSA tokens | **CI-green** | `audit-chain.test.ts` passes; prod TSA endpoint config unverified |
| Backup nightly cron | **code-shipped** | `backup-nightly.yml` with `0 3 * * *` schedule; Railway secrets `DATABASE_URL_PG` + `BACKUP_AGE_RECIPIENT` must be set — not confirmed |
| pgvector semantic search | **code-shipped** | Migration + job code exist; prod pgvector extension activation unverified |
| SLO alerts active | **code-shipped** | `ops/grafana/dashboards/slo.json` + `slo-report.yml` present; Grafana prod wiring env-gated |
| CSP / HSTS headers | **CI-green** | `security-headers.test.ts` passes in CI; prod headers not re-probed |
| RLS on 21 tables | **CI-green** | `rls-isolation.test.ts` passes; prod RLS mode (`REQUIRE_VERIFIED_IDENTITY`, SET LOCAL hooks) env-gated |
