DROP TABLE `product`;--> statement-breakpoint
DROP TABLE `product_alias`;--> statement-breakpoint
DROP TABLE `product_supermarket_unavailable`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shopping_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ingredient_id` integer NOT NULL,
	`quantity` real,
	`unit_id` integer,
	`category_id` integer,
	`checked` integer DEFAULT false NOT NULL,
	`checked_at` integer,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_shopping_item`("id", "ingredient_id", "quantity", "unit_id", "category_id", "checked", "checked_at", "note", "sort_order", "version", "created_at", "updated_at") SELECT "id", "ingredient_id", "quantity", "unit_id", "category_id", "checked", "checked_at", "note", "sort_order", "version", "created_at", "updated_at" FROM `shopping_item`;--> statement-breakpoint
DROP TABLE `shopping_item`;--> statement-breakpoint
ALTER TABLE `__new_shopping_item` RENAME TO `shopping_item`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shopping_item_checked_idx` ON `shopping_item` (`checked`,`checked_at`);