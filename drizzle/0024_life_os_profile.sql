CREATE TABLE `mail_triage` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`verdict` text NOT NULL,
	`judged_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mail_triage_owner_judged_at` ON `mail_triage` (`owner_id`,`judged_at`);--> statement-breakpoint
CREATE TABLE `today_now_cache` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`signature` text NOT NULL,
	`chosen` text NOT NULL,
	`decided_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text,
	`iv` text,
	`time_zone` text,
	`time_zone_source` text,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`consolidated_day` text,
	`last_run_at` text,
	`last_run_status` text,
	`last_run_trigger` text,
	`last_run_messages` integer DEFAULT 0 NOT NULL,
	`last_run_error` text,
	`last_success_at` text,
	`run_started_at` text,
	`manual_run_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
