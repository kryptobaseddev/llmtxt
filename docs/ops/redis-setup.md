# Redis Setup — Ops Runbook

**Scope**: Redis is MANDATORY for production. Every Railway replica shares the
same Redis instance for the presence registry and CRDT pub/sub. Without Redis,
each pod maintains its own isolated view of who is active, silently breaking the
"Never duplicate work / never impede others" Guiding Star.

---

## Why Redis is required

| Concern | Without Redis | With Redis |
|---------|--------------|------------|
| Presence registry | Each pod sees only its own agents | All pods share one unified view |
| CRDT pub/sub | Updates only reach WS clients on the same pod | Updates fan out to all pods |
| Guiding Star | "Never impede others" violated silently | Fully honoured |

The server enforces this at startup: if `NODE_ENV=production` and `REDIS_URL` is
not set the process logs a fatal error and exits with code 1.

---

## Railway provisioning (recommended)

### 1. Add a Redis service

In the Railway dashboard for your project:

1. Click **+ New** in the top-left.
2. Select **Database** → **Add Redis**.
3. Railway provisions a Redis 7 instance in the same private network as your
   backend service.

### 2. Set the `REDIS_URL` environment variable

In the Railway dashboard, open your **backend** service → **Variables** tab:

```
REDIS_URL = ${{Redis.REDIS_URL}}
```

Railway resolves `${{Redis.REDIS_URL}}` at deploy time to the private-network
URL of the Redis service you added in step 1. The URL has the form:

```
redis://default:<password>@<internal-hostname>:6379
```

The backend service connects to Redis over Railway's private network so traffic
never leaves the data centre.

### 3. Deploy

Trigger a redeploy of the backend service. Confirm the startup log contains:

```
[redis] publisher connected
[redis] subscriber connected
```

If you see `[FATAL] REDIS_URL is not set and NODE_ENV=production` the variable
was not propagated — check the Railway service variables.

---

## Local development

`REDIS_URL` is **optional** in development and test environments. When absent
the presence registry and CRDT pub/sub fall back to in-process
EventEmitter/Map implementations. A single WARN is emitted at startup:

```
[redis] WARN: REDIS_URL not set — Redis clients are null.
```

To run a local Redis for integration testing:

```bash
# Docker
docker run -d -p 6379:6379 redis:7

# Then in your shell:
export REDIS_URL=redis://localhost:6379
pnpm --filter backend dev
```

---

## Environment variable reference

| Variable | Required in prod | Default | Notes |
|----------|-----------------|---------|-------|
| `REDIS_URL` | **Yes** | (none) | Full Redis URL. Use Railway reference variable. |
| `REDIS_TEST_URL` | No | (none) | Override for integration tests only. Falls back to `REDIS_URL`. |

Add the following to `apps/backend/.env.example` (already present from T728):

```env
# ─── Redis (MANDATORY in production) ─────────────────────────────────────────
# Required for: presence registry (multi-pod) + CRDT pub/sub fan-out.
# The server will exit(1) at startup if this is unset and NODE_ENV=production.
#
# Railway: use the reference variable from the Redis add-on:
#   REDIS_URL=${{Redis.REDIS_URL}}
#
# Local dev: omit or set to a local Redis URL.
#   REDIS_URL=redis://localhost:6379
# REDIS_URL=
```

---

## Health check integration

`GET /api/ready` includes Redis in the readiness probe. If Redis is
not connected (e.g. still starting up) the response is:

```json
{ "status": "unavailable", "reason": "Redis not ready — waiting for connection" }
```

HTTP status 503. Railway will not route traffic to this replica until Redis
is ready. This prevents a pod from serving requests with a broken presence view.

---

## Monitoring

Recommended Redis metrics to alert on (via the self-hosted Grafana stack):

| Metric | Threshold | Action |
|--------|-----------|--------|
| `redis_connected_clients` | < 2 per backend pod | Investigate pub/sub subscription drop |
| `redis_used_memory_bytes` | > 80 % of `maxmemory` | Increase Redis plan or add eviction policy |
| `redis_keyspace_hits_total` | < 90 % hit rate | Consider connection or config issues |

---

## Troubleshooting

### Server exits with `[FATAL] REDIS_URL is not set and NODE_ENV=production`

Set `REDIS_URL` in the backend service Variables tab on Railway.

### `[redis] publisher error: connect ECONNREFUSED`

The Redis service is not reachable. Check:
- Redis service is running in Railway dashboard.
- `REDIS_URL` uses the Railway internal hostname (`${{Redis.REDIS_URL}}`), not
  a public URL.

### Presence is not shared between pods

Verify both pods log `[redis] publisher connected` and `[redis] subscriber connected`.
If only one pod is connected, check that `REDIS_URL` is set on the service (not
just one replica's environment).

### Pub/sub messages not arriving within 500 ms

Check Redis network latency between pods (`redis-cli -h <host> PING`). Internal
Railway networking is typically < 2 ms. Latency > 100 ms indicates a network
misconfiguration.
