# Worker Output: T467 + T472 — bodyLimit + SIGNING_SECRET Fail-Fast

**Date**: 2026-04-18
**Tasks**: T467 (T108.1 bodyLimit), T472 (T108.6 SIGNING_SECRET fail-fast)
**Status**: Both complete

## T467 — Fastify bodyLimit enforcement

`bodyLimit: CONTENT_LIMITS.maxDocumentSize` was already set in
`apps/backend/src/index.ts` (line 92) when this task was picked up.
The gap was test coverage.

Added `apps/backend/src/__tests__/body-limit.test.ts` with 4 tests:
- body at `maxDocumentSize - 1` (10 MB - 1 byte) → 200
- body at `maxDocumentSize + 1` (10 MB + 1 byte) → 413
- small body → 200
- sanity check that `CONTENT_LIMITS.maxDocumentSize === 10 * 1024 * 1024`

The test builds a minimal Fastify instance mirroring the same `bodyLimit`
option as `index.ts` and uses `inject()` — no real database dependency.

**Commit**: 08ddc68

## T472 — SIGNING_SECRET fail-fast in production

Extracted the validation logic into a pure, testable function:

**New file**: `apps/backend/src/lib/signing-secret-validator.ts`
- Exports `KNOWN_INSECURE_SIGNING_SECRETS` (Set of 7 known-bad values)
- Exports `validateSigningSecret(secret, nodeEnv)` — throws when production
  and secret is insecure; no-op otherwise

**Modified**: `apps/backend/src/index.ts`
- Calls `validateSigningSecret()` at the top level (before Fastify is
  constructed), so a misconfigured production deployment exits before
  accepting a single connection

**Modified**: `apps/backend/src/routes/signed-urls.ts`
- Removed duplicate constant list and inline `process.exit(1)` block
- Imports `KNOWN_INSECURE_SIGNING_SECRETS` from the shared module
- Derives `_effectiveSigningSecret` using the shared set

**New file**: `apps/backend/src/__tests__/signing-secret-validator.test.ts`
- 40 unit tests covering all 7 insecure secrets in production (throws),
  3 strong secrets in production (does not throw), 4 non-production envs
  with all insecure secrets (does not throw), and default-parameter edge cases

**Commit**: 7d62cd0

## Test results

365 tests, 0 failures (full backend suite via `pnpm test` in apps/backend).
biome check: 0 errors. tsc --noEmit: 0 errors.
