# XSS Render Paths — Catalogue and Sanitization Mechanisms

**Last updated**: 2026-04-18  
**Epic**: T163 — Markdown XSS Sanitization E2E  
**Status**: All paths audited and secured

---

## Render Path Inventory

### Path 1: Backend SSR HTML View

**Location**: `apps/backend/src/routes/viewTemplate.ts` (`renderViewHtml`)  
**Trigger**: HTTP GET `/api/documents/:slug` with `Accept: text/html`  
**User content used**: `data.content` (raw document content from DB)

**Sanitization chain**:
1. `renderMarkdown(data.content)` — escapes all HTML via `escapeHtml()` first, then applies safe structural regex replacements for headings/bold/italic/code. No raw HTML can survive this step.
2. `sanitizeHtml(...)` — DOMPurify pass over the markdown-rendered output with `ALLOWED_URI_REGEXP` URI allowlist, comprehensive `FORBID_ATTR` list, and `FORBID_CONTENTS`.

**Status**: SECURE

---

### Path 2: Backend client-side toggle (inline script in SSR HTML)

**Location**: `apps/backend/src/routes/viewTemplate.ts` (inline `<script nonce="...">` in the SSR HTML)  
**Trigger**: User clicks "Raw" / "Rendered" toggle button  
**User content used**: `documentData.content` (JSON-stringified data embedded in the page)

**Sanitization chain**:
- JSON data is serialized with `JSON.stringify(safeData).replace(/</g, '\\u003c')` to prevent `</script>` injection in the JSON literal
- Client-side `renderMarkdown(text)` calls `escapeHtml(text)` first (using a DOM `div.textContent` assignment), then applies structural replacements — no raw HTML can survive this step
- JSON display uses `escapeHtml(JSON.stringify(...))` — fully escaped

**Known gap**: The client-side `renderMarkdown` does not run through DOMPurify (DOMPurify is not available in the inline script context). However, `escapeHtml()` neutralizes all angle brackets before the regex substitutions run, so no user-supplied HTML reaches `innerHTML`.

**Status**: SECURE (escape-first, then structural replacements)

---

### Path 3: Frontend document view page

**Location**: `apps/frontend/src/routes/doc/[slug]/+page.svelte`  
**Trigger**: Browser navigation to `/doc/:slug`  
**User content used**: `rawContent` (fetched from API)

**Sanitization chain**:
- Content displayed inside `<pre><code>{rawContent}</code></pre>` using Svelte's text interpolation `{...}` — Svelte automatically HTML-escapes all `{...}` bindings
- **No `{@html}` directive is used anywhere in this component**

**Status**: SECURE (Svelte text binding, no raw HTML)

---

### Path 4: Frontend main page (editor)

**Location**: `apps/frontend/src/routes/+page.svelte`  
**Trigger**: Browser navigation to `/`  
**User content used**: `content` (textarea value)

**Sanitization chain**:
- Content is only ever used in a `<textarea bind:value={content}>` — textareas display plain text, not HTML
- Content is sent to the API as a JSON body string — no HTML rendering on this page
- **No `{@html}` directive is used anywhere in this component**

**Status**: SECURE (textarea only, no HTML rendering)

---

### Path 5: API raw content endpoint

**Location**: `apps/backend/src/routes/` (GET `/api/documents/:slug/raw`)  
**Response type**: `text/plain; charset=utf-8`

**Sanitization chain**:
- Content returned with `Content-Type: text/plain` — browsers will not parse it as HTML
- `X-Content-Type-Options: nosniff` prevents MIME sniffing

**Status**: NOT APPLICABLE (plain text, not HTML)

---

### Path 6: API JSON content endpoint

**Location**: `apps/backend/src/routes/` (GET `/api/documents/:slug`)  
**Response type**: `application/json`

**Sanitization chain**:
- Content is a JSON string value — not rendered as HTML by any LLMtxt consumer
- API consumers are responsible for their own sanitization if they render the content as HTML

**Status**: NOT APPLICABLE (JSON, not HTML)

---

### Path 7: Docs site (docs.llmtxt.my)

**Location**: `apps/docs/content/**/*.mdx`  
**Trigger**: Browser navigation to docs pages  
**User content used**: NONE — docs content is authored by the LLMtxt team

**Sanitization chain**:
- MDX is compiled at build time by Fumadocs/Next.js
- No user-supplied content is rendered on the docs site
- Fumadocs escapes all dynamic values

**Status**: NOT APPLICABLE (static content, no user input)

---

## Sanitization Configuration SSoT

The canonical sanitization configuration lives in:

```
packages/llmtxt/src/sanitize.ts
```

It exports the shared constants used by all sanitizers:
- `ALLOWED_TAGS` — permitted HTML elements
- `ALLOWED_ATTR` — permitted attributes
- `ALLOWED_URI_REGEXP` — URI allowlist (blocks `javascript:`, `vbscript:`, `data:text/html`)
- `FORBIDDEN_ATTR` — 30+ event handler attributes
- `FORBIDDEN_CONTENTS` — elements stripped including their contents

The backend `apps/backend/src/middleware/sanitize.ts` mirrors this policy using DOMPurify directly.

---

## URI Scheme Allowlist

Only these schemes are permitted in `href`, `src`, and similar attributes:

| Scheme | Allowed | Notes |
|--------|---------|-------|
| `https://` | YES | HTTPS URIs |
| `http://` | YES | HTTP URIs (upgrade-insecure-requests CSP directive applies) |
| `mailto:` | YES | Email links |
| Relative (no scheme) | YES | Same-origin relative paths |
| `javascript:` | **NO** | Blocked by ALLOWED_URI_REGEXP |
| `vbscript:` | **NO** | Blocked by ALLOWED_URI_REGEXP |
| `data:text/html` | **NO** | Blocked by ALLOWED_URI_REGEXP |
| `data:text/javascript` | **NO** | Blocked by ALLOWED_URI_REGEXP |
| `data:image/*` | **NO** | Blocked for `href`; allowed for `src` via `img-src data:` in CSP |

---

## Test Coverage

| Test file | Payloads | Coverage |
|-----------|---------|---------|
| `apps/backend/src/__tests__/xss-sanitize.test.ts` | 52 OWASP payloads | sanitizeHtml() — all paths through server-side DOMPurify |

### Payload categories tested:
- Basic script injection (4 variants)
- Image event handlers (`onerror`, `onload`, encoded, whitespace)
- SVG event handlers (`onload`, `onbegin`)
- `javascript:` URI scheme (6 variants including encoded/case variants)
- `vbscript:` URI scheme
- `data:text/html` URI scheme
- DOM event handlers on other elements (`body`, `input`, `div`, `p`, `select`)
- HTML encoding evasion (entity encoding, URL encoding, null bytes, comments)
- Nested/broken tag evasion
- CSS expression attacks
- Meta refresh attacks
- Object/embed/applet attacks
- DOM clobbering attacks
- Mixed content (payload embedded in legitimate text)
