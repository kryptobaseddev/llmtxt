CREATE TABLE `agent_inbox_messages` (
	`id` text PRIMARY KEY,
	`to_agent_id` text NOT NULL,
	`envelope_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`exp` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_pubkeys` (
	`id` text PRIMARY KEY,
	`agent_id` text NOT NULL,
	`pubkey_hex` text NOT NULL,
	`label` text,
	`created_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE TABLE `agent_signature_nonces` (
	`nonce` text PRIMARY KEY,
	`agent_id` text NOT NULL,
	`first_seen` integer NOT NULL,
	`expires_at` integer NOT NULL
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
	`sig_hex` text,
	`canonical_payload` text,
	`chain_hash` text,
	`prev_chain_hash` text,
	`bft_f` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_events` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`idempotency_key` text,
	`created_at` integer NOT NULL,
	`prev_hash` text
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`state` text DEFAULT 'DRAFT' NOT NULL,
	`created_by` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`version_count` integer DEFAULT 0 NOT NULL,
	`labels_json` text DEFAULT '[]' NOT NULL,
	`expires_at` integer,
	`event_seq_counter` integer DEFAULT 0 NOT NULL,
	`bft_f` integer DEFAULT 1 NOT NULL,
	`required_approvals` integer DEFAULT 1 NOT NULL,
	`approval_timeout_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scratchpad_entries` (
	`id` text PRIMARY KEY,
	`to_agent_id` text NOT NULL,
	`from_agent_id` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`exp` integer NOT NULL
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
CREATE TABLE `section_embeddings` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`section_key` text DEFAULT '__full__' NOT NULL,
	`embedding_blob` blob NOT NULL,
	`dimensions` integer NOT NULL,
	`model_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `section_leases` (
	`id` text PRIMARY KEY,
	`resource` text NOT NULL,
	`holder` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
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
	`at_version` integer NOT NULL
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
	`storage_key` text
);
--> statement-breakpoint
CREATE INDEX `agent_inbox_messages_to_agent_id_idx` ON `agent_inbox_messages` (`to_agent_id`);--> statement-breakpoint
CREATE INDEX `agent_inbox_messages_exp_idx` ON `agent_inbox_messages` (`exp`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_pubkeys_agent_id_idx` ON `agent_pubkeys` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_signature_nonces_agent_id_idx` ON `agent_signature_nonces` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_signature_nonces_expires_at_idx` ON `agent_signature_nonces` (`expires_at`);--> statement-breakpoint
CREATE INDEX `approvals_document_id_idx` ON `approvals` (`document_id`);--> statement-breakpoint
CREATE INDEX `approvals_reviewer_idx` ON `approvals` (`document_id`,`reviewer_id`);--> statement-breakpoint
CREATE INDEX `approvals_status_idx` ON `approvals` (`document_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_events_doc_seq_unique` ON `document_events` (`document_id`,`seq`);--> statement-breakpoint
CREATE INDEX `document_events_doc_created_at_idx` ON `document_events` (`document_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_slug_idx` ON `documents` (`slug`);--> statement-breakpoint
CREATE INDEX `documents_created_at_idx` ON `documents` (`created_at`);--> statement-breakpoint
CREATE INDEX `documents_state_idx` ON `documents` (`state`);--> statement-breakpoint
CREATE INDEX `documents_created_by_idx` ON `documents` (`created_by`);--> statement-breakpoint
CREATE INDEX `scratchpad_entries_to_agent_id_idx` ON `scratchpad_entries` (`to_agent_id`);--> statement-breakpoint
CREATE INDEX `scratchpad_entries_exp_idx` ON `scratchpad_entries` (`exp`);--> statement-breakpoint
CREATE INDEX `section_crdt_updates_doc_section_seq_idx` ON `section_crdt_updates` (`document_id`,`section_id`,`seq`);--> statement-breakpoint
CREATE INDEX `section_embeddings_document_id_idx` ON `section_embeddings` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `section_embeddings_unique_doc_section_idx` ON `section_embeddings` (`document_id`,`section_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `section_leases_resource_idx` ON `section_leases` (`resource`);--> statement-breakpoint
CREATE INDEX `section_leases_expires_at_idx` ON `section_leases` (`expires_at`);--> statement-breakpoint
CREATE INDEX `state_transitions_document_id_idx` ON `state_transitions` (`document_id`);--> statement-breakpoint
CREATE INDEX `state_transitions_changed_at_idx` ON `state_transitions` (`changed_at`);--> statement-breakpoint
CREATE INDEX `versions_document_id_idx` ON `versions` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `versions_unique_version_idx` ON `versions` (`document_id`,`version_number`);