-- T186/T187 schema-migration reconciliation:
-- schema-pg.ts was updated to add `legal_hold` and `archived_at` to
-- `audit_logs`, but the original compliance_data_lifecycle migration only
-- created the new `audit_archive` table and skipped the ALTER on audit_logs.
-- This migration fills that gap — additive-only, idempotent.

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "legal_hold"  boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "archived_at" bigint;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_logs_legal_hold_idx"
  ON "audit_logs" ("legal_hold");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_logs_archived_at_idx"
  ON "audit_logs" ("archived_at");
