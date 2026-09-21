CREATE TABLE `agent_files` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`title` text NOT NULL,
	`purpose` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_files_object_key_unique` ON `agent_files` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_agent_files_created_at` ON `agent_files` (`created_at`);