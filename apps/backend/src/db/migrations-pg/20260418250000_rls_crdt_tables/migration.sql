-- T537: Enable Row-Level Security on CRDT and event tables:
--   section_crdt_states, section_crdt_updates, document_events, section_leases
--
-- NOTE: These tables use document_id as a FK to documents.slug (not documents.id).
-- Ownership is derived by joining documents ON documents.slug = table.document_id.
--
-- Strategy:
--   SELECT — admin | document is visible (public OR owner OR role grant)
--   INSERT — admin | document owner (CRDT mutations are owner-only)
--   UPDATE — admin | document owner
--   DELETE — admin | document owner
--
-- section_leases additionally: the lease holder (holderAgentId) can read/update
-- their own lease even if they are not the document owner (collaborative editing).

-- ════════════════════════════════════════════════════════════════════════════
-- section_crdt_states
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE section_crdt_states ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE section_crdt_states FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_section_crdt_states_select ON section_crdt_states
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_crdt_states.document_id
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
  CREATE POLICY rls_section_crdt_states_insert ON section_crdt_states
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_crdt_states.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_section_crdt_states_update ON section_crdt_states
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_crdt_states.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- section_crdt_updates
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE section_crdt_updates ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE section_crdt_updates FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_section_crdt_updates_select ON section_crdt_updates
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_crdt_updates.document_id
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
  CREATE POLICY rls_section_crdt_updates_insert ON section_crdt_updates
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_crdt_updates.document_id
          AND (
            d.owner_id = current_setting('app.current_user_id', true)
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

-- ════════════════════════════════════════════════════════════════════════════
-- document_events
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE document_events ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE document_events FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_document_events_select ON document_events
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = document_events.document_id
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
  CREATE POLICY rls_document_events_insert ON document_events
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = document_events.document_id
          AND (
            d.owner_id = current_setting('app.current_user_id', true)
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

-- ════════════════════════════════════════════════════════════════════════════
-- section_leases
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE section_leases ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE section_leases FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  -- Lease holder can always see their own lease; document visibility also grants access
  CREATE POLICY rls_section_leases_select ON section_leases
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR holder_agent_id = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_leases.doc_id
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
  -- Only the holder themselves or document owner may insert a lease
  CREATE POLICY rls_section_leases_insert ON section_leases
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR holder_agent_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- Only the holder or document owner may renew/release their lease
  CREATE POLICY rls_section_leases_update ON section_leases
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR holder_agent_id = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_leases.doc_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_section_leases_delete ON section_leases
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR holder_agent_id = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = section_leases.doc_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
