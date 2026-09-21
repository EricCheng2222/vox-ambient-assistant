CREATE TABLE `user_contacts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_hash` text NOT NULL,
	`email_ciphertext` text NOT NULL,
	`email_iv` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_contacts_email_hash_unique` ON `user_contacts` (`email_hash`);