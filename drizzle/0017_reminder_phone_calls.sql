ALTER TABLE `reminders` ADD `delivery` text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `call_status` text;--> statement-breakpoint
ALTER TABLE `reminders` ADD `call_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `called_at` text;--> statement-breakpoint
CREATE INDEX `idx_reminders_delivery_status_due_at` ON `reminders` (`delivery`,`status`,`due_at`);