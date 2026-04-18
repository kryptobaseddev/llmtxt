-- T010 + T011: Monetization — usage tracking, tier management, Stripe billing.
--
-- Additive-only migration. Never drops or modifies existing columns.
-- Idempotent: safe to run multiple times (IF NOT EXISTS / IF column NOT EXISTS).

-- Step 1: subscriptions table
-- Maps each user to their billing tier and Stripe identifiers.
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id"                      text PRIMARY KEY,
  "user_id"                 text NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "tier"                    text NOT NULL DEFAULT 'free',
  "status"                  text NOT NULL DEFAULT 'active',
  "stripe_customer_id"      text UNIQUE,
  "stripe_subscription_id"  text UNIQUE,
  "current_period_start"    timestamptz,
  "current_period_end"      timestamptz,
  "grace_period_end"        timestamptz,
  "created_at"              timestamptz NOT NULL DEFAULT NOW(),
  "updated_at"              timestamptz NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subscriptions_stripe_customer_id_idx"
  ON "subscriptions" ("stripe_customer_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_idx"
  ON "subscriptions" ("stripe_subscription_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subscriptions_tier_status_idx"
  ON "subscriptions" ("tier", "status");
--> statement-breakpoint

-- Step 2: usage_events table
-- Per-event log used for billing enforcement and rollup aggregation.
CREATE TABLE IF NOT EXISTS "usage_events" (
  "id"          text PRIMARY KEY,
  "user_id"     text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "agent_id"    text,
  "event_type"  text NOT NULL,
  "resource_id" text,
  "bytes"       bigint NOT NULL DEFAULT 0,
  "created_at"  timestamptz NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "usage_events_user_id_created_at_idx"
  ON "usage_events" ("user_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "usage_events_event_type_idx"
  ON "usage_events" ("event_type");
--> statement-breakpoint

-- Step 3: usage_rollups table
-- Daily aggregate per user. Populated by background job.
CREATE TABLE IF NOT EXISTS "usage_rollups" (
  "id"              text PRIMARY KEY,
  "user_id"         text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "rollup_date"     date NOT NULL,
  "api_calls"       bigint NOT NULL DEFAULT 0,
  "crdt_ops"        bigint NOT NULL DEFAULT 0,
  "doc_reads"       bigint NOT NULL DEFAULT 0,
  "doc_writes"      bigint NOT NULL DEFAULT 0,
  "bytes_ingested"  bigint NOT NULL DEFAULT 0,
  "created_at"      timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "usage_rollups_user_id_rollup_date_uniq" UNIQUE ("user_id", "rollup_date")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "usage_rollups_user_id_rollup_date_idx"
  ON "usage_rollups" ("user_id", "rollup_date");
--> statement-breakpoint

-- Step 4: stripe_events table
-- Deduplication table for Stripe webhook events (idempotent processing).
CREATE TABLE IF NOT EXISTS "stripe_events" (
  "stripe_event_id"  text PRIMARY KEY,
  "event_type"       text NOT NULL,
  "processed_at"     timestamptz NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
