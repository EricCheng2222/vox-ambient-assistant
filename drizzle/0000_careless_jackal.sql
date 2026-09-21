CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`content` text NOT NULL,
	`source` text DEFAULT 'conversation' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
