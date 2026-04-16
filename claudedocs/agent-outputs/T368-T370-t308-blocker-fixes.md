# T308 Remaining Blocker Fixes: T368, T369, T370

Date: 2026-04-15
Status: complete

## Summary

Three targeted fixes for the T308 8/8 E2E verification re-run. Each fix
addresses a precisely diagnosed root cause.

---

## T368 — X-Server-Receipt header scoping (CAP-1 was FAIL)

**Root cause**: `agentSignaturePlugin` was registered at the root Fastify scope
in `apps/backend/src/index.ts` via `app.register(agentSignaturePlugin)`. Fastify
plugin registration creates a child context with isolated hooks. The actual
routes live inside `v1Routes`, which is a separate `app.register(v1Routes, ...)`
call — a different child context. The `onSend` hook that emits `X-Server-Receipt`
only fired within the `agentSignaturePlugin` child scope, which contained no
routes, so no route ever saw the hook.

**Fix**: Moved the `agentSignaturePlugin` registration to the top of `v1Routes`
(in `apps/backend/src/routes/v1/index.ts`), before any route module registrations.
Every route registered in v1Routes now inherits both hooks (onRequest for
signature verification, onSend for X-Server-Receipt + receipt body injection).
Removed the root-level registration and its import from `index.ts`.

**Files changed**:
- `apps/backend/src/routes/v1/index.ts` — added `agentSignaturePlugin` import
  and `await app.register(agentSignaturePlugin)` as the first thing in v1Routes
- `apps/backend/src/index.ts` — removed root-level `app.register(agentSignaturePlugin)`
  and the import; replaced with an explanatory comment

---

## T369 — Consensus-bot BFT quorum (CAP-7 was FAIL)

**Blocker A — stale inbox messages**: `pollInbox()` in `shared/base.js` returned
the 50 oldest non-expired messages regardless of when they were sent. Prior test
runs left messages in the queue with different slugs. `consensus-bot.js` filters
by `payload.slug !== this.slug` but the slug filter only works after decoding the
base64 envelope payload, while the 50-message limit applies before that filter.
If the queue had 50+ stale messages from prior runs, none of the current-run
messages ever surfaced.

**Fix (Blocker A)**: Added optional `{ since }` parameter to `pollInbox()` in
`shared/base.js`. When provided:
- The timestamp is appended as `?since=<ms>` query param on the inbox GET request
  (server-side filter, once the a2a route propagates it; currently falls through).
- Client-side filter applied regardless: messages whose `received_at` < `since`
  are discarded, guaranteeing current-run messages are not masked by stale ones.
`consensus-bot.js` records `this._startTime = Date.now()` before the first poll
and passes `{ since: this._startTime }` to every `pollInbox()` call.

**Blocker B — BFT_F config mismatch**: The database `documents.bft_f` column has
`default(1)` (quorum = 2f+1 = 3), but the demo `consensus-bot.js` runs with
`BFT_F = 0` (quorum = 1). Even if ConsensusBot submitted a BFT approval, the
server required 3 approvals and rejected the quorum check.

**Fix (Blocker B)**: Updated `apps/demo/scripts/seed.js` to call
`agent.createDocument(initial, { format: 'markdown', bft_f: 0 })`. Updated
`createDocument` in `shared/base.js` to pass `bft_f` through to the POST body.
Updated `apps/backend/src/routes/api.ts` to read `bft_f` from the raw request
body and forward it as `bftF` to `createDocument`. Updated
`packages/llmtxt/src/pg/pg-backend.ts` `createDocument` to read the `bftF`
extended field and include it in the documents INSERT when explicitly supplied.

**Files changed**:
- `apps/demo/agents/shared/base.js` — `pollInbox({ since })` with client-side
  filter; `createDocument` forwards `bft_f` option
- `apps/demo/agents/consensus-bot.js` — `_startTime` recorded at run start;
  `pollInbox({ since: this._startTime })` on every poll
- `apps/demo/scripts/seed.js` — `bft_f: 0` in seed createDocument call
- `apps/backend/src/routes/api.ts` — reads `bft_f` from raw body; passes
  `bftF` to backendCore.createDocument
- `packages/llmtxt/src/pg/pg-backend.ts` — reads `bftF` extended param and
  conditionally includes it in the documents INSERT values

---

## T370 — Sections API missing sectionId (CAP-2 was PARTIAL)

**Root cause**: `GET /api/v1/documents/:slug/sections` returned sections from
`generateOverview().sections` which are `Section` objects with fields `title`,
`depth`, `startLine`, `endLine`, `tokenCount`, `type`. No `id`, `sectionId`, or
`slug` field was present. The observer-bot tried
`section.id ?? section.sectionId ?? section.slug` — all three were undefined — so
`sid` was `undefined` and the `/collab` WebSocket URL was malformed, causing a
404 from ws-crdt.ts.

**Investigation**: The CRDT collab WS route is
`GET /api/v1/documents/:slug/sections/:sid/collab` where `:sid` is an arbitrary
string key used to namespace the section's Y.js document in the CRDT state store.
There is no UUID for sections in the current schema (sections are structural, not
persisted rows). The `sid` just needs to be a stable, URL-safe string.

**Fix**: In the sections endpoint in `apps/backend/src/routes/disclosure.ts`,
each section object is augmented with a `slug` field derived by slugifying the
section title (lowercase, strip non-word chars, replace spaces with hyphens,
fallback to `section-<idx>` for empty titles). Observer-bot's existing code
`section.id ?? section.sectionId ?? section.slug` will now resolve to the `slug`
field and construct a valid collab WS URL.

No migration needed — sections are computed from document content at request time,
not persisted.

**Files changed**:
- `apps/backend/src/routes/disclosure.ts` — sections endpoint maps each `Section`
  to add a `slug` field; comment updated to document the new field and its purpose

---

## Verification

All checks green after fixes:

- `pnpm --filter backend run build` — tsc exit 0, no errors
- `pnpm --filter backend run test` — 156/156 pass
- `pnpm --filter llmtxt run test` — 30/30 pass
- `pnpm --filter backend run lint` — 0 warnings, exit 0

The three commits are:
- C1: `fix(T368): register agentSignaturePlugin inside v1Routes to fix X-Server-Receipt scoping`
- C2: `fix(T369): consensus-bot filters inbox + seed creates bft_f=0 doc for demo quorum`
- C3: `fix(T370): include sectionId in sections API + observer-bot uses it for /collab WS`
