CREATE TABLE "agent_pubkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" text NOT NULL UNIQUE,
	"pubkey" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_signature_nonces" (
	"nonce" text PRIMARY KEY,
	"agent_id" text NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"document_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" bytea
);
--> statement-breakpoint
CREATE TABLE "section_crdt_states" (
	"document_id" text,
	"section_id" text,
	"clock" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"yrs_state" bytea NOT NULL,
	CONSTRAINT "section_crdt_states_pk" PRIMARY KEY("document_id","section_id")
);
--> statement-breakpoint
CREATE TABLE "section_crdt_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"document_id" text NOT NULL,
	"section_id" text NOT NULL,
	"update_blob" bytea NOT NULL,
	"client_id" text NOT NULL,
	"seq" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_signature_nonces_agent_first_seen_idx" ON "agent_signature_nonces" ("agent_id","first_seen");--> statement-breakpoint
CREATE UNIQUE INDEX "document_events_doc_seq_unique" ON "document_events" ("document_id","seq");--> statement-breakpoint
CREATE INDEX "section_crdt_updates_doc_section_seq_idx" ON "section_crdt_updates" ("document_id","section_id","seq");--> statement-breakpoint
CREATE INDEX "section_crdt_updates_doc_section_created_at_idx" ON "section_crdt_updates" ("document_id","section_id","created_at");--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_id_documents_slug_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("slug") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "section_crdt_states" ADD CONSTRAINT "section_crdt_states_document_id_documents_slug_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("slug") ON DELETE CASCADE;