# T317 Part 2 — RemoteBackend, CLI, CLEO Example

**Agent**: Claude Sonnet 4.6
**Date**: 2026-04-16
**Status**: complete

## Deliverables

### C1 — RemoteBackend + Contract Tests (T332, T333)

- `/mnt/projects/llmtxt/packages/llmtxt/src/remote/remote-backend.ts` — full
  Backend interface implementation via HTTP/WS. REST for all CRUD, SSE for
  subscribeStream, WebSocket for subscribeSection.

- `/mnt/projects/llmtxt/packages/llmtxt/src/remote/index.ts` — subpath index
  re-exporting RemoteBackend and all Backend core types.

- `/mnt/projects/llmtxt/packages/llmtxt/src/local/index.ts` — subpath index
  re-exporting LocalBackend and all Backend core types.

- `/mnt/projects/llmtxt/packages/llmtxt/src/__tests__/backend-contract.test.ts`
  — 25-test contract suite using the Node.js built-in test runner (tsx/esm).
  Tests: createDocument, getDocument (null on miss), slug uniqueness, list,
  delete (true/false), publishVersion, versionCount increment, getVersion (null),
  listVersions order, transitionVersion valid/invalid, appendEvent+queryEvents,
  acquireLease/block/idempotent, releaseLease, scratchpad CRUD, A2A CRUD,
  registerPubkey (idempotent), lookupPubkey (null), revoke, nonce record/check.

  Result: 25/25 pass.

### C2 — Fastify LocalBackend Plugin (T334)

- `/mnt/projects/llmtxt/apps/backend/src/plugins/local-backend-plugin.ts` —
  `registerLocalBackendPlugin(app)` decorates Fastify as `app.localBackend`.
  Opens on registration, closes via onClose hook. All 156 existing backend tests
  remain green.

### C3 — CLI (T335, T336)

- `/mnt/projects/llmtxt/packages/llmtxt/src/cli/llmtxt.ts` — full CLI binary.
  Commands: init, create-doc, push-version, pull, watch, search, keys
  (generate|list|revoke), sync.

- Key fix: noble/ed25519 v3 requires `ed.hashes.sha512 = sha512` before any
  key operation; imported from `@noble/hashes/sha2.js`.

- Build script updated to copy `src/local/migrations` into `dist/local/migrations`
  (tsc skips non-TS files).

- Smoke test verified: `llmtxt --version`, `llmtxt init`, `llmtxt create-doc`,
  `llmtxt push-version` all succeed.

### C4 — Sync (T337)

Implemented in CLI: `llmtxt sync --remote <url>` pulls remote docs missing
locally, pushes local docs missing from remote. Included in C3 commit.

### C5 — CLEO Example + Docs (T338, T339)

- `/mnt/projects/llmtxt/apps/examples/cleo-integration/index.ts` — 4-pattern
  runnable example: task attachment, BFT approval, A2A + leases, presence.
  Verified: all 4 patterns execute and produce correct output.

- `/mnt/projects/llmtxt/apps/examples/cleo-integration/README.md` — quick-start
  snippet (5 lines: open, createDocument, publishVersion, close).

- `/mnt/projects/llmtxt/apps/docs/content/docs/embed/cleo-pm.mdx` — full docs
  page covering all patterns with working code snippets.

- `pnpm-workspace.yaml` updated to include `apps/examples/*`.

### C6 — Packaging + README (T340, T341)

- `packages/llmtxt/package.json`: subpath exports `llmtxt/local`, `llmtxt/remote`,
  `llmtxt/cli` added; `bin.llmtxt` → `dist/cli/llmtxt.js`; `test` script added;
  `tsx` added as devDependency.

- `packages/llmtxt/README.md`: LocalBackend quick-start, RemoteBackend quick-start,
  CLI quick-start all added.

- `packages/llmtxt/CHANGELOG.md`: Unreleased section documents all T317 deliverables.

## Validation Gates

| Gate | Result |
|------|--------|
| pnpm --filter llmtxt typecheck | PASS |
| pnpm --filter llmtxt build | PASS |
| pnpm --filter llmtxt test (25 contract tests) | PASS (25/25) |
| pnpm --filter @llmtxt/backend test (156 tests) | PASS (156/156) |
| llmtxt init smoke test | PASS |
| llmtxt create-doc smoke test | PASS |
| llmtxt push-version smoke test | PASS |
| apps/examples/cleo-integration runs | PASS (all 4 patterns) |
| pnpm --filter @llmtxt/backend build | PASS |

## Commits

- `cbae989` — feat(T332,T333): RemoteBackend + contract tests
- `1593f32` — feat(T334): Fastify LocalBackend plugin
- `0bf71bf` — feat(T335,T336): CLI
- `276ebae` — feat(T337,T338,T339): sync, CLEO example, embed docs
- `9689c80` — docs(T340,T341): packaging + README + CHANGELOG

## Constraints Honoured

- drizzle-orm/kit pinned at 1.0.0-beta.21 (unchanged)
- zod at ^4.x (unchanged)
- No node:crypto direct imports in new code
- No yjs direct imports in new code
- better-sqlite3 transaction callbacks remain synchronous
- No version bump, no publish

## Notes

- T334 (backend refactor) was scoped as a plugin rather than a route rewrite.
  Full route migration is a separate larger epic; the plugin provides the
  injection point without risk to 156 existing tests.

- RemoteBackend is a HTTP transport adapter; exact route paths will need tuning
  when the real api.llmtxt.my routes stabilise.
