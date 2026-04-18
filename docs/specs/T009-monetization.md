# Monetization Technical Spec — T009 / T010 / T011

**Version**: 1.0.0  
**Date**: 2026-04-18  
**Status**: Approved

---

## 1. Tier Matrix

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Price | $0 | $19/mo | $199/mo |
| Documents | 50 | 500 | Unlimited |
| Max doc size | 500 KB | 10 MB | 100 MB |
| API calls/mo | 1,000 | 50,000 | 500,000 |
| CRDT ops/mo | 500 | 25,000 | 250,000 |
| Agent seats | 3 | 25 | Unlimited |
| Storage | 25 MB | 5 GB | 100 GB |
| Version retention | 90 days | Unlimited | Unlimited |

Unlimited = no server-side limit enforced (soft cap only in monitoring).

---

## 2. Rust SSoT — `crates/llmtxt-core/src/billing.rs`

### 2.1 Types

```rust
pub enum TierKind { Free, Pro, Enterprise }

pub struct TierLimits {
    pub max_documents: Option<u64>,
    pub max_doc_bytes: Option<u64>,
    pub max_api_calls_per_month: Option<u64>,
    pub max_crdt_ops_per_month: Option<u64>,
    pub max_agent_seats: Option<u64>,
    pub max_storage_bytes: Option<u64>,
}

pub struct UsageSnapshot {
    pub document_count: u64,
    pub api_calls_this_month: u64,
    pub crdt_ops_this_month: u64,
    pub agent_seat_count: u64,
    pub storage_bytes: u64,
}

pub enum TierDecision {
    Allowed,
    Blocked { limit_type: String, current: u64, limit: u64 },
}
```

### 2.2 Contract

```rust
pub fn tier_limits(tier: TierKind) -> TierLimits
pub fn evaluate_tier_limits(usage: &UsageSnapshot, tier: TierKind) -> TierDecision
```

- Pure function — no I/O.
- `None` limit = no cap enforced.
- Same inputs always yield same output (deterministic).
- Exposed via WASM binding `evaluate_tier_limits_wasm(usage_json, tier_str) -> String`.

---

## 3. Database Schema

### 3.1 `usage_events` table

```sql
CREATE TABLE usage_events (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id    TEXT,
  event_type  TEXT NOT NULL,  -- doc_read|doc_write|api_call|crdt_op|blob_upload
  resource_id TEXT,
  bytes       BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX usage_events_user_id_created_at_idx ON usage_events(user_id, created_at);
CREATE INDEX usage_events_event_type_idx ON usage_events(event_type);
```

### 3.2 `subscriptions` table

```sql
CREATE TABLE subscriptions (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tier                  TEXT NOT NULL DEFAULT 'free',  -- free|pro|enterprise
  status                TEXT NOT NULL DEFAULT 'active', -- active|past_due|canceled|trialing
  stripe_customer_id    TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  grace_period_end      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX subscriptions_stripe_customer_id_idx ON subscriptions(stripe_customer_id);
CREATE INDEX subscriptions_stripe_subscription_id_idx ON subscriptions(stripe_subscription_id);
CREATE INDEX subscriptions_tier_status_idx ON subscriptions(tier, status);
```

### 3.3 `usage_rollups` table (daily aggregates)

```sql
CREATE TABLE usage_rollups (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rollup_date     DATE NOT NULL,
  api_calls       BIGINT NOT NULL DEFAULT 0,
  crdt_ops        BIGINT NOT NULL DEFAULT 0,
  doc_reads       BIGINT NOT NULL DEFAULT 0,
  doc_writes      BIGINT NOT NULL DEFAULT 0,
  bytes_ingested  BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, rollup_date)
);

CREATE INDEX usage_rollups_user_id_rollup_date_idx ON usage_rollups(user_id, rollup_date);
```

### 3.4 `stripe_events` table (webhook dedup)

```sql
CREATE TABLE stripe_events (
  stripe_event_id  TEXT PRIMARY KEY,
  event_type       TEXT NOT NULL,
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 4. API Endpoints

### GET `/api/me/usage`

Auth: required (any tier).

Response:
```json
{
  "tier": "free",
  "status": "active",
  "period": { "start": "2026-04-01", "end": "2026-04-30" },
  "usage": {
    "api_calls": { "used": 342, "limit": 1000 },
    "crdt_ops": { "used": 12, "limit": 500 },
    "documents": { "used": 8, "limit": 50 },
    "storage_bytes": { "used": 1048576, "limit": 26214400 }
  },
  "upgrade_url": "https://www.llmtxt.my/pricing"
}
```

### POST `/api/billing/checkout`

Auth: required. Creates a Stripe Checkout Session for Pro upgrade.

Request: `{ "tier": "pro", "success_url": "...", "cancel_url": "..." }`

Response: `{ "checkout_url": "https://checkout.stripe.com/..." }`

### POST `/api/billing/portal`

Auth: required. Creates a Stripe Billing Portal session.

Response: `{ "portal_url": "https://billing.stripe.com/..." }`

### POST `/api/billing/webhook`

Auth: Stripe signature (`stripe-signature` header). No user auth.

Handles:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_failed`
- `invoice.payment_succeeded`

### GET `/api/v1/admin/subscriptions`

Auth: admin only.

Response: paginated list of all subscriptions with user email, tier, status, MRR.

---

## 5. Tier Enforcement Middleware

```typescript
// apps/backend/src/middleware/tier-limits.ts
// Checks current usage vs tier limits before allowing the request.
// Returns HTTP 402 Payment Required on limit exceeded.
// Error body includes upgrade_url.
```

Applied to:
- POST `/api/compress` (doc_write event)
- GET `/api/documents/:slug` (doc_read event)
- POST `/api/crdt/*` (crdt_op event)
- All other `/api/` routes (api_call event)

---

## 6. Background Job: Daily Usage Rollup

- Runs at 01:00 UTC daily.
- Aggregates yesterday's `usage_events` into `usage_rollups`.
- Purges `usage_events` older than 60 days (rollups retained forever).

---

## 7. Stripe Integration Contract

- Stripe Node.js SDK (`stripe` npm package).
- Keys from env vars only:
  - `STRIPE_SECRET_KEY` — server-side secret
  - `STRIPE_WEBHOOK_SECRET` — webhook signature verification
  - `STRIPE_PRO_PRICE_ID` — Stripe Price ID for Pro
  - `STRIPE_ENTERPRISE_PRICE_ID` — Stripe Price ID for Enterprise
- All webhook events verified via `stripe.webhooks.constructEvent`.
- Idempotent: `stripe_events` table deduplicates by `stripe_event_id`.
- Test mode: `STRIPE_SECRET_KEY=sk_test_...` — no real charges.

---

## 8. Frontend Requirements (T011)

- `/pricing` page: tier comparison table + Stripe checkout CTA.
- `/billing` page: current subscription status + portal link.
- On 402 errors from API: show upgrade modal with link to `/pricing`.

---

## 9. Grace Period Policy

On `invoice.payment_failed`:
- Set `status = 'past_due'`.
- Set `grace_period_end = NOW() + 7 days`.
- During grace period: Pro limits still enforced (no immediate downgrade).
- After `grace_period_end`: downgrade to Free tier limits.

On `invoice.payment_succeeded` (recovery):
- Set `status = 'active'`.
- Clear `grace_period_end`.
- Restore Pro limits.

On `customer.subscription.deleted` (explicit cancel):
- Set `tier = 'free'`, `status = 'canceled'`.
- Immediate downgrade.
