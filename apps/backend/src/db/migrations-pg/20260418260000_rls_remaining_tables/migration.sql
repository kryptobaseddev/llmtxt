-- T538: Enable Row-Level Security on remaining tables:
--   collections, collection_documents, document_roles, document_links,
--   signed_url_tokens, section_embeddings, blob_attachments, agent_inbox_messages
--
-- All policies are additive + idempotent (DO/EXCEPTION guards).

-- ════════════════════════════════════════════════════════════════════════════
-- collections  (owner_id column direct)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE collections FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_collections_select ON collections
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR visibility = 'public'
      OR owner_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_collections_insert ON collections
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
  CREATE POLICY rls_collections_update ON collections
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
  CREATE POLICY rls_collections_delete ON collections
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR owner_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- collection_documents  (via collections.owner_id)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE collection_documents ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE collection_documents FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_collection_documents_select ON collection_documents
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM collections c
        WHERE c.id = collection_documents.collection_id
          AND (c.visibility = 'public' OR c.owner_id = current_setting('app.current_user_id', true))
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_collection_documents_insert ON collection_documents
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM collections c
        WHERE c.id = collection_documents.collection_id
          AND c.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_collection_documents_delete ON collection_documents
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM collections c
        WHERE c.id = collection_documents.collection_id
          AND c.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- document_roles  (user sees their own grants; doc owner sees all)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE document_roles ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE document_roles FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_document_roles_select ON document_roles
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      -- The user can see their own role grants
      OR user_id = current_setting('app.current_user_id', true)
      -- The document owner can see all grants for their docs
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_roles.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- Only document owner or admin can grant roles
  CREATE POLICY rls_document_roles_insert ON document_roles
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_roles.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_document_roles_delete ON document_roles
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_roles.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- document_links  (accessible if either source or target doc is accessible)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE document_links FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_document_links_select ON document_links
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_links.source_doc_id
          AND (d.visibility = 'public' OR d.owner_id = current_setting('app.current_user_id', true))
      )
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_links.target_doc_id
          AND (d.visibility = 'public' OR d.owner_id = current_setting('app.current_user_id', true))
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_document_links_insert ON document_links
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_links.source_doc_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_document_links_delete ON document_links
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_links.source_doc_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- signed_url_tokens  (agent_id direct + document owner)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE signed_url_tokens ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE signed_url_tokens FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_signed_url_tokens_select ON signed_url_tokens
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR agent_id = current_setting('app.current_user_id', true)
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = signed_url_tokens.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_signed_url_tokens_insert ON signed_url_tokens
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = signed_url_tokens.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_signed_url_tokens_delete ON signed_url_tokens
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = signed_url_tokens.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- section_embeddings  (via documents.id)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE section_embeddings ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE section_embeddings FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_section_embeddings_select ON section_embeddings
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = section_embeddings.document_id
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
  CREATE POLICY rls_section_embeddings_insert ON section_embeddings
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = section_embeddings.document_id
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- blob_attachments  (via documents.slug — doc_slug column)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE blob_attachments ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE blob_attachments FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_blob_attachments_select ON blob_attachments
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = blob_attachments.doc_slug
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
  CREATE POLICY rls_blob_attachments_insert ON blob_attachments
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = blob_attachments.doc_slug
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_blob_attachments_delete ON blob_attachments
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR EXISTS (
        SELECT 1 FROM documents d
        WHERE d.slug = blob_attachments.doc_slug
          AND d.owner_id = current_setting('app.current_user_id', true)
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- agent_inbox_messages  (sender or recipient)
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE agent_inbox_messages ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE agent_inbox_messages FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  -- Either the sender or the recipient can read the message
  CREATE POLICY rls_agent_inbox_messages_select ON agent_inbox_messages
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR to_agent_id = current_setting('app.current_user_id', true)
      OR from_agent_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- Only the sender (from_agent_id) can insert a message on their behalf
  CREATE POLICY rls_agent_inbox_messages_insert ON agent_inbox_messages
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR from_agent_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- Only the recipient can mark a message as read (update)
  CREATE POLICY rls_agent_inbox_messages_update ON agent_inbox_messages
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR to_agent_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- Recipient or sender can delete (recall/clear) messages
  CREATE POLICY rls_agent_inbox_messages_delete ON agent_inbox_messages
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR to_agent_id = current_setting('app.current_user_id', true)
      OR from_agent_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
