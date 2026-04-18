# T014: LLM-First Content Delivery

**Status**: complete  
**Date**: 2026-04-18  
**Commit**: d0737db8c1385885c6587bcb240c4a1f0a6fe634  

## Problem Solved

Agents hitting `www.llmtxt.my/doc/:slug` received an HTML shell requiring
JavaScript execution. One independent agent spent 35,000 tokens reading a
15,000-token document due to client-side rendering and trial-and-error API
discovery. The platform now serves content directly to any HTTP client.

## Implementation

### Files Created

| File | Purpose |
|------|---------|
| `apps/frontend/src/routes/doc/[slug]/+server.ts` | Content-negotiated GET handler |
| `apps/frontend/src/routes/doc/[slug].[ext=docext]/+server.ts` | Extension route override (.txt/.json/.md) |
| `apps/frontend/src/params/docext.ts` | SvelteKit route matcher (txt/json/md) |
| `apps/frontend/src/lib/content/negotiation.ts` | Pure-TS negotiation logic |
| `apps/frontend/src/lib/content/fetch.ts` | Server-side backend fetch helpers |
| `apps/frontend/src/__tests__/content-negotiation.test.ts` | 33 unit tests |
| `docs/dx/content-delivery.md` | Full DX documentation |

### Content Negotiation Matrix

| Accept header | UA | Format returned |
|---|---|---|
| `text/plain` | any | Plain text body |
| `application/json` | any | JSON with metadata |
| `text/markdown` / `text/x-markdown` | any | Markdown + frontmatter |
| `text/html` | any | SvelteKit page (HTML/JS) |
| `*/*` or absent | curl/wget/GPTBot/ClaudeBot/python-requests/Go-http | Plain text |
| `*/*` or absent | browser | SvelteKit page |

### Bot UA Detection Regex

```
/bot|spider|crawl|agent|scraper|gptbot|claudebot|perplexitybot|googlebot|bingbot|curl|wget|httpie|lwp|python[\s-]|go-http|axios|node-fetch|got\/|undici/i
```

### Cache Headers

All responses include:
- `Cache-Control: public, max-age=60, s-maxage=300`
- `ETag: "<content-hash>"`
- `Vary: Accept, User-Agent` (negotiated routes) / none (extension routes)

### Progressive Disclosure

`?section=<title>` passed through to backend `/documents/:slug/raw?section=<title>`.
Returns 404 with error message if section not found.

## Test Results

33/33 tests passing (`pnpm --filter frontend run test`):
- 11 isBotUserAgent tests
- 8 negotiateFormat (Accept priority) tests
- 8 negotiateFormat (UA heuristic) tests
- 6 extensionToFormat tests

## Quality Gates

- svelte-check: 0 errors, 12 pre-existing warnings
- All new files: 0 TypeScript errors
- 6 subtasks completed (T508–T513)

## Deployment Path

The frontend uses `@sveltejs/adapter-node` and deploys to Railway as
`www.llmtxt.my`. The `+server.ts` route is picked up automatically on
next deploy — no infrastructure changes needed.

## Follow-ups

1. Add `pnpm-lock.yaml` handling for the `test` script at monorepo root level
   so `tool:pnpm-test` works in CLEO for frontend tasks.
2. Consider adding `svelte-check` as a recognized CLEO QA tool.
3. For full HTML SSR (not just machine-access SSR), convert `+page.ts` to
   `+page.server.ts` with a dedicated auth token for server-side API calls.
4. Bot UA list maintenance — add new AI crawler UAs as they emerge.
