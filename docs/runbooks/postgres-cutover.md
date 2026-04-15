# PostgreSQL Cutover Runbook

**Document**: docs/runbooks/postgres-cutover.md  
**Epic**: T233 — Ops: SQLite → Postgres migration  
**Status**: Production cutover procedure  
**Last Updated**: 2026-04-15  
**Estimated Duration**: 5–10 minutes  
**Acceptable Downtime**: 10 minutes max  

---

## Prerequisites

Before starting cutover, verify:

1. **All tasks complete** — T234 through T240 all `complete` status in `cleo`
2. **CI is green** — Latest `main` branch:
   - `migration-check` job passes (both SQLite + PG harness green)
   - All 67 backend tests pass on PG
3. **Railway Postgres service healthy** — Log into Railway dashboard:
   - Postgres service is UP
   - Database `railway` is accessible
   - No auth errors in service logs
4. **Free space on Postgres volume** — At least 2× current SQLite size
   - Check Railway Postgres → Storage tab
   - Current SQLite size: ~500MB (check `data.db` with `ls -lh`)
5. **SQLite volume snapshot scheduled** — Before step 3 below
6. **On-call team notified** — Slack/Discord/wherever
7. **Maintenance mode implemented** — Set `MAINTENANCE_MODE=1` env var on `llmtxt-api` (if implemented in T235; fallback: scale to 0 replicas)

---

## Cutover Sequence

### T-30 minutes: Announce maintenance window

1. Post a notice on `www.llmtxt.my` (add banner or update status page)
   ```
   Maintenance in progress. Expected downtime: 10 minutes.
   ```

2. Notify team in Slack/Discord
   ```
   🔧 Starting PostgreSQL cutover. API downtime: ~10 min. Cutover runbook: docs/runbooks/postgres-cutover.md
   ```

---

### T-15 minutes: Pre-flight checks

1. **Verify latest main CI green**
   ```bash
   # In GitHub Actions, check the latest main workflow run
   # All jobs must be green, including:
   #  - migration-check
   #  - backend-tests (both sqlite and postgres harness)
   ```

2. **Confirm Railway Postgres is healthy**
   - Log into Railway dashboard
   - Go to Postgres service
   - Check status badge = "Up"
   - Check resource usage is <50% CPU, <50% memory
   - No recent error logs in Logs tab

3. **Verify free space on Postgres volume**
   ```bash
   # In Railway Postgres → Storage tab, ensure Available >= 1GB
   # (current data.db is ~500MB; need headroom for migration)
   ```

4. **Snapshot the SQLite volume** (cold backup for 30-day retention)
   ```bash
   # In Railway dashboard:
   # 1. Go to llmtxt-api service
   # 2. Under Volumes, find the volume containing /app/data/data.db
   # 3. Click "..." → Snapshot
   # 4. Name it: "pre-cutover-YYYY-MM-DD"
   # 5. Wait for snapshot to complete (2-3 min)
   ```

5. **Verify current data**
   ```bash
   # Get row counts from SQLite before cutover (for verification later)
   # You can run this locally or note the script will print them during migration
   ```

---

### T-0: Stop writes

**Option A: Maintenance mode env var** (if implemented in T235)
```bash
# In Railway dashboard, llmtxt-api service:
# 1. Go to Variables tab
# 2. Set: MAINTENANCE_MODE=1
# 3. Click Deploy
# 4. Wait for restart (~30s)
# 5. Verify: curl https://api.llmtxt.my/api/health → 503 (Service Unavailable)
```

**Option B: Scale to 0 replicas** (fallback if MAINTENANCE_MODE not yet available)
```bash
# In Railway dashboard, llmtxt-api service:
# 1. Click "Scale" button (or go to Deployments tab)
# 2. Set replicas to 0
# 3. Wait for all replicas to terminate
# 4. Confirm: curl https://api.llmtxt.my/api/health → connection refused
```

Wait **30 seconds** for any in-flight requests to drain.

---

### Step 4: Copy data from SQLite to PostgreSQL

Run the migration script on your local machine or an ephemeral Railway job:

```bash
# Get the SQLite database file
# Option 1: Download from Railway volume
railway volume download <volume-id> /path/to/local/data.db

# Option 2: Or if you have a local copy already at ./apps/backend/data.db

# Get the Postgres connection URL from Railway dashboard:
# → Postgres service → Connect tab → copy DATABASE_PUBLIC_URL

# Run migration (from monorepo root):
export SQLITE_SOURCE_PATH=./apps/backend/data.db
export POSTGRES_TARGET_URL="postgresql://..."  # Paste the DATABASE_PUBLIC_URL from Railway
cd apps/backend
pnpm exec tsx scripts/migrate-sqlite-to-postgres.ts
```

**Expected output** (watch for):
- Per-table progress: `Migrating users ... 5 rows, 203ms`
- Each table shows: table name, row count, duration
- Final summary: all 20 tables, total row count, total time
- Exit code 0 = success, exit code 1 = failure

**If any table fails**:
```
❌ STOP HERE. Do not proceed to Step 5.
- Check the error message (FK constraint, type mismatch, etc.)
- Ask team/issue to investigate
- Run the script again with DRY_RUN=1 to see what would happen without writing
- Do NOT attempt manual inserts — script is idempotent, safe to re-run
```

---

### Step 5: Verify row counts match

After migration completes, verify the counts:

```bash
# Run verification script (if available; otherwise, script already printed them)
cd apps/backend
pnpm exec tsx scripts/verify-counts.ts

# Or manually check a few tables:
# In Railway Postgres → Query tab or CLI:
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM documents;
SELECT COUNT(*) FROM versions;
# Compare to SQLite counts printed by migration script above
```

**Expected**:
- Every table in PostgreSQL has row count ≥ SQLite row count
- Spot-check a recent document: fetch it by `id` in both DBs, content matches exactly

**If counts don't match**:
```
❌ STOP. Do not proceed.
- Investigate the missing rows
- Re-run migration script (it is idempotent with ON CONFLICT DO NOTHING)
- Ask team for help before proceeding
```

---

### Step 6: Apply PG schema migration tracking

This marks the schema as "at latest state" in Drizzle:

```bash
cd apps/backend
DATABASE_URL="$POSTGRES_TARGET_URL" pnpm exec tsx scripts/run-migrations.ts
```

**Expected**:
- Output: `Applied migration: 0001_...`
- Exit code 0

**Verify** (via Railway Postgres → Query tab):
```sql
SELECT * FROM __drizzle_migrations;
-- Should have 1 row for the baseline 0001 migration
```

---

### Step 7: Flip DATABASE_URL on Railway

Update the `llmtxt-api` service environment to point to Postgres:

```bash
# In Railway dashboard, llmtxt-api service:
# 1. Go to Variables tab
# 2. Update or create: DATABASE_URL = ${{Postgres.DATABASE_URL}}
#    (This is a Railway variable reference — copy from Postgres → Connect → DATABASE_URL)
# 3. If not already set: DATABASE_PROVIDER = postgresql
# 4. REMOVE or DELETE: MAINTENANCE_MODE (if you set it in Step 3)
# 5. Click Deploy
# 6. Watch the deployment progress (~1-2 min)
```

---

### Step 8: Scale back + health check

Once deployment is complete:

```bash
# If you scaled to 0 replicas in Step 3, scale back to 1
# In Railway dashboard, llmtxt-api:
# 1. Click Scale → set replicas to 1
# 2. Wait for replica to be Ready (watch Deployment history, status changes to "Running")
# 3. Health check (allow ~30s for startup): curl -v https://api.llmtxt.my/api/health
#    Expected: 200 OK, body: { ok: true }
```

Verify startup logs show Postgres driver:

```bash
# In Railway dashboard, llmtxt-api → Logs tab, watch for:
# [db] driver=postgres
# [db] connected to postgres://...
# (If you see [db] driver=sqlite, something went wrong — check DATABASE_URL and revert!)
```

**Verify read-only endpoints work**:
```bash
curl https://api.llmtxt.my/api/health
# Expected: 200 OK, { ok: true }

curl https://api.llmtxt.my/api/ready
# Expected: 200 OK (verifies DB ping against PostgreSQL)

curl https://api.llmtxt.my/api/metrics
# Expected: 200 OK, JSON with counter stats
```

---

### Step 9: Run smoke tests

Create a real document and verify round-trip:

```bash
# 1. Create a new document
curl -X POST https://api.llmtxt.my/api/compress \
  -H "Content-Type: application/json" \
  -d '{"content":"smoke test","title":"test"}' \
  -o /tmp/doc.json
cat /tmp/doc.json
# Expected: 200 OK, returns { id: "...", content: "...", ... }

# 2. Fetch it back (verify read works against Postgres)
DOC_ID=$(jq -r .id /tmp/doc.json)
curl https://api.llmtxt.my/api/documents/$DOC_ID
# Expected: 200 OK, content matches

# 3. Create a version (verify versioning + concurrent write retry logic)
curl -X POST https://api.llmtxt.my/api/documents/$DOC_ID/versions \
  -H "Content-Type: application/json" \
  -d '{"content":"v2 content"}' \
  -o /tmp/v2.json
cat /tmp/v2.json
# Expected: 200 OK, new version created

# 4. List versions
curl https://api.llmtxt.my/api/documents/$DOC_ID/versions
# Expected: 200 OK, list includes both versions

# 5. Check a migrated document from before cutover (if any exist)
curl https://api.llmtxt.my/api/documents/<known-doc-id>
# Expected: 200 OK, old content intact
```

---

### Step 10: Monitor for 1 hour

Watch the error rate and performance metrics:

```bash
# Check logs for errors
# In Railway dashboard, llmtxt-api → Logs tab:
# - Look for ERROR or WARN messages
# - If you see "unique constraint" errors, that is normal (indicates retries)
# - If you see "connection pool exhausted", increase max connections
# - If you see timezone mismatches in timestamps, investigate

# Monitor metrics
curl https://api.llmtxt.my/api/metrics
# Watch the counters increment as requests flow in
# Ensure no sudden spikes in error_count

# Check Postgres resource usage
# In Railway Postgres → Storage tab:
# - CPU usage should be <70%
# - Memory usage should be <70%
# - Connection count should be <20 (you set max: 20)
```

---

### Step 11: Post-cutover handoff

Once stable for 1 hour:

1. **Remove maintenance mode notice** from www.llmtxt.my
2. **Announce completion** in Slack/Discord
   ```
   ✅ PostgreSQL cutover complete. API is back online. Cutover time: ~X minutes.
   ```
3. **Update MEMORY.md** in project root:
   ```markdown
   ## Postgres Cutover Date
   - **Date**: 2026-04-15 (example)
   - **Duration**: 7 minutes
   - **Notes**: Zero data loss, no rollback needed
   - **SQLite snapshot**: pre-cutover-2026-04-15 (retained for 30 days)
   ```
4. **Create a follow-up task** to delete the SQLite snapshot after 30 days
   ```bash
   cleo create \
     --type task \
     --parent T233 \
     --title "T244: Delete SQLite volume snapshot (30 days post-cutover)" \
     --description "Delete Railway volume snapshot 'pre-cutover-YYYY-MM-DD' from Dashboard → Backups. Cutover completed YYYY-MM-DD." \
     --size small
   ```

---

## Rollback (if anything goes wrong during Steps 4–10)

**If you need to revert to SQLite**, follow these steps:

### Revert environment

```bash
# In Railway dashboard, llmtxt-api service:
# 1. Go to Variables tab
# 2. Set: DATABASE_URL = file:///app/data/data.db
#    (This is the SQLite file path on the volume)
# 3. Set: DATABASE_PROVIDER = sqlite
# 4. Click Deploy
# 5. Wait for restart (~30s)
```

### Verify rollback

```bash
# Check logs for SQLite driver:
# In Railway → llmtxt-api → Logs tab, look for:
# [db] driver=sqlite
# [db] connected to file:///app/data/data.db

# Health check:
curl https://api.llmtxt.my/api/health
# Expected: 200 OK

curl https://api.llmtxt.my/api/ready
# Expected: 200 OK (verifies DB ping against SQLite)
```

### Investigate root cause

```
✏️ DO NOT proceed to re-cutover without understanding why it failed.
- Check the error logs from the cutover step that failed
- Was it Step 4 (migration script error)? Check FK constraints, data types
- Was it Step 8 (health check failed)? Check DATABASE_URL, Postgres connectivity
- Was it Step 9 (smoke test failed)? Check if data was actually migrated
- Post in #incidents channel with full error + logs
```

### Post-rollback

- **DO NOT delete the PostgreSQL data** — it can be inspected for debugging
- **Keep the SQLite volume snapshot** — rollback path is now live
- **Re-attempt cutover only after** root cause is fixed and verified in preview
- **Update CLEO task** T241 with failure details so next attempt can learn from it

---

## Known Risks & Mitigations

### Risk: Concurrent writes cause UNIQUE constraint collisions

**What happens**: Two agents write versions to the same document simultaneously. One hits a UNIQUE constraint error.

**Mitigation**: Both `versions.ts` and the retry logic in `merge.ts` already handle this. Postgres will reject the duplicate, the client retries, and the second client's version gets a new version number. **Expected behavior — not a bug.**

**Monitor**: Watch logs for `unique constraint` errors. A few per hour is normal. If >10 per minute, something else is broken.

### Risk: Connection pool exhaustion

**What happens**: Too many concurrent requests exceed the `max: 20` connection pool, new requests wait or fail.

**Mitigation**: 20 connections is sized for single Railway instance. If you see `ConnectionError: too many`, increase `max` in `src/db/index.ts` and redeploy.

**Monitor**: Watch logs for `ConnectionError`. Check Postgres metrics for connection count (Railway dashboard).

### Risk: Timestamp timezone mismatches

**What happens**: SQLite stores timestamps as integer milliseconds (UTC assumed). Postgres stores `timestamp with time zone`. Migration script should preserve UTC, but verify a known document's timestamp before and after.

**Mitigation**: Migration script converts via `toDate()` helper. Spot-check a migrated document's `createdAt` and `updatedAt` in both databases to confirm they match.

**Verify**:
```bash
# Before cutover, in SQLite:
sqlite3 ./apps/backend/data.db "SELECT id, created_at FROM documents LIMIT 1;"

# After cutover, in Postgres (via Railway → Query):
SELECT id, created_at FROM documents LIMIT 1;
# Should match (same timestamp value)
```

### Risk: Boolean values converted incorrectly

**What happens**: SQLite stores booleans as `0`/`1`, Postgres expects true/false. If not converted, queries may fail.

**Mitigation**: Migration script includes `toBool()` helper for all boolean columns:
- `users.email_verified`, `users.is_anonymous`
- `documents.is_anonymous`, `documents.approval_require_unanimous`
- `signed_url_tokens.revoked`, `api_keys.revoked`, `webhooks.revoked`, `webhooks.active`

**Verify**: A few smoke test creates/reads will surface this immediately.

---

## Recovery Checklist

If the cutover succeeds but something seems off post-cutover, use this checklist:

- [ ] Logs show `[db] driver=postgres` at startup
- [ ] Health check returns 200
- [ ] Ready check returns 200 (DB ping succeeds)
- [ ] Metrics endpoint returns 200 with non-zero counters
- [ ] Smoke test creates a document successfully
- [ ] Smoke test fetches an old document (pre-cutover) and content matches
- [ ] No ERROR-level logs in the past 5 minutes
- [ ] Postgres resource usage <70% CPU, <70% memory
- [ ] No `unique constraint violation` errors (a few retries are normal, >10/min is bad)
- [ ] Timestamps on documents match between SQLite snapshot and Postgres (spot-check)
- [ ] Team confirms they can use the API normally

If any check fails, **immediately revert to SQLite** using the Rollback section above, then investigate.

---

## References

- **SPEC**: docs/spec/SPEC-T233-postgres-migration.md (section 8)
- **ADR**: docs/adr/ADR-T233-postgres-migration.md (section D6 deployment)
- **Migration Script**: apps/backend/scripts/migrate-sqlite-to-postgres.ts
- **Epic**: T233 (PostgreSQL Migration)
- **Follow-up**: T244 (30-day snapshot retention reminder)

---

## Questions & Escalation

**Q: Can I run the migration script multiple times?**  
A: Yes. It uses `ON CONFLICT DO NOTHING`, so re-running is safe and idempotent.

**Q: What if the migration script times out?**  
A: Increase the timeout in the script (currently 30s per table). Re-run it — already-migrated rows are skipped.

**Q: Can I cutover at a time other than 3am?**  
A: Yes. This runbook is generic — adjust the time as needed. Key requirement is minimal user traffic during the 5–10 min window.

**Q: What if I need to use the old SQLite after cutover?**  
A: You can't—API is configured for Postgres now. The SQLite volume snapshot is a cold backup only. Don't edit it; keep it for 30 days, then delete.

**Q: Can T146 (CRDT) ship before this cutover completes?**  
A: No. T146 depends on T233 being fully deployed and verified in production. Wait for this runbook to complete successfully first.
