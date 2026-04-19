-- T699/T713: Backfill ownerless documents and enforce NOT NULL on owner_id.
--
-- Background:
--   The POST /compress endpoint previously inserted documents with owner_id=NULL
--   and visibility='public' when called without authentication, violating the
--   T166 RLS invariant ("every document must have an owner").
--
-- Fix strategy (additive, idempotent):
--   Step 1 — Upsert a sentinel system user (fixed UUID) to serve as a placeholder
--             owner for documents that were created before this fix was applied.
--             Using ON CONFLICT DO NOTHING makes the upsert idempotent.
--
--   Step 2 — Set visibility='private' for all currently-null-owner documents.
--             Private visibility stops the global-read exposure immediately, even
--             before the NOT NULL constraint is added.
--
--   Step 3 — Assign the sentinel as owner for all null-owner rows, satisfying the
--             FK constraint so the NOT NULL can be applied.
--
--   Step 4 — Drop the old FK (ON DELETE SET NULL) and re-add as ON DELETE RESTRICT.
--             With owner_id NOT NULL, SET NULL on user deletion would violate the
--             constraint. RESTRICT ensures application must re-assign docs before
--             deleting a user.
--
--   Step 5 — ALTER TABLE documents ALTER COLUMN owner_id SET NOT NULL.
--             Postgres rejects this if any NULL rows remain — Steps 2+3 ensure none do.
--
--   Step 6 — Verification: count remaining NULLs; raise if any found (idempotency guard).
--
-- The sentinel user is a non-interactive system account:
--   id      = '00000000-0000-0000-0000-000000000001'  (well-known, never changes)
--   email   = 'system@llmtxt.internal'               (unique sentinel)
--   name    = 'System (legacy documents)'

--> statement-breakpoint

-- Step 1: Upsert sentinel system user (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO users (id, name, email, email_verified, created_at, updated_at, region)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'System (legacy documents)',
  'system@llmtxt.internal',
  FALSE,
  NOW(),
  NOW(),
  'us'
)
ON CONFLICT (id) DO NOTHING;

--> statement-breakpoint

-- Step 2: Set visibility='private' for all ownerless documents
-- Stops global-read exposure immediately before NOT NULL enforcement
UPDATE documents
SET visibility = 'private'
WHERE owner_id IS NULL
  AND visibility = 'public';

--> statement-breakpoint

-- Step 3: Assign sentinel owner to all remaining null-owner rows
UPDATE documents
SET owner_id = '00000000-0000-0000-0000-000000000001'
WHERE owner_id IS NULL;

--> statement-breakpoint

-- Step 4a: Drop old FK constraint (ON DELETE SET NULL conflicts with NOT NULL)
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS "documents_owner_id_users_id_fkey";

--> statement-breakpoint

-- Step 4b: Re-add FK with ON DELETE RESTRICT — application must re-assign docs
-- before deleting a user (preserves referential integrity with NOT NULL)
ALTER TABLE documents
  ADD CONSTRAINT "documents_owner_id_users_id_fkey"
  FOREIGN KEY (owner_id) REFERENCES users(id)
  ON DELETE RESTRICT;

--> statement-breakpoint

-- Step 5: Add NOT NULL constraint (all NULL rows are now gone from Step 3)
ALTER TABLE documents
  ALTER COLUMN owner_id SET NOT NULL;

--> statement-breakpoint

-- Step 6: Verify backfill — idempotency guard
DO $$
DECLARE
  null_count bigint;
BEGIN
  SELECT COUNT(*) INTO null_count FROM documents WHERE owner_id IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'T699 backfill incomplete: % rows still have owner_id=NULL', null_count;
  END IF;
END $$;
