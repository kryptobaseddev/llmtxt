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
ALTER TABLE `documents` ADD `visibility` text DEFAULT 'public' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `document_orgs_doc_org_idx` ON `document_orgs` (`document_id`,`org_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_roles_doc_user_idx` ON `document_roles` (`document_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `document_roles_user_idx` ON `document_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `document_roles_role_idx` ON `document_roles` (`document_id`,`role`);--> statement-breakpoint
CREATE INDEX `documents_visibility_idx` ON `documents` (`visibility`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_members_org_user_idx` ON `org_members` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `org_members_user_idx` ON `org_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_idx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `pending_invites_doc_email_idx` ON `pending_invites` (`document_id`,`email`);--> statement-breakpoint
CREATE INDEX `pending_invites_email_idx` ON `pending_invites` (`email`);