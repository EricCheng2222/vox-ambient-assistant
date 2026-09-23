CREATE TABLE `remote_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`device_id` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_ciphertext` text,
	`result_iv` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_remote_commands_device_status_created` ON `remote_commands` (`device_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_remote_commands_owner_created` ON `remote_commands` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `remote_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text DEFAULT 'Mac' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claim_id` text,
	`claim_label` text,
	`claim_proof` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL,
	`paired_at` text,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_remote_devices_owner_status` ON `remote_devices` (`owner_id`,`status`);