CREATE TABLE `agent_pubkeys` (
	`id` text PRIMARY KEY,
	`agent_id` text NOT NULL UNIQUE,
	`pubkey` blob NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `agent_signature_nonces` (
	`nonce` text PRIMARY KEY,
	`agent_id` text NOT NULL,
	`first_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`scopes` text DEFAULT '*' NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_api_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`agent_id` text,
	`ip_address` text,
	`user_agent` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`details` text,
	`timestamp` integer NOT NULL,
	`request_id` text,
	`method` text,
	`path` text,
	`status_code` integer
);
--> statement-breakpoint
CREATE TABLE `document_events` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`prev_hash` blob
);
--> statement-breakpoint
CREATE TABLE `document_orgs` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`org_id` text NOT NULL,
	`added_at` integer NOT NULL,
	CONSTRAINT `fk_document_orgs_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_document_orgs_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `document_roles` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` integer NOT NULL,
	CONSTRAINT `fk_document_roles_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_document_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `org_members` (
	`id` text PRIMARY KEY,
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	CONSTRAINT `fk_org_members_org_id_organizations_id_fk` FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_org_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_organizations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `pending_invites` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	CONSTRAINT `fk_pending_invites_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `section_crdt_states` (
	`document_id` text NOT NULL,
	`section_id` text NOT NULL,
	`clock` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`yrs_state` blob NOT NULL,
	CONSTRAINT `section_crdt_states_pk` PRIMARY KEY(`document_id`, `section_id`)
);
--> statement-breakpoint
CREATE TABLE `section_crdt_updates` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`section_id` text NOT NULL,
	`update_blob` blob NOT NULL,
	`client_id` text NOT NULL,
	`seq` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`document_slug` text,
	`active` integer DEFAULT true NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_delivery_at` integer,
	`last_success_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_webhooks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE INDEX `agent_signature_nonces_agent_first_seen_idx` ON `agent_signature_nonces` (`agent_id`,`first_seen`);--> statement-breakpoint
CREATE INDEX `api_keys_user_id_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_idx` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_key_prefix_idx` ON `api_keys` (`key_prefix`);--> statement-breakpoint
CREATE INDEX `audit_logs_user_id_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_logs_resource_idx` ON `audit_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_timestamp_idx` ON `audit_logs` (`timestamp`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_events_doc_seq_unique` ON `document_events` (`document_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_orgs_doc_org_idx` ON `document_orgs` (`document_id`,`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_roles_doc_user_idx` ON `document_roles` (`document_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `document_roles_user_idx` ON `document_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `document_roles_role_idx` ON `document_roles` (`document_id`,`role`);--> statement-breakpoint
CREATE INDEX `documents_visibility_idx` ON `documents` (`visibility`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_members_org_user_idx` ON `org_members` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `org_members_user_idx` ON `org_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `pending_invites_doc_email_idx` ON `pending_invites` (`document_id`,`email`);--> statement-breakpoint
CREATE INDEX `pending_invites_email_idx` ON `pending_invites` (`email`);--> statement-breakpoint
CREATE INDEX `section_crdt_updates_doc_section_seq_idx` ON `section_crdt_updates` (`document_id`,`section_id`,`seq`);--> statement-breakpoint
CREATE INDEX `section_crdt_updates_doc_section_created_at_idx` ON `section_crdt_updates` (`document_id`,`section_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `webhooks_user_id_idx` ON `webhooks` (`user_id`);--> statement-breakpoint
CREATE INDEX `webhooks_document_slug_idx` ON `webhooks` (`document_slug`);--> statement-breakpoint
CREATE INDEX `webhooks_active_idx` ON `webhooks` (`active`,`user_id`);