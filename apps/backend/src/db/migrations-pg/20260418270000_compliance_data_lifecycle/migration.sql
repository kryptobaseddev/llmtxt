-- T186 / T187: Compliance Data Lifecycle — audit_archive, deletion_certificates,
--              user_export_rate_limit tables.
--
-- Additive-only migration. Never drops or modifies existing columns.
-- Idempotent: safe to run multiple times (IF NOT EXISTS guards on all DDL).
--
-- Tables created:
--   audit_archive            — Cold-storage index for audit_logs entries older
--                              than 90 days.  S3/R2 object key stored here.
--   deletion_certificates    — Immutable erasure receipt issued after hard-delete.
--                              Rows are NEVER deleted.
--   user_export_rate_limit   — Rate-limit table: one row per (user_id, UTC date).
--
-- Note: The retention job (apps/backend/src/jobs/audit-retention.ts) populates
-- these tables on a nightly schedule.  Legal-hold entries in audit_archive are
-- NEVER hard-deleted.

--> statement-breakpoint

-- ─── 1. audit_archive ────────────────────────────────────────────────────────
-- Cold-storage index for audit_log entries that have been moved out of the
-- hot Postgres DB.  The full entry JSON lives at s3_key in S3/R2.  The index
-- row is retained in Postgres for date-range export queries.

CREATE TABLE IF NOT EXISTS "audit_archive" (
  "id"               text     PRIMARY KEY,
  "audit_log_id"     text     NOT NULL,
  "s3_key"           text     NOT NULL,
  "archived_at"      bigint   NOT NULL,
  "event_timestamp"  bigint   NOT NULL,
  "user_id"          text,
  "legal_hold"       boolean  NOT NULL DEFAULT false
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_archive_audit_log_id_idx"
  ON "audit_archive" ("audit_log_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_archive_event_timestamp_idx"
  ON "audit_archive" ("event_timestamp");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_archive_user_id_idx"
  ON "audit_archive" ("user_id");

--> statement-breakpoint

-- ─── 2. deletion_certificates ────────────────────────────────────────────────
-- Immutable proof-of-erasure receipt.  Issued by the retention job after all
-- of a user's owned resources are hard-deleted.  The certificate row itself
-- is retained indefinitely as the user's verifiable record of deletion.

CREATE TABLE IF NOT EXISTS "deletion_certificates" (
  "id"                text     PRIMARY KEY,
  "user_id"           text     NOT NULL,
  "deleted_at"        text     NOT NULL,
  "resource_counts"   text     NOT NULL,
  "certificate_hash"  text     NOT NULL,
  "created_at"        bigint   NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "deletion_certificates_user_id_idx"
  ON "deletion_certificates" ("user_id");

--> statement-breakpoint

-- ─── 3. user_export_rate_limit ───────────────────────────────────────────────
-- Rate-limits GDPR data export requests to 1 per user per UTC calendar day.
-- One row per (user_id, UTC date string YYYY-MM-DD).

CREATE TABLE IF NOT EXISTS "user_export_rate_limit" (
  "user_id"        text    NOT NULL,
  "export_date"    text    NOT NULL,
  "last_export_at" bigint  NOT NULL,
  PRIMARY KEY ("user_id", "export_date")
);

--> statement-breakpoint

-- ─── 4. retention_policy ─────────────────────────────────────────────────────
-- Singleton configuration table (at most one row with id = 'default').
-- All retention windows are in days.  Admin API: GET/PUT /api/v1/admin/retention.

CREATE TABLE IF NOT EXISTS "retention_policy" (
  "id"                    text      PRIMARY KEY DEFAULT 'default',
  "audit_log_hot_days"    integer   NOT NULL DEFAULT 90,
  "audit_log_total_days"  integer   NOT NULL DEFAULT 2555,
  "soft_deleted_docs_days" integer  NOT NULL DEFAULT 30,
  "anonymous_doc_days"    integer   NOT NULL DEFAULT 1,
  "revoked_api_key_days"  integer   NOT NULL DEFAULT 90,
  "agent_inbox_days"      integer   NOT NULL DEFAULT 2,
  "policy_version"        integer   NOT NULL DEFAULT 1,
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);
