CREATE TABLE `owner_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`delivered` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_owner_notices_owner_created` ON `owner_notices` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `push_devices` (
	`token` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`environment` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` text NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_push_devices_owner` ON `push_devices` (`owner_id`);