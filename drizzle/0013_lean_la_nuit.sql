CREATE TABLE `phone_assistant_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`phone_hash` text NOT NULL,
	`phone_ciphertext` text NOT NULL,
	`phone_iv` text NOT NULL,
	`phone_last_four` text NOT NULL,
	`pin_salt` text NOT NULL,
	`pin_hash` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`allow_outbound` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `phone_assistant_settings_phone_hash_unique` ON `phone_assistant_settings` (`phone_hash`);--> statement-breakpoint
CREATE INDEX `idx_phone_assistant_phone_hash` ON `phone_assistant_settings` (`phone_hash`);--> statement-breakpoint
CREATE TABLE `phone_call_sessions` (
	`call_sid` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'pending_pin' NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_phone_call_sessions_owner_expires` ON `phone_call_sessions` (`owner_id`,`expires_at`);