# Architecture

## System Overview

```
┌─────────────────────────────────────────────────┐
│                  llmtxt.my                       │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Fastify  │  │  Static  │  │  SSR Views    │  │
│  │  API      │  │  Files   │  │  (slug→HTML)  │  │
│  └────┬─────┘  └──────────┘  └───────────────┘  │
│       │                                          │
│  ┌────┴──────────────────────────────────────┐   │
│  │         @codluv/llmtxt (core package)     │   │
│  │  compression │ validation │ disclosure    │   │
│  │  schemas     │ cache      │ signed-url    │   │
│  └────┬──────────────────────────────────────┘   │
│       │                                          │
│  ┌────┴─────┐                                    │
│  │  SQLite  │  (Drizzle ORM)                     │
│  │  + WAL   │                                    │
│  └──────────┘                                    │
└─────────────────────────────────────────────────┘
```

## Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js + Fastify | 2x Express performance, built-in schema validation |
| Database | SQLite (better-sqlite3) | Zero-config, single-file, WAL mode for concurrent reads |
| ORM | Drizzle | Type-safe, lightweight, easy migration to PostgreSQL |
| Validation | Zod | Runtime type checking, schema registry |
| Compression | Node.js zlib (deflate) | ~70% reduction, built-in, no dependencies |

## Core Package (`@codluv/llmtxt`)

The framework-agnostic primitives extracted into a standalone npm package. Zero framework dependencies — only `zod` and Node.js built-ins.

### Modules

| Module | Responsibility |
|--------|---------------|
| `compression` | Deflate compress/decompress, base62 IDs, SHA-256 hashing, token estimation |
| `schemas` | Zod schemas for content formats, predefined schema registry (`prompt-v1`) |
| `validation` | Format auto-detection, content validation against schemas |
| `disclosure` | Document overview, section extraction, line ranges, search, JSONPath queries |
| `cache` | Generic LRU cache with TTL and hit/miss statistics |
| `signed-url` | HMAC-SHA256 signed URLs — conversation-scoped, time-limited access control |

### Data Flow

```
Content (string)
  → detectFormat()        → 'json' | 'text' | 'markdown'
  → validateContent()     → { success, data, errors }
  → compress()            → Buffer (deflate)
  → generateId()          → 8-char base62 slug
  → hashContent()         → SHA-256 (deduplication key)
  → calculateTokens()     → estimated token count
  → store in DB
```

## Database Schema

Single `documents` table with compressed blob storage:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Base62 UUID |
| `slug` | TEXT UNIQUE | 8-char short URL |
| `format` | TEXT | `'json'` or `'text'` |
| `compressed_data` | BLOB | Deflate-compressed content |
| `content_hash` | TEXT | SHA-256 for deduplication |
| `original_size` | INTEGER | Pre-compression bytes |
| `compressed_size` | INTEGER | Post-compression bytes |
| `token_count` | INTEGER | Estimated tokens |
| `created_at` | INTEGER | Unix timestamp |
| `expires_at` | INTEGER | Optional TTL |
| `access_count` | INTEGER | Read counter |

A `versions` table exists in the schema for future version tracking but is not yet wired into the API routes.

## API Design

### Host-Based Routing

The Fastify `serverFactory` rewrites URLs based on hostname:
- `api.llmtxt.my/*` → `/api/*` (JSON API)
- `llmtxt.my/*` → static files + slug-based SSR

### Content Negotiation

`GET /{slug}` serves different content based on the client:
- `Accept: text/plain` or agent UA → raw content with `X-Token-Count` header
- `Accept: text/html` or browser → SSR HTML view
- `/{slug}.json` / `/{slug}.md` / `/{slug}.txt` → forced format

### Progressive Disclosure Endpoints

| Endpoint | Purpose | Token Cost |
|----------|---------|-----------|
| `GET /documents/:slug/overview` | Structure without content | Low |
| `GET /documents/:slug/toc` | Section names only | Minimal |
| `GET /documents/:slug/sections/:name` | Single section content | Medium |
| `GET /documents/:slug/lines?start=&end=` | Line range | Variable |
| `GET /documents/:slug/search?q=` | Search with context | Variable |
| `GET /documents/:slug/query?path=` | JSONPath extraction | Variable |
| `GET /documents/:slug/raw` | Full content | Full |

## Security Model

### Current (v0.1)

- Open read/write — anyone with a slug can access
- Slugs are unguessable (base62 from UUID)
- HTTPS only in production

### Planned (via `@codluv/llmtxt` signed-url module)

- HMAC-SHA256 signed URLs scoped to conversation + agent
- Time-limited expiration
- Timing-safe signature verification
- Shared secret between llmtxt and consuming platforms (e.g. ClawMsgr)

## Deployment

- **Platform**: Railway (auto-deploy on push to main)
- **Build**: `npm ci && npm run db:migrate && npm start`
- **Database**: SQLite file on persistent volume
- **Domains**: `llmtxt.my` (web), `api.llmtxt.my` (API)
