# LLMtxt Architecture Specification v2.0

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document
are to be interpreted as described in RFC 2119.

---

## 1. Overview

This specification defines the unified, LLM-first architecture for LLMtxt, a text sharing system optimized for agent-to-agent communication. The design eliminates the dual-storage confusion, minimizes token overhead, and scales to millions of documents per day.

**Design Principles:**
- Single storage mode (backend only) - no URL hash storage
- Metadata computed on-demand, not stored redundantly
- HTTP headers for LLM metadata to keep response bodies minimal
- Single codebase serving both humans and LLMs via content negotiation
- Stateless design with horizontal scaling capability

---

## 2. Definitions

| Term | Definition |
|------|------------|
| **Slug** | 8-character base62 identifier for document retrieval |
| **Agent** | An automated LLM-based system consuming the API |
| **Human User** | A person interacting via web browser |
| **Metadata** | Token count, compression ratio, timestamps (computed, not stored) |
| **Payload** | The actual content being shared |
| **TTL** | Time-to-live for document expiration |

---

## 3. Architecture Decision

### 3.1 Unified Backend Storage (MANDATORY)

**DECISION-001**: The system MUST use only backend storage. URL hash storage MUST be removed entirely.

**Rationale:**
- Eliminates user confusion about storage modes
- Simplifies mental model: "Everything has a short URL"
- Enables consistent versioning and metadata
- Scales uniformly regardless of content size
- Removes browser-specific URL length limitations

**Migration Path:**
1. Remove hash-based storage code from frontend
2. All content flows through `/api/documents` endpoints
3. Frontend auto-saves to backend with debouncing (500ms)
4. URL always shows short slug format

### 3.2 Database Schema (Simplified)

**REQ-001**: The database MUST store only immutable fields:

```sql
CREATE TABLE documents (
    id TEXT PRIMARY KEY,              -- internal UUID
    slug TEXT UNIQUE NOT NULL,        -- 8-char base62 
    content BLOB NOT NULL,            -- compressed payload
    format TEXT NOT NULL,             -- 'json' | 'text'
    schema TEXT,                      -- validation schema name
    created_at INTEGER NOT NULL,      -- unix timestamp (ms)
    expires_at INTEGER,               -- optional TTL
    access_count INTEGER DEFAULT 0    -- analytics
);

CREATE INDEX idx_slug ON documents(slug);
CREATE INDEX idx_expires ON documents(expires_at) 
  WHERE expires_at IS NOT NULL;
```

**REQ-002**: Metadata fields (tokenCount, compressionRatio) MUST be computed on retrieval, not stored.

**Rationale:**
- Saves 30-40% storage per document
- Metadata always fresh (no stale data)
- Reduces write amplification

---

## 4. API Design (LLM-First)

### 4.1 Minimal Response Principle

**REQ-003**: API responses MUST contain only essential fields by default.

**Default Response Format:**
```json
{
  "slug": "EDaCET4W",
  "url": "https://llmtxt.my/EDaCET4W",
  "content": "..."
}
```

**REQ-004**: Full metadata MUST be available via HTTP headers.

**Response Headers:**
```
X-Token-Count: 42
X-Compression-Ratio: 0.85
X-Format: json
X-Schema: prompt-v1
X-Created-At: 1709836800000
```

**Rationale:**
- LLM agents can read headers without parsing large JSON
- Keeps response body minimal for token efficiency
- Humans can view headers in browser dev tools

### 4.2 Endpoint Specification

#### Create Document

**REQ-005**: `POST /api/documents` MUST accept:

```json
{
  "content": "string (required)",
  "format": "json|text (optional, auto-detected)",
  "schema": "string (optional)",
  "expires_in": 86400
}
```

**REQ-006**: Response MUST be (201 Created):

```json
{
  "slug": "EDaCET4W",
  "url": "https://llmtxt.my/EDaCET4W"
}
```

With headers:
```
X-Token-Count: 42
X-Compression-Ratio: 0.85
```

**Rationale:** 42 tokens × 3 chars/token = 126 chars saved vs including in body

#### Retrieve Document

**REQ-007**: `GET /api/documents/:slug` MUST return content with minimal wrapping.

**REQ-008**: Query parameter `?meta=true` MAY return full metadata in body for human consumption.

**REQ-009**: Query parameter `?raw=true` MUST return content only (no JSON wrapper).

**Rationale for raw mode:**
- LLM agents often need just the content
- Reduces parsing overhead
- Useful for piping content directly

### 4.3 Token Efficiency Analysis

**Current Approach vs Proposed:**

| Metric | Current | Proposed | Savings |
|--------|---------|----------|---------|
| Create response (chars) | 280 | 65 | 77% |
| Retrieve response (chars) | 320 | 55* | 83% |
| Headers overhead | 0 | 120 | -120 |
| **Net token savings** | - | - | **~70%** |

*Using `?raw=true` mode

---

## 5. LLM-to-LLM Communication Workflow

### 5.1 Basic Workflow

**Workflow-001**: Agent A creates content and shares with Agent B.

```bash
# Agent A creates document
curl -X POST https://llmtxt.my/api/documents \
  -H "Content-Type: application/json" \
  -d '{"content": "{\"system\":\"You are helpful...\"}"}'

# Response (42 tokens in headers, 65 chars in body)
# {"slug":"EDaCET4W","url":"https://llmtxt.my/EDaCET4W"}

# Agent A sends to Agent B:
# "Here's the context: https://llmtxt.my/EDaCET4W"

# Agent B retrieves (raw mode for minimal tokens):
curl https://llmtxt.my/api/documents/EDaCET4W?raw=true

# Response: Just the content, no JSON wrapper
```

**Token Count:**
- Create: ~15 input + 65 output = 80 tokens
- Retrieve: ~10 input + content tokens
- Total overhead: ~90 tokens vs 400+ in current implementation

### 5.2 Batch Operations (Optional Enhancement)

**REQ-010**: `POST /api/documents/batch` MAY support creating multiple documents.

**Use case:** Agent sharing context with multiple LLM instances.

```json
{
  "documents": [
    {"content": "Context part 1..."},
    {"content": "Context part 2..."}
  ]
}
```

**Response:**
```json
{
  "slugs": ["EDaCET4W", "xK9mP2nQ"]
}
```

---

## 6. Storage Strategy

### 6.1 Compression Approach

**REQ-011**: Content MUST be compressed using zlib (deflate) before storage.

**Compression Levels:**
- Level 6 (default): Balanced speed/ratio
- Level 1 (fast path): For <1KB content
- Level 9 (max): For archival content (configurable)

**Expected Ratios:**
- JSON: 70-80% compression
- Text/Markdown: 60-75% compression
- Code: 50-65% compression

### 6.2 Storage Cost Analysis (1M docs/day)

**Assumptions:**
- Average content size: 2KB uncompressed
- Compression ratio: 0.7
- Document count: 1M/day

**Storage Requirements:**
```
Per document:
- Content: 2KB × 0.7 = 1.4KB
- Metadata overhead: ~100 bytes
- Total: ~1.5KB per document

Daily: 1.5KB × 1M = 1.5GB/day
Monthly: 1.5GB × 30 = 45GB/month
Annual: 45GB × 12 = 540GB/year

Cost (AWS S3): ~$12/month storage + transfer
Cost (SQLite/Railway): Included in base tier
```

**REQ-012**: Documents MUST support optional TTL (expires_in seconds).

**Rationale:** Reduces storage costs for temporary content.

### 6.3 Version Control (Deferred)

**DECISION-002**: Full version history is NOT REQUIRED for MVP.

**Rationale:**
- Increases storage 3-5x
- Complex conflict resolution
- Most LLM use cases don't need history
- Can add later via separate versions table

**MVP Versioning:**
- Create new slug for each "version"
- Implicit versioning via document lineage
- Add explicit versioning in v2.1 if needed

---

## 7. Scalability Plan

### 7.1 Horizontal Scaling

**REQ-013**: The system MUST be stateless to enable horizontal scaling.

**Architecture:**
```
┌─────────────────────────────────────┐
│           Load Balancer             │
└──────────────┬──────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌─────────┐          ┌─────────┐
│ API Pod │          │ API Pod │
└────┬────┘          └────┬────┘
     │                     │
     └──────────┬──────────┘
                ▼
         ┌─────────────┐
         │  Database   │
         │  (Primary)  │
         └──────┬──────┘
                │
         ┌──────▼──────┐
         │   Cache     │
         │   (Redis)   │
         └─────────────┘
```

**Phased Scaling:**

**Phase 1 (Current - 1K docs/day):**
- Single Railway instance
- SQLite database
- In-memory LRU cache

**Phase 2 (10K docs/day):**
- Multi-instance Railway
- PostgreSQL (Railway managed)
- Redis cache shared across instances

**Phase 3 (1M+ docs/day):**
- Kubernetes cluster
- PostgreSQL with read replicas
- Redis cluster
- CDN for static assets

### 7.2 Caching Strategy

**REQ-014**: Hot documents MUST be cached in memory.

**Cache Configuration:**
```javascript
{
  maxSize: 10000,        // documents
  ttl: 3600000,          // 1 hour
  checkPeriod: 600000    // 10 minutes
}
```

**Cache Invalidation:**
- Write-through: Cache updated on create
- TTL-based: Auto-expire after 1 hour
- Manual: DELETE endpoint clears cache

**Expected Hit Rate:** 60-80% (Pareto principle)

### 7.3 Performance Targets

**REQ-015**: The system MUST meet these performance criteria:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Create latency | <50ms p95 | End-to-end |
| Retrieve latency | <20ms p95 | With cache hit |
| Throughput | >1000 req/s | Per instance |
| Availability | 99.9% | Monthly |

---

## 8. Human vs LLM Interfaces

### 8.1 Content Negotiation

**REQ-016**: The system MUST use HTTP Accept header for interface selection.

| Accept Header | Response Format |
|--------------|-----------------|
| `application/json` | JSON API response (default for LLMs) |
| `text/html` | HTML viewer page (default for browsers) |
| `text/plain` | Raw content only |

**Example:**
```bash
# LLM agent
curl -H "Accept: application/json" https://llmtxt.my/EDaCET4W

# Human browser (no header)
curl https://llmtxt.my/EDaCET4W
# → Returns HTML viewer page
```

### 8.2 URL Routing

**REQ-017**: URL `/:slug` MUST route based on Accept header:

```
GET /EDaCET4W
├─ Accept: text/html → Returns view.html with content
├─ Accept: application/json → Returns JSON API response
└─ Accept: text/plain → Returns raw content
```

**Rationale:** Single URL works for both humans and LLMs.

### 8.3 Human Dashboard

**REQ-018**: Human users MAY access metadata dashboard at `/:slug/meta`.

**Features:**
- Token count visualization
- Compression statistics
- Format detection
- QR code generation
- Copy-to-clipboard

**Implementation:**
- Static HTML/CSS/JS
- Fetches JSON data from API
- No server-side rendering required

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
**Goal:** Unified storage, minimal API

**Tasks:**
1. Remove URL hash storage from frontend
2. Simplify database schema (remove computed fields)
3. Implement minimal response format
4. Add HTTP header metadata
5. Update llms.txt documentation

**Acceptance Criteria:**
- All content uses backend storage
- Response <100 chars for simple creates
- Headers contain all metadata
- Frontend auto-saves to backend

### Phase 2: Optimization (Week 3-4)
**Goal:** Token efficiency, caching

**Tasks:**
1. Implement `?raw=true` mode
2. Add in-memory LRU cache
3. Add compression level optimization
4. Implement TTL support
5. Add batch operations

**Acceptance Criteria:**
- 70% token reduction vs current
- <20ms retrieval with cache hit
- Configurable document expiration

### Phase 3: Scale (Week 5-6)
**Goal:** Production readiness

**Tasks:**
1. Add PostgreSQL migration path
2. Implement Redis caching
3. Add rate limiting
4. Add monitoring/alerting
5. Performance testing (1M docs)

**Acceptance Criteria:**
- Handles 1000 req/s per instance
- <50ms p95 latency
- 99.9% availability

---

## 10. Security Considerations

### 10.1 Rate Limiting

**REQ-019**: API MUST implement rate limiting:

```
- Per IP: 100 requests/minute
- Per slug: 1000 requests/minute
- Burst: 20 requests/second
```

### 10.2 Content Safety

**REQ-020**: Content MUST be scanned for:
- Malicious JavaScript (if rendered as HTML)
- Excessive size (>1MB rejected)
- Binary content (rejected for text API)

### 10.3 URL Safety

**REQ-021**: Slugs MUST:
- Be randomly generated (not sequential)
- Exclude profanity (filter list)
- Use base62 encoding (URL-safe)

---

## 11. Migration from Current Implementation

### 11.1 Breaking Changes

| Current | New | Migration |
|---------|-----|-----------|
| URL hash storage | Removed | Auto-migrate on first API call |
| Full metadata in body | Headers only | Update client code |
| `POST /compress` | `POST /api/documents` | Redirect/alias |
| `POST /decompress` | `GET /api/documents/:slug` | Redirect/alias |

### 11.2 Backward Compatibility

**REQ-022**: Old endpoints MUST redirect to new for 30 days.

```javascript
// Old endpoint
fastify.post('/compress', async (req, res) => {
  res.header('Deprecation', 'true');
  res.header('Sunset', 'Thu, 15 Apr 2026 00:00:00 GMT');
  // Redirect to new endpoint
  return createDocument(req, res);
});
```

---

## 12. Compliance

A system is compliant with this specification if:

1. **REQ-001** through **REQ-022** are implemented as specified
2. All storage uses backend (no URL hash fallback)
3. Metadata is provided via HTTP headers by default
4. Content negotiation works via Accept header
5. Performance targets are met under load testing
6. Rate limiting is enforced
7. Migration path preserves existing documents

Non-compliant implementations SHOULD document deviations and provide rationale.

---

## Appendix A: Token Cost Comparison

**Scenario:** Agent A shares 500-token context with Agent B

**Current Implementation:**
```
Create response: 280 chars = ~70 tokens
Agent A→B message: "Use this context: https://llmtxt.my/EDaCET4W"
Retrieve response: 320 chars = ~80 tokens
Content: 500 tokens
Total: ~650 tokens
```

**Proposed Implementation:**
```
Create response: 65 chars = ~16 tokens
Agent A→B message: "https://llmtxt.my/EDaCET4W"
Retrieve (raw): 0 overhead
Content: 500 tokens
Total: ~520 tokens

Savings: 130 tokens (20% reduction)
```

**At scale (1M transfers/day):**
- Savings: 130M tokens/day
- Cost: ~$2.60/day ($78/month) at GPT-4 pricing

---

## Appendix B: Database Migration Script

```sql
-- Step 1: Create new table
CREATE TABLE documents_v2 (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    content BLOB NOT NULL,
    format TEXT NOT NULL,
    schema TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    access_count INTEGER DEFAULT 0
);

-- Step 2: Migrate data (computed fields removed)
INSERT INTO documents_v2 
SELECT id, slug, compressedData, format, schema, createdAt, expiresAt, accessCount
FROM documents;

-- Step 3: Verify counts match
SELECT 
  (SELECT COUNT(*) FROM documents) as old_count,
  (SELECT COUNT(*) FROM documents_v2) as new_count;

-- Step 4: Swap tables
ALTER TABLE documents RENAME TO documents_old;
ALTER TABLE documents_v2 RENAME TO documents;

-- Step 5: Create indexes
CREATE INDEX idx_slug ON documents(slug);
CREATE INDEX idx_expires ON documents(expires_at) WHERE expires_at IS NOT NULL;

-- Step 6: Drop old table (after verification)
-- DROP TABLE documents_old;
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-03-08 | Initial specification |
| 2.0 | 2026-03-08 | Unified storage, header metadata, simplified schema |
