CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`company_id` integer,
	`relationship` text NOT NULL,
	`title` text,
	`linkedin_url` text,
	`connection_degree` integer,
	`can_refer` integer DEFAULT false NOT NULL,
	`enrichment_blob` text,
	`notes_path` text,
	`outreach_status` text DEFAULT 'none' NOT NULL,
	`next_action` text,
	`next_action_date` text,
	`last_contacted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_slug_ux` ON `people` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `people_linkedin_ux` ON `people` (`linkedin_url`);--> statement-breakpoint
CREATE INDEX `people_company_ix` ON `people` (`company_id`);--> statement-breakpoint
CREATE INDEX `people_relationship_ix` ON `people` (`relationship`);--> statement-breakpoint
CREATE INDEX `people_can_refer_degree_ix` ON `people` (`can_refer`,`connection_degree`);