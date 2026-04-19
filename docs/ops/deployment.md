# Deployment Operations Guide

## Railway deployment overview

The `llmtxt-api` service deploys from the root `Dockerfile` via Railway's
Docker builder. On every push to `main` Railway rebuilds and redeploys.

### Startup sequence

```
run-migrations.ts  →  exit 0  →  dist/index.js
```

If `run-migrations.ts` exits non-zero, the container halts before the HTTP
server starts. Railway marks the deployment failed and does not swap traffic.

### Health and readiness probes

| Endpoint       | Behaviour                               |
|----------------|-----------------------------------------|
| `GET /api/health` | Pure no-I/O liveness — always 200    |
| `GET /api/ready`  | SELECT 1 DB ping — 503 when DB down  |

Railway polls `/api/health` (`healthcheckPath`) with a 100 s retry window
(`healthcheckTimeout`). On 3 consecutive failures the container is restarted
(`restartPolicyMaxRetries = 3`).

---

## Required environment variables

Set these in the Railway `llmtxt-api` service dashboard
(railway.app → project → llmtxt-api → Variables):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (`postgresql://...`) |
| `SIGNING_SECRET` | Yes | Minimum 32-char random secret for signed URLs. Must NOT be empty, `changeme`, `default`, `secret`, `dev-secret`, `llmtxt-dev-secret`, or `development-secret`. Server refuses to start if this is insecure in production (T472). |
| `NODE_ENV` | Yes | Must be `production` in Railway |
| `BETTER_AUTH_SECRET` | Yes | Secret for better-auth session signing |
| `CORS_ORIGIN` | Recommended | Comma-separated allowed origins (default: `https://www.llmtxt.my`) |
| `REDIS_URL` | **Yes (production)** | Redis URL for presence registry + CRDT pub/sub. Server exits with code 1 at startup if unset and `NODE_ENV=production`. Use Railway reference: `${{Redis.REDIS_URL}}`. See [docs/ops/redis-setup.md](redis-setup.md). |
| `STRIPE_SECRET_KEY` | Conditional | Required for billing endpoints (`/api/billing/*`) |
| `STRIPE_WEBHOOK_SECRET` | Conditional | Required to verify Stripe webhook signatures |
| `AUDIT_SIGNING_KEY` | Optional | Ed25519 private key hex for Merkle checkpoint signing (T107) |
| `SIGNING_KEY_KEK` | Optional | AES-256 key-encryption key for agent key rotation (T086/T090). 64 hex chars. |
| `BLOB_STORAGE_MODE` | Optional | `s3` (default) or `pg-lo`. Controls blob attachment storage. |
| `BLOB_S3_BUCKET` | Conditional | S3/R2 bucket name (required when `BLOB_STORAGE_MODE=s3`) |
| `S3_ENDPOINT` | Conditional | S3-compatible endpoint URL (R2, MinIO, etc.) |
| `S3_ACCESS_KEY_ID` | Conditional | S3 access key |
| `S3_SECRET_ACCESS_KEY` | Conditional | S3 secret key |
| `METRICS_TOKEN` | Optional | Bearer token for `/api/metrics`. If unset, endpoint is public. |
| `LOKI_URL` | Optional | Grafana Loki push URL for structured log shipping |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional | OpenTelemetry OTLP endpoint (Tempo) |
| `PORT` | Auto-set | Railway sets this automatically (defaults to 8080 in Dockerfile) |

---

## Known failure modes and fixes

### FST_ERR_DEC_REFERENCE_TYPE — server crashes at startup (T166)

**Symptom**: Container starts, passes healthcheck briefly, then enters
CrashLoopBackOff. Cloudflare edge returns 502. No runtime request logs appear.

**Root cause**: Fastify 5 rejects `decorateRequest(name, value)` when `value`
is a reference type (plain object or function). Every request would share the
same instance, which is unsafe. Fastify 5 requires the `{ getter }` form:

```typescript
// WRONG (Fastify 5 throws FST_ERR_DEC_REFERENCE_TYPE)
app.decorateRequest('rlsContext', { userId: '', role: 'anon' });

// CORRECT
app.decorateRequest('rlsContext', {
  getter() { return { userId: '', role: 'anon' } as RlsContext; },
});
```

**Fix**: `38ca17e` — `apps/backend/src/plugins/rls-plugin.ts` converted all
three `decorateRequest` calls to the `{ getter }` form.

**Affected version**: deployed between `ea52bec` and `38ca17e`.

---

### SIGNING_SECRET fail-fast (T472)

**Symptom**: Container exits immediately with:
```
[FATAL] SIGNING_SECRET is missing or set to an insecure default value.
```

**Fix**: Set `SIGNING_SECRET` to a strong random secret in Railway Variables:
```bash
openssl rand -hex 32
```

Paste the output as the `SIGNING_SECRET` env var value.

---

### Migration failure — container halts before server starts

**Symptom**: Railway deployment shows "Crashed" immediately; no request logs.

**Root cause**: `scripts/run-migrations.ts` exits 1 on any Postgres error.
The `&&` in the CMD prevents the server from starting.

**Diagnosis**:
1. Check Railway build logs (`railway logs -b`) for `migration_failed` JSON.
2. The error field contains the Postgres error message.

**Common causes**:
- Column already exists (non-idempotent migration — add `IF NOT EXISTS`).
- Table referenced in a foreign key doesn't exist yet (migration ordering).
- RLS policy creation fails (`duplicate_object`) when not wrapped in
  `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`.

---

### RLS blocks background jobs (T166 side effect)

**Symptom**: Background jobs (`audit-retention`, `crdt-compaction`, etc.) run
but silently process 0 rows even though data exists.

**Root cause**: Tables with `FORCE ROW LEVEL SECURITY` filter queries when
`app.current_user_id` is not set via `SET LOCAL`. Direct `db.*` calls outside
a `withRlsContext` wrapper see only `visibility='public'` documents.

**Fix**: Background jobs that need to see ALL rows must either:
1. Use a service-account `withRlsContext` call with `isAdmin: true`, OR
2. Have their tables excluded from RLS enforcement (add a policy that
   permits the application database role unconditionally).

The retention job (`jobs/audit-retention.ts`) currently queries `audit_logs`
directly. Since `audit_logs` has RLS with `audit_logs_select` requiring
`user_id = current_setting(...)`, the retention job sees 0 rows without an
admin context. This is a known limitation — tracked for future fix.

---

## Migration runbook

Migrations apply automatically on each Railway deploy via `run-migrations.ts`.
They are tracked by SHA-256 hash of content in `drizzle.__drizzle_migrations`.

To add a migration:

1. Create `apps/backend/src/db/migrations-pg/<timestamp>_<slug>/migration.sql`
2. Use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` for idempotency.
3. Wrap `CREATE POLICY` in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`.
4. Push to `main` — Railway will apply on next deploy.

Never modify an existing migration file. Always add a new migration.
