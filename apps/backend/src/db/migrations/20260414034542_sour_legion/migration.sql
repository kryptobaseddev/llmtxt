CREATE TABLE `collection_documents` (
	`id` text PRIMARY KEY,
	`collection_id` text NOT NULL,
	`document_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`added_by` text,
	`added_at` integer NOT NULL,
	CONSTRAINT `fk_collection_documents_collection_id_collections_id_fk` FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_collection_documents_document_id_documents_id_fk` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`owner_id` text NOT NULL,
	`visibility` text DEFAULT 'public' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_collections_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_links` (
	`id` text PRIMARY KEY,
	`source_doc_id` text NOT NULL,
	`target_doc_id` text NOT NULL,
	`link_type` text NOT NULL,
	`label` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_document_links_source_doc_id_documents_id_fk` FOREIGN KEY (`source_doc_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_document_links_target_doc_id_documents_id_fk` FOREIGN KEY (`target_doc_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `collection_docs_collection_idx` ON `collection_documents` (`collection_id`);--> statement-breakpoint
CREATE INDEX `collection_docs_document_idx` ON `collection_documents` (`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `collection_docs_unique_idx` ON `collection_documents` (`collection_id`,`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_idx` ON `collections` (`slug`);--> statement-breakpoint
CREATE INDEX `collections_owner_idx` ON `collections` (`owner_id`);--> statement-breakpoint
CREATE INDEX `document_links_source_idx` ON `document_links` (`source_doc_id`);--> statement-breakpoint
CREATE INDEX `document_links_target_idx` ON `document_links` (`target_doc_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `document_links_unique_idx` ON `document_links` (`source_doc_id`,`target_doc_id`,`link_type`);