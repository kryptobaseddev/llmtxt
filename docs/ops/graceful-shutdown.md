# Graceful Shutdown and Deployment Safety

Epic T092 — Ops, Reliability, Phase-8

## Overview

The backend registers a SIGTERM handler that orchestrates a clean shutdown
sequence before the process exits. This eliminates visible failures to
subscribed agents during Railway rolling deploys.

## Behavior on SIGTERM

1. **isDraining = true** — flipped immediately. `/api/ready` returns `503
   draining` so the load balancer stops routing new traffic within one health
   check interval.

2. **Drain hooks run in registration order** (30s overall deadline):
   - `ws-subscriptions` — JSON event-bus WS sockets receive
     `{type:"shutdown"}` then close with code `1001 Going Away`.
   - `ws-crdt-sessions` — CRDT collaborative editing sockets close with
     code `1001`.
   - `sse-document-events` — SSE streams at `/documents/:slug/events/stream`
     receive `retry: 5000\n\n` before the connection is ended. Clients
     reconnect after 5 s.
   - `sse-subscribe` — SSE streams at `/subscribe` receive the same retry
     directive.
   - `webhook-deliveries` — waits for all in-flight HTTP deliveries to
     settle (success or failure). New events are not dispatched during drain.

3. **In-flight HTTP requests** — an `onRequest`/`onResponse` Fastify hook
   pair tracks the active count. `drain()` spin-polls until the count reaches
   zero or the 30s deadline expires.

4. **`app.close()`** — Fastify closes its HTTP server and all plugin
   connections.

5. **`process.exit(0)`** — clean exit.

## Configuration

| Variable | Default | Notes |
|----------|---------|-------|
| `SIGTERM` | — | Sent by Railway on deploy/stop |
| Drain timeout | 30s | Hardcoded in `lib/shutdown.ts` |
| SSE retry delay | 5000ms | Clients reconnect after 5s |
| WS close code | 1001 | RFC 6455 Going Away |

## Dockerfile

```
STOPSIGNAL SIGTERM
```

The root `Dockerfile` includes this directive. Railway forwards SIGTERM to
`node` and waits up to its configured stop timeout (default 30s) before
sending SIGKILL.

## Module: `apps/backend/src/lib/shutdown.ts`

Exports:

- `shutdownCoordinator` — singleton `ShutdownCoordinator` instance.
- `shutdownCoordinator.isDraining` — read this in any route to short-circuit.
- `shutdownCoordinator.registerDrainHook(name, fn)` — add a cleanup callback.
- `shutdownCoordinator.drain()` — trigger drain (called by SIGTERM handler).
- `shutdownCoordinator.requestStarted()` / `requestFinished()` — in-flight
  counter used by Fastify hooks in `index.ts`.

## Health Endpoints During Drain

| Endpoint | Normal | Draining |
|----------|--------|----------|
| `GET /api/health` | `200 ok` | `200 ok` (liveness always passes) |
| `GET /api/ready` | `200 ok` | `503 draining` |

Railway uses `/api/ready` for its readiness probe. The 503 causes the
load balancer to stop routing traffic to the draining instance within one
health check cycle.

## Zero-Downtime Deploy Invariant

Railway redeploys containers sequentially. With this change:

1. New instance starts, passes health checks, receives traffic.
2. Old instance receives SIGTERM.
3. Old instance sets isDraining, returns 503 from /api/ready.
4. Railway stops routing to old instance.
5. Old instance drains in-flight requests, closes sockets, exits.

Net effect: zero 5xx errors during rolling redeploys.

## Testing

```
node --import tsx/esm --test src/__tests__/graceful-shutdown.test.ts
```

Tests cover:
- `isDraining` flag behavior
- Hook execution order
- Hook failure recovery
- In-flight counter
- Idempotency of `drain()`
- `/api/ready` returns 503 during drain
- SSE retry event on drain
- WS close code 1001 on drain
