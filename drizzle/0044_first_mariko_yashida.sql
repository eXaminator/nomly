CREATE TABLE `ingredient_purchase` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ingredient_id` integer NOT NULL,
	`shopping_item_id` integer,
	`purchased_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ingredient_purchase_ingredient_idx` ON `ingredient_purchase` (`ingredient_id`,`purchased_at`);--> statement-breakpoint
CREATE INDEX `ingredient_purchase_item_idx` ON `ingredient_purchase` (`shopping_item_id`);