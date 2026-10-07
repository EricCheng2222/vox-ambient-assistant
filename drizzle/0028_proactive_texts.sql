CREATE TABLE `proactive_text_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_proactive_text_keys_owner_seen` ON `proactive_text_keys` (`owner_id`,`seen_at`);--> statement-breakpoint
CREATE TABLE `proactive_text_log` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`local_day` text NOT NULL,
	`items` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_proactive_text_log_owner_created` ON `proactive_text_log` (`owner_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `phone_assistant_settings` ADD `proactive_texts` integer DEFAULT true NOT NULL;