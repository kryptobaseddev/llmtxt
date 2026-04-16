-- T150 (W2 leases): section_leases table + indexes + FK.
-- Fully idempotent so retries after partial failure succeed.
--
-- NOTE: the `event_seq_counter` column on `documents` is added by the earlier
-- `20260416000002_event_seq_counter/migration.sql`; it is NOT re-added here
-- (the earlier incarnation of this file re-added it without IF NOT EXISTS,
-- which crashed retries on Railway when the column already existed).

CREATE TABLE IF NOT EXISTS "section_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"doc_id" text NOT NULL,
	"section_id" text NOT NULL,
	"holder_agent_id" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "section_leases_doc_section_idx" ON "section_leases" ("doc_id","section_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "section_leases_expires_at_idx" ON "section_leases" ("expires_at");
--> statement-breakpoint
-- PG lacks ADD CONSTRAINT IF NOT EXISTS; emulate via DO-block that inspects pg_constraint.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'section_leases_doc_id_documents_slug_fkey'
	) THEN
		ALTER TABLE "section_leases"
			ADD CONSTRAINT "section_leases_doc_id_documents_slug_fkey"
			FOREIGN KEY ("doc_id") REFERENCES "documents"("slug") ON DELETE CASCADE;
	END IF;
END $$;
