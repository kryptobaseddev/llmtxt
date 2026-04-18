# T471 + T474: CSP Nonce + CSRF Cookie Config

**Date**: 2026-04-18
**Tasks**: T471 (T108.5 CSP nonce), T474 (T108.8 CSRF cookie name from config)
**Status**: complete
**Commit**: 1a6bd16

## T471 — CSP Nonce per Request

**File**: `apps/backend/src/middleware/security.ts`

The security middleware already contained the full implementation (added by a prior worker):
- `generateNonce()` calls `randomBytes(16).toString('base64')` for a fresh 128-bit nonce each request.
- `onRequest` hook attaches the nonce to `reply.cspNonce` for route handlers / view templates.
- `onSend` hook writes `Content-Security-Policy` with `'nonce-<N>'` in `script-src`; `'unsafe-inline'` is absent.
- `FastifyReply` interface augmented with `cspNonce?: string`.

**Tests added**: `apps/backend/src/__tests__/security.test.ts` (8 tests)
- CSP header present on every response
- Header contains `'nonce-XXXX'` token
- Nonce is valid base64, length >= 16
- Two concurrent requests receive different nonces (per-request randomness)
- `unsafe-inline` absent from script-src
- `reply.cspNonce` matches nonce in CSP header
- `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` present

## T474 — CSRF Cookie Name from Config

**File**: `apps/backend/src/middleware/csrf.ts`

The implementation was already present:
```typescript
export const CSRF_SESSION_COOKIE_NAME =
  process.env.CSRF_SESSION_COOKIE_NAME ?? 'better-auth.session_token';
```
The session-cookie presence check uses `CSRF_SESSION_COOKIE_NAME` instead of the old hardcoded string `'better-auth.session_token'`.

**Tests added**: `apps/backend/src/__tests__/csrf.test.ts` (6 tests)
- Default value is `'better-auth.session_token'` when env var unset
- Env var override logic validated directly
- POST with session cookie + no CSRF token returns 403
- POST with no cookie at all passes (200)
- Bearer token request bypasses CSRF regardless of session cookie
- Exported constant is a non-empty string

## Test Results

- 14/14 tests pass (8 security + 6 CSRF)
- Biome: clean on both new test files (exit 0)
- tsc: 0 errors in files touched (pre-existing errors in user-data.ts unrelated)
