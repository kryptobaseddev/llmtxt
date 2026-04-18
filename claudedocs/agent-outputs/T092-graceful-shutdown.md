# T092 — Graceful Shutdown and Deployment Safety

**Status**: complete
**Commit**: 6ced1b6415c40f6d1b6622de255e9f42fe935c53
**Tests**: 9/9 new + 266/266 full suite (zero regressions)
**Build**: tsc clean

## What Shipped

### New Module: `apps/backend/src/lib/shutdown.ts`
`ShutdownCoordinator` singleton with:
- `isDraining` flag (flipped on SIGTERM, checked by `/api/ready`)
- `registerDrainHook(name, fn)` — ordered cleanup callbacks
- `drain()` — 30s total deadline, runs all hooks, waits for in-flight count
- `requestStarted()` / `requestFinished()` — in-flight HTTP counter

### SIGTERM Handler (`apps/backend/src/index.ts`)
- `onRequest`/`onResponse`/`onError` Fastify hooks track in-flight count
- `process.once('SIGTERM')` calls `drain()` then `app.close()` then `process.exit(0)`
- `process.once('SIGINT')` mirrors for local dev

### Health Route (`apps/backend/src/routes/health.ts`)
- `GET /api/ready` returns `503 { status: "draining" }` when `isDraining === true`
- `GET /api/health` (liveness) always returns 200 — unchanged

### WebSocket Drain (`apps/backend/src/routes/ws.ts`, `ws-crdt.ts`)
- `ws-subscriptions` drain hook: JSON event-bus sockets get `{type:"shutdown"}` then `close(1001, "shutdown")`
- `ws-crdt-sessions` drain hook: CRDT collaborative editing sockets closed with code 1001
- Active socket Sets track all open connections; deregistered on `close` events

### SSE Drain (`apps/backend/src/routes/document-events.ts`, `subscribe.ts`)
- `sse-document-events` + `sse-subscribe` drain hooks
- Each active SSE response gets `retry: 5000\n\n` written before `end()`
- Clients auto-reconnect after 5s

### Webhook Flush (`apps/backend/src/events/webhooks.ts`)
- `_pendingDeliveries` Set tracks all in-flight `dispatchToWebhooks()` promises
- `webhook-deliveries` drain hook awaits `Promise.allSettled(pendingDeliveries)`

### Dockerfile
Added `STOPSIGNAL SIGTERM` before CMD — Railway respects this and waits up to its stop timeout before SIGKILL.

### Docs
`docs/ops/graceful-shutdown.md` — complete operational runbook.

## Child Tasks
- T489 (shutdown coordinator module): done
- T499 (SIGTERM handler + in-flight tracking): done
- T500 (WS graceful close): done
- T501 (SSE retry event): done
- T502 (health 503 during drain): done
- T503 (Dockerfile STOPSIGNAL + webhook flush): done
- T504 (tests): done

## Railway Deploy Safety Invariant
Zero 5xx during rolling deploys:
1. New instance passes health checks and receives traffic
2. Old instance receives SIGTERM → isDraining = true → 503 from /api/ready
3. Railway stops routing to old instance within one health check cycle
4. Old instance drains in-flight requests, sends close frames, exits cleanly
