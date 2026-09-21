CREATE TABLE `conversation_messages` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`owner_id` text NOT NULL,
	`role` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_messages_id_unique` ON `conversation_messages` (`id`);--> statement-breakpoint
CREATE INDEX `idx_conversation_messages_owner_sequence` ON `conversation_messages` (`owner_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `conversation_threads` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
