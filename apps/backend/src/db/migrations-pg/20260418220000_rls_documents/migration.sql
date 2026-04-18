-- T534: Enable Row-Level Security on the documents table.
--
-- Strategy (additive + idempotent):
--   1. ALTER TABLE ... ENABLE ROW LEVEL SECURITY  — safe to run multiple times
--      (no-op if already enabled).
--   2. ALTER TABLE ... FORCE ROW LEVEL SECURITY   — ensures table owner is also
--      subject to policies (prevents accidental bypass by the app role).
--   3. Policy creation wrapped in DO $$ ... EXCEPTION WHEN duplicate_object $$
--      so re-running the migration is a no-op rather than an error.
--
-- Policies created:
--   rls_documents_select  — SELECT: admin | public | owner | explicit role grant | org membership
--   rls_documents_insert  — INSERT: admin | owner must match session user
--   rls_documents_update  — UPDATE: admin | owner only
--   rls_documents_delete  — DELETE: admin | owner only
--
-- Session variables expected (set by withRlsContext):
--   app.current_user_id   TEXT    — authenticated user id ('' for anon)
--   app.current_org_ids   TEXT    — not used in documents (org join goes via org_members)
--   app.current_role      TEXT    — 'authenticated' | 'anon'
--   app.is_admin          TEXT    — 'true' | 'false'

--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  -- SELECT policy —————————————————————————————————————————————————————————————
  -- Allows reading when ANY of the following is true:
  --   a) Admin bypass (app.is_admin = 'true')
  --   b) Public document (visibility = 'public')
  --   c) Owner of the document
  --   d) User has an explicit role grant in document_roles
  --   e) Org-visibility: user is a member of an org associated with this doc
  CREATE POLICY rls_documents_select ON documents
    FOR SELECT
    USING (
      -- a) Admin bypass
      current_setting('app.is_admin', true) = 'true'
      -- b) Public documents visible to anyone
      OR visibility = 'public'
      -- c) Owner always sees their document
      OR owner_id = current_setting('app.current_user_id', true)
      -- d) Explicit role grant
      OR EXISTS (
        SELECT 1
        FROM document_roles dr
        WHERE dr.document_id = documents.id
          AND dr.user_id = current_setting('app.current_user_id', true)
      )
      -- e) Org visibility: user must be in an org associated with the doc
      OR (
        visibility = 'org'
        AND EXISTS (
          SELECT 1
          FROM document_orgs do_
            JOIN org_members om ON om.org_id = do_.org_id
          WHERE do_.document_id = documents.id
            AND om.user_id = current_setting('app.current_user_id', true)
        )
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- INSERT policy —————————————————————————————————————————————————————————————
  -- User may only insert a document where owner_id matches their session user,
  -- or admin may insert any owner_id.
  CREATE POLICY rls_documents_insert ON documents
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR owner_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- UPDATE policy —————————————————————————————————————————————————————————————
  -- Only the owner or an admin may update a document row.
  CREATE POLICY rls_documents_update ON documents
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR owner_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- DELETE policy —————————————————————————————————————————————————————————————
  -- Only the owner or an admin may delete a document row.
  CREATE POLICY rls_documents_delete ON documents
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR owner_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
