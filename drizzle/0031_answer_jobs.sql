CREATE TABLE `answer_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`response_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_answer_jobs_status_updated` ON `answer_jobs` (`status`,`updated_at`);