CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`location` text,
	`work_type` text,
	`description` text,
	`posted_date` text,
	`status` text DEFAULT 'new' NOT NULL,
	`source` text,
	`external_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `roles_company_ix` ON `roles` (`company_id`);--> statement-breakpoint
CREATE INDEX `roles_status_ix` ON `roles` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `roles_external_id_ux` ON `roles` (`external_id`);