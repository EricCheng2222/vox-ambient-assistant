CREATE TABLE `activation_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`display_name` text DEFAULT 'Vox member' NOT NULL,
	`created_by` text NOT NULL,
	`creator_slot` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activation_codes_user_id_unique` ON `activation_codes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activation_codes_code_hash_unique` ON `activation_codes` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `activation_codes_creator_slot_unique` ON `activation_codes` (`creator_slot`);--> statement-breakpoint
CREATE INDEX `idx_activation_codes_created_by` ON `activation_codes` (`created_by`);