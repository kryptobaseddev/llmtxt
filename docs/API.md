# LLMtxt API Reference

**Base URL:** `https://api.llmtxt.my`
**Web URL:** `https://llmtxt.my`

On the API host, all endpoints are at the root (`/health`, `/compress`, etc.).
On the web host, all API endpoints are prefixed with `/api`.

## Endpoints

### Health Check

```
GET /health
```

Returns server status, uptime, and version.

### Create Document

```
POST /compress
Content-Type: application/json

{
  "content": "Your text or JSON content",
  "format": "text" | "json" | "markdown",
  "schema": "prompt-v1"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `content` | Yes | Content string (min 1 char) |
| `format` | No | Explicit format. Auto-detected if omitted (default: `"text"`) |
| `schema` | No | Predefined schema name for JSON validation |

**Response (201):**

```json
{
  "id": "abc123xy",
  "slug": "xK9mP2nQ",
  "url": "https://api.llmtxt.my/documents/xK9mP2nQ",
  "format": "json",
  "tokenCount": 42,
  "compressionRatio": 2.5,
  "originalSize": 1024,
  "compressedSize": 410,
  "schema": "prompt-v1",
  "validated": true
}
```

### Retrieve Document Content

```
POST /decompress
Content-Type: application/json

{
  "slug": "xK9mP2nQ"
}
```

**Response (200):**

```json
{
  "id": "abc123xy",
  "slug": "xK9mP2nQ",
  "format": "text",
  "content": "# Document content here...",
  "tokenCount": 42,
  "originalSize": 1024,
  "compressedSize": 410,
  "createdAt": 1711234567890,
  "accessCount": 5
}
```

### Get Document Metadata

```
GET /documents/:slug
```

Returns metadata without content. Includes `compressionRatio`, `accessCount`, timestamps.

### Validate Content

```
POST /validate
Content-Type: application/json

{
  "content": "Content to validate",
  "format": "json",
  "schema": "prompt-v1"
}
```

Validates content against format and optional schema without storing it.

### List Schemas

```
GET /schemas
GET /schemas/:name
```

Available predefined schemas: `prompt-v1` (OpenAI/Anthropic chat format).

### Search

```
POST /search
Content-Type: application/json

{
  "query": "search term",
  "slugs": ["slug1", "slug2"]
}
```

Searches content across multiple documents by slug. Returns matching lines with line numbers.

### Cache

```
GET /stats/cache
DELETE /cache
```

Cache statistics (hit rate, size) and cache clearing.

## Progressive Disclosure Endpoints

These endpoints let agents inspect document structure before fetching full content, reducing token costs.

### Document Overview

```
GET /documents/:slug/overview
```

Returns format, line count, token count, sections list, and (for JSON) top-level keys or (for markdown) table of contents. No content body.

### Table of Contents

```
GET /documents/:slug/toc
```

Minimal — returns only section title strings.

### Section List

```
GET /documents/:slug/sections
GET /documents/:slug/sections/:name?depth=all
```

List all sections, or extract a specific section by name. The `depth=all` query param includes nested child sections.

### Line Range

```
GET /documents/:slug/lines?start=1&end=50
```

Returns specific line range. Response includes `tokenCount`, `totalTokens`, and `tokensSaved`.

### Search Within Document

```
GET /documents/:slug/search?q=auth&context=2&max=20
```

| Param | Default | Description |
|-------|---------|-------------|
| `q` | required | Search string or `/regex/flags` |
| `context` | 2 | Lines of context before/after match |
| `max` | 20 | Maximum results |

### JSONPath Query

```
GET /documents/:slug/query?path=$.users[0].name
```

Extracts specific values from JSON documents using JSONPath syntax.

### Batch Sections

```
POST /documents/:slug/batch
Content-Type: application/json

{
  "sections": ["Introduction", "API Design"]
}
```

Fetch multiple sections in one request.

### Raw Content

```
GET /documents/:slug/raw
GET /documents/:slug/raw?start=1&end=50
GET /documents/:slug/raw?section=API+Design
```

Returns plain text (`text/plain`) with metadata in response headers (`X-Token-Count`, `X-Total-Tokens`, `X-Tokens-Saved`).

## Content Negotiation

`GET /{slug}` on the web host serves different responses:

| Client | Response |
|--------|----------|
| Browser (`Accept: text/html`) | SSR HTML document view |
| Agent/Bot/curl (`Accept: text/plain`) | Raw text content |
| `Accept: application/json` | JSON envelope with metadata |
| `/{slug}.json` | Forced JSON response |
| `/{slug}.md` | Forced markdown response |
| `/{slug}.txt` | Forced plain text response |

## Discovery

```
GET /.well-known/llm.json
GET /llms.txt
```

Agent discovery documents listing available endpoints.

## Caching

All document endpoints support `?nocache=1` to bypass the LRU cache. Cache status is returned in the `X-Cache` response header (`HIT`, `MISS`, or `SKIP`).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |
| `CACHE_MAX_SIZE` | `1000` | Max cache entries |
| `CACHE_TTL` | `86400000` | Cache TTL in ms (24h) |
| `NODE_ENV` | — | `production` or `development` |
