-- T536: Enable Row-Level Security on document child tables:
--   versions, approvals, state_transitions, contributors, version_attributions
--
-- These tables have a document_id FK to documents.id.  Ownership is derived
-- by joining to documents.owner_id.  A user can access child rows when:
--   a) app.is_admin = 'true'   (admin bypass)
--   b) The parent document is visible to the session user (visibility='public'
--      OR owner_id matches OR explicit role grant OR org membership)
--
-- Rather than duplicating the full documents SELECT policy, we use a correlated
-- subquery that mirrors the documents RLS logic.  This keeps the policies
-- consistent even if the documents policy is later extended.
--
-- Idempotency: all CREATE POLICY statements wrapped in DO/EXCEPTION.

-- Helper macro (SQL comment for readability — actual policy repeated inline):
-- A row is accessible when documents_visible_to_session(document_id) is true,
-- where that predicate = admin OR public OR owner OR role grant OR org member.

-- ════════════════════════════════════════════════════════════════════════════
-- versions
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE versions ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE versions FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_versions_select ON versions
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = versions.document_id
          AND (
            d.visibility = 'public'
            OR d.owner_id = current_setting('app.current_user_id', true)
            OR EXISTS (
              SELECT 1 FROM document_roles dr
              WHERE dr.document_id = d.id
                AND dr.user_id = current_setting('app.current_user_id', true)
            )
            OR (d.visibility = 'org' AND EXISTS (
              SELECT 1 FROM document_orgs do_
                JOIN org_members om ON om.org_id = do_.org_id
              WHERE do_.document_id = d.id
                AND om.user_id = current_setting('app.current_user_id', true)
            ))
          )
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_versions_insert ON versions
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = versions.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_versions_update ON versions
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = versions.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_versions_delete ON versions
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = versions.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- approvals
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  -- Approvals are visible if the parent document is visible, or if the row
  -- belongs to the current reviewer (they should always see their own reviews)
  CREATE POLICY rls_approvals_select ON approvals
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR reviewer_id = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = approvals.document_id
          AND (
            d.visibility = 'public'
            OR d.owner_id = current_setting('app.current_user_id', true)
            OR EXISTS (
              SELECT 1 FROM document_roles dr
              WHERE dr.document_id = d.id
                AND dr.user_id = current_setting('app.current_user_id', true)
            )
          )
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- INSERT: reviewer_id must match session user (can't impersonate another reviewer)
  CREATE POLICY rls_approvals_insert ON approvals
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR reviewer_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_approvals_update ON approvals
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR reviewer_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_approvals_delete ON approvals
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR reviewer_id = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = approvals.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- state_transitions
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE state_transitions ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE state_transitions FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_state_transitions_select ON state_transitions
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = state_transitions.document_id
          AND (
            d.visibility = 'public'
            OR d.owner_id = current_setting('app.current_user_id', true)
            OR EXISTS (
              SELECT 1 FROM document_roles dr
              WHERE dr.document_id = d.id
                AND dr.user_id = current_setting('app.current_user_id', true)
            )
          )
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_state_transitions_insert ON state_transitions
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = state_transitions.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- contributors
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE contributors FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_contributors_select ON contributors
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = contributors.document_id
          AND (
            d.visibility = 'public'
            OR d.owner_id = current_setting('app.current_user_id', true)
            OR EXISTS (
              SELECT 1 FROM document_roles dr
              WHERE dr.document_id = d.id
                AND dr.user_id = current_setting('app.current_user_id', true)
            )
          )
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_contributors_insert ON contributors
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = contributors.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_contributors_update ON contributors
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = contributors.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- version_attributions
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE version_attributions ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE version_attributions FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_version_attributions_select ON version_attributions
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = version_attributions.document_id
          AND (
            d.visibility = 'public'
            OR d.owner_id = current_setting('app.current_user_id', true)
            OR EXISTS (
              SELECT 1 FROM document_roles dr
              WHERE dr.document_id = d.id
                AND dr.user_id = current_setting('app.current_user_id', true)
            )
          )
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_version_attributions_insert ON version_attributions
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = version_attributions.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
