CREATE TABLE "agent_inbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"to_agent_id" text NOT NULL,
	"from_agent_id" text NOT NULL,
	"envelope_json" jsonb NOT NULL,
	"nonce" text NOT NULL UNIQUE,
	"received_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"read" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blob_attachments" (
	"id" text PRIMARY KEY,
	"doc_slug" text NOT NULL,
	"blob_name" text NOT NULL,
	"hash" text NOT NULL,
	"size" bigint NOT NULL,
	"content_type" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" bigint NOT NULL,
	"pg_lo_oid" bigint,
	"s3_key" text,
	"deleted_at" bigint
);
--> statement-breakpoint
CREATE TABLE "section_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"document_id" text NOT NULL,
	"section_slug" text DEFAULT '' NOT NULL,
	"section_title" text DEFAULT '' NOT NULL,
	"content_hash" text NOT NULL,
	"provider" text DEFAULT 'local-onnx-minilm-l6' NOT NULL,
	"model" text DEFAULT 'all-MiniLM-L6-v2' NOT NULL,
	"embedding" text,
	"computed_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "sig_hex" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "canonical_payload" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "chain_hash" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "prev_chain_hash" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "bft_f" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "bft_f" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_inbox_to_agent_idx" ON "agent_inbox_messages" ("to_agent_id","received_at");--> statement-breakpoint
CREATE INDEX "agent_inbox_expires_at_idx" ON "agent_inbox_messages" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_inbox_nonce_idx" ON "agent_inbox_messages" ("nonce");--> statement-breakpoint
CREATE INDEX "blob_attachments_doc_slug_idx" ON "blob_attachments" ("doc_slug");--> statement-breakpoint
CREATE INDEX "blob_attachments_hash_idx" ON "blob_attachments" ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "blob_attachments_active_name_idx" ON "blob_attachments" ("doc_slug","blob_name") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "section_embeddings_document_id_idx" ON "section_embeddings" ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "section_embeddings_doc_section_model_idx" ON "section_embeddings" ("document_id","section_slug","model");--> statement-breakpoint
ALTER TABLE "section_embeddings" ADD CONSTRAINT "section_embeddings_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;