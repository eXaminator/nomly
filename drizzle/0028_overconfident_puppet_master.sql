PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`default_category_id` integer,
	`grams_per_ml` real,
	`default_unit_id` integer,
	`default_sub_unit_id` integer,
	`exclude_from_shopping_list` integer DEFAULT false NOT NULL,
	`is_equipment` integer DEFAULT false NOT NULL,
	`dietary_class` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`default_category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`default_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`default_sub_unit_id`) REFERENCES `ingredient_sub_unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ingredient`("id", "name", "default_category_id", "grams_per_ml", "default_unit_id", "default_sub_unit_id", "exclude_from_shopping_list", "is_equipment", "dietary_class", "created_at", "updated_at") SELECT "id", "name", "default_category_id", "grams_per_ml", "default_unit_id", "default_sub_unit_id", "exclude_from_shopping_list", "is_equipment", "dietary_class", "created_at", "updated_at" FROM `ingredient`;--> statement-breakpoint
DROP TABLE `ingredient`;--> statement-breakpoint
ALTER TABLE `__new_ingredient` RENAME TO `ingredient`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_name_unique` ON `ingredient` (`name`);--> statement-breakpoint
ALTER TABLE `ingredient_sub_unit` DROP COLUMN `per_purchase`;