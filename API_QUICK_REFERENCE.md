# LLMtxt v2 API Quick Reference

**Base URL:** `https://llmtxt.my/api`  
**Authentication:** None (rate limited)  
**Content-Type:** `application/json`

---

## Create Document

```bash
POST /documents
```

**Request:**
```json
{
  "content": "Your content here",
  "format": "json|text",
  "schema": "prompt-v1",
  "expires_in": 86400
}
```

**Response (201):**
```json
{
  "slug": "EDaCET4W",
  "url": "https://llmtxt.my/EDaCET4W"
}
```

**Headers:**
```http
X-Token-Count: 42
X-Compression-Ratio: 0.85
X-Format: json
```

---

## Retrieve Document

```bash
GET /documents/:slug
```

**Query Parameters:**
- `?raw=true` - Return content only (no JSON)
- `?meta=true` - Include metadata in body

**Response (JSON mode):**
```json
{
  "slug": "EDaCET4W",
  "content": "Your content",
  "url": "https://llmtxt.my/EDaCET4W"
}
```

**Response (Raw mode - ?raw=true):**
```
Your content here (no JSON wrapper)
```

---

## Content Negotiation

| Accept Header | Response |
|--------------|----------|
| `application/json` | JSON API response |
| `text/html` | HTML viewer page |
| `text/plain` | Raw content |

```bash
# LLM agent
curl -H "Accept: application/json" https://llmtxt.my/EDaCET4W

# Human browser
curl https://llmtxt.my/EDaCET4W

# Pipe to another command
curl -H "Accept: text/plain" https://llmtxt.my/EDaCET4W
```

---

## LLM-to-LLM Workflow Example

```bash
# Agent A creates document
RESPONSE=$(curl -s -X POST https://llmtxt.my/api/documents \
  -H "Content-Type: application/json" \
  -d '{"content": "{\"system\":\"You are helpful\"}"}')

SLUG=$(echo $RESPONSE | jq -r '.slug')
echo "Share this: https://llmtxt.my/$SLUG"

# Agent B retrieves (raw mode for efficiency)
curl https://llmtxt.my/api/documents/$SLUG?raw=true
```

---

## Response Headers (All Endpoints)

| Header | Description |
|--------|-------------|
| `X-Token-Count` | Estimated tokens in content |
| `X-Compression-Ratio` | 0.0 - 1.0 (higher is better) |
| `X-Format` | `json` or `text` |
| `X-Schema` | Validation schema name |
| `X-Created-At` | Unix timestamp (ms) |
| `X-Cache` | `HIT`, `MISS`, or `SKIP` |

---

## Rate Limits

- **Per IP:** 100 requests/minute
- **Per slug:** 1000 requests/minute
- **Burst:** 20 requests/second

**Response (429 Too Many Requests):**
```json
{
  "error": "Rate limit exceeded",
  "retry_after": 60
}
```

---

## Error Responses

**400 Bad Request:**
```json
{
  "error": "Invalid content",
  "message": "JSON parse error"
}
```

**404 Not Found:**
```json
{
  "error": "Document not found"
}
```

**413 Payload Too Large:**
```json
{
  "error": "Content too large",
  "max_size": 1048576
}
```

---

## Content Schemas

### prompt-v1 (OpenAI/Anthropic compatible)

```json
{
  "system": "You are helpful...",
  "messages": [
    {"role": "user", "content": "Hello"}
  ],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Validation Rules:**
- `messages` array is required
- Each message must have `role` and `content`
- `role` must be: `system`, `user`, `assistant`, or `tool`
- `temperature` must be 0-2
- `max_tokens` must be positive integer

---

## Token Efficiency Tips

1. **Use raw mode** for minimal overhead:
   ```bash
   curl https://llmtxt.my/EDaCET4W?raw=true
   ```

2. **Read headers** for metadata (saves body parsing):
   ```bash
   curl -I https://llmtxt.my/api/documents/EDaCET4W
   ```

3. **Use TTL** for temporary content:
   ```json
   {"content": "...", "expires_in": 3600}
   ```

4. **Check format** in headers before parsing:
   ```bash
   FORMAT=$(curl -s -I https://llmtxt.my/api/documents/EDaCET4W | grep X-Format)
   ```

---

## Migration from v1

| Old | New |
|-----|-----|
| `POST /compress` | `POST /api/documents` |
| `POST /decompress` | `GET /api/documents/:slug` |
| Metadata in body | Metadata in headers |
| URL hash storage | Removed (backend only) |

**Old endpoints redirect for 30 days with deprecation headers.**

---

## SDK Examples

### JavaScript
```javascript
// Create
const res = await fetch('https://llmtxt.my/api/documents', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({content: 'Hello'})
});
const {slug} = await res.json();

// Retrieve (raw mode)
const content = await fetch(
  `https://llmtxt.my/api/documents/${slug}?raw=true`
).then(r => r.text());
```

### Python
```python
import requests

# Create
res = requests.post('https://llmtxt.my/api/documents',
  json={'content': 'Hello'})
slug = res.json()['slug']

# Retrieve (raw mode)
content = requests.get(
  f'https://llmtxt.my/api/documents/{slug}?raw=true'
).text
```

### cURL
```bash
# Create
curl -X POST https://llmtxt.my/api/documents \
  -d '{"content": "Hello"}'

# Retrieve
curl https://llmtxt.my/api/documents/EDaCET4W?raw=true
```

---

## Support

- **Documentation:** https://llmtxt.my/llms.txt
- **Issues:** https://github.com/kryptobaseddev/llmtxt/issues
- **Status:** https://llmtxt.my/api/health

---

**Version:** 2.0  
**Last Updated:** 2026-03-08
