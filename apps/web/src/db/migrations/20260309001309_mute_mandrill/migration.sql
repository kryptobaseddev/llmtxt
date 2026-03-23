CREATE TABLE `documents` (
	`id` text PRIMARY KEY,
	`slug` text NOT NULL,
	`format` text NOT NULL,
	`content_hash` text NOT NULL,
	`compressed_data` blob NOT NULL,
	`original_size` integer NOT NULL,
	`compressed_size` integer NOT NULL,
	`token_count` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY,
	`document_id` text NOT NULL,
	`version_number` integer NOT NULL,
	`compressed_data` blob NOT NULL,
	`content_hash` text NOT NULL,
	`token_count` integer,
	`created_at` integer NOT NULL,
	`created_by` text,
	`changelog` text,
	CONSTRAINT `fk_versions_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `documents_slug_idx` ON `documents` (`slug`);--> statement-breakpoint
CREATE INDEX `documents_created_at_idx` ON `documents` (`created_at`);--> statement-breakpoint
CREATE INDEX `documents_expires_at_idx` ON `documents` (`expires_at`);--> statement-breakpoint
CREATE INDEX `versions_document_id_idx` ON `versions` (`document_id`);--> statement-breakpoint
CREATE INDEX `versions_version_number_idx` ON `versions` (`document_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `versions_created_at_idx` ON `versions` (`created_at`);