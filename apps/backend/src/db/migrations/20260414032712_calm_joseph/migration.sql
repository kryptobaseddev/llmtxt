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
CREATE INDEX `audit_logs_user_id_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `audit_logs_resource_idx` ON `audit_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `audit_logs_timestamp_idx` ON `audit_logs` (`timestamp`);