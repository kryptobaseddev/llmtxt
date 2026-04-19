# T700 Epic Tree — Actual CLEO ID Mapping

Generated: 2026-04-19
Source scorecards: scorecard-v2026.4.9.md (6.5/10), T308-verification-v2026.4.9.md (6/8)

## Root Epic

T700_ACTUAL (spec) = T698 (CLEO)  — "v2026.4.10 Score 9/10 + T308 8/8"

## Wave 0 — CRITICAL (blockers for 8/8 + security)

T701_ACTUAL = T699  — "T701: /compress endpoint ownerless doc fix (RLS bypass)"
T702_ACTUAL = T700  — "T702: T308 Cap 2 fix: CRDT WS observer ordering"
T703_ACTUAL = T701  — "T703: T308 Cap 7 fix: BFT SSE propagation to consensus-bot"

## Wave 1 — HIGH (multi-pod correctness)

T704_ACTUAL = T702  — "T704: Redis-backed presence registry (multi-pod)"
T705_ACTUAL = T703  — "T705: Redis-backed scratchpad durability"
T706_ACTUAL = T704  — "T706: Advisory lease to enforced lease at write path"

## Wave 2 — HIGH (production observability)

T707_ACTUAL = T705  — "T707: TSA token prod wiring verification"
T708_ACTUAL = T706  — "T708: SLO alerts wired to live Grafana verification"
T709_ACTUAL = T707  — "T709: pgvector extension verified active in prod"

## Wave 3 — MEDIUM (performance)

T710_ACTUAL = T708  — "T710: zlib to zstd compression migration"
T711_ACTUAL = T709  — "T711: Published load-test baselines (k6)"

## Wave 4 — COMPLIANCE (audit prep, pending external)

T712_ACTUAL = T710  — "T712: SOC 2 external audit engagement prep"

---

## Subtask ID Map

### T699 subtasks (compress RLS fix)
T699.1 = T711  — Inspect compress.ts and reproduce ownerless doc bug
T699.2 = T712  — Fix compress route to enforce ownerId and visibility on insert
T699.3 = T713  — Migration to backfill null rows and add NOT NULL constraints
T699.4 = T714  — Verify RLS blocks anonymous read of ownerless rows
T699.5 = T715  — End-to-end regression test for compress endpoint ownership invariant

### T700 subtasks (CRDT observer ordering)
T700.1 = T716  — Trace observer-bot CRDT subscription failure root cause
T700.2 = T717  — Implement server-side initial state snapshot on CRDT subscribe
T700.3 = T718  — Update observer-bot to handle initial snapshot message
T700.4 = T719  — Integration test for late-subscriber CRDT state delivery
T700.5 = T720  — Verify T308 Cap 2 PASS in full E2E run after fix (depends: T719)

### T701 subtasks (BFT SSE propagation)
T701.1 = T721  — Trace versionCreated event path from PUT to SSE fan-out
T701.2 = T722  — Fix SSE live-push for long-lived client connections
T701.3 = T723  — Fix consensus-bot SSE subscription to handle live events
T701.4 = T724  — Integration test: SSE event delivery latency <10s assertion
T701.5 = T725  — Verify T308 Cap 7 BFT PASS in full E2E run (depends: T720)

### T702 subtasks (Redis presence)
T702.1 = T726  — Add REDIS_URL fail-fast validation at server startup
T702.2 = T727  — Implement Redis pub/sub fanout for presence updates
T702.3 = T728  — Presence set stored in Redis hash with TTL
T702.4 = T729  — Integration test with 2-pod presence simulation
T702.5 = T730  — Document REDIS_URL setup in deployment runbook

### T703 subtasks (Redis scratchpad)
T703.1 = T731  — Implement Redis stream for scratchpad message durability
T703.2 = T732  — Implement pod-restart message recovery from Redis stream
T703.3 = T733  — Integration test simulating pod restart with message recovery
T703.4 = T734  — Fail-fast Redis validation for scratchpad in production

### T704 subtasks (enforced leases)
T704.1 = T735  — Audit current lease advisory-only implementation in routes/leases.ts
T704.2 = T736  — Implement STRICT_LEASES env flag and server-side lease check on PUT
T704.3 = T737  — Regression test: non-cooperating agent blocked by enforced lease
T704.4 = T738  — 2-agent race condition test under STRICT_LEASES
T704.5 = T739  — Document STRICT_LEASES flag in API reference and env docs

### T705 subtasks (TSA wiring)
T705.1 = T740  — Verify TSA_ENDPOINT env var set in Railway production
T705.2 = T741  — Add GET /api/v1/audit/tsa/status endpoint
T705.3 = T742  — CI workflow asserts TSA anchor freshness in prod
T705.4 = T743  — Manual end-to-end TSA token issuance verification

### T706 subtasks (SLO Grafana)
T706.1 = T744  — Probe Grafana prod and confirm alert rules loaded
T706.2 = T745  — Confirm OTEL traces appearing in Grafana Tempo
T706.3 = T746  — Synthetic burn-rate injection test for SLO alert firing
T706.4 = T747  — Commit ops/slo-verification.md with all findings

### T707 subtasks (pgvector)
T707.1 = T748  — Activate pgvector extension in Railway prod DB
T707.2 = T749  — Verify semantic search uses pgvector not TF-IDF fallback
T707.3 = T750  — Integration test validating embedding ranking beats TF-IDF
T707.4 = T751  — Document pgvector activation in ops runbook

### T708 subtasks (zstd migration)
T708.1 = T752  — Add zstd dependency to crates/llmtxt-core and implement compress/decompress
T708.2 = T753  — Implement Accept-Encoding zstd negotiation in HTTP responses
T708.3 = T754  — Migrate stored content to zstd with fallback zlib decode
T708.4 = T755  — Benchmark zstd vs zlib ratio and speed
T708.5 = T756  — Update CHANGELOG and API docs for zstd support

### T709 subtasks (load tests)
T709.1 = T757  — Write k6 load test script for core endpoints
T709.2 = T758  — Run baseline load test against api.llmtxt.my and publish results
T709.3 = T759  — Commit baseline to ops/load-baseline.md
T709.4 = T760  — Add CI job that fails on >20% p95 regression from baseline

### T710 subtasks (SOC 2 audit prep)
T710.1 = T761  — Export controls inventory CSV from soc2-type1-readiness.md
T710.2 = T762  — Create evidence vault with pointers to existing artifacts
T710.3 = T763  — Shortlist 3 SOC 2 auditors and draft engagement RFP
T710.4 = T764  — Compile vendor letters and policy docs package

---

## Summary

| Layer | Count |
|-------|-------|
| Root epic | 1 (T698) |
| Child epics (large tasks) | 11 (T699–T710, skipping gap IDs) |
| Atomic subtasks | 52 (T711–T764) |
| **Total nodes** | **64** |

Orchestration initialized: `cleo orchestrate start T698` — all 11 child epics in wave 1 (pending).

Wave dispatch order for implementers:
1. T699, T700, T701 first (Wave 0 — unblocked immediately)
2. T702, T703, T704 after Wave 0 green (Wave 1 — multi-pod)
3. T705, T706, T707 parallel to Wave 1 (Wave 2 — observability)
4. T708, T709 after Wave 2 green (Wave 3 — performance)
5. T710 anytime (Wave 4 — docs-only, pending external)
