CREATE TABLE `dashboard_panels` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`refreshed_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dashboard_panels_owner_position` ON `dashboard_panels` (`owner_id`,`position`);