-- T535: Enable Row-Level Security on user-scoped tables:
--   api_keys, webhooks, audit_logs
--
-- All three tables have a user_id column that directly references users.id.
-- RLS strategy: owner + admin bypass (same pattern for all three).
--
-- Policies:
--   api_keys   — user sees / inserts / updates / deletes only their own keys
--   webhooks   — user sees / inserts / updates / deletes only their own hooks
--   audit_logs — user sees only their own log entries; admin sees all (read-only)
--
-- Idempotency: policy creation wrapped in DO/EXCEPTION for re-run safety.

-- ════════════════════════════════════════════════════════════════════════════
-- api_keys
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_api_keys_select ON api_keys
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_api_keys_insert ON api_keys
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_api_keys_update ON api_keys
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_api_keys_delete ON api_keys
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- webhooks
-- ════════════════════════════════════════════════════════════════════════════

--> statement-breakpoint
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_webhooks_select ON webhooks
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_webhooks_insert ON webhooks
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_webhooks_update ON webhooks
    FOR UPDATE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  CREATE POLICY rls_webhooks_delete ON webhooks
    FOR DELETE
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- audit_logs
-- ════════════════════════════════════════════════════════════════════════════
-- audit_logs is append-only at runtime: only INSERT and SELECT policies matter.
-- UPDATE and DELETE are not permitted for non-admins (defense-in-depth).

--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
DO $$
BEGIN
  -- SELECT: user sees their own log entries; admin sees all
  CREATE POLICY rls_audit_logs_select ON audit_logs
    FOR SELECT
    USING (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

--> statement-breakpoint
DO $$
BEGIN
  -- INSERT: the backend inserts audit rows on behalf of the acting user;
  -- admin can insert any user_id (for system-generated entries)
  CREATE POLICY rls_audit_logs_insert ON audit_logs
    FOR INSERT
    WITH CHECK (
      current_setting('app.is_admin', true) = 'true'
      OR user_id = current_setting('app.current_user_id', true)
      OR user_id IS NULL  -- anonymous / system entries allowed
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
