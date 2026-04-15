CREATE TABLE "accounts" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" text DEFAULT '*' NOT NULL,
	"last_used_at" bigint,
	"expires_at" bigint,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"status" text NOT NULL,
	"timestamp" bigint NOT NULL,
	"reason" text,
	"at_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY,
	"user_id" text,
	"agent_id" text,
	"ip_address" text,
	"user_agent" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"details" text,
	"timestamp" bigint NOT NULL,
	"request_id" text,
	"method" text,
	"path" text,
	"status_code" integer
);
--> statement-breakpoint
CREATE TABLE "collection_documents" (
	"id" text PRIMARY KEY,
	"collection_id" text NOT NULL,
	"document_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_by" text,
	"added_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"description" text,
	"owner_id" text NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contributors" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"versions_authored" integer DEFAULT 0 NOT NULL,
	"total_tokens_added" integer DEFAULT 0 NOT NULL,
	"total_tokens_removed" integer DEFAULT 0 NOT NULL,
	"net_tokens" integer DEFAULT 0 NOT NULL,
	"first_contribution" bigint NOT NULL,
	"last_contribution" bigint NOT NULL,
	"sections_modified" text DEFAULT '[]' NOT NULL,
	"display_name" text
);
--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" text PRIMARY KEY,
	"source_doc_id" text NOT NULL,
	"target_doc_id" text NOT NULL,
	"link_type" text NOT NULL,
	"label" text,
	"created_by" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_orgs" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"org_id" text NOT NULL,
	"added_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_roles" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"format" text NOT NULL,
	"content_hash" text NOT NULL,
	"compressed_data" bytea,
	"original_size" integer NOT NULL,
	"compressed_size" integer NOT NULL,
	"token_count" integer,
	"created_at" bigint NOT NULL,
	"expires_at" bigint,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" bigint,
	"state" text DEFAULT 'DRAFT' NOT NULL,
	"owner_id" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"storage_type" text DEFAULT 'inline' NOT NULL,
	"storage_key" text,
	"current_version" integer DEFAULT 0 NOT NULL,
	"version_count" integer DEFAULT 0 NOT NULL,
	"sharing_mode" text DEFAULT 'signed_url' NOT NULL,
	"approval_required_count" integer DEFAULT 1 NOT NULL,
	"approval_require_unanimous" boolean DEFAULT false NOT NULL,
	"approval_allowed_reviewers" text DEFAULT '' NOT NULL,
	"approval_timeout_ms" bigint DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" text PRIMARY KEY,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"joined_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_invites" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signed_url_tokens" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"slug" text NOT NULL,
	"agent_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"org_id" text,
	"signature" text NOT NULL,
	"signature_length" integer DEFAULT 16 NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" bigint
);
--> statement-breakpoint
CREATE TABLE "state_transitions" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" bigint NOT NULL,
	"reason" text,
	"at_version" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"name" text DEFAULT '' NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	"agent_id" text,
	"expires_at" bigint
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "version_attributions" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"author_id" text NOT NULL,
	"added_lines" integer DEFAULT 0 NOT NULL,
	"removed_lines" integer DEFAULT 0 NOT NULL,
	"added_tokens" integer DEFAULT 0 NOT NULL,
	"removed_tokens" integer DEFAULT 0 NOT NULL,
	"sections_modified" text DEFAULT '[]' NOT NULL,
	"changelog" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" text PRIMARY KEY,
	"document_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"compressed_data" bytea,
	"content_hash" text NOT NULL,
	"token_count" integer,
	"created_at" bigint NOT NULL,
	"created_by" text,
	"changelog" text,
	"patch_text" text,
	"base_version" integer,
	"storage_type" text DEFAULT 'inline' NOT NULL,
	"storage_key" text
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text DEFAULT '[]' NOT NULL,
	"document_slug" text,
	"active" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_delivery_at" bigint,
	"last_success_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys" ("key_prefix");--> statement-breakpoint
CREATE INDEX "approvals_document_id_idx" ON "approvals" ("document_id");--> statement-breakpoint
CREATE INDEX "approvals_reviewer_idx" ON "approvals" ("document_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "approvals_status_idx" ON "approvals" ("document_id","status");--> statement-breakpoint
CREATE INDEX "approvals_timestamp_idx" ON "approvals" ("timestamp");--> statement-breakpoint
CREATE INDEX "approvals_latest_review_idx" ON "approvals" ("document_id","reviewer_id","timestamp");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs" ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs" ("timestamp");--> statement-breakpoint
CREATE INDEX "collection_docs_collection_idx" ON "collection_documents" ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_docs_document_idx" ON "collection_documents" ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_docs_unique_idx" ON "collection_documents" ("collection_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_slug_idx" ON "collections" ("slug");--> statement-breakpoint
CREATE INDEX "collections_owner_idx" ON "collections" ("owner_id");--> statement-breakpoint
CREATE INDEX "contributors_document_id_idx" ON "contributors" ("document_id");--> statement-breakpoint
CREATE INDEX "contributors_agent_id_idx" ON "contributors" ("document_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contributors_unique_idx" ON "contributors" ("document_id","agent_id");--> statement-breakpoint
CREATE INDEX "contributors_net_tokens_idx" ON "contributors" ("document_id","net_tokens");--> statement-breakpoint
CREATE INDEX "document_links_source_idx" ON "document_links" ("source_doc_id");--> statement-breakpoint
CREATE INDEX "document_links_target_idx" ON "document_links" ("target_doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_unique_idx" ON "document_links" ("source_doc_id","target_doc_id","link_type");--> statement-breakpoint
CREATE UNIQUE INDEX "document_orgs_doc_org_idx" ON "document_orgs" ("document_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_roles_doc_user_idx" ON "document_roles" ("document_id","user_id");--> statement-breakpoint
CREATE INDEX "document_roles_user_idx" ON "document_roles" ("user_id");--> statement-breakpoint
CREATE INDEX "document_roles_role_idx" ON "document_roles" ("document_id","role");--> statement-breakpoint
CREATE INDEX "documents_slug_idx" ON "documents" ("slug");--> statement-breakpoint
CREATE INDEX "documents_created_at_idx" ON "documents" ("created_at");--> statement-breakpoint
CREATE INDEX "documents_expires_at_idx" ON "documents" ("expires_at");--> statement-breakpoint
CREATE INDEX "documents_state_idx" ON "documents" ("state");--> statement-breakpoint
CREATE INDEX "documents_owner_id_idx" ON "documents" ("owner_id");--> statement-breakpoint
CREATE INDEX "documents_is_anonymous_idx" ON "documents" ("is_anonymous");--> statement-breakpoint
CREATE INDEX "documents_purge_idx" ON "documents" ("is_anonymous","expires_at");--> statement-breakpoint
CREATE INDEX "documents_storage_key_idx" ON "documents" ("storage_key");--> statement-breakpoint
CREATE INDEX "documents_sharing_mode_idx" ON "documents" ("sharing_mode");--> statement-breakpoint
CREATE INDEX "documents_visibility_idx" ON "documents" ("visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_idx" ON "org_members" ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_invites_doc_email_idx" ON "pending_invites" ("document_id","email");--> statement-breakpoint
CREATE INDEX "pending_invites_email_idx" ON "pending_invites" ("email");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" ("token");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_document_id_idx" ON "signed_url_tokens" ("document_id");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_slug_idx" ON "signed_url_tokens" ("slug");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_agent_id_idx" ON "signed_url_tokens" ("agent_id");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_conversation_id_idx" ON "signed_url_tokens" ("conversation_id");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_expires_at_idx" ON "signed_url_tokens" ("expires_at");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_verify_idx" ON "signed_url_tokens" ("slug","agent_id","conversation_id","expires_at");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_org_idx" ON "signed_url_tokens" ("org_id");--> statement-breakpoint
CREATE INDEX "signed_url_tokens_purge_idx" ON "signed_url_tokens" ("revoked","expires_at");--> statement-breakpoint
CREATE INDEX "state_transitions_document_id_idx" ON "state_transitions" ("document_id");--> statement-breakpoint
CREATE INDEX "state_transitions_changed_at_idx" ON "state_transitions" ("changed_at");--> statement-breakpoint
CREATE INDEX "state_transitions_doc_time_idx" ON "state_transitions" ("document_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" ("email");--> statement-breakpoint
CREATE INDEX "users_expires_at_idx" ON "users" ("expires_at");--> statement-breakpoint
CREATE INDEX "users_agent_id_idx" ON "users" ("agent_id");--> statement-breakpoint
CREATE INDEX "version_attributions_document_id_idx" ON "version_attributions" ("document_id");--> statement-breakpoint
CREATE INDEX "version_attributions_author_id_idx" ON "version_attributions" ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "version_attributions_unique_idx" ON "version_attributions" ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "versions_document_id_idx" ON "versions" ("document_id");--> statement-breakpoint
CREATE INDEX "versions_version_number_idx" ON "versions" ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "versions_created_at_idx" ON "versions" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_unique_version_idx" ON "versions" ("document_id","version_number");--> statement-breakpoint
CREATE INDEX "webhooks_user_id_idx" ON "webhooks" ("user_id");--> statement-breakpoint
CREATE INDEX "webhooks_document_slug_idx" ON "webhooks" ("document_slug");--> statement-breakpoint
CREATE INDEX "webhooks_active_idx" ON "webhooks" ("active","user_id");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_documents" ADD CONSTRAINT "collection_documents_collection_id_collections_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collection_documents" ADD CONSTRAINT "collection_documents_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_source_doc_id_documents_id_fkey" FOREIGN KEY ("source_doc_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_target_doc_id_documents_id_fkey" FOREIGN KEY ("target_doc_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_orgs" ADD CONSTRAINT "document_orgs_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_orgs" ADD CONSTRAINT "document_orgs_org_id_organizations_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_roles" ADD CONSTRAINT "document_roles_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "document_roles" ADD CONSTRAINT "document_roles_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_users_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "pending_invites" ADD CONSTRAINT "pending_invites_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signed_url_tokens" ADD CONSTRAINT "signed_url_tokens_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "version_attributions" ADD CONSTRAINT "version_attributions_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_document_id_documents_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;