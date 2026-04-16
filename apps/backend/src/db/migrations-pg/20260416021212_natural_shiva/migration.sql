CREATE TABLE "section_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"doc_id" text NOT NULL,
	"section_id" text NOT NULL,
	"holder_agent_id" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reason" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "event_seq_counter" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "section_leases_doc_section_idx" ON "section_leases" ("doc_id","section_id");--> statement-breakpoint
CREATE INDEX "section_leases_expires_at_idx" ON "section_leases" ("expires_at");--> statement-breakpoint
ALTER TABLE "section_leases" ADD CONSTRAINT "section_leases_doc_id_documents_slug_fkey" FOREIGN KEY ("doc_id") REFERENCES "documents"("slug") ON DELETE CASCADE;