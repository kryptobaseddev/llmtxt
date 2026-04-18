-- T164: Tamper-evident audit log — add hash chain columns to audit_logs,
--       create audit_checkpoints table.
--
-- Additive-only migration. Never drops or modifies existing columns.
-- Idempotent: safe to run multiple times (IF NOT EXISTS / IF column NOT EXISTS).

-- Step 1: Add payload_hash column to audit_logs (null for legacy rows).
-- payload_hash = SHA-256(canonical_event_serialization)
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "payload_hash" text;
--> statement-breakpoint

-- Step 2: Add chain_hash column to audit_logs (null for legacy rows).
-- chain_hash = SHA-256(prev_chain_hash_bytes || payload_hash_bytes)
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "chain_hash" text;
--> statement-breakpoint

-- Step 3: Add event_type column to audit_logs for structured security event taxonomy.
-- Derived from the action field; redundant but enables fast filtering.
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "event_type" text;
--> statement-breakpoint

-- Step 4: Add actor_id column for explicit actor attribution (T147 signed identity).
ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "actor_id" text;
--> statement-breakpoint

-- Step 5: Create index on chain_hash for fast chain traversal.
CREATE INDEX IF NOT EXISTS "audit_logs_chain_hash_idx"
  ON "audit_logs" ("chain_hash");
--> statement-breakpoint

-- Step 6: Create index on payload_hash.
CREATE INDEX IF NOT EXISTS "audit_logs_payload_hash_idx"
  ON "audit_logs" ("payload_hash");
--> statement-breakpoint

-- Step 7: Create audit_checkpoints table.
-- Stores daily Merkle root commitments + optional RFC 3161 TSR tokens.
CREATE TABLE IF NOT EXISTS "audit_checkpoints" (
  "id" text PRIMARY KEY,
  "checkpoint_date" text NOT NULL,
  "merkle_root" text NOT NULL,
  "tsr_token" text,
  "event_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Step 8: Unique constraint — one checkpoint per day.
CREATE UNIQUE INDEX IF NOT EXISTS "audit_checkpoints_date_idx"
  ON "audit_checkpoints" ("checkpoint_date");
