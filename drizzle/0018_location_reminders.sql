ALTER TABLE `reminders` ADD `trigger_type` text DEFAULT 'time' NOT NULL;--> statement-breakpoint
ALTER TABLE `reminders` ADD `place` text;--> statement-breakpoint
ALTER TABLE `reminders` ADD `place_event` text;--> statement-breakpoint
ALTER TABLE `reminders` ADD `location_status` text;