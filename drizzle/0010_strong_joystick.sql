CREATE TABLE `social_interaction_state` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`last_morning_date` text,
	`last_night_date` text,
	`last_natural_callback_at` text,
	`last_emotional_followup_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
