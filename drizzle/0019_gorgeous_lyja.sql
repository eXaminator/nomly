ALTER TABLE `ical_feed` ADD `raw_ics` text;--> statement-breakpoint
ALTER TABLE `ical_feed` ADD `raw_ics_fetched_at` integer;--> statement-breakpoint
ALTER TABLE `ical_feed` ADD `sort_order` integer DEFAULT 0 NOT NULL;