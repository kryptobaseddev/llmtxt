# T438 + T440 + T442 + T444: Document Export Format Serializers

**Type**: Implementation
**Date**: 2026-04-17
**Tasks**: T438 (markdown), T440 (json), T442 (txt), T444 (llmtxt)
**Epic**: T427 (Document Export + SSoT)
**Commit**: 96c527aa75ae4b07e995b7721a1c90d42c23e356
**Status**: complete

---

## Summary

Implemented 4 document export format serializers in `packages/llmtxt/src/export/` plus a
shared canonical frontmatter bridge and full test suite. All 4 tasks completed in a single
commit batch; 29/29 tests pass; TypeScript compiles with zero errors.

---

## Files Created

| File | Task | Purpose |
|------|------|---------|
| `packages/llmtxt/src/export/canonical.ts` | shared | Pure-TS SSoT bridge for `canonicalFrontmatter()` — byte-identical to `crates/llmtxt-core/src/canonical.rs` |
| `packages/llmtxt/src/export/types.ts` | shared | `DocumentExportState` + `ExportOpts` interfaces |
| `packages/llmtxt/src/export/markdown.ts` | T438 | `formatMarkdown()` — YAML frontmatter + blank line + body |
| `packages/llmtxt/src/export/json.ts` | T440 | `formatJson()` — fixed key order, sorted contributors, 2-space indent |
| `packages/llmtxt/src/export/txt.ts` | T442 | `formatTxt()` — body only, no metadata |
| `packages/llmtxt/src/export/llmtxt.ts` | T444 | `formatLlmtxt()` — standard frontmatter + `chain_ref` + `format:"llmtxt/1"` |
| `packages/llmtxt/src/export/index.ts` | shared | Re-exports all 4 formatters + shared types |
| `packages/llmtxt/src/__tests__/export.test.ts` | all | 29 tests across 4 suites (node:test) |

**Modified**: `packages/llmtxt/src/index.ts` — added re-exports for all formatters and types.

---

## Test Results

```
formatMarkdown (T438): 8/8 pass
formatJson (T440):     7/7 pass
formatTxt (T442):      6/6 pass
formatLlmtxt (T444):   8/8 pass
Total:                29/29 pass (0 fail)
```

---

## Key Design Decisions

### Canonical Frontmatter Bridge

The WASM binary (built before T435 shipped) does not include `canonicalFrontmatter_wasm`.
`canonical.ts` implements the algorithm in pure TypeScript that is byte-identical to the
Rust function. When the WASM binary is rebuilt (after T390's wasm-pack rebuild stabilises),
the module automatically delegates to WASM via a dynamic check on the wasmModule object.

### DocumentExportState vs Document

The formatters accept a `DocumentExportState` interface that is a self-contained snapshot
(all fields pre-computed by the caller: `contentHash`, `exportedAt`, `chainRef`, etc.).
This keeps formatters as pure functions with no backend dependency.

### JSON Key Order

`JSON.stringify` with a `replacer` array enforces fixed key order deterministically.
The replacer approach is the only portable way to guarantee key order in V8 for numeric
and mixed-type keys.

### chain_ref: null

The `.llmtxt` format serializes `chain_ref: null` as a bare YAML null scalar (not quoted
`"null"`), matching the spec §4.5. The `injectLlmtxtFields()` helper handles this
distinctly from string chain refs.

---

## Spec Compliance Checklist

- [x] §4.1 canonical frontmatter: fixed key order, sorted contributors, LF only
- [x] §4.2 markdown: `---` + frontmatter + `---` + blank line + body + trailing `\n`
- [x] §4.3 JSON: `schema:"llmtxt-export/1"`, fixed key order, 2-space indent, sorted contributors
- [x] §4.4 txt: body only, LF, single trailing `\n`
- [x] §4.5 llmtxt: standard frontmatter + `chain_ref` + `format:"llmtxt/1"` as last key
- [x] §6 determinism: same input → identical output bytes (determinism tests pass)
- [x] `includeMetadata: false` support for markdown and llmtxt formatters
- [x] CRLF normalisation in all formats
- [x] Trailing blank line stripping in markdown, txt, llmtxt body
