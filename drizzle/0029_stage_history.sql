CREATE TABLE `stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stage_history_owner_created` ON `stage_history` (`owner_id`,`created_at`);