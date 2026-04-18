# Webhooks — Developer Guide

LLMtxt delivers real-time event notifications to your HTTP endpoints via webhooks.
This guide covers registration, signature verification, replay protection, delivery
guarantees, and the dead-letter queue.

---

## Quick Start

### 1. Register a webhook

```bash
curl -X POST https://api.llmtxt.my/api/v1/webhooks \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-server.example.com/hooks/llmtxt",
    "events": ["version.created", "state.changed"],
    "documentSlug": "my-doc-slug"
  }'
```

Response (secret shown once only):

```json
{
  "id": "wh_abc123",
  "url": "https://your-server.example.com/hooks/llmtxt",
  "events": ["version.created", "state.changed"],
  "active": true,
  "secret": "llmtxt_sec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "createdAt": 1745000000000
}
```

Store the `secret` securely — it will never be returned again.

### 2. Receive and verify a delivery

Every delivery is an HTTP POST with a JSON body and these headers:

| Header | Description |
|--------|-------------|
| `X-LLMtxt-Signature` | `sha256=<HMAC-SHA256 hex>` over the raw body |
| `X-LLMtxt-Event` | Event type string (e.g. `version.created`) |
| `X-Llmtxt-Event-Id` | Stable UUID — same on every retry of the same event |
| `Content-Type` | `application/json` |
| `User-Agent` | `llmtxt-webhook/1.0` |
| `traceparent` | W3C Trace Context (if OTel is active) |

### 3. Verify the signature (Node.js)

```typescript
import crypto from 'node:crypto';

function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  // signature is in the form "sha256=<hex>"
  const [algo, received] = signature.split('=');
  if (algo !== 'sha256' || !received) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Constant-time comparison to prevent timing attacks.
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(received, 'hex'),
  );
}
```

In your handler:

```typescript
app.post('/hooks/llmtxt', (req, res) => {
  const rawBody = req.body as string; // read raw string, not parsed JSON
  const sig = req.headers['x-llmtxt-signature'] as string;

  if (!verifyWebhookSignature(rawBody, sig, process.env.LLMTXT_WEBHOOK_SECRET!)) {
    return res.status(401).send('Invalid signature');
  }

  const event = JSON.parse(rawBody);
  // handle event...
  res.status(200).send('ok');
});
```

---

## Replay Protection

The `X-Llmtxt-Event-Id` header is a UUID that is **identical on every retry
attempt for the same event**. You can use it to build an idempotent receiver:

```typescript
const seenEventIds = new Set<string>();

app.post('/hooks/llmtxt', (req, res) => {
  const eventId = req.headers['x-llmtxt-event-id'] as string;

  if (seenEventIds.has(eventId)) {
    // Already processed — acknowledge to stop retries, but skip business logic.
    return res.status(200).send('already processed');
  }
  seenEventIds.add(eventId);

  // ... process the event
  res.status(200).send('ok');
});
```

For production, use Redis or a database table instead of an in-memory set.

---

## Delivery Guarantees

- **At-least-once delivery** — if a delivery fails, the system retries.
- **10 attempts max** — 1 initial + 9 retries.
- **Exponential backoff** — delays: 10 s, 20 s, 40 s, 80 s, …, capped at 1 hour.
- **10 s timeout** per attempt.
- **Dead-letter queue** — after all 10 attempts fail, the event is preserved for
  manual replay. No events are silently dropped.

---

## Event Types

| Event | Triggered when |
|-------|----------------|
| `document.created` | A new document is created |
| `version.created` | A new version is published |
| `state.changed` | The document lifecycle state changes |
| `document.locked` | The document is locked (autoLock or manual) |
| `document.archived` | The document is archived |
| `approval.submitted` | An approval decision is submitted |
| `approval.rejected` | An approval is rejected |
| `contributor.updated` | A contributor's stats are updated |

Subscribe to all events by omitting the `events` array (or passing `[]`).

---

## Delivery History

Inspect the last 50 delivery attempts for a webhook:

```bash
curl https://api.llmtxt.my/api/v1/webhooks/wh_abc123/deliveries \
  -H "Authorization: Bearer $API_KEY"
```

```json
{
  "webhookId": "wh_abc123",
  "deliveries": [
    {
      "id": "del_xyz",
      "eventId": "550e8400-e29b-41d4-a716-446655440000",
      "attemptNum": 0,
      "status": "success",
      "responseStatus": 200,
      "durationMs": 142,
      "createdAt": 1745001234567
    }
  ],
  "total": 1
}
```

---

## Dead-Letter Queue

Events that exhaust all retries land in the dead-letter queue (DLQ).

### Inspect DLQ entries

```bash
curl https://api.llmtxt.my/api/v1/webhooks/wh_abc123/dlq \
  -H "Authorization: Bearer $API_KEY"
```

### Replay a DLQ entry

Fix your endpoint first, then replay:

```bash
curl -X POST \
  "https://api.llmtxt.my/api/v1/webhooks/wh_abc123/dlq/dlq_entry_id/replay" \
  -H "Authorization: Bearer $API_KEY"
```

A successful replay marks `replayedAt` on the DLQ entry and resets the webhook's
failure counter.

---

## Circuit Breaker

If more than 50% of deliveries to a webhook fail within a 5-minute sliding
window (with at least 4 attempts in the window), the webhook is automatically
disabled. The failing event is still written to the DLQ.

To re-enable a disabled webhook after fixing your endpoint:

```bash
curl -X POST \
  "https://api.llmtxt.my/api/v1/webhooks/wh_abc123/enable" \
  -H "Authorization: Bearer $API_KEY"
```

This resets `failureCount` to 0 and clears the circuit-breaker window.

---

## Webhook Scoping

| `documentSlug` | Receives events from |
|----------------|---------------------|
| `null` (default) | All documents owned by you |
| `"my-doc"` | Only the document with slug `my-doc` |

---

## FAQ

**Q: My endpoint returned 5xx during a deploy. Will I lose events?**  
A: No. Events are retried with exponential backoff (up to 10 attempts, 1-hour max
delay between retries). If all retries fail, the event lands in the DLQ for
manual replay.

**Q: Can I receive the same event twice?**  
A: Yes — this is at-least-once delivery. Use `X-Llmtxt-Event-Id` to deduplicate.

**Q: How do I rotate my webhook secret?**  
A: Delete the webhook and re-register it. Secret rotation via the API is on the
roadmap (T090).

**Q: How long are delivery logs retained?**  
A: 30 days. DLQ entries are retained until replayed or manually deleted.
