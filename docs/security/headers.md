# LLMtxt Security Headers Reference

**Last updated**: 2026-04-18  
**Implemented by**: T162 (CSP/HSTS/COEP), T471/T108.5 (CSP nonce)

---

## Active Headers — All Origins

The following headers are applied to every HTTP response from all three LLMtxt origins.

### Content-Security-Policy

Controls which resources the browser may load.

**api.llmtxt.my (backend)**:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<random>'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.llmtxt.my wss://api.llmtxt.my; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
```

**www.llmtxt.my (frontend)**:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-<random>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.qrserver.com; font-src 'self'; connect-src 'self' https://api.llmtxt.my wss://api.llmtxt.my; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
```

**docs.llmtxt.my (docs)**:
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests
```

Note: The docs site uses `unsafe-inline` for scripts because Fumadocs injects inline scripts for theming. The docs site renders no user-supplied content.

---

### Strict-Transport-Security (HSTS)

Enforces HTTPS on all connections. Only sent in production.

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

| Property | Value | Meaning |
|----------|-------|---------|
| `max-age` | 63072000 | 2 years (minimum for preload list: 31536000 = 1 year) |
| `includeSubDomains` | present | Applies to api., www., docs. subdomains |
| `preload` | present | Enables submission to hstspreload.org |

**Preload list submission**: Visit https://hstspreload.org and submit `llmtxt.my` once the HSTS header has been live for the required period.

---

### Cross-Origin-Embedder-Policy (COEP)

Isolates the browsing context for Spectre-class attack prevention.

| Origin | Value | Rationale |
|--------|-------|-----------|
| api.llmtxt.my | `require-corp` | Enables SharedArrayBuffer/WASM threads; no cross-origin resources served |
| www.llmtxt.my | `credentialless` | QR code service (api.qrserver.com) may not send CORP |
| docs.llmtxt.my | `credentialless` | Fumadocs may load external assets |

---

### Cross-Origin-Opener-Policy (COOP)

```
Cross-Origin-Opener-Policy: same-origin
```

Prevents cross-origin window access (`window.opener`, `postMessage` from cross-origin popups). Applied to all origins.

---

### Cross-Origin-Resource-Policy (CORP)

```
Cross-Origin-Resource-Policy: same-origin
```

Prevents this server's responses from being read by cross-origin scripts (defence against Spectre via cross-origin reads). Applied to all origins.

---

### Referrer-Policy

```
Referrer-Policy: strict-origin-when-cross-origin
```

Sends the full URL as referrer for same-origin requests, only the origin (no path/query) for cross-origin HTTPS requests, and nothing for cross-origin HTTP requests.

---

### Permissions-Policy

```
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Disables access to sensitive browser APIs that LLMtxt does not require.

---

### X-Content-Type-Options

```
X-Content-Type-Options: nosniff
```

Prevents MIME-type sniffing (e.g. serving a `.txt` file and having the browser execute it as JavaScript).

---

### X-Frame-Options

```
X-Frame-Options: DENY
```

Legacy clickjacking protection (the CSP `frame-ancestors 'none'` directive takes precedence in modern browsers; this header covers legacy browsers).

---

### X-XSS-Protection

```
X-XSS-Protection: 0
```

Disabled per OWASP guidance. The built-in XSS filter in older IE/Chrome browsers can introduce new XSS vectors. Set to 0 to disable it entirely. Modern browsers have removed this header.

---

## Implementation Files

| File | Purpose |
|------|---------|
| `apps/backend/src/middleware/security.ts` | Fastify onSend hook — all backend headers |
| `apps/frontend/src/hooks.server.ts` | SvelteKit handle hook — all frontend headers |
| `apps/docs/next.config.mjs` | Next.js headers() config — all docs headers |

## Testing

| File | Coverage |
|------|---------|
| `apps/backend/src/__tests__/security-headers.test.ts` | 13 header assertion tests |
| `apps/backend/src/__tests__/security.test.ts` | 7 CSP nonce-specific tests (T471) |

## CSP Nonce Architecture

The backend generates a fresh cryptographic nonce (128 bits / 16 bytes, base64-encoded) per request via `node:crypto.randomBytes(16)`. The nonce is:

1. Generated in the `onRequest` hook and stored on `reply.cspNonce`
2. Embedded in the `script-src` CSP directive in the `onSend` hook
3. Passed to `renderViewHtml()` and injected into the `<script nonce="...">` tag

This means only the server-rendered inline script (which controls the document view toggle) can execute. Any injected `<script>` tag without the correct nonce is blocked by the browser.
