# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        llmtxt ecosystem                             │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  llmtxt-core (Rust crate, crates.io)                          │  │
│  │  SSoT: compression, hashing, signing, patching, similarity    │  │
│  │                                                               │  │
│  │  ┌─────────────┐     ┌──────────────────┐                    │  │
│  │  │  wasm-pack   │     │  Cargo native    │                    │  │
│  │  │  (WASM build)│     │  (Rust backends) │                    │  │
│  │  └──────┬──────┘     └────────┬─────────┘                    │  │
│  └─────────┼─────────────────────┼───────────────────────────────┘  │
│            │                     │                                   │
│  ┌─────────▼───────────────┐     │                                  │
│  │  llmtxt (npm, Node.js)  │     │                                  │
│  │                         │     │                                  │
│  │  primitives (WASM)      │     │                                  │
│  │  disclosure (TS)        │     │                                  │
│  │  sdk (TS + WASM)        │     │                                  │
│  │  similarity (TS)        │     │                                  │
│  │  graph (TS)             │     │                                  │
│  │  client (HTTP)          │     │                                  │
│  │  validation (Zod)       │     │                                  │
│  └─────────┬───────────────┘     │                                  │
│            │ HTTP client         │ Cargo dep                        │
│  ┌─────────▼─────────────────────▼──────────────────────────────┐  │
│  │  SignalDock API (Axum/Rust)                                   │  │
│  │                                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  │  │
│  │  │ Postgres │  │ S3 Bucket│  │   Redis   │  │  Axum HTTP │  │  │
│  │  │ metadata │  │ blobs    │  │ locks/cache│  │  endpoints │  │  │
│  │  └──────────┘  └──────────┘  └───────────┘  └────────────┘  │  │
│  │                                                               │  │
│  │  api.signaldock.io (canonical)                                │  │
│  │  api.clawmsgr.com (legacy parallel)                           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  llmtxt.my (web app)                                          │  │
│  │                                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐               │  │
│  │  │ Fastify  │  │  Static  │  │  SSR Views    │               │  │
│  │  │ API      │  │  Files   │  │  (slug->HTML) │               │  │
│  │  └────┬─────┘  └──────────┘  └───────────────┘               │  │
│  │       │                                                       │  │
│  │  ┌────┴──────────────────────────────────────────────┐       │  │
│  │  │  llmtxt (npm)                                      │       │  │
│  │  │  compression | validation | disclosure | cache     │       │  │
│  │  └────┬──────────────────────────────────────────────┘       │  │
│  │       │                                                       │  │
│  │  ┌────┴─────┐                                                │  │
│  │  │  SQLite  │  (Drizzle ORM, WAL mode)                       │  │
│  │  └──────────┘                                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology | Where |
|-------|-----------|-------|
| Primitives | Rust (Edition 2024) | crates/llmtxt-core/ |
| WASM Bridge | wasm-pack + wasm-bindgen | packages/llmtxt/wasm/ |
| npm Package | TypeScript 5.9 (ESM) | packages/llmtxt/ |
| Validation | Zod 3.x | packages/llmtxt/src/validation.ts |
| Web App | Node.js + Fastify 5.x | apps/backend/ |
| Web ORM | Drizzle 1.0 beta | apps/backend/ |
| Web DB | SQLite (better-sqlite3, WAL) | apps/backend/ |
| API Server | Rust + Axum 0.8 | SignalDock repo |
| API DB | PostgreSQL (sqlx) | Railway |
| Blob Storage | S3-compatible (Railway) | signaldock-bucket |
| Cache/Locks | Redis | Railway (shared) |
| CI | GitHub Actions | .github/workflows/ |
| Versioning | CalVer (YYYY.M.PATCH) | VersionGuard |

## API Design

### Content Negotiation (llmtxt.my web app)

`GET /{slug}` serves different content based on the client:
- `Accept: text/plain` or agent UA -> raw content with `X-Token-Count` header
- `Accept: text/html` or browser -> SSR HTML view
- `/{slug}.json` / `/{slug}.md` / `/{slug}.txt` -> forced format

### Host-Based Routing (llmtxt.my)

- `api.llmtxt.my/*` -> `/api/*` (JSON API)
- `llmtxt.my/*` -> static files + slug-based SSR

### SignalDock API (canonical production API)

All collaborative document operations go through the SignalDock API. See the Collaborative Document Endpoints section below for the full endpoint list.

## Rust Crate (`llmtxt-core`)

Single source of truth for all cryptographic and compression operations. 25 public functions + 4 types.

Published: `crates.io/crates/llmtxt-core`

Compiles two ways:
- **WASM** (via `wasm-pack`): loaded by the `llmtxt` npm package
- **Native** (via Cargo): consumed directly by Rust backends (SignalDock)

See [PORTABLE_CORE_CONTRACT.md](../packages/llmtxt/PORTABLE_CORE_CONTRACT.md) for byte-identical guarantees.

## npm Package (`llmtxt`)

Published: `npmjs.com/package/llmtxt`

### Modules

| Module | Responsibility |
|--------|---------------|
| `compression` | WASM-backed: deflate compress/decompress, base62 IDs, SHA-256 hashing, token estimation |
| `patch` | WASM-backed: unified diff creation, application, version reconstruction, squash |
| `signed-url` | HMAC-SHA256 signed URLs -- conversation-scoped, time-limited, org-scoped variants |
| `disclosure` | Progressive disclosure: overview, section extraction, line ranges, search, JSONPath |
| `similarity` | N-gram Jaccard, word shingles, MinHash fingerprinting, ranked search |
| `graph` | Knowledge graph extraction from message streams (@mentions, #tags, /directives) |
| `validation` | Zod-based format detection, content validation, predefined schemas |
| `cache` | Generic LRU cache with TTL and hit/miss statistics |
| `snapshot` | Session snapshot compression for agent handoffs |
| `client` | HTTP wrapper for attachment CRUD, versioning, resharing |
| `sdk/lifecycle` | Document state machine: DRAFT, REVIEW, LOCKED, ARCHIVED |
| `sdk/versions` | Patch stack reconstruction, squash, reverse patch, diff between versions |
| `sdk/attribution` | Per-version author tracking with token impact and section detection |
| `sdk/consensus` | Multi-agent approval evaluation with stale review handling |
| `sdk/storage` | Content reference abstraction (inline vs object-store) |
| `sdk/retrieval` | Token-budget-aware section planning |
| `sdk/document` | LlmtxtDocument orchestration class (composes all SDK modules) |

### Data Flow

```
Content (string)
  -> detectFormat()        -> 'json' | 'text' | 'markdown'
  -> validateContent()     -> { success, data, errors }
  -> compress()            -> Buffer (deflate, RFC 1950)
  -> generateId()          -> 8-char base62 slug
  -> hashContent()         -> SHA-256 (deduplication key)
  -> calculateTokens()     -> estimated token count
  -> store via API
```

## Web App (`apps/web`)

Utility/demo web application for direct content hosting.

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Fastify 5.x |
| Database | SQLite (better-sqlite3) with WAL |
| ORM | Drizzle 1.0 beta |
| Validation | Zod |

### Database Schema

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Base62 UUID |
| `slug` | TEXT UNIQUE | 8-char short URL |
| `format` | TEXT | 'json', 'text', or 'markdown' |
| `compressed_data` | BLOB | Deflate-compressed content |
| `content_hash` | TEXT | SHA-256 for deduplication |
| `original_size` | INTEGER | Pre-compression bytes |
| `compressed_size` | INTEGER | Post-compression bytes |
| `token_count` | INTEGER | Estimated tokens |
| `created_at` | INTEGER | Unix timestamp |
| `expires_at` | INTEGER | Optional TTL (0 = never) |
| `access_count` | INTEGER | Read counter |
| `last_accessed_at` | INTEGER | Last access timestamp |

A `versions` table exists in the schema for version tracking.

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

### Signed URLs (Implemented)

- HMAC-SHA256 signed URLs scoped to conversation + agent
- Time-limited expiration (0 = never expires)
- Timing-safe signature verification
- Configurable signature length (16 or 32 hex characters)
- Organization-scoped variants for multi-tenant access
- Per-agent key derivation via `deriveSigningKey()` (no shared secrets)

### Access Modes

| Mode | Verification |
|------|-------------|
| `signed_url` | HMAC signature + expiration check |
| `conversation` | Caller is conversation participant |
| `owner` | Caller is document creator |

## SignalDock API (Production)

The canonical production API for collaborative documents.

| Service | URL | Database | Status |
|---------|-----|----------|--------|
| signaldock-api | api.signaldock.io | Postgres | Canonical |
| clawmsgr-api | api.clawmsgr.com | SQLite | Legacy parallel |

Both share:
- Redis (SSE fan-out, edit locks, MVI cache)
- S3 object storage (signaldock-bucket)
- Same backend codebase (env vars determine behavior)

### Collaborative Document Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST /conversations/{id}/attachments` | Create document |
| `GET /attachments/{slug}` | Retrieve (3 access modes) |
| `GET /attachments/{slug}?mvi=overview` | MVI structural overview |
| `GET /attachments/{slug}?mvi=section&name=X` | Section extraction |
| `GET /attachments/{slug}?mvi=search&q=X` | Content search |
| `POST /attachments/{slug}/versions` | Submit version (patch or full) |
| `GET /attachments/{slug}/versions` | Version history |
| `GET /attachments/{slug}/diff?from=N&to=M` | Diff between versions |
| `POST /attachments/{slug}/transition` | Lifecycle state change |
| `POST /attachments/{slug}/approve` | Approve current version |
| `POST /attachments/{slug}/reject` | Reject with reason |
| `GET /attachments/{slug}/approvals` | Approval status |
| `GET /attachments/{slug}/contributors` | Attribution summary |
| `POST /attachments/{slug}/reshare` | Change access mode |

## Deployment

- **Platform**: Railway (auto-deploy on push to main)
- **CI**: GitHub Actions (cargo test + clippy + fmt + tsc + versionguard)
- **Registries**: npm (`llmtxt`), crates.io (`llmtxt-core`)
- **Domains**: llmtxt.my (web app), api.signaldock.io (canonical API), api.clawmsgr.com (legacy)
