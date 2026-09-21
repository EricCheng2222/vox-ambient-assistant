CREATE TABLE `user_preferences` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`reply_length` text DEFAULT 'balanced' NOT NULL,
	`voice` text DEFAULT 'marin' NOT NULL,
	`initiative` text DEFAULT 'balanced' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
