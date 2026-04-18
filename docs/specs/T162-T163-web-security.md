# T162 + T163: Web Security — CSP/HSTS/COEP Headers + Markdown XSS Sanitization

**Status**: Implemented  
**Date**: 2026-04-18  
**Epics**: T162 (headers), T163 (XSS sanitization)  
**Layer**: Layer 3 — Security (red-team-2026-04-15)

---

## 1. Threat Model

Without these controls, the platform is vulnerable to:

1. **Stored XSS** — an attacker stores `<img src=x onerror=alert(1)>` as document content; the SSR view renders it without sanitization; the script runs in the victim's browser session.
2. **Cross-origin information leakage** — without COEP/COOP, Spectre-class attacks can read cross-origin memory.
3. **Clickjacking** — without `frame-ancestors 'none'`, the UI can be embedded in an attacker-controlled iframe.
4. **Protocol downgrade** — without HSTS, users on first visit over HTTP can be MITM'd before being redirected to HTTPS.
5. **Referrer leakage** — without `Referrer-Policy`, the `Authorization` token or slug may leak in the `Referer` header.

---

## 2. CSP Policy (RFC 2119)

### 2.1 Backend (api.llmtxt.my — Fastify)

| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | Deny-by-default |
| `script-src` | `'self' 'nonce-XXX'` | Inline scripts require per-request nonce (T471/T108.5) |
| `style-src` | `'self' 'unsafe-inline'` | SSR template has inline `<style>` block |
| `img-src` | `'self' data:` | No external image CDN on the API |
| `font-src` | `'self'` | No external fonts |
| `connect-src` | `'self' https://api.llmtxt.my wss://api.llmtxt.my` | CRDT WebSocket sync |
| `frame-ancestors` | `'none'` | Clickjacking prevention |
| `base-uri` | `'self'` | Prevent base tag injection |
| `form-action` | `'self'` | Prevent form hijacking |
| `upgrade-insecure-requests` | (present) | Block mixed content |

### 2.2 Frontend (www.llmtxt.my — SvelteKit)

Identical to backend, with additions:
- `img-src` includes `https://api.qrserver.com` for QR code generation
- `Cross-Origin-Embedder-Policy: credentialless` (not `require-corp`) because the QR service may not send CORP headers

### 2.3 Docs (docs.llmtxt.my — Next.js)

| Directive | Value | Note |
|-----------|-------|------|
| `script-src` | `'self' 'unsafe-inline'` | Fumadocs injects inline scripts; no user content |
| `style-src` | `'self' 'unsafe-inline'` | Fumadocs inline styles |

The docs site renders **no user-supplied content**, so `unsafe-inline` in `script-src` is acceptable here. A follow-up task should add Next.js middleware nonce injection to eliminate it.

---

## 3. HSTS

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

- **max-age=63072000** = 2 years (minimum for HSTS preload list: 1 year)
- **includeSubDomains** — applies to `api.llmtxt.my`, `www.llmtxt.my`, `docs.llmtxt.my`
- **preload** — enables submission to https://hstspreload.org

Only applied in `NODE_ENV=production`. Local dev uses plain HTTP.

---

## 4. Cross-Origin Isolation (COEP / COOP / CORP)

| Header | api.llmtxt.my | www.llmtxt.my | docs.llmtxt.my |
|--------|--------------|--------------|----------------|
| COEP | `require-corp` | `credentialless` | `credentialless` |
| COOP | `same-origin` | `same-origin` | `same-origin` |
| CORP | `same-origin` | `same-origin` | `same-origin` |

**Why `require-corp` on API?** The API serves no cross-origin embedded resources. `require-corp` enables SharedArrayBuffer for WASM consumers.

**Why `credentialless` on frontend/docs?** Third-party resources (QR code service, Fumadocs CDN assets) may not send `Cross-Origin-Resource-Policy: cross-origin`, which would break `require-corp` loading. `credentialless` isolates the context without blocking those resources.

---

## 5. Other Headers

| Header | Value |
|--------|-------|
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (legacy; frame-ancestors in CSP takes precedence) |
| `X-XSS-Protection` | `0` (disabled per OWASP — can create new vulns in old browsers) |

---

## 6. XSS Sanitization Architecture (T163)

### 6.1 Render Paths Audit

| Path | Location | Sanitized? | Method |
|------|----------|------------|--------|
| Backend SSR HTML | `apps/backend/src/routes/viewTemplate.ts` | YES | `sanitizeHtml(renderMarkdown(content))` |
| Backend client-side toggle | `viewTemplate.ts` inline `<script>` | YES | `escapeHtml()` before `renderMarkdown()` (all input escaped before regex) |
| Frontend doc page | `apps/frontend/src/routes/doc/[slug]/+page.svelte` | SAFE | Content rendered as `<pre><code>{rawContent}</code></pre>` — no `{@html}` usage |
| Frontend main page | `apps/frontend/src/routes/+page.svelte` | SAFE | Content only in `<textarea>` value binding — not rendered as HTML |
| Docs site | `apps/docs/**/*.mdx` | SAFE | Static MDX, no user content |
| API raw endpoint | `/api/documents/:slug/raw` | N/A | Returns `text/plain` — not parsed as HTML |
| API JSON endpoint | `/api/documents/:slug` | N/A | Returns `application/json` — not parsed as HTML |

### 6.2 Sanitization SSoT

The single source of truth for sanitization policy is `packages/llmtxt/src/sanitize.ts`.

It exports:
- `ALLOWED_TAGS` — canonical list of permitted HTML elements
- `ALLOWED_ATTR` — canonical list of permitted attributes
- `ALLOWED_URI_REGEXP` — URI allowlist (blocks `javascript:`, `vbscript:`, `data:text/html`)
- `FORBIDDEN_ATTR` — comprehensive event handler blocklist (30+ handlers)
- `FORBIDDEN_CONTENTS` — elements whose content must be stripped (`script`, `style`, `iframe`, ...)
- `sanitizeHtmlAsync(html)` — async sanitizer (Node.js + browser)
- `sanitizeHtmlSync(html)` — sync sanitizer (browser-only)
- `isSafeUri(uri)` — URI allowlist check

The backend `apps/backend/src/middleware/sanitize.ts` uses these constants directly from DOMPurify (the package is not imported from the SDK yet to avoid a circular dependency — tracked as follow-up).

### 6.3 URI Scheme Policy

Only these URI schemes are permitted in `href`/`src` attributes:
- `https://`
- `http://`
- `mailto:`
- Relative paths (no scheme prefix)

Blocked schemes: `javascript:`, `vbscript:`, `data:text/html`, `data:text/javascript`, and all others.

### 6.4 DOMPurify Configuration (shared policy)

```typescript
ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
SANITIZE_DOM = true           // DOM clobbering prevention
RETURN_DOM = false             // always return string
RETURN_DOM_FRAGMENT = false
ADD_ATTR = ['rel']             // force rel=noopener noreferrer on links
FORBID_CONTENTS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button']
```

---

## 7. Testing

### 7.1 Header Tests
File: `apps/backend/src/__tests__/security-headers.test.ts`

Asserts:
- All 8 cross-origin/CSP headers present
- HSTS max-age ≥ 63072000 + includeSubDomains + preload (production)
- HSTS absent in development
- CSP `connect-src` includes `wss://api.llmtxt.my`
- CSP `frame-ancestors 'none'`
- CSP `upgrade-insecure-requests`

### 7.2 XSS Fuzz Tests
File: `apps/backend/src/__tests__/xss-sanitize.test.ts`

- 52 OWASP XSS cheat sheet payloads
- Each payload must produce zero escape matches
- Safe content (headings, bold, links) must pass through
- `javascript:` href must be stripped while link text is preserved

---

## 8. Non-Negotiables (verified)

- [x] HSTS `preload` flag present
- [x] HSTS `max-age` >= 63072000 (2 years = 1 year minimum for preload)
- [x] HSTS `includeSubDomains` present
- [x] `frame-ancestors 'none'` in CSP (no clickjacking)
- [x] No `unsafe-inline` in `script-src` for API or frontend (nonce-only)
- [x] COEP, COOP, CORP all set on all three origins
- [x] `javascript:` URIs blocked in DOMPurify
- [x] `vbscript:` URIs blocked in DOMPurify
- [x] `data:text/html` URIs blocked in DOMPurify
- [x] Client-side `renderMarkdown` in viewTemplate.ts escapes HTML before processing

---

## 9. Follow-Up Items (out of scope for T162/T163)

1. **docs nonce middleware** — Next.js middleware.ts for per-request nonce on docs.llmtxt.my (eliminates `unsafe-inline` in script-src)
2. **CORP upgrade** — Confirm api.qrserver.com sends `Cross-Origin-Resource-Policy: cross-origin` to allow switching frontend COEP to `require-corp`
3. **CSP report-uri** — Add `report-to` / `report-uri` endpoint for CSP violation reporting (T162 acceptance criterion)
4. **Playwright E2E XSS suite** — Browser-level XSS fuzz with actual rendering (currently covered by unit tests of sanitizer)
