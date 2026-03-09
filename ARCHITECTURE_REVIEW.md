# LLMtxt Architecture Review

## 🚨 Current Issue: Two Competing Storage Systems

We accidentally created **TWO different approaches**:

### 1. Frontend-Only (textarea.my style)
- Content stored in URL hash via `btoa(JSON.stringify(data))`
- No backend persistence
- URL looks like: `llmtxt.my/#eyJjIjoiSGVsbG8iLCJ0IjoxMjN9`
- PROBLEM: Large content = very long URLs (browser limits ~2000 chars)

### 2. Backend API (short URL service)
- Content compressed and stored in SQLite
- Short 8-char slugs: `llmtxt.my/EDaCET4W`
- Full metadata: tokens, compression, format
- Persistent storage

**These don't work together!** The frontend textarea saves to URL hash, but the API creates short URLs in database.

---

## ✅ Recommended Solution: Unified Backend Storage

**Remove the URL hash storage entirely.** Instead:

### Frontend Behavior:
1. User types in textarea
2. Auto-save to backend API every 2 seconds (debounced)
3. Backend returns short URL
4. Update browser URL to short slug
5. Share short URL

### Benefits:
- No URL length limits
- Content persisted in database
- Version history works
- Metadata available
- Works for both humans AND LLM agents

---

## 🤖 For LLM Agents

Agents need clear programmatic access:

```
POST https://llmtxt.my/api/compress
{
  "content": "...",
  "format": "json|text",
  "schema": "prompt-v1"  // optional
}

Response:
{
  "slug": "EDaCET4W",
  "url": "https://llmtxt.my/EDaCET4W",
  "format": "json",
  "tokenCount": 42,
  "compressionRatio": 0.85
}
```

**Key for LLMs:**
- Simple POST to create
- Short slug to retrieve
- Metadata helps optimize token usage
- No human UI needed for agents

---

## 📝 Schema System (prompt-v1)

The schema validates JSON structure:

**prompt-v1** (OpenAI/Anthropic compatible):
```json
{
  "system": "You are helpful...",
  "messages": [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi!"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Why schemas matter:**
- Ensures JSON is valid for LLM APIs
- Prevents errors when using with OpenAI/Anthropic
- Can add more schemas later (e.g., 'claude-v1', 'gemini-v1')
- Optional - agents can skip validation

---

## 📊 Metadata - What's Useful?

| Field | Human Use | LLM Agent Use |
|-------|-----------|---------------|
| tokenCount | Cost estimation | ✅ Critical - budget management |
| compressionRatio | Debug/interest | ✅ Useful - verify efficiency |
| originalSize | Debug | ℹ️ Info |
| compressedSize | Debug | ℹ️ Info |
| format | Organization | ✅ Important - processing logic |
| schema | Validation | ✅ Critical - API compatibility |

**Keep all metadata** - it's useful for both!

---

## 🌐 DNS Configuration

**Recommended:** Single domain with paths

```
www.llmtxt.my           → Human web UI (textarea)
www.llmtxt.my/api/*     → API endpoints
www.llmtxt.my/:slug     → Document redirect
www.llmtxt.my/llms.txt  → Agent instructions
```

**Why not api.llmtxt.my?**
- Simpler CORS (same origin)
- Easier SSL certificate
- One DNS record to manage
- Railway can handle routing

**Railway config:**
```toml
[[deploy.domains]]
domain = "llmtxt.my"
```

Then in Cloudflare:
```
CNAME: llmtxt.my → llmtxt-production.up.railway.app
```

---

## 📄 llms.txt Specification

This is CRITICAL - every LLM agent needs to know how to use the API.

File: `public/llms.txt`

```
# LLMtxt API Specification

## Overview
LLMtxt is a text document sharing service optimized for LLM agents.
Create, share, and retrieve text documents with compression and metadata.

## Base URL
https://llmtxt.my/api

## Authentication
No authentication required for basic usage.
Rate limits: 100 requests/minute per IP.

## Endpoints

### Create Document
POST /compress
Content-Type: application/json

Request:
{
  "content": "string (required) - Document content",
  "format": "string (optional) - 'json' or 'text', auto-detected if omitted",
  "schema": "string (optional) - 'prompt-v1' for OpenAI/Anthropic validation"
}

Response (201):
{
  "slug": "string - 8-character document ID",
  "url": "string - Full URL to document",
  "format": "string - 'json' or 'text'",
  "tokenCount": "number - Estimated token count",
  "compressionRatio": "number - Compression efficiency (0-1)",
  "originalSize": "number - Size in bytes before compression",
  "compressedSize": "number - Size in bytes after compression",
  "schema": "string - Schema used (if any)",
  "validated": "boolean - True if schema validation passed"
}

### Retrieve Document
POST /decompress
Content-Type: application/json

Request:
{
  "slug": "string (required) - Document slug from create response"
}

Response (200):
{
  "slug": "string",
  "content": "string - Original content",
  "format": "string",
  "tokenCount": "number",
  "createdAt": "number - Unix timestamp"
}

### Get Metadata
GET /documents/:slug

Response (200):
{
  "slug": "string",
  "format": "string",
  "tokenCount": "number",
  "compressionRatio": "number",
  "originalSize": "number",
  "compressedSize": "number",
  "createdAt": "number",
  "accessCount": "number"
}

### List Schemas
GET /schemas

Response (200):
{
  "schemas": [
    {
      "name": "string - Schema identifier",
      "description": "string - Human-readable description"
    }
  ]
}

## Schemas

### prompt-v1
Standard LLM prompt format (OpenAI/Anthropic compatible)

Structure:
{
  "system": "string (optional) - System prompt",
  "messages": [
    {
      "role": "string - 'system', 'user', or 'assistant'",
      "content": "string - Message content"
    }
  ],
  "temperature": "number (optional) - 0-2",
  "max_tokens": "number (optional) - Positive integer"
}

Validation rules:
- messages array is required
- Each message must have role and content
- role must be 'system', 'user', or 'assistant'
- temperature must be between 0 and 2
- max_tokens must be positive integer

## Error Handling

All errors return JSON with:
{
  "error": "string - Error type",
  "message": "string - Human-readable description",
  "details": "array - Detailed validation errors (if applicable)"
}

Common status codes:
- 200: Success
- 201: Created
- 400: Bad Request (validation failed)
- 404: Not Found (invalid slug)
- 429: Rate Limited
- 500: Server Error

## Example Usage

### Create and Share
```bash
curl -X POST https://llmtxt.my/api/compress \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Important context for LLM processing...",
    "format": "text"
  }'
# Returns: {"slug": "EDaCET4W", "url": "https://llmtxt.my/EDaCET4W"}
```

### Retrieve
```bash
curl -X POST https://llmtxt.my/api/decompress \
  -H "Content-Type: application/json" \
  -d '{"slug": "EDaCET4W"}'
# Returns: {"content": "Important context..."}
```

### Create Validated LLM Prompt
```bash
curl -X POST https://llmtxt.my/api/compress \
  -H "Content-Type: application/json" \
  -d '{
    "content": "{\"system\":\"You are helpful\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
    "format": "json",
    "schema": "prompt-v1"
  }'
```

## Best Practices

1. **Always specify format** - Helps with processing
2. **Use schemas for LLM content** - Ensures compatibility
3. **Check tokenCount** - Manage context window size
4. **Handle 404 errors** - Documents may expire
5. **Cache results** - Use metadata endpoint for cache validation

## Version
API Version: 1.0.0
Last Updated: 2026-03-09
```

---

## 🎯 Next Steps

1. **Fix the frontend** to use backend API (not URL hash)
2. **Create llms.txt** file
3. **Configure custom domain** llmtxt.my
4. **Test end-to-end** with an LLM agent

Should I proceed with these changes?