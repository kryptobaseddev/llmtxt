-- T165: Webhook delivery hardening — dead-letter queue + delivery log + seen-IDs table.
--
-- Additive-only migration. Never drops or modifies existing columns.
-- Idempotent: safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS guards).
--
-- Design:
--   webhook_deliveries — one row per HTTP delivery attempt (success or failure).
--   webhook_dlq        — dead-letter queue for permanently-failed events.
--   webhook_seen_ids   — optional idempotency store for receiver-side dedup.

--> statement-breakpoint

-- Step 1: webhook_deliveries — delivery attempt log.
-- Every HTTP attempt (including retries) writes a row here.
-- Retained for 30 days and pruned by the audit-retention job.
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id"              text          PRIMARY KEY,
  "webhook_id"      text          NOT NULL
                      REFERENCES "webhooks" ("id") ON DELETE CASCADE,
  "event_id"        text          NOT NULL,
  "attempt_num"     integer       NOT NULL,
  "status"          text          NOT NULL
                      CHECK ("status" IN ('success','failed','timeout')),
  "response_status" integer,
  "duration_ms"     integer       NOT NULL,
  "created_at"      bigint        NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_id_idx"
  ON "webhook_deliveries" ("webhook_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_id_idx"
  ON "webhook_deliveries" ("event_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_deliveries_created_at_idx"
  ON "webhook_deliveries" ("created_at");
--> statement-breakpoint

-- Step 2: webhook_dlq — dead-letter queue.
-- Populated when all delivery retries are exhausted.
-- Owners replay entries via POST /webhooks/:id/dlq/:entryId/replay.
CREATE TABLE IF NOT EXISTS "webhook_dlq" (
  "id"                  text          PRIMARY KEY,
  "webhook_id"          text          NOT NULL
                          REFERENCES "webhooks" ("id") ON DELETE CASCADE,
  "failed_delivery_id"  text          NOT NULL,
  "event_id"            text          NOT NULL,
  "reason"              text          NOT NULL,
  "payload"             text          NOT NULL,
  "captured_at"         bigint        NOT NULL,
  "replayed_at"         bigint
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_dlq_webhook_id_idx"
  ON "webhook_dlq" ("webhook_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_dlq_event_id_idx"
  ON "webhook_dlq" ("event_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_dlq_captured_at_idx"
  ON "webhook_dlq" ("captured_at");
--> statement-breakpoint

-- Step 3: webhook_seen_ids — receiver-side idempotency store.
-- SDK utility table. Rows self-expire after their expiresAt timestamp.
-- The delivery worker itself does NOT write here — this supports external receivers
-- that opt into server-side dedup without managing their own store.
CREATE TABLE IF NOT EXISTS "webhook_seen_ids" (
  "event_id"    text    PRIMARY KEY,
  "webhook_id"  text    NOT NULL,
  "expires_at"  bigint  NOT NULL,
  "seen_at"     bigint  NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_seen_ids_expires_at_idx"
  ON "webhook_seen_ids" ("expires_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "webhook_seen_ids_webhook_id_idx"
  ON "webhook_seen_ids" ("webhook_id");
