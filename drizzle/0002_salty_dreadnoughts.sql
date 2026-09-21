CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'conversation' NOT NULL,
	`notified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_reminders_due_at` ON `reminders` (`due_at`);--> statement-breakpoint
CREATE INDEX `idx_reminders_status_due_at` ON `reminders` (`status`,`due_at`);