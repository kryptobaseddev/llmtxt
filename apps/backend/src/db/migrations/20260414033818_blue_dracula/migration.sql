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
CREATE INDEX `webhooks_user_id_idx` ON `webhooks` (`user_id`);--> statement-breakpoint
CREATE INDEX `webhooks_document_slug_idx` ON `webhooks` (`document_slug`);--> statement-breakpoint
CREATE INDEX `webhooks_active_idx` ON `webhooks` (`active`,`user_id`);