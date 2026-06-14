CREATE TABLE `quantifier` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`value` real,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quantifier_name_unique` ON `quantifier` (`name`);--> statement-breakpoint
CREATE TABLE `quantifier_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quantifier_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`quantifier_id`) REFERENCES `quantifier`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quantifier_alias_name_unique` ON `quantifier_alias` (`name`);--> statement-breakpoint
ALTER TABLE `recipe_ingredient` ADD `quantifier_id` integer REFERENCES quantifier(id);