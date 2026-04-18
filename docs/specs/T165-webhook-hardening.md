# SPEC-T165: Webhook Delivery Hardening

**Status**: Active  
**Version**: 1.0.0  
**Date**: 2026-04-18  
**Task**: T165

---

## 1. Overview

This specification defines the hardened webhook delivery system for LLMtxt.
The system MUST guarantee that no event is silently dropped on failure, that
receivers can safely deduplicate retried deliveries, and that the platform
operator is alerted to endpoints exhibiting sustained failure rates.

All keywords (MUST, SHOULD, MAY) are per RFC 2119.

---

## 2. Scope

### In scope
- Exponential-backoff retry logic for failed HTTP deliveries.
- Dead-letter queue (DLQ) for permanently-failed events.
- Stable per-event identifier for replay protection.
- HMAC-SHA256 delivery signature.
- Delivery log for owner inspection.
- Circuit breaker for auto-disabling persistently failing webhooks.
- Admin API for inspecting and replaying DLQ entries.
- Re-enable endpoint with circuit-breaker reset.

### Out of scope
- Fan-out via external queues (SQS, RabbitMQ, etc.).
- Changing the HMAC algorithm (T113 owns that).
- Multi-region delivery sharding.

---

## 3. Data Model

### 3.1 `webhooks` (existing, unchanged)

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | base62 identifier |
| user_id | text FK | owner |
| url | text | callback URL |
| secret | text | HMAC-SHA256 signing key |
| events | text | JSON array of subscribed event types |
| document_slug | text | null = all documents for this user |
| active | boolean | false after 10 consecutive failures |
| failure_count | integer | consecutive delivery failure counter |
| last_delivery_at | bigint | last attempt timestamp (ms) |
| last_success_at | bigint | last success timestamp (ms) |
| created_at | bigint | creation timestamp (ms) |

### 3.2 `webhook_deliveries` (new, T165)

One row per HTTP delivery attempt.

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | base62 identifier |
| webhook_id | text FK | references webhooks(id) ON DELETE CASCADE |
| event_id | text | stable UUID shared across all retries for one event |
| attempt_num | integer | 0-indexed attempt number (−1 = manual replay) |
| status | text | 'success' / 'failed' / 'timeout' |
| response_status | integer | HTTP status code; null on network error |
| duration_ms | integer | round-trip duration in milliseconds |
| created_at | bigint | timestamp of this attempt (ms) |

Indexes: `webhook_id`, `event_id`, `created_at`.

### 3.3 `webhook_dlq` (new, T165)

Dead-letter queue for permanently-failed events.

| Column | Type | Description |
|--------|------|-------------|
| id | text PK | base62 identifier |
| webhook_id | text FK | references webhooks(id) ON DELETE CASCADE |
| failed_delivery_id | text | id of the last failed `webhook_deliveries` row |
| event_id | text | stable event UUID |
| reason | text | 'http_error' / 'timeout' / 'network_error' / 'circuit_breaker' |
| payload | text | full JSON payload attempted |
| captured_at | bigint | timestamp when written to DLQ (ms) |
| replayed_at | bigint | null until successfully replayed |

Indexes: `webhook_id`, `event_id`, `captured_at`.

### 3.4 `webhook_seen_ids` (new, T165)

Optional receiver-side idempotency store.

| Column | Type | Description |
|--------|------|-------------|
| event_id | text PK | the stable event UUID |
| webhook_id | text | the associated webhook |
| expires_at | bigint | expiry timestamp (ms); row SHOULD be purged after this |
| seen_at | bigint | first-seen timestamp (ms) |

Indexes: `expires_at`, `webhook_id`.

---

## 4. Delivery Protocol

### 4.1 Event ID

The delivery worker MUST generate one UUID per event before the retry loop.
This UUID MUST be sent as the `X-Llmtxt-Event-Id` header on every delivery
attempt for that event. Receivers SHOULD use this header to implement
idempotency (reject or no-op on duplicate IDs seen within a configurable window).

### 4.2 Retry Schedule

| Attempt | Delay before attempt |
|---------|---------------------|
| 0 (first try) | 0 ms |
| 1 (first retry) | 10 000 ms (10 s) |
| 2 | 20 000 ms (20 s) |
| 3 | 40 000 ms (40 s) |
| 4 | 80 000 ms (80 s) |
| … | doubles each time |
| 9 (last retry) | min(10 000 * 2^8, 3 600 000) ms |
| cap | 3 600 000 ms (1 hour) |

The delay formula is:

```
delay(attempt) = min(INITIAL_BACKOFF_MS * 2^(attempt-1), MAX_BACKOFF_MS)
```

where `INITIAL_BACKOFF_MS = 10 000` and `MAX_BACKOFF_MS = 3 600 000`.

A delivery is "successful" when the remote server responds with HTTP 2xx.
Any non-2xx response or network-level error is a failure. On any failure the
retry loop MUST continue until `MAX_RETRIES` is exhausted.

### 4.3 Delivery Timeout

Each HTTP attempt MUST abort after `DELIVERY_TIMEOUT_MS = 10 000` ms (10 s).
Aborted attempts MUST be recorded with `status = 'timeout'`.

### 4.4 Delivery Log

The worker MUST write one `webhook_deliveries` row after every attempt,
including the first attempt. The row MUST be written before evaluating the
circuit breaker and before sleeping for the next backoff interval.

### 4.5 Dead-Letter Queue

If all `MAX_RETRIES + 1 = 10` attempts fail, the worker MUST write one row to
`webhook_dlq` before returning. The row MUST capture:
- The `event_id` (stable UUID).
- The `failed_delivery_id` of the last delivery row.
- A non-empty `reason` string.
- The complete `payload` string.

The worker MUST NOT silently drop events. If the DLQ write itself fails, the
error MUST be logged but MUST NOT crash the delivery goroutine.

---

## 5. Signature

Every delivery MUST include an `X-LLMtxt-Signature` header with value
`sha256=<hex>` where the HMAC-SHA256 is computed over the raw JSON body using
the webhook's `secret` field.

The computation is delegated to `crates/llmtxt-core::crypto::sign_webhook_payload`
via the WASM binding.

Receivers SHOULD verify this header before processing events.

---

## 6. Circuit Breaker

### 6.1 Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| CB_WINDOW_MS | 300 000 (5 min) | Sliding window duration |
| CB_FAILURE_RATE_THRESHOLD | 0.5 (50 %) | Failure rate above this trips the circuit |
| CB_MIN_CALLS | 4 | Minimum calls in window before tripping |

### 6.2 Behavior

After each delivery attempt, the worker MUST record the outcome in the
in-process circuit-breaker window for the webhook.

If the failure rate in the window exceeds `CB_FAILURE_RATE_THRESHOLD` with at
least `CB_MIN_CALLS` total attempts in the window, the circuit MUST trip:

1. The webhook MUST be disabled immediately (`active = false`, `failure_count = MAX_FAILURE_COUNT`).
2. The current event MUST be written to the DLQ with reason `'circuit_breaker'`.
3. No further delivery attempts for that webhook SHOULD be made for the current event.

The circuit-breaker state is in-process only. It resets on process restart or
when the webhook is re-enabled via `POST /webhooks/:id/enable`.

---

## 7. API

### 7.1 GET /webhooks/:id/deliveries

Returns the last 50 delivery attempts for this webhook.

**Auth**: owner only.  
**Response**: `{ webhookId, deliveries: DeliveryRow[], total }`.

### 7.2 GET /webhooks/:id/dlq

Returns DLQ entries for this webhook.

**Auth**: owner only.  
**Query params**:
- `includeReplayed=true` — include already-replayed entries.

**Response**: `{ webhookId, entries: DlqEntry[], total }`.

### 7.3 POST /webhooks/:id/dlq/:entryId/replay

Re-attempt delivery of a DLQ entry using the original payload and event ID.

**Auth**: owner only.  
**Response**: `{ entryId, webhookId, success: boolean, statusCode: number | null }`.

On success, `replayedAt` is set on the DLQ entry and the webhook's
`failureCount` is reset to 0.

### 7.4 POST /webhooks/:id/enable

Re-enable a disabled webhook.

**Auth**: owner only.  
**Effect**: sets `active = true`, `failureCount = 0`, clears circuit-breaker state.  
**Response**: `{ id, active: true, failureCount: 0 }`.

---

## 8. Security

- Webhook URLs MUST use HTTPS in production (`NODE_ENV=production`).
- The HMAC secret MUST be at least 16 characters (enforced at registration).
- Delivery secrets MUST NOT be returned in list responses.
- All admin routes MUST require authentication and ownership verification.

---

## 9. Retention

`webhook_deliveries` rows SHOULD be purged after 30 days by the audit-retention
job. `webhook_dlq` rows SHOULD be retained until explicitly replayed or manually
deleted by the owner. `webhook_seen_ids` rows MUST be purged after their
`expires_at` timestamp.

---

## 10. Test Requirements

The following MUST be verified by automated tests:

| Test | Coverage |
|------|----------|
| Backoff schedule matches formula for attempts 0–9 | Unit |
| `X-Llmtxt-Event-Id` is stable across retries | Unit/DB |
| `webhook_deliveries` row written per attempt | DB |
| `webhook_dlq` row written on exhaustion | DB |
| DLQ `payload` is valid JSON | DB |
| DLQ `replayed_at` set on successful replay | DB |
| Duplicate `event_id` rejected by `webhook_seen_ids` PK | DB |
| Circuit-breaker does not trip below `CB_MIN_CALLS` | Unit |
| Circuit-breaker trips at >50% failure rate | Unit |
| Circuit-breaker does not trip at exactly 50% failure rate | Unit |
