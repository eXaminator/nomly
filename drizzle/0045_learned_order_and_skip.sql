CREATE TABLE `shopping_item_skip` (
	`shopping_item_id` integer NOT NULL,
	`supermarket_id` integer NOT NULL,
	`skipped_on` text NOT NULL,
	PRIMARY KEY(`shopping_item_id`, `supermarket_id`),
	FOREIGN KEY (`shopping_item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supermarket_id`) REFERENCES `supermarket`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `ingredient_purchase` ADD `supermarket_id` integer REFERENCES supermarket(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `ingredient_purchase_store_idx` ON `ingredient_purchase` (`supermarket_id`,`purchased_at`);