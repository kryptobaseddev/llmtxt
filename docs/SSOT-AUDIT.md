# SSoT Audit — What's Misplaced in apps/backend and packages/llmtxt

> **Methodology**: Adversarial audit against `docs/ARCHITECTURE-PRINCIPLES.md`.
> **Scope**: Every file under `apps/backend/src/` and `packages/llmtxt/src/`.
> **Verdict**: Widespread SSoT violations. 4 HIGH severity (wire compatibility at risk), 13 MEDIUM, 7 LOW.
> **Date**: 2026-04-14

## Summary Table

| # | File | Violation | Severity |
|---|------|-----------|----------|
| 1 | `apps/backend/src/events/webhooks.ts` | `computeSignature` uses `node:crypto` directly instead of llmtxt-core HMAC | **HIGH** |
| 2 | `apps/backend/src/routes/semantic.ts` | `cosineSimilarityTs` re-implements Rust core `cosine_similarity` | **HIGH** |
| 3 | `apps/backend/src/utils/api-keys.ts` | `hashApiKey` uses `node:crypto` directly; canonical key hash | **HIGH** |
| 4 | `apps/backend/src/utils/embeddings.ts` | `l2Normalize` must match Rust normalization; TF-IDF + FNV in TS | **HIGH** |
| 5 | `apps/backend/src/utils/sections.ts` | Duplicate markdown parser vs `packages/llmtxt/src/disclosure.ts` | MED |
| 6 | `apps/backend/src/middleware/rbac.ts` | `ROLE_PERMISSIONS`, `Permission`, `Role` types not in SDK | MED |
| 7 | `apps/backend/src/events/bus.ts` | `DocumentEventType` / `DocumentEvent` schema not in SDK | MED |
| 8 | `apps/backend/src/routes/cross-doc.ts` | `scoreContent` re-implements `rankBySimilarity` | MED |
| 9 | `apps/backend/src/routes/semantic.ts` | `embedSections` calls wrong section parser | MED |
| 10 | `apps/backend/src/routes/collections.ts` | `slugify` — pure function, not in SDK | MED |
| 11 | `packages/llmtxt/src/disclosure.ts` | Entire file is pure TS, not WASM-wrapped | MED |
| 12 | `packages/llmtxt/src/similarity.ts` | Entire file is pure TS, not WASM-wrapped | MED |
| 13 | `packages/llmtxt/src/graph.ts` | Entire file is pure TS, not WASM-wrapped | MED |
| 14 | `packages/llmtxt/src/validation.ts` | `detectFormat` duplicates `detectDocumentFormat` | MED |
| 15 | `apps/backend/src/utils/embeddings.ts` | TF-IDF + FNV-1a + hashing re-implemented in TS | MED |
| 16 | `apps/backend/src/middleware/audit.ts` | Action name strings not typed/exported in SDK | LOW |
| 17 | `apps/backend/src/middleware/audit.ts` | `STATE_CHANGING_METHODS` duplicated in `csrf.ts` | LOW |
| 18 | `apps/backend/src/middleware/content-limits.ts` | `CONTENT_LIMITS` backend-only | LOW |
| 19 | `apps/backend/src/middleware/api-version.ts` | Version constants not in SDK | LOW |
| 20 | `apps/backend/src/routes/cross-doc.ts` | `VALID_LINK_TYPES` enum not in SDK | LOW |
| 21 | `apps/backend/src/routes/collections.ts` | Export separator format not a named constant | LOW |
| 22 | `apps/backend/src/utils/api-keys.ts` | Key format constants (`llmtxt_` prefix, length) not in SDK | LOW |

## By Category

### A. Crypto / wire-critical (must fix first)

| # | Where | Current | Target |
|---|-------|---------|--------|
| 1 | `webhooks.ts` computeSignature | `createHmac('sha256', secret)` from `node:crypto` | `crates/llmtxt-core::sign_webhook_payload` via WASM/NAPI |
| 3 | `api-keys.ts` hashApiKey | `createHash('sha256')` from `node:crypto` | `crates/llmtxt-core::hash_content` (already exists) via WASM/NAPI |
| 2 | `semantic.ts` cosineSimilarityTs | Inline TS implementation | `crates/llmtxt-core::cosine_similarity` (already exists) via WASM/NAPI |
| 4 | `embeddings.ts` l2Normalize | Inline TS implementation | `crates/llmtxt-core::l2_normalize` (NEW) via WASM/NAPI |

### B. Pure-TS re-implementations of Rust-worthy primitives

| # | File | TS functions | Should move to |
|---|------|--------------|---------------|
| 11 | `packages/llmtxt/src/disclosure.ts` | generateOverview, detectDocumentFormat, getLineRange, searchContent, getSection, queryJsonPath, parseMarkdownSections, parseCodeSections, parseJsonSections, parseTextSections | `crates/llmtxt-core::disclosure` module (NEW) |
| 12 | `packages/llmtxt/src/similarity.ts` | extractNgrams, extractWordShingles, jaccardSimilarity, textSimilarity, contentSimilarity, minHashFingerprint, rankBySimilarity, simpleHash | `crates/llmtxt-core::similarity` module (partially exists — expand) |
| 13 | `packages/llmtxt/src/graph.ts` | extractMentions, extractTags, extractDirectives, buildGraph, topTopics, topAgents | `crates/llmtxt-core::graph` module (NEW) |
| 14 | `packages/llmtxt/src/validation.ts` | detectFormat, containsBinaryContent, findOverlongLine, validateContent | `crates/llmtxt-core::validation` module (NEW) |
| 15 | `apps/backend/src/utils/embeddings.ts` | LocalEmbeddingProvider (TF-IDF + FNV1a + L2) | `crates/llmtxt-core::tfidf` module (NEW) |

### C. Duplicate implementations of the same algorithm

| # | Algorithm | Copies | Fix |
|---|-----------|--------|-----|
| 5 | Markdown section parsing | `apps/backend/src/utils/sections.ts` AND `packages/llmtxt/src/disclosure.ts::parseMarkdownSections` | Single implementation in Rust core; both consumers call it |
| 14 | Format detection | `packages/llmtxt/src/disclosure.ts::detectDocumentFormat` AND `packages/llmtxt/src/validation.ts::detectFormat` | Single Rust implementation; delete both |
| 17 | STATE_CHANGING_METHODS | `apps/backend/src/middleware/audit.ts` AND `apps/backend/src/middleware/csrf.ts` | Single constant in shared location |

### D. Types/enums/constants that should be SDK-exported

| # | What | Where it is | Where it should be |
|---|------|-------------|---------------------|
| 6 | Permission/Role/ROLE_PERMISSIONS | `apps/backend/src/middleware/rbac.ts` | `packages/llmtxt` (types) + `crates/llmtxt-core::rbac` (matrix) |
| 7 | DocumentEventType / DocumentEvent | `apps/backend/src/events/bus.ts` | `packages/llmtxt` (types exported) |
| 16 | AuditAction enum | `apps/backend/src/middleware/audit.ts` | `packages/llmtxt` (types exported) |
| 18 | CONTENT_LIMITS | `apps/backend/src/middleware/content-limits.ts` | `packages/llmtxt` (constants exported) |
| 19 | API_VERSION_REGISTRY, CURRENT_API_VERSION | `apps/backend/src/middleware/api-version.ts` | `packages/llmtxt` (constants exported) |
| 20 | VALID_LINK_TYPES | `apps/backend/src/routes/cross-doc.ts` | `packages/llmtxt` (enum exported) |

### E. Pure functions using Node-only APIs

| # | Function | File | Fix |
|---|----------|------|-----|
| 10 | slugify | `apps/backend/src/routes/collections.ts` | Move to `crates/llmtxt-core::slugify`; backend calls SDK |

## Clean files (correctly structured)

These files do it right — they import from `llmtxt` (SDK) or pure Fastify/framework code:

- `apps/backend/src/routes/similarity.ts` — imports `rankBySimilarity` from SDK (model route)
- `apps/backend/src/routes/graph.ts` — imports `extractMentions`/`buildGraph` from SDK (model route)
- `apps/backend/src/routes/retrieval.ts` — imports `planRetrieval` from SDK (model route)
- `apps/backend/src/routes/conflicts.ts` — imports `threeWayMerge` from SDK (model route)
- `apps/backend/src/routes/disclosure.ts` — routes delegate to SDK
- `apps/backend/src/middleware/rate-limit.ts` — deployment-specific (per principles)
- `apps/backend/src/middleware/csrf.ts` — framework-specific (per principles)
- `apps/backend/src/utils/tokenizer.ts` — documented ML-ecosystem exception (per principles)

## Critical Path (order of operations)

**Wave A — HIGH severity wire-compat fixes** (1-2 weeks):
1. Move HMAC for webhooks to Rust core → update webhooks.ts to use SDK
2. Replace `cosineSimilarityTs` in semantic.ts with existing Rust `cosine_similarity` via SDK
3. Move `hashApiKey` to Rust core (or use existing `hash_content`) via SDK
4. Move `l2_normalize` to Rust core; update embeddings.ts

**Wave B — Pure-TS module migration** (biggest effort):
5. Migrate `packages/llmtxt/src/disclosure.ts` to Rust core module + WASM wrapper
6. Migrate `packages/llmtxt/src/similarity.ts` to Rust core module + WASM wrapper
7. Migrate `packages/llmtxt/src/graph.ts` to Rust core module + WASM wrapper
8. Migrate `packages/llmtxt/src/validation.ts` to Rust core module + WASM wrapper
9. Replace backend `utils/sections.ts` with SDK's parser
10. Remove `utils/embeddings.ts` LocalEmbeddingProvider; use Rust `tfidf` module via SDK

**Wave C — Schema/type exports** (1 week):
11. Export DocumentEventType/DocumentEvent from SDK
12. Export AuditAction enum from SDK
13. Export CONTENT_LIMITS from SDK
14. Export API_VERSION_REGISTRY from SDK
15. Export VALID_LINK_TYPES from SDK
16. Export Permission/Role from SDK; move ROLE_PERMISSIONS matrix to core

**Wave D — Hygiene**:
17. Deduplicate `STATE_CHANGING_METHODS`
18. Name the collection export separator
19. Audit every future PR against this list

## Tracking

This audit is tracked as CLEO epic **T111 (SDK-First Refactor)** with sub-tasks. Also references **T112 (NAPI-RS + WASM dual runtime bindings)** which expands the SDK's native-binding coverage.

After Wave B completes, re-audit: the goal is `packages/llmtxt/src/*.ts` contains **nothing but WASM/NAPI wrappers and types** — zero algorithm implementations.
