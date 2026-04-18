-- T458: Additive-only PG migration — blob_attachments only.
-- Rewritten 2026-04-17 to remove duplicates that drizzle-kit re-emitted:
--   agent_inbox_messages (already in 20260416030000_w3_bft_a2a_inbox)
--   section_embeddings (already in 20260416040000_pgvector_embeddings)
--   approvals.{sig_hex, canonical_payload, chain_hash, prev_chain_hash, bft_f}
--   documents.bft_f
--   all their indexes + section_embeddings FK
-- Keeping only the net-new blob_attachments table + its 3 indexes.

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
CREATE INDEX "blob_attachments_doc_slug_idx" ON "blob_attachments" ("doc_slug");--> statement-breakpoint
CREATE INDEX "blob_attachments_hash_idx" ON "blob_attachments" ("hash");--> statement-breakpoint
CREATE UNIQUE INDEX "blob_attachments_active_name_idx" ON "blob_attachments" ("doc_slug","blob_name") WHERE "deleted_at" IS NULL;
