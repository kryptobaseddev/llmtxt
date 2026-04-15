# T111 Decomposition — SDK-First Refactor (Move All Primitives to llmtxt-core)

**Date**: 2026-04-15
**Author**: LOOM Decomposition Agent
**Source**: docs/SSOT-AUDIT.md (22 violations), docs/SSOT.md, docs/ARCHITECTURE-PRINCIPLES.md

---

## Summary

21 child tasks created under T111, covering all 22 SSoT-AUDIT violations across 4 waves.

- Wave A: 4 tasks (HIGH severity crypto fixes, parallelizable)
- Wave B: 8 tasks (MED severity module ports, parallelizable within wave)
- Wave C: 5 tasks (LOW severity schema/constant exports, fully parallelizable)
- Wave D: 4 tasks (hygiene, CI lint rule, audit table update)

Dependency chain: A -> B -> C -> D (inter-wave). Within each wave, tasks are parallel-safe except where noted in individual task descriptions.

---

## Wave A — HIGH Crypto Fixes (4 tasks, parallelizable)

All Wave B tasks depend on ALL Wave A tasks completing.

| Task | Title | Audit Item | Size |
|------|-------|-----------|------|
| T113 | Migrate webhooks.ts HMAC to llmtxt-core sign_webhook_payload | #1 webhooks.ts computeSignature | small |
| T114 | Migrate api-keys.ts hashApiKey to llmtxt-core hash_content | #3 api-keys.ts hashApiKey | small |
| T116 | Migrate semantic.ts cosineSimilarityTs to llmtxt-core cosine_similarity | #2 semantic.ts cosineSimilarityTs | small |
| T117 | Migrate embeddings.ts l2Normalize to llmtxt-core l2_normalize | #4 embeddings.ts l2Normalize | small |

Notes:
- T114: hash_content already exists in crates/llmtxt-core — worker must verify WASM/NAPI binding exists before adding new code.
- T116 also resolves audit item #9 (embedSections wrong section parser) — both are in semantic.ts.
- T113 creates a NEW Rust function sign_webhook_payload (not currently in crates/llmtxt-core).
- T117 creates a NEW Rust function l2_normalize.

---

## Wave B — MED Module Ports (8 tasks, parallelizable within wave)

All depend on T113, T114, T116, T117 (Wave A). Within Wave B, tasks do not share files except:
- T119 (disclosure.ts) and T123 (validation.ts) both resolve the format-detection duplication — worker on T123 MUST coordinate with T119 worker or sequence T123 after T119 to avoid re-implementing the same canonical detectFormat function twice.

| Task | Title | Audit Items | Size |
|------|-------|------------|------|
| T119 | Port packages/llmtxt/src/disclosure.ts to crates/llmtxt-core::disclosure module | #5 sections.ts duplicate, #9 embedSections parser (partial), #11 disclosure.ts pure TS | medium |
| T121 | Port packages/llmtxt/src/similarity.ts to crates/llmtxt-core::similarity module (expand) | #8 cross-doc scoreContent, #12 similarity.ts pure TS | medium |
| T122 | Port packages/llmtxt/src/graph.ts to crates/llmtxt-core::graph module | #13 graph.ts pure TS | medium |
| T123 | Port packages/llmtxt/src/validation.ts to crates/llmtxt-core::validation module | #14 validation.ts detectFormat duplicate | small |
| T125 | Port embeddings.ts LocalEmbeddingProvider TF-IDF+FNV to crates/llmtxt-core::tfidf module | #15 tfidf+FNV re-implementation | medium |
| T127 | Migrate rbac.ts ROLE_PERMISSIONS to llmtxt-core::rbac; export Permission and Role from SDK | #6 rbac.ts ROLE_PERMISSIONS | small |
| T128 | Export DocumentEventType and DocumentEvent schema from packages/llmtxt SDK | #7 bus.ts DocumentEventType | small |
| T130 | Migrate slugify from collections.ts to crates/llmtxt-core; export from SDK | #10 collections.ts slugify | small |

Notes:
- T119 is the largest Wave B task (10 functions across 4 format parsers). Mark as medium and expect multiple Rust submodules.
- T121 expands an EXISTING Rust module — worker must read the current state of crates/llmtxt-core::similarity before adding to it to avoid name collisions.
- T122 creates a NEW Rust module — graph analysis is compute-worthy for Rust.
- T123 and T119 share the detectFormat/detectDocumentFormat duplication — judgment call: T123 defers to the single canonical implementation produced by T119. If run in parallel, coordinate on the canonical function name.

---

## Wave C — LOW Schema/Constant Exports (5 tasks, fully parallelizable)

All depend on ALL Wave B tasks (T119, T121, T122, T123, T125, T127, T128, T130). These are trivial exports — the types/constants already exist in apps/backend; this wave just surfaces them through packages/llmtxt.

| Task | Title | Audit Items | Size |
|------|-------|------------|------|
| T132 | Export AuditAction enum from packages/llmtxt SDK | #16 audit.ts action strings | small |
| T133 | Export CONTENT_LIMITS constants from packages/llmtxt SDK | #18 content-limits.ts | small |
| T134 | Export API_VERSION_REGISTRY and CURRENT_API_VERSION from packages/llmtxt SDK | #19 api-version.ts version constants | small |
| T136 | Export VALID_LINK_TYPES from packages/llmtxt SDK | #20 cross-doc.ts VALID_LINK_TYPES | small |
| T137 | Name collection export separator as SDK constant; export API key format constants | #21 collection separator, #22 api-key format constants | small |

Notes:
- T137 batches two LOW items (#21 and #22) that both affect constants with no algorithmic value. Judgment call: grouping saved a task; the worker can split into two commits if cleaner.
- Wave C depends on Wave B completing because Wave B restructures packages/llmtxt exports and a concurrent Wave C change could conflict with the wasm wrapper rewrite.

---

## Wave D — Hygiene + CI + Audit Table (4 tasks)

| Task | Title | Depends On | Size |
|------|-------|-----------|------|
| T139 | Delete apps/backend/src/utils/sections.ts after Wave B | T119 | small |
| T140 | Deduplicate STATE_CHANGING_METHODS (audit.ts + csrf.ts) | Wave B complete | small |
| T142 | Add CI lint rule: ban yjs/automerge/node:crypto createHash+createHmac in apps/backend | Wave A complete (T113,T114,T116,T117) | small |
| T143 | Update docs/SSOT-AUDIT.md resolution table — mark all 22 violations resolved | All waves complete | small |

Notes:
- T139 is a hard delete — must verify zero remaining imports of sections.ts before executing.
- T140 placement: STATE_CHANGING_METHODS is a shared HTTP method list, not a cryptographic primitive. Placement in packages/llmtxt or a backend-internal shared file is acceptable; judgment call is: export from packages/llmtxt (makes it SDK-visible for external consumers building middleware). HITL review recommended if placement feels wrong.
- T142 must activate AFTER Wave A is complete. Activating the ban before migrating call sites would break CI.
- T143 is the final documentation task — runs last, validates the full refactor.

---

## Audit Coverage Verification

All 22 SSOT-AUDIT items are covered:

| Audit # | Severity | Covered By |
|---------|----------|-----------|
| 1 | HIGH | T113 |
| 2 | HIGH | T116 |
| 3 | HIGH | T114 |
| 4 | HIGH | T117 |
| 5 | MED | T119 (sections.ts deletion in acceptance criteria) + T139 (Wave D deletion) |
| 6 | MED | T127 |
| 7 | MED | T128 |
| 8 | MED | T121 |
| 9 | MED | T116 (partial — embedSections section parser fix) |
| 10 | MED | T130 |
| 11 | MED | T119 |
| 12 | MED | T121 |
| 13 | MED | T122 |
| 14 | MED | T123 |
| 15 | MED | T125 |
| 16 | LOW | T132 |
| 17 | LOW | T140 |
| 18 | LOW | T133 |
| 19 | LOW | T134 |
| 20 | LOW | T136 |
| 21 | LOW | T137 |
| 22 | LOW | T137 |

---

## Judgment Calls (flag for HITL review)

1. **T123 + T119 detectFormat collision**: The audit identified both `detectDocumentFormat` (disclosure.ts) and `detectFormat` (validation.ts) as duplicates. T119 produces the canonical Rust implementation; T123 deletes the TypeScript duplicate and wires to the same Rust function. If workers run truly in parallel, they could each implement a Rust function with a different name. The decomposition addresses this in both tasks' acceptance criteria but does not force strict sequencing within Wave B. Flag: if CI fails after Wave B with duplicate symbol conflicts, rerun T123 blocked by T119.

2. **STATE_CHANGING_METHODS placement**: Audit item #17 says "deduplicated" but does not specify whether it should live in packages/llmtxt (SDK-exported) or as a backend-only shared constant. Placed in T140 with packages/llmtxt as preferred target. Owner may prefer backend-internal shared file instead — ask before T140 ships.

3. **T121 modifies an existing Rust module**: `crates/llmtxt-core::similarity` partially exists. Worker must read the current module before adding to it. Risk of name collision with existing `cosine_similarity` (already moved in Wave A). Explicitly called out in T121 acceptance criteria.

4. **T116 double-counts audit items #2 and #9**: Both live in semantic.ts. Combined into one task rather than splitting to avoid needing to coordinate two workers on the same file. Single worker handles both. Auditors should verify both items are closed when T116 is marked done.

---

## Dependency DAG (text)

```
Wave A (parallel):   T113  T114  T116  T117
                       |     |     |     |
                       +-----+-----+-----+
                                   |
Wave B (parallel):  T119 T121 T122 T123 T125 T127 T128 T130
                       |    |    |    |    |    |    |    |
                       +----+----+----+----+----+----+----+
                                         |
Wave C (parallel):  T132 T133 T134 T136 T137
                                   |
Wave D (partial order):
  T142 (depends only on Wave A)
  T139 (depends only on T119)
  T140 (depends on Wave B)
  T143 (depends on ALL of A+B+C+D minus itself)
```
