CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`contact_person_id` integer,
	`status` text DEFAULT 'interested' NOT NULL,
	`next_action` text,
	`next_action_date` text,
	`applied_at` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `applications_role_ix` ON `applications` (`role_id`);--> statement-breakpoint
CREATE INDEX `applications_company_ix` ON `applications` (`company_id`);--> statement-breakpoint
CREATE INDEX `applications_status_ix` ON `applications` (`status`);