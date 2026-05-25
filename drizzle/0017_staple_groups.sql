CREATE TABLE `shopping_item_staple_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`staple_group_id` integer NOT NULL,
	`staple_group_item_id` integer,
	`contributed_quantity` real,
	`contributed_unit_id` integer,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staple_group_id`) REFERENCES `staple_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staple_group_item_id`) REFERENCES `staple_group_item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contributed_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_item_staple_source_item_idx` ON `shopping_item_staple_source` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_item_staple_source_group_idx` ON `shopping_item_staple_source` (`staple_group_id`);--> statement-breakpoint
CREATE TABLE `staple_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staple_group_name_unique` ON `staple_group` (`name`);--> statement-breakpoint
CREATE TABLE `staple_group_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`ingredient_id` integer NOT NULL,
	`quantity` real,
	`unit_id` integer,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `staple_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staple_group_item_unique` ON `staple_group_item` (`group_id`,`ingredient_id`);--> statement-breakpoint
CREATE INDEX `staple_group_item_group_idx` ON `staple_group_item` (`group_id`);