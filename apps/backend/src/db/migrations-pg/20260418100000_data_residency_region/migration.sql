-- T185: Data residency — add region column to users and organizations tables.
--
-- Additive-only migration. Never drops or modifies existing columns.
-- Idempotent: safe to run multiple times (IF NOT EXISTS guard).
--
-- The region column records the tenant's chosen data residency region.
-- Valid values: 'us' (default) | 'eu' | 'apac'
--
-- When multi-region routing is live, the API gateway uses this value to:
--   1. Route authenticated requests to the correct regional backend.
--   2. Enforce cross-region access guards (users may only read/write their
--      own region's backend).
--   3. Select the correct S3/R2 bucket for blob storage.
--
-- Default 'us' preserves existing behaviour for all current rows.
-- New rows default to 'us' unless the signup flow specifies otherwise.
--
-- NOTE: Region selection is permanent. Changing a user's or org's region
-- requires a manual data migration procedure and customer consent.
-- The API does not expose a region-update endpoint.

-- Step 1: Add region to users table.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "region" text NOT NULL DEFAULT 'us';
--> statement-breakpoint

-- Step 2: Add region to organizations table.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "region" text NOT NULL DEFAULT 'us';
--> statement-breakpoint

-- Step 3: Add an index on users.region for efficient regional shard queries.
-- Used by the cross-region guard to look up all users in a given region.
CREATE INDEX IF NOT EXISTS "users_region_idx" ON "users" ("region");
--> statement-breakpoint

-- Step 4: Add an index on organizations.region for the same reason.
CREATE INDEX IF NOT EXISTS "organizations_region_idx" ON "organizations" ("region");
--> statement-breakpoint

-- Step 5: Add a CHECK constraint to enforce the valid region enum values.
-- Applied after column creation to avoid blocking the table scan.
-- NOTE: PostgreSQL ADD CONSTRAINT IF NOT EXISTS is not available before PG 15.
-- The constraint name includes the table name to avoid collisions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_region_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_region_check"
      CHECK ("region" IN ('us', 'eu', 'apac'));
  END IF;
END$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_region_check'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE "organizations"
      ADD CONSTRAINT "organizations_region_check"
      CHECK ("region" IN ('us', 'eu', 'apac'));
  END IF;
END$$;
