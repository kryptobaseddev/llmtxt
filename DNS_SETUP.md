# DNS Setup Guide for LLMtxt

## Domains Required

You need to configure **TWO domains** in Cloudflare:

### 1. www.llmtxt.my (Human Web Interface)
```
Type: CNAME
Name: www
Target: llmtxt-production.up.railway.app
Proxy: DNS only (gray cloud) - Required for Railway
TTL: Auto
```

### 2. api.llmtxt.my (API Endpoints)
```
Type: CNAME
Name: api
Target: llmtxt-production.up.railway.app
Proxy: DNS only (gray cloud) - Required for Railway
TTL: Auto
```

## Why Two Domains?

**www.llmtxt.my** - Human users:
- Simple textarea interface
- Visual format/schema selectors
- Copy/paste URL sharing
- Dark/light mode support

**api.llmtxt.my** - LLM Agents:
- Programmatic API access
- `/compress` - Create documents
- `/decompress` - Retrieve documents
- `/schemas` - List validation schemas
- CORS enabled for all origins

## Railway Configuration

The `railway.toml` already has both domains configured:

```toml
[[deploy.domains]]
domain = "www.llmtxt.my"

[[deploy.domains]]
domain = "api.llmtxt.my"
```

## Testing After DNS Setup

### Test Web Interface:
```bash
curl -s https://www.llmtxt.my/ | head -20
```

### Test API:
```bash
curl -s https://api.llmtxt.my/health
curl -s https://api.llmtxt.my/schemas
```

### Create Document via API:
```bash
curl -X POST https://api.llmtxt.my/compress \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello LLMtxt", "format": "text"}'
```

## SSL Certificates

Railway automatically provisions SSL certificates for both domains once DNS is configured. No action needed on your part.

## Troubleshooting

**If domains don't work:**
1. Check Railway Dashboard → Service → Settings → Domains
2. Verify both domains show "Active"
3. Check Cloudflare DNS propagation: `dig www.llmtxt.my`
4. Ensure proxy is OFF (gray cloud) in Cloudflare

**If API returns 404:**
- Make sure you're using `api.llmtxt.my`, not `www.llmtxt.my/api`
- The API is hosted on the api subdomain

## Current Status

✅ Code deployed to Railway  
✅ railway.toml configured with both domains  
⏳ Waiting for DNS configuration in Cloudflare  
⏳ Waiting for Railway to provision SSL certificates

Once you add the CNAME records in Cloudflare, the service will be fully operational!
