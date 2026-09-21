DROP INDEX `idx_agent_files_created_at`;--> statement-breakpoint
ALTER TABLE `agent_files` ADD `owner_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_agent_files_owner_created_at` ON `agent_files` (`owner_id`,`created_at`);--> statement-breakpoint
DROP INDEX `idx_reminders_due_at`;--> statement-breakpoint
DROP INDEX `idx_reminders_status_due_at`;--> statement-breakpoint
ALTER TABLE `reminders` ADD `owner_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_reminders_owner_due_at` ON `reminders` (`owner_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `idx_reminders_owner_status_due_at` ON `reminders` (`owner_id`,`status`,`due_at`);--> statement-breakpoint
ALTER TABLE `memories` ADD `owner_id` text DEFAULT 'owner' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_memories_owner_updated_at` ON `memories` (`owner_id`,`updated_at`);
