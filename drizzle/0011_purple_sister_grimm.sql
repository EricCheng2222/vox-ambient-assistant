CREATE TABLE `vision_usage` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`hour_bucket` text DEFAULT '' NOT NULL,
	`hour_count` integer DEFAULT 0 NOT NULL,
	`day_bucket` text DEFAULT '' NOT NULL,
	`day_count` integer DEFAULT 0 NOT NULL,
	`last_analysis_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
