CREATE TABLE `shopping_item_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`quantity` real,
	`unit_id` integer,
	`dimension` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_item_stock_item_unique` ON `shopping_item_stock` (`item_id`);