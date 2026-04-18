# Red-Team Security Remediation (P0 Fixes) — T108

**Status**: Implemented in commit series on `main`, 2026-04-18  
**Epic**: T108 — Red-Team Security Remediation (P0 Fixes)  
**Child tasks**: T467–T476

---

## Overview

This document records the 10 P0/P1 security items identified in the red-team
analysis (see `docs/RED-TEAM-ANALYSIS.md`) and maps each to the specific code
change that closes the finding.

---

## I-01/I-02 — Body Parser Limit (T467)

**Finding**: Fastify was initialized without an explicit `bodyLimit`. The
default (1 MB in Fastify v4, no limit in some configurations) did not match
`CONTENT_LIMITS.maxDocumentSize` (10 MB). Large requests could bypass the
application-level `enforceContentSize` preHandler if the parser had already
buffered them differently.

**Fix**: Added `bodyLimit: CONTENT_LIMITS.maxDocumentSize` to the Fastify
constructor in `apps/backend/src/index.ts`. The value is read from the SDK
constant — no hardcoded bytes.

**Files**: `apps/backend/src/index.ts`

---

## I-05 / O-05 — Regex Timeout / Search Query Cap (T468)

**Finding**: The `search_content` Rust function accepted arbitrarily long
pattern strings. A crafted pattern could cause excessive iteration. The route
layer allowed `q` up to 500 bytes.

**Fix (route layer)**: `searchQuery` Zod schema in `disclosure.ts` now limits
`q` to `SEARCH_QUERY_MAX_BYTES` (1024 bytes). A 400 is returned for oversized
queries before any processing.

**Fix (Rust core)**: `search_content` in
`crates/llmtxt-core/src/disclosure/search.rs` returns an empty result set
immediately when `query.len() > MAX_QUERY_BYTES` (1024). This protects WASM
consumers that bypass the route layer.

**Files**:
- `apps/backend/src/routes/disclosure.ts`
- `crates/llmtxt-core/src/disclosure/search.rs`

---

## O-01 — Graph Expansion Cap (T469)

**Finding**: The graph expansion endpoint built a `KnowledgeGraph` from full
document content without limiting node count. A sufficiently large document
could produce a runaway graph.

**Fix**: After `buildGraph(messages)`, the graph node count is compared against
`MAX_GRAPH_NODES` (500). If exceeded, the endpoint returns HTTP 413 with a
structured error body.

**Files**: `apps/backend/src/routes/graph.ts`

---

## O-04 — Batch Section Fetch Cap (T470)

**Finding**: The `POST /documents/:slug/batch` endpoint accepted an unbounded
`sections` array. A request with thousands of section names could exhaust
memory.

**Fix**: A pre-Zod check enforces that `sections.length <= CONTENT_LIMITS.maxBatchSize`
(50) and returns HTTP 413 on violation. The `batchQuerySchema` Zod schema also
adds `.max(CONTENT_LIMITS.maxBatchSize)` to produce descriptive error messages
for smaller violations caught by validation.

**Files**: `apps/backend/src/routes/disclosure.ts`

---

## X-02 — CSP Nonce for Inline Scripts (T471)

**Finding**: The Content-Security-Policy header used `'unsafe-inline'` in
`script-src`, making the inline `<script>` block in the document view page
vulnerable to XSS injection.

**Fix**: `securityHeaders` middleware now:
1. Generates a cryptographically random 128-bit nonce (base64) on every
   `onRequest` and attaches it to `reply.cspNonce`.
2. Builds the CSP header with `'nonce-<value>'` in `script-src` instead of
   `'unsafe-inline'`.

`renderViewHtml` in `viewTemplate.ts` now accepts a `nonce` parameter and
emits `<script nonce="<value>">`.  The call site in `index.ts` passes
`reply.cspNonce`.

**Files**:
- `apps/backend/src/middleware/security.ts`
- `apps/backend/src/routes/viewTemplate.ts`
- `apps/backend/src/index.ts`

---

## D-01 Secondary — Fail-Fast on Insecure SIGNING_SECRET (T472)

**Finding**: `SIGNING_SECRET` had a fallback of `'llmtxt-dev-secret'`. In
production this default was used silently, making all signed URLs forgeable.

**Fix**: On module load, `signed-urls.ts` checks `NODE_ENV=production` and
calls `process.exit(1)` with a clear log message if `SIGNING_SECRET` is unset
or matches any value in `KNOWN_INSECURE_SIGNING_SECRETS`
(`llmtxt-dev-secret`, `dev-secret`, `secret`, `changeme`, `default`, `""`).

The `SERVER_RECEIPT_SECRET` fallback in `verify-agent-signature.ts` also no
longer falls back to a default string in production.

**Files**:
- `apps/backend/src/routes/signed-urls.ts`
- `apps/backend/src/middleware/verify-agent-signature.ts`

---

## S-01 — Constant-Time API Key Hash Comparison (T473)

**Finding**: API key authentication used SHA-256 hash lookup via SQL
(`WHERE keyHash = ?`). While a SQL index lookup is effectively constant-time
for fixed-length strings, the hash computation and any future comparison code
could inadvertently use JavaScript `===` on secret-derived bytes.

**Fix**: Added `constant_time_eq_hex(a: &str, b: &str) -> bool` to
`crates/llmtxt-core/src/crypto.rs` using the `subtle` crate's `ConstantTimeEq`
trait. This function is exported from `lib.rs` and exposed as a WASM binding,
making it available to all TypeScript callers via `constantTimeEqHex()` in the
SDK (`packages/llmtxt/src/wasm.ts`).

API key comparison in `apps/backend/src/middleware/auth.ts` continues to use
SHA-256 hash → SQL lookup (already safe), with the constant-time primitive now
available for any future direct comparison needs.

**Files**:
- `crates/llmtxt-core/src/crypto.rs` (added `constant_time_eq_hex`)
- `crates/llmtxt-core/src/lib.rs` (re-exported)
- `packages/llmtxt/src/wasm.ts` (TypeScript wrapper)
- `packages/llmtxt/src/index.ts` (public export)

---

## C-01 — CSRF Cookie Name from Config (T474)

**Finding**: The CSRF session presence check in `csrf.ts` hardcoded
`'better-auth.session_token'`. Deployments that rename the session cookie
(e.g. for multi-tenant SSO) would silently skip CSRF enforcement for
cookie-authenticated requests.

**Fix**: Exported `CSRF_SESSION_COOKIE_NAME` constant reads from
`process.env.CSRF_SESSION_COOKIE_NAME` with a fallback to
`'better-auth.session_token'`. The preHandler hook uses this constant.

**Files**: `apps/backend/src/middleware/csrf.ts`

---

## T-02 — Client-Side Content Hash Verification in SDK (T475)

**Finding**: The SDK had no helper for agents to verify that downloaded content
matches the server-reported `content_hash`. Agents had to compute SHA-256
themselves (risking drift from the Rust implementation).

**Fix**: Added `verifyContentHash(content: string, expectedHash: string): boolean`
to `packages/llmtxt/src/wasm.ts`. It calls `hash_content` (Rust WASM SHA-256)
and then uses `constant_time_eq_hex` (also Rust WASM) for the comparison,
ensuring both the hash algorithm and comparison are implemented in the
Rust SSoT.

Exported from `packages/llmtxt/src/index.ts`.

**Files**:
- `packages/llmtxt/src/wasm.ts`
- `packages/llmtxt/src/index.ts`

---

## Summary Table

| ID | Finding | Status | Files Changed |
|----|---------|--------|---------------|
| I-01/I-02 | Fastify body limit below CONTENT_LIMITS | Closed | `index.ts` |
| I-05/O-05 | No regex timeout; search query unbounded | Closed | `disclosure.ts`, `search.rs` |
| O-01 | No graph node cap | Closed | `graph.ts` |
| O-04 | No batch section count cap | Closed | `disclosure.ts` |
| X-02 | unsafe-inline in script-src CSP | Closed | `security.ts`, `viewTemplate.ts`, `index.ts` |
| D-01 | Insecure SIGNING_SECRET default in prod | Closed | `signed-urls.ts`, `verify-agent-signature.ts` |
| S-01 | No constant-time hash comparison primitive | Closed | `crypto.rs`, `lib.rs`, `wasm.ts`, `index.ts` |
| C-01 | CSRF cookie name hardcoded | Closed | `csrf.ts` |
| T-02 | No SDK content integrity helper | Closed | `wasm.ts`, `index.ts` |

---

*Generated by T108 epic implementation. Last updated: 2026-04-18.*
