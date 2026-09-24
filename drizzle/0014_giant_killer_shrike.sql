PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_phone_assistant_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`passphrase_hash` text,
	`passphrase_length` integer DEFAULT 0 NOT NULL,
	`phone_hash` text,
	`phone_ciphertext` text,
	`phone_iv` text,
	`phone_last_four` text,
	`enabled` integer DEFAULT true NOT NULL,
	`allow_outbound` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_phone_assistant_settings`("owner_id", "passphrase_hash", "passphrase_length", "phone_hash", "phone_ciphertext", "phone_iv", "phone_last_four", "enabled", "allow_outbound", "created_at", "updated_at") SELECT "owner_id", NULL, 0, "phone_hash", "phone_ciphertext", "phone_iv", "phone_last_four", false, false, "created_at", "updated_at" FROM `phone_assistant_settings`;--> statement-breakpoint
DROP TABLE `phone_assistant_settings`;--> statement-breakpoint
ALTER TABLE `__new_phone_assistant_settings` RENAME TO `phone_assistant_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `phone_assistant_settings_passphrase_hash_unique` ON `phone_assistant_settings` (`passphrase_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `phone_assistant_settings_phone_hash_unique` ON `phone_assistant_settings` (`phone_hash`);--> statement-breakpoint
CREATE INDEX `idx_phone_assistant_passphrase_hash` ON `phone_assistant_settings` (`passphrase_hash`);--> statement-breakpoint
CREATE TABLE `__new_phone_call_sessions` (
	`call_sid` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`caller_hash` text NOT NULL,
	`status` text DEFAULT 'pending_phrase' NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_phone_call_sessions`("call_sid", "owner_id", "caller_hash", "status", "failed_attempts", "created_at", "updated_at", "expires_at") SELECT "call_sid", "owner_id", 'migration-expired', 'failed', "failed_attempts", "created_at", "updated_at", "expires_at" FROM `phone_call_sessions`;--> statement-breakpoint
DROP TABLE `phone_call_sessions`;--> statement-breakpoint
ALTER TABLE `__new_phone_call_sessions` RENAME TO `phone_call_sessions`;--> statement-breakpoint
CREATE INDEX `idx_phone_call_sessions_owner_expires` ON `phone_call_sessions` (`owner_id`,`expires_at`);
