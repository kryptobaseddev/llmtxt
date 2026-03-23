# LLMtxt API Documentation

**Production URL:** https://llmtxt-production.up.railway.app  
**Custom Domain:** https://llmtxt.my (configure via Railway dashboard)

## API Endpoints

### Health Check
```bash
GET /api/health
```

### Compress Content
```bash
POST /api/compress
Content-Type: application/json

{
  "content": "Your text or JSON content here",
  "format": "text" | "json",
  "schema": "prompt-v1"  // optional for JSON format
}
```

### Decompress Content
```bash
POST /api/decompress
Content-Type: application/json

{
  "slug": "EDaCET4W"
}
```

### Get Document Metadata
```bash
GET /api/documents/:slug
```

### List Available Schemas
```bash
GET /api/schemas
```

### Validate Content (without storing)
```bash
POST /api/validate
Content-Type: application/json

{
  "content": "Content to validate",
  "format": "json",
  "schema": "prompt-v1"
}
```

### Cache Stats
```bash
GET /api/stats/cache
```

## Web Interface

- **Home:** https://llmtxt-production.up.railway.app/
- **View Document:** https://llmtxt-production.up.railway.app/view.html?slug=EDaCET4W
- **Direct Slug:** https://llmtxt-production.up.railway.app/EDaCET4W (redirects to viewer)

## Example Usage

### Create a Text Document
```bash
curl -X POST https://llmtxt-production.up.railway.app/api/compress \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# My Notes\n\nImportant information here...",
    "format": "text"
  }'
```

### Create a JSON Document with Validation
```bash
curl -X POST https://llmtxt-production.up.railway.app/api/compress \
  -H "Content-Type: application/json" \
  -d '{
    "content": "{\"system\":\"You are helpful\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}",
    "format": "json",
    "schema": "prompt-v1"
  }'
```

### Retrieve Document
```bash
curl https://llmtxt-production.up.railway.app/api/decompress \
  -H "Content-Type: application/json" \
  -d '{"slug": "YOUR_SLUG_HERE"}'
```

## Features

- **Dual Format Support:** JSON (with validation) and Text/Markdown
- **Compression:** Automatic deflate compression for efficient storage
- **Short URLs:** Base62 encoded 8-character slugs
- **Caching:** LRU cache for frequently accessed documents
- **Validation:** JSON Schema validation (prompt-v1, custom schemas)
- **Token Counting:** Automatic token estimation
- **Version History:** Track document changes (coming soon)

## Deployment

**Railway:** Auto-deploys on push to main branch
**Build:** Railpack with npm ci
**Start:** npm run db:migrate && npm start
**Health Check:** /api/health

## Environment Variables

```env
PORT=3000
DATABASE_URL=./data.db
CACHE_MAX_SIZE=1000
CACHE_TTL=86400000
NODE_ENV=production
```
