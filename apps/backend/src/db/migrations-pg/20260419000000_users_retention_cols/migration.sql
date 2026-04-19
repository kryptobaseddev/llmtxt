-- T187 users table retention columns (soft-delete + pseudonymization).
-- schema-pg.ts declares these columns; ensure they exist on existing PG
-- deployments. Additive-only, idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deleted_at"                  bigint;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletion_confirmed_at"       bigint;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletion_token"              text;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletion_token_expires_at"   bigint;
--> statement-breakpoint
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "pseudonymized_at"            bigint;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_deleted_at_idx"
  ON "users" ("deleted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_deletion_token_idx"
  ON "users" ("deletion_token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_pseudonymized_at_idx"
  ON "users" ("pseudonymized_at");
