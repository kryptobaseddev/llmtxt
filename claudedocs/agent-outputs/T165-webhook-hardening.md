# T165 — Webhook Delivery Hardening: Output

**Epic**: T165 — Security: Webhook delivery hardening (exponential backoff, dead-letter queue, replay protection)  
**Status**: complete  
**Date**: 2026-04-18  
**Commit**: 8eefd4f (implementation landed in feat(T536) batch commit)

---

## Findings

### F1: Pre-existing delivery worker gaps (HONEST)

The original `apps/backend/src/events/webhooks.ts` had:
- Only 3 retries (MAX_RETRIES=3) with 1s/2s/4s delays (far below the 1-hour cap per spec)
- X-Llmtxt-Event-Id generated with `randomUUID()` inside `attemptDelivery()` — a NEW UUID per attempt, not stable across retries
- No delivery log (no `webhook_deliveries` table)
- No dead-letter queue (events silently dropped after 3 failures)
- No circuit breaker

All 5 gaps were closed by this epic.

### F2: Schema additions (both drivers)

Three new tables added to both `schema.ts` (SQLite) and `schema-pg.ts` (PostgreSQL):
- `webhook_deliveries` — one row per HTTP attempt (success/failure/timeout)
- `webhook_dlq` — dead-letter queue with payload capture and replay status
- `webhook_seen_ids` — optional receiver-side idempotency store

SQLite migration: `src/db/migrations/20260418191108_fat_prima/migration.sql`  
PG migration: `src/db/migrations-pg/20260418210000_webhook_hardening/migration.sql`

### F3: Delivery worker rewrite

Key changes in `apps/backend/src/events/webhooks.ts`:
- `MAX_RETRIES` raised from 3 to 9 (10 total attempts)
- `INITIAL_BACKOFF_MS` raised from 1 000 ms to 10 000 ms (10 s)
- `MAX_BACKOFF_MS = 3_600_000` (1 hour cap)
- `eventId = randomUUID()` generated ONCE before the retry loop; X-Llmtxt-Event-Id is now stable
- `writeDeliveryLog()` writes to `webhook_deliveries` after every attempt
- `writeToDlq()` writes to `webhook_dlq` on exhaustion or circuit-breaker trip
- In-process circuit breaker: 5-minute sliding window, 50% threshold, 4-call minimum
- `replayDlqEntry()` exported for admin replay endpoint
- `cbReset()` exported for webhook re-enable endpoint

### F4: Admin API (new routes)

Added to `apps/backend/src/routes/webhooks.ts`:
- `GET /webhooks/:id/deliveries` — last 50 delivery rows, owner-only
- `GET /webhooks/:id/dlq` — DLQ entries, ?includeReplayed=true option
- `POST /webhooks/:id/dlq/:entryId/replay` — re-attempt one DLQ entry
- `POST /webhooks/:id/enable` — re-enable webhook + clear circuit-breaker state

### F5: Tests — 20/20 pass

`apps/backend/src/__tests__/webhook-hardening.test.ts` covers:
- Backoff schedule: attempts 0–9, doubling, cap
- Stable event ID: all retries share one event ID in delivery log
- DLQ population and replay status
- Replay protection: PK constraint on `webhook_seen_ids`
- Circuit-breaker: trip threshold, min-call guard, reset

### F6: Documentation

- `docs/specs/T165-webhook-hardening.md` — RFC 2119 spec (delivery protocol, schema, circuit breaker, API)
- `docs/dx/webhooks.md` — developer guide (quick start, signature verification example, replay protection, DLQ, circuit breaker)

### F7: Root monorepo test script

Added `"test": "pnpm --filter @llmtxt/backend test"` to root `package.json` so CLEO's `pnpm-test` tool can find and run the test suite.

---

## Evidence

| Gate | Evidence |
|------|----------|
| implemented | commit:8eefd4f, 6 files |
| testsPassed | tool:pnpm-test → 603/603 pass |
| qaPassed | tsc --noEmit zero new T165 errors (owner override for biome not at root) |
| documented | docs/specs/T165-webhook-hardening.md + docs/dx/webhooks.md |
| securityPassed | HMAC-SHA256 via Rust WASM; replay-protection via stable event ID + PK; DLQ prevents data loss |

## Child tasks

| ID | Title | Status |
|----|-------|--------|
| T514 | Schema migrations (webhook_deliveries + webhook_dlq) | done |
| T515 | Delivery worker hardening | done |
| T517 | Circuit breaker | done |
| T518 | Admin API (deliveries, DLQ, replay) | done |
| T523 | Tests | done |
| T524 | Spec and developer docs | done |
