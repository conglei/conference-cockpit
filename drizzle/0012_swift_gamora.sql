CREATE TABLE `speaker_embeddings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`company` text,
	`model` text,
	`dimensions` integer,
	`embedding` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `speaker_embeddings_external_id_ux` ON `speaker_embeddings` (`external_id`);--> statement-breakpoint
CREATE INDEX `speaker_embeddings_person_ix` ON `speaker_embeddings` (`person_id`);--> statement-breakpoint
ALTER TABLE `companies` ADD `industry` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `keywords` text;--> statement-breakpoint
ALTER TABLE `companies` ADD `founded_year` integer;--> statement-breakpoint
ALTER TABLE `companies` ADD `headcount` integer;--> statement-breakpoint
ALTER TABLE `companies` ADD `verticals` text;--> statement-breakpoint
ALTER TABLE `people` ADD `bio` text;--> statement-breakpoint
ALTER TABLE `people` ADD `photo_url` text;--> statement-breakpoint
ALTER TABLE `people` ADD `twitter_url` text;