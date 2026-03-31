CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`status` text NOT NULL,
	`timestamp` integer NOT NULL,
	`reason` text,
	`at_version` integer NOT NULL,
	CONSTRAINT `fk_approvals_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `contributors` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`versions_authored` integer DEFAULT 0 NOT NULL,
	`total_tokens_added` integer DEFAULT 0 NOT NULL,
	`total_tokens_removed` integer DEFAULT 0 NOT NULL,
	`net_tokens` integer DEFAULT 0 NOT NULL,
	`first_contribution` integer NOT NULL,
	`last_contribution` integer NOT NULL,
	`sections_modified` text DEFAULT '[]' NOT NULL,
	`display_name` text,
	CONSTRAINT `fk_contributors_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`format` text NOT NULL,
	`content_hash` text NOT NULL,
	`compressed_data` blob,
	`original_size` integer NOT NULL,
	`compressed_size` integer NOT NULL,
	`token_count` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`state` text DEFAULT 'DRAFT' NOT NULL,
	`owner_id` text,
	`is_anonymous` integer DEFAULT false NOT NULL,
	`storage_type` text DEFAULT 'inline' NOT NULL,
	`storage_key` text,
	`current_version` integer DEFAULT 0 NOT NULL,
	`version_count` integer DEFAULT 0 NOT NULL,
	`sharing_mode` text DEFAULT 'signed_url' NOT NULL,
	`approval_required_count` integer DEFAULT 1 NOT NULL,
	`approval_require_unanimous` integer DEFAULT false NOT NULL,
	`approval_allowed_reviewers` text DEFAULT '' NOT NULL,
	`approval_timeout_ms` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_documents_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `signed_url_tokens` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`slug` text NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`org_id` text,
	`signature` text NOT NULL,
	`signature_length` integer DEFAULT 16 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	CONSTRAINT `fk_signed_url_tokens_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `state_transitions` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`changed_by` text NOT NULL,
	`changed_at` integer NOT NULL,
	`reason` text,
	`at_version` integer NOT NULL,
	CONSTRAINT `fk_state_transitions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`name` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_anonymous` integer DEFAULT false,
	`agent_id` text,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `version_attributions` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`author_id` text NOT NULL,
	`added_lines` integer DEFAULT 0 NOT NULL,
	`removed_lines` integer DEFAULT 0 NOT NULL,
	`added_tokens` integer DEFAULT 0 NOT NULL,
	`removed_tokens` integer DEFAULT 0 NOT NULL,
	`sections_modified` text DEFAULT '[]' NOT NULL,
	`changelog` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_version_attributions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`compressed_data` blob,
	`content_hash` text NOT NULL,
	`token_count` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`changelog` text,
	`patch_text` text,
	`base_version` integer,
	`storage_type` text DEFAULT 'inline' NOT NULL,
	`storage_key` text,
	CONSTRAINT `fk_versions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `approvals_document_id_idx` ON `approvals` (`document_id`);--> statement-breakpoint
CREATE INDEX `approvals_reviewer_idx` ON `approvals` (`document_id`,`reviewer_id`);--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`document_id`,`status`);--> statement-breakpoint
CREATE INDEX `approvals_timestamp_idx` ON `approvals` (`timestamp`);--> statement-breakpoint
CREATE INDEX `approvals_latest_review_idx` ON `approvals` (`document_id`,`reviewer_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `contributors_document_id_idx` ON `contributors` (`document_id`);--> statement-breakpoint
CREATE INDEX `contributors_agent_id_idx` ON `contributors` (`document_id`,`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contributors_unique_idx` ON `contributors` (`document_id`,`agent_id`);--> statement-breakpoint
CREATE INDEX `contributors_net_tokens_idx` ON `contributors` (`document_id`,`net_tokens`);--> statement-breakpoint
CREATE INDEX `documents_slug_idx` ON `documents` (`slug`);--> statement-breakpoint
CREATE INDEX `documents_created_at_idx` ON `documents` (`created_at`);--> statement-breakpoint
CREATE INDEX `documents_expires_at_idx` ON `documents` (`expires_at`);--> statement-breakpoint
CREATE INDEX `documents_state_idx` ON `documents` (`state`);--> statement-breakpoint
CREATE INDEX `documents_owner_id_idx` ON `documents` (`owner_id`);--> statement-breakpoint
CREATE INDEX `documents_is_anonymous_idx` ON `documents` (`is_anonymous`);--> statement-breakpoint
CREATE INDEX `documents_purge_idx` ON `documents` (`is_anonymous`,`expires_at`);--> statement-breakpoint
CREATE INDEX `documents_storage_key_idx` ON `documents` (`storage_key`);--> statement-breakpoint
CREATE INDEX `documents_sharing_mode_idx` ON `documents` (`sharing_mode`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_idx` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_document_id_idx` ON `signed_url_tokens` (`document_id`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_slug_idx` ON `signed_url_tokens` (`slug`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_agent_id_idx` ON `signed_url_tokens` (`agent_id`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_conversation_id_idx` ON `signed_url_tokens` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_expires_at_idx` ON `signed_url_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_verify_idx` ON `signed_url_tokens` (`slug`,`agent_id`,`conversation_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_org_idx` ON `signed_url_tokens` (`org_id`);--> statement-breakpoint
CREATE INDEX `signed_url_tokens_purge_idx` ON `signed_url_tokens` (`revoked`,`expires_at`);--> statement-breakpoint
CREATE INDEX `state_transitions_document_id_idx` ON `state_transitions` (`document_id`);--> statement-breakpoint
CREATE INDEX `state_transitions_changed_at_idx` ON `state_transitions` (`changed_at`);--> statement-breakpoint
CREATE INDEX `state_transitions_doc_time_idx` ON `state_transitions` (`document_id`,`changed_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_expires_at_idx` ON `users` (`expires_at`);--> statement-breakpoint
CREATE INDEX `users_agent_id_idx` ON `users` (`agent_id`);--> statement-breakpoint
CREATE INDEX `version_attributions_document_id_idx` ON `version_attributions` (`document_id`);--> statement-breakpoint
CREATE INDEX `version_attributions_author_id_idx` ON `version_attributions` (`author_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `version_attributions_unique_idx` ON `version_attributions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `versions_document_id_idx` ON `versions` (`document_id`);--> statement-breakpoint
CREATE INDEX `versions_version_number_idx` ON `versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `versions_created_at_idx` ON `versions` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_unique_version_idx` ON `versions` (`document_id`,`version_number`);