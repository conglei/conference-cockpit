PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_talks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`speaker_id` integer,
	`company_id` integer,
	`title` text NOT NULL,
	`description` text,
	`day` text,
	`time` text,
	`room` text,
	`track` text,
	`type` text,
	`source` text,
	`source_detail` text,
	`raw` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`speaker_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_talks`("id", "speaker_id", "company_id", "title", "description", "day", "time", "room", "track", "type", "source", "source_detail", "raw", "created_at", "updated_at") SELECT "id", "speaker_id", "company_id", "title", "description", "day", "time", "room", "track", "type", "source", "source_detail", "raw", "created_at", "updated_at" FROM `talks`;--> statement-breakpoint
DROP TABLE `talks`;--> statement-breakpoint
ALTER TABLE `__new_talks` RENAME TO `talks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `talks_speaker_ix` ON `talks` (`speaker_id`);--> statement-breakpoint
CREATE INDEX `talks_company_ix` ON `talks` (`company_id`);--> statement-breakpoint
CREATE INDEX `talks_track_ix` ON `talks` (`track`);--> statement-breakpoint
CREATE UNIQUE INDEX `talks_dedupe_ux` ON `talks` (`speaker_id`,`title`,`time`);