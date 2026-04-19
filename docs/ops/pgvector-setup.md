# pgvector Extension Setup — Operational Runbook

**Document**: pgvector Activation and Troubleshooting  
**Last Updated**: 2026-04-19  
**Status**: Production Ready  

## Overview

This runbook documents how to activate and troubleshoot the pgvector PostgreSQL extension in the LLMtxt production environment.

## Prerequisites

- PostgreSQL 11+ (Railway uses PostgreSQL 15+)
- pgvector extension available (Railway Postgres includes it)
- Superuser or `GRANT pg_write_server_files` privilege
- Migration `20260416040000_pgvector_embeddings` applied

## Quick Start

### 1. Activate pgvector Extension

```bash
# Via Railway CLI
railway connect postgres

# Or via environment-specific method:
railway run --service postgres -- psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### 2. Verify Activation

```bash
psql "$DATABASE_URL" -c "SELECT extversion FROM pg_extension WHERE extname='vector';"

# Output:
#  extversion
# ────────────
#  0.4.4
# (1 row)
```

### 3. Check Schema

```bash
psql "$DATABASE_URL" -c "\dt section_embeddings"

# Output:
#          List of relations
#  Schema │       Name       │ Type  │ Owner
# ────────┼──────────────────┼───────┼──────
#  public │ section_embeddings │ table │ ...
# (1 row)
```

### 4. Verify IVFFlat Index

```bash
psql "$DATABASE_URL" -c "\di section_embeddings_ivfflat*"

# Output:
#        List of relations
#  Schema │      Name      │ Type  │ Owner │ Table
# ────────┼────────────────┼───────┼───────┼────────────────
#  public │section_embeddings_ivfflat_idx │ index │ ... │ section_embeddings
# (1 row)
```

## Embedding Model

### Model: sentence-transformers/all-MiniLM-L6-v2

| Property | Value |
|---|---|
| Model name | `all-MiniLM-L6-v2` |
| Provider identifier | `local-onnx-minilm-l6` |
| Architecture | 6-layer MiniLM, distilled from MPNet |
| Output dimensions | **384** |
| ONNX variant | Xenova/all-MiniLM-L6-v2 (quantized INT8) |
| File on disk | `model_quantized.onnx` (~23 MB quantized) |
| Download size | ~23 MB (quantized) + ~3 MB tokenizer files |
| Docker image delta | < 30 MB (quantized model + onnxruntime-node) |
| Max sequence length | 512 tokens (capped at 128 in production) |
| Inference runtime | `onnxruntime-node` >= 1.18.0 |

**Why all-MiniLM-L6-v2?**

- Industry-standard sentence embedding model for semantic search
- 384 dimensions: compact enough for ANN index, rich enough for contextual understanding
- Quantized INT8 ONNX variant keeps the model at ~23 MB (vs ~90 MB FP32)
- No external API calls — inference runs fully local
- Passes contextual tests: "canines" query correctly ranks "dogs" content above "rocks" content (TF-IDF fails this)
- No license restrictions; Apache 2.0

### Model Download

The model downloads **lazily on first use** and is cached locally. No manual step required in production.

**Default cache location**: `~/.llmtxt/models/all-MiniLM-L6-v2/`

Override with:
```bash
export LLMTXT_MODEL_CACHE_DIR=/app/models  # e.g. in Docker
```

**Files downloaded on first embed:**
```
~/.llmtxt/models/all-MiniLM-L6-v2/
├── model_quantized.onnx          (~23 MB, SHA-256 verified)
└── tokenizer/
    ├── tokenizer.json
    ├── tokenizer_config.json
    └── vocab.txt
```

**Manual pre-download (for Docker build-time caching):**

```bash
# Pre-download model during Docker build (optional, saves cold-start latency)
node --input-type=module <<'EOF'
import { embed } from 'llmtxt/embeddings';
await embed('warmup');
console.log('Model cached at', process.env.LLMTXT_MODEL_CACHE_DIR || '~/.llmtxt/models');
EOF
```

### Semantic Search Configuration

```bash
# .env (production)
SEMANTIC_BACKEND=pgvector      # Default — uses ONNX+pgvector
DATABASE_PROVIDER=postgresql   # PostgreSQL driver
DATABASE_URL=postgresql://...  # Railway Postgres URL

# Optional overrides:
LLMTXT_MODEL_CACHE_DIR=/app/models   # Custom model cache path
# SEMANTIC_BACKEND=tfidf             # Force TF-IDF (dev/test only, no ONNX load)
```

**Provider selection order (runtime):**
1. OpenAI `text-embedding-3-small` — if `OPENAI_API_KEY` is set (1536-dim)
2. ONNX `all-MiniLM-L6-v2` — default when `DATABASE_PROVIDER=postgresql` (384-dim)
3. TF-IDF — fallback if `SEMANTIC_BACKEND=tfidf` or `DATABASE_PROVIDER=sqlite`

## Activation Steps (Detailed)

### Step 1: Connect to Railway Postgres

#### Option A: Railway CLI (Recommended)

```bash
# Install Railway CLI
npm install -g railway

# Authenticate
railway login

# Connect to the project
railway status

# Should show:
# Project: llmtxt
# Environment: production
# Service: llmtxt-api

# Connect to Postgres
railway connect postgres

# This opens psql directly connected to the DB
```

#### Option B: Direct psql

```bash
# Export environment variables
export DATABASE_URL=$(railway variable get DATABASE_URL)

# Connect
psql "$DATABASE_URL"
```

#### Option C: Railway Web Dashboard

1. Navigate to https://railway.app
2. Select Project: `llmtxt`
3. Select Service: `postgres` (or `Postgres`)
4. Go to **Data** or **Extensions** tab
5. Find `vector` in the extensions list
6. Click **Install** or **Enable**

### Step 2: Activate pgvector Extension

```sql
-- Method 1: Via psql interactive session
CREATE EXTENSION IF NOT EXISTS vector;

-- Verify
SELECT extversion FROM pg_extension WHERE extname='vector';
```

If you get an error:

```
ERROR: could not open extension control file "...vector.control": No such file or directory
```

The extension is not installed on this Postgres version. Contact Railway support or use the web dashboard.

### Step 3: Verify section_embeddings Table

The migration creates this table automatically. Verify it exists:

```sql
-- Check table
SELECT * FROM information_schema.tables
WHERE table_name='section_embeddings';

-- List columns
\d section_embeddings

-- Expected columns:
-- id (uuid)
-- document_id (text)
-- section_slug (text)
-- section_title (text)
-- content_hash (text)
-- provider (text)
-- model (text)
-- embedding (vector)
-- computed_at (bigint)
```

### Step 4: Verify IVFFlat Index

```sql
-- Check indexes
\di section_embeddings*

-- Expected indexes:
-- section_embeddings_ivfflat_idx (IVFFlat on embedding)
-- section_embeddings_doc_section_model_idx (UNIQUE constraint)
-- section_embeddings_document_id_idx (document lookup)

-- Detailed index info
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename='section_embeddings';
```

### Step 5: Deploy Backend

After verifying pgvector is active:

```bash
# Pull latest migration changes
git pull origin main

# Deploy via Railway
railway deploy --service llmtxt-api

# Verify deployment
railway service logs llmtxt-api | head -20

# Look for: "[db] driver=postgres-js" and "Semantic routes: using embedding provider..."
```

## Verification Tests

### Health Check: Semantic Search Endpoint

```bash
# Test the search endpoint
curl "https://api.llmtxt.my/api/v1/search?q=JWT+authentication&mode=semantic" | jq .

# Expected response:
{
  "query": "JWT authentication",
  "mode": "semantic",
  "embeddingSource": "pgvector",
  "results": [
    { "slug": "...", "sectionSlug": "...", "score": 0.89, ... }
  ]
}
```

### Direct Database Query

```bash
# Test a semantic query directly
psql "$DATABASE_URL" << 'SQL'
-- Create a test query vector (example: embedding of "hello world")
-- This is mock data; use actual embedding in production
SELECT
  d.slug,
  se.section_slug,
  1 - (se.embedding <=> '[0.1, 0.2, 0.3, ...]'::vector) AS score
FROM section_embeddings se
JOIN documents d ON d.id = se.document_id
LIMIT 5;
SQL
```

### Run Integration Test

```bash
# Activate pgvector test suite
SEMANTIC_BACKEND=pgvector pnpm run test -- semantic-pgvector.test.ts

# Expected: All 5 tests pass
# ✔ pgvector extension is installed
# ✔ section_embeddings table exists with vector column
# ✔ semantic search query returns expected results
# ✔ semantic ranking beats TF-IDF baseline for 2/3 queries
# ✔ IVFFlat index is available for vector search
```

## Troubleshooting

### Issue: Extension Not Found

```
ERROR: extension "vector" does not exist
```

**Cause**: pgvector not installed on this Postgres version.

**Solutions**:
1. Use Railway web dashboard to install extension
2. Check Postgres version: `SELECT version();`
3. Contact Railway support for extension installation

### Issue: Permission Denied

```
ERROR: permission denied to create extension
```

**Cause**: User does not have CREATE EXTENSION privilege.

**Solutions**:
1. Use a superuser account (check `railway connect postgres`)
2. Grant privileges: `GRANT CREATE ON DATABASE llmtxt TO your_user;`
3. Use Railway dashboard (automated privilege check)

### Issue: Vector Type Does Not Exist

```
ERROR: type "vector" does not exist
```

**Cause**: Extension created but not loaded in this session.

**Solution**: Disconnect and reconnect:
```bash
\quit
psql "$DATABASE_URL"
```

### Issue: IVFFlat Index Missing

```
SELECT indexname FROM pg_indexes WHERE tablename='section_embeddings';
```

**If no ivfflat index**:

```sql
-- Rebuild index (migration should have created it)
DROP INDEX IF EXISTS section_embeddings_ivfflat_idx;

CREATE INDEX section_embeddings_ivfflat_idx
  ON section_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Issue: Semantic Search Still Returns TF-IDF Results

```json
{
  "query": "...",
  "mode": "semantic",
  "embeddingSource": "tfidf",
  "fallback": true
}
```

**Cause**: pgvector active but section_embeddings table missing or wrong schema.

**Debug**:
```bash
# Check if embeddings exist
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM section_embeddings;"

# Check error logs
railway service logs llmtxt-api | grep -i "pgvector\|embedding\|error"

# Expected log if fallback triggered:
# [search] pgvector not ready, falling back to TF-IDF: table "section_embeddings" does not exist
```

**Solutions**:
1. Verify migration was applied: `\dt section_embeddings`
2. Re-run migration if needed
3. Check data: `SELECT COUNT(*) FROM section_embeddings;`

### Issue: Query Timeout

```
ERROR: canceling statement due to user request
```

**Cause**: IVFFlat index misconfigured or too few probes.

**Solutions**:
1. Increase `lists` parameter for large datasets (>100k rows):
   ```sql
   -- Current lists value
   SELECT * FROM pg_stat_user_indexes
   WHERE indexname='section_embeddings_ivfflat_idx';
   
   -- Rebuild with higher lists
   REINDEX INDEX CONCURRENTLY section_embeddings_ivfflat_idx;
   ```

2. Check query plan:
   ```sql
   EXPLAIN (ANALYZE, BUFFERS)
   SELECT 1 - (embedding <=> '[...]'::vector) AS score
   FROM section_embeddings
   ORDER BY embedding <=> '[...]'::vector
   LIMIT 20;
   ```

## Performance Tuning

### IVFFlat Lists Configuration

The IVFFlat index uses `lists=100` by default:

```
Corpus Size   | Recommended lists
──────────────┼──────────────────
<10k          | 50
10k-100k      | 100
100k-1M       | 200-500
>1M           | 500-1000
```

To adjust:

```sql
-- Check current index config (approximate)
SELECT pg_size_pretty(pg_relation_size('section_embeddings_ivfflat_idx'));

-- Rebuild with new lists (takes downtime)
DROP INDEX section_embeddings_ivfflat_idx;

CREATE INDEX section_embeddings_ivfflat_idx
  ON section_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 200);  -- Increase if slow
```

### Query Optimization

```sql
-- Check table size and bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename='section_embeddings';

-- Vacuum if bloated
VACUUM ANALYZE section_embeddings;
```

## Rollback Procedure

If pgvector needs to be disabled:

```bash
# 1. Set backend to TF-IDF fallback
SEMANTIC_BACKEND=tfidf pnpm deploy

# 2. Stop using pgvector queries
#    (search endpoint will auto-fallback to TF-IDF)

# 3. Drop extension (optional, can keep for later re-activation)
psql "$DATABASE_URL" << 'SQL'
DROP EXTENSION IF EXISTS vector CASCADE;
SQL
```

The application continues to work with TF-IDF fallback (slower but functional).

## Maintenance

### Daily Checks

```bash
# Monitor logs for pgvector errors
railway service logs llmtxt-api --tail 50 | grep -i "vector\|embedding\|error"

# Check table size
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM section_embeddings;"

# Verify index health
psql "$DATABASE_URL" -c "REINDEX INDEX CONCURRENTLY section_embeddings_ivfflat_idx;"
```

### Weekly Tasks

```bash
# Analyze query plans
psql "$DATABASE_URL" << 'SQL'
ANALYZE section_embeddings;

SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename='section_embeddings';
SQL

# Check extension version
psql "$DATABASE_URL" -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
```

### Monthly Tasks

```bash
# Full VACUUM (might need maintenance window)
psql "$DATABASE_URL" << 'SQL'
VACUUM FULL ANALYZE section_embeddings;
SQL

# Rebuild IVFFlat if needed
psql "$DATABASE_URL" -c "REINDEX INDEX CONCURRENTLY section_embeddings_ivfflat_idx;"
```

## Scaling Considerations

### Embedding Computation

- **ONNX model download**: ~90 MB on first run (cached locally)
- **Embedding latency**: 10-50ms per document (depends on content length)
- **Concurrent embeddings**: 4-8 workers to avoid CPU saturation

### Database Scalability

- **Small corpus** (<10k docs): 50-100 lists
- **Medium corpus** (10k-100k): 100-200 lists
- **Large corpus** (>100k): 500+ lists

### Query Performance

- **Semantic search** (pgvector): O(log n) with IVFFlat, typically 2-5ms
- **TF-IDF fallback**: O(n) full table scan, 50-200ms depending on corpus

## References

- [pgvector GitHub](https://github.com/pgvector/pgvector)
- [Railway PostgreSQL docs](https://docs.railway.app/databases/postgresql)
- [LLMtxt Migration 20260416040000](../../apps/backend/src/db/migrations-pg/20260416040000_pgvector_embeddings/migration.sql)
- [Semantic Search Route](../../apps/backend/src/routes/search.ts)
- [Integration Test](../../apps/backend/src/__tests__/semantic-pgvector.test.ts)

## Support Contacts

- **Railway Support**: https://railway.app/support
- **Team**: [team email/slack]
- **On-Call**: [rotation link]

---

**Document Version**: 1.0  
**Last Reviewed**: 2026-04-19  
**Next Review**: 2026-05-19
