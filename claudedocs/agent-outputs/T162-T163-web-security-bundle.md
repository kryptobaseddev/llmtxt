# T162 + T163 Web Security Bundle — Team Lead Output

**Date**: 2026-04-18  
**Commit**: b90c8f6  
**Status**: COMPLETE — both epics marked done

---

## T162: CSP/HSTS/COEP Headers

**Files changed**:
- `apps/backend/src/middleware/security.ts` — added COEP (require-corp), COOP (same-origin), CORP (same-origin); upgraded HSTS to 2yr+preload; added wss:// to connect-src; upgrade-insecure-requests
- `apps/frontend/src/hooks.server.ts` — new SvelteKit server hook with full header suite (COEP credentialless for QR API compat)
- `apps/docs/next.config.mjs` — Next.js headers() config with full header suite

**Tests**: `apps/backend/src/__tests__/security-headers.test.ts` — 17 tests, all pass

**Key decisions**:
- API COEP = `require-corp` (no external resources); frontend/docs COEP = `credentialless` (QR service)
- HSTS max-age=63072000 (2 years) per preload list minimum
- CSP `connect-src` includes `wss://api.llmtxt.my` for CRDT WebSocket sync

---

## T163: XSS Sanitization

**Files changed**:
- `apps/backend/src/middleware/sanitize.ts` — drop `style` attr (CSS url() XSS), add ALLOWED_URI_REGEXP, expand FORBID_ATTR to 30+ handlers, add FORBID_CONTENTS
- `packages/llmtxt/src/sanitize.ts` — SSoT module: ALLOWED_TAGS, ALLOWED_ATTR, ALLOWED_URI_REGEXP, FORBIDDEN_ATTR, FORBIDDEN_CONTENTS, sanitizeHtmlAsync, sanitizeHtmlSync, isSafeUri
- `apps/backend/src/routes/viewTemplate.ts` — client-side renderMarkdown already calls escapeHtml() first (confirmed safe)

**Tests**: `apps/backend/src/__tests__/xss-sanitize.test.ts` — 56 OWASP payloads, all blocked

**Render path audit**: All 7 paths catalogued in `docs/security/XSS-RENDER-PATHS.md`. Frontend uses no `{@html}` directive. Content displayed as `<pre><code>` text binding or textarea value only.

**Key XSS vectors blocked**:
- `javascript:` / `vbscript:` / `data:text/html` URIs via ALLOWED_URI_REGEXP
- All `on*=` event attributes (30+ comprehensive list)
- CSS `url(javascript:...)` via removing `style` from ALLOWED_ATTR
- DOM clobbering via SANITIZE_DOM=true
- Script/iframe/object content via FORBID_CONTENTS

---

## Docs

- `docs/specs/T162-T163-web-security.md` — architecture spec
- `docs/security/headers.md` — header reference
- `docs/security/XSS-RENDER-PATHS.md` — render path catalogue

---

## Test Results

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| security-headers.test.ts (T162) | 17 | 17 | 0 |
| xss-sanitize.test.ts (T163) | 56 | 56 | 0 |
| Full backend suite | 573 | 573 | 0 |
