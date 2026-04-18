# LLM-First Content Delivery

**T014** — Direct content access for AI agents and CLI tools.

`www.llmtxt.my/doc/:slug` now serves content directly — no JavaScript
execution required. AI agents, `curl`, and any HTTP client can access
documents without rendering a browser or parsing an HTML shell.

---

## Quick start

```bash
# Get plain text — works from any shell or agent
curl https://www.llmtxt.my/doc/my-document

# Get JSON with metadata
curl -H "Accept: application/json" https://www.llmtxt.my/doc/my-document

# Get Markdown with frontmatter
curl -H "Accept: text/markdown" https://www.llmtxt.my/doc/my-document
```

---

## Content negotiation matrix

| Accept header        | Response format             | Content-Type                 |
|----------------------|-----------------------------|------------------------------|
| `text/plain`         | Plain body only             | `text/plain; charset=utf-8`  |
| `application/json`   | JSON with metadata + body   | `application/json; charset=utf-8` |
| `text/markdown`      | Markdown + YAML frontmatter | `text/markdown; charset=utf-8` |
| `text/x-markdown`    | Same as text/markdown       | `text/markdown; charset=utf-8` |
| `text/html`          | Browser page (HTML/JS)      | `text/html`                  |
| `*/*` + bot UA       | Plain text (default)        | `text/plain; charset=utf-8`  |
| `*/*` + browser UA   | Browser page (HTML/JS)      | `text/html`                  |

### Bot/agent User-Agent detection

When the Accept header is `*/*` or absent, the server applies a User-Agent
heuristic. The following patterns are treated as non-browser clients and
receive plain text by default:

- AI crawlers: `GPTBot`, `ClaudeBot`, `PerplexityBot`, `Googlebot`, `Bingbot`
- CLI tools: `curl`, `wget`, `httpie`, `LWP`
- HTTP libraries: `python-requests`, `python-httpx`, `Go-http-client`, `Axios`,
  `node-fetch`, `got`, `undici`
- Generic: strings containing `bot`, `spider`, `crawl`, `agent`, `scraper`

To explicitly request a format, always set an `Accept` header — the UA heuristic
is a fallback.

---

## URL extension shortcuts

Extension-based URLs bypass content negotiation and always return the specified
format, regardless of Accept headers:

```bash
# Always plain text
curl https://www.llmtxt.my/doc/my-document.txt

# Always JSON
curl https://www.llmtxt.my/doc/my-document.json

# Always Markdown
curl https://www.llmtxt.my/doc/my-document.md
```

Extension routes are bookmarkable, CDN-cacheable, and do not include a
`Vary` header (format is fixed by the URL, not negotiated).

---

## Progressive disclosure — section fetching

To fetch only a specific section of a document, append `?section=<title>`:

```bash
# Fetch one section by title
curl "https://www.llmtxt.my/doc/my-document.txt?section=Introduction"

# Works with content negotiation too
curl -H "Accept: text/markdown" \
  "https://www.llmtxt.my/doc/my-document?section=API%20Reference"

# Extension + section
curl "https://www.llmtxt.my/doc/my-document.json?section=Configuration"
```

Section titles are case-sensitive and must match exactly (URL-encoded).

If the section is not found, the server returns HTTP 404 with a plain-text
error message.

---

## Cache headers

All content-negotiated responses include:

| Header            | Value                                    |
|-------------------|------------------------------------------|
| `Cache-Control`   | `public, max-age=60, s-maxage=300`       |
| `ETag`            | `"<content-hash>"`                       |
| `Vary`            | `Accept, User-Agent` (negotiated routes) |
| `X-Content-Format`| `text`, `json`, or `markdown`            |
| `X-Document-Version` | Current version number              |

Cloudflare and other CDNs will create separate cache entries for each
`Accept` + `User-Agent` combination (for negotiated routes) or one entry
per URL (for extension routes).

---

## JSON response schema

```json
{
  "schema": "llmtxt-export/1",
  "slug": "my-document",
  "version": 3,
  "state": "LOCKED",
  "format": "text",
  "token_count": 1240,
  "created_at": 1713000000000,
  "updated_at": 1713012345678,
  "content_hash": "a3f2...",
  "labels": null,
  "created_by": "agent-abc",
  "content": "..."
}
```

---

## Python example

```python
import httpx

# Plain text (bot UA → defaults to text/plain automatically)
response = httpx.get("https://www.llmtxt.my/doc/my-document")
text = response.text

# Explicit JSON
response = httpx.get(
    "https://www.llmtxt.my/doc/my-document",
    headers={"Accept": "application/json"}
)
doc = response.json()
print(doc["content"])

# Just a section
response = httpx.get(
    "https://www.llmtxt.my/doc/my-document.txt",
    params={"section": "Configuration"}
)
```

---

## Implementation notes

- The `+server.ts` route handler at `apps/frontend/src/routes/doc/[slug]/+server.ts`
  intercepts all non-HTML GET requests.
- Extension routes live at `apps/frontend/src/routes/doc/[slug].[ext=docext]/+server.ts`.
- The SvelteKit route matcher at `apps/frontend/src/params/docext.ts` restricts
  `[ext]` to `txt | json | md`.
- Content is fetched server-side from `api.llmtxt.my` — the browser never
  executes JavaScript to retrieve document bodies.
- The negotiation logic lives in `apps/frontend/src/lib/content/negotiation.ts`
  (pure TypeScript, no SvelteKit dependencies).
- Tests: `pnpm --filter frontend test` (33 unit tests covering all negotiation paths).
