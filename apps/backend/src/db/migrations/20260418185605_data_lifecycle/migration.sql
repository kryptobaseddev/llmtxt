-- T094 / T186 / T187 Data Lifecycle Bundle — additive-only migration.
--
-- Adds:
--   1. users.deleted_at                — soft-delete timestamp for GDPR erasure (T187)
--   2. users.deletion_confirmed_at     — timestamp when user confirmed deletion via email
--   3. users.deletion_token            — single-use token for email confirmation
--   4. users.deletion_token_expires_at — token expiry (unix ms)
--   5. users.pseudonymized_at          — timestamp when PII was replaced by pseudonym (T187)
--   6. audit_logs.legal_hold           — legal-hold flag prevents archival/deletion (T186)
--   7. audit_logs.archived_at          — timestamp when entry was moved to cold storage (T186)
--   8. audit_archive table             — cold-storage index for audit entries moved to S3 (T186)
--   9. user_export_rate_limit table    — rate-limiter: 1 export/user/day (T094)
--  10. deletion_certificates table     — cryptographic certificate of completion after hard delete (T187)
--
-- All changes are purely additive.  Existing rows are unaffected.

-- ── 1. users.deleted_at ─────────────────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deleted_at" bigint;

--> statement-breakpoint

-- ── 2. users.deletion_confirmed_at ─────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletion_confirmed_at" bigint;

--> statement-breakpoint

-- ── 3. users.deletion_token ─────────────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletion_token" text;

--> statement-breakpoint

-- ── 4. users.deletion_token_expires_at ─────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletion_token_expires_at" bigint;

--> statement-breakpoint

-- ── 5. users.pseudonymized_at ───────────────────────────────────────────────

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "pseudonymized_at" bigint;

--> statement-breakpoint

-- ── 6. audit_logs.legal_hold ────────────────────────────────────────────────

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "legal_hold" boolean NOT NULL DEFAULT false;

--> statement-breakpoint

-- ── 7. audit_logs.archived_at ───────────────────────────────────────────────

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "archived_at" bigint;

--> statement-breakpoint

-- Index for efficient retention job sweep (non-archived, old entries).
CREATE INDEX IF NOT EXISTS "audit_logs_archived_at_idx"
  ON "audit_logs" ("archived_at")
  WHERE "archived_at" IS NULL;

--> statement-breakpoint

-- Index for legal-hold filter on retention job.
CREATE INDEX IF NOT EXISTS "audit_logs_legal_hold_idx"
  ON "audit_logs" ("legal_hold");

--> statement-breakpoint

-- ── 8. audit_archive table ──────────────────────────────────────────────────

-- Cold-storage index.  Each row tracks an audit_log entry that has been
-- serialised and moved to S3.  The S3 object key is stored here so that
-- the export endpoint can reconstitute the full log across hot + cold.

CREATE TABLE IF NOT EXISTS "audit_archive" (
  "id"            text        PRIMARY KEY,
  -- Original audit_logs.id (row may be deleted from hot DB after archival).
  "audit_log_id"  text        NOT NULL,
  -- S3/R2 object key where the entry JSON is stored.
  "s3_key"        text        NOT NULL,
  -- Unix ms when the entry was moved to cold storage.
  "archived_at"   bigint      NOT NULL,
  -- Unix ms timestamp of the original audit event (for date-range export).
  "event_timestamp" bigint    NOT NULL,
  -- user_id of the actor (denormalised for export queries).
  "user_id"       text,
  -- Whether this entry is under legal hold (copied from audit_logs).
  "legal_hold"    boolean     NOT NULL DEFAULT false
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

-- ── 9. user_export_rate_limit table ─────────────────────────────────────────

-- One row per (user_id, calendar date).  Limits export requests to 1/day.

CREATE TABLE IF NOT EXISTS "user_export_rate_limit" (
  "user_id"        text  NOT NULL,
  -- ISO 8601 date (YYYY-MM-DD) in UTC.
  "export_date"    text  NOT NULL,
  -- Unix ms of the most recent export request.
  "last_export_at" bigint NOT NULL,
  PRIMARY KEY ("user_id", "export_date")
);

--> statement-breakpoint

-- ── 10. deletion_certificates table ─────────────────────────────────────────

-- Immutable receipt issued after a hard-delete completes (T187 §5).
-- Rows are NEVER deleted — they are the user's proof of erasure.

CREATE TABLE IF NOT EXISTS "deletion_certificates" (
  "id"              text    PRIMARY KEY,
  -- Original user ID (pseudonymised after deletion).
  "user_id"         text    NOT NULL,
  -- ISO 8601 timestamp of hard-delete completion.
  "deleted_at"      text    NOT NULL,
  -- JSON object: { documents, versions, apiKeys, auditLogEntries, webhooks, ... }
  "resource_counts" text    NOT NULL,
  -- SHA-256 hex of the certificate JSON (integrity seal).
  "certificate_hash" text   NOT NULL,
  -- Unix ms when this certificate was created.
  "created_at"      bigint  NOT NULL
);

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "deletion_certificates_user_id_idx"
  ON "deletion_certificates" ("user_id");
