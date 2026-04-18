CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY,
	`webhook_id` text NOT NULL,
	`event_id` text NOT NULL,
	`attempt_num` integer NOT NULL,
	`status` text NOT NULL,
	`response_status` integer,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_webhook_deliveries_webhook_id_webhooks_id_fk` FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `webhook_dlq` (
	`id` text PRIMARY KEY,
	`webhook_id` text NOT NULL,
	`failed_delivery_id` text NOT NULL,
	`event_id` text NOT NULL,
	`reason` text NOT NULL,
	`payload` text NOT NULL,
	`captured_at` integer NOT NULL,
	`replayed_at` integer,
	CONSTRAINT `fk_webhook_dlq_webhook_id_webhooks_id_fk` FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `webhook_seen_ids` (
	`event_id` text PRIMARY KEY,
	`webhook_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_id_idx` ON `webhook_deliveries` (`webhook_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_event_id_idx` ON `webhook_deliveries` (`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_created_at_idx` ON `webhook_deliveries` (`created_at`);--> statement-breakpoint
CREATE INDEX `webhook_dlq_webhook_id_idx` ON `webhook_dlq` (`webhook_id`);--> statement-breakpoint
CREATE INDEX `webhook_dlq_event_id_idx` ON `webhook_dlq` (`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_dlq_captured_at_idx` ON `webhook_dlq` (`captured_at`);--> statement-breakpoint
CREATE INDEX `webhook_seen_ids_expires_at_idx` ON `webhook_seen_ids` (`expires_at`);--> statement-breakpoint
CREATE INDEX `webhook_seen_ids_webhook_id_idx` ON `webhook_seen_ids` (`webhook_id`);