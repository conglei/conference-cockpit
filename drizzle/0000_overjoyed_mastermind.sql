CREATE TABLE `companies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`linkedin_url` text,
	`website_url` text,
	`description` text,
	`stage` text,
	`category` text,
	`location` text,
	`work_type` text,
	`size_band` text,
	`latest_round` text,
	`latest_amount` text,
	`last_funding_date` text,
	`lead_investor` text,
	`status` text DEFAULT 'new' NOT NULL,
	`source` text,
	`source_detail` text,
	`enrichment_blob` text,
	`deep_dive_path` text,
	`score_founder_quality` real,
	`score_investor_quality` real,
	`score_domain_fit` real,
	`score_stage_fit` real,
	`score_size_fit` real,
	`score_overall` real,
	`score_rationale` text,
	`scored_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_slug_ux` ON `companies` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_domain_ux` ON `companies` (`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `companies_linkedin_ux` ON `companies` (`linkedin_url`);--> statement-breakpoint
CREATE INDEX `companies_status_ix` ON `companies` (`status`);--> statement-breakpoint
CREATE INDEX `companies_score_overall_ix` ON `companies` (`score_overall`);