CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`occurred_at` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activity_log_owner_occurred` ON `activity_log` (`owner_id`,`occurred_at`);