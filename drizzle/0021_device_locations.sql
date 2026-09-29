CREATE TABLE `location_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_devices_token_hash_unique` ON `location_devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_location_devices_owner` ON `location_devices` (`owner_id`);--> statement-breakpoint
CREATE TABLE `location_pings` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`device_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_location_pings_device_captured` ON `location_pings` (`device_id`,`captured_at`);