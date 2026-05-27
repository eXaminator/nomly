PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recipe_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer NOT NULL,
	`ingredient_id` integer,
	`display_name` text,
	`quantity` real,
	`unit_id` integer,
	`sub_unit_id` integer,
	`display_unit` text,
	`notes` text,
	`is_optional` integer DEFAULT false NOT NULL,
	`fixed_amount` integer DEFAULT false NOT NULL,
	`raw_line` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`alternative_for_id` integer,
	FOREIGN KEY (`section_id`) REFERENCES `recipe_section`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sub_unit_id`) REFERENCES `ingredient_sub_unit`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`alternative_for_id`) REFERENCES `recipe_ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_recipe_ingredient`("id", "section_id", "ingredient_id", "display_name", "quantity", "unit_id", "sub_unit_id", "display_unit", "notes", "is_optional", "fixed_amount", "raw_line", "sort_order", "alternative_for_id") SELECT "id", "section_id", "ingredient_id", "display_name", "quantity", "unit_id", "sub_unit_id", "display_unit", "notes", "is_optional", "fixed_amount", "raw_line", "sort_order", "alternative_for_id" FROM `recipe_ingredient`;--> statement-breakpoint
DROP TABLE `recipe_ingredient`;--> statement-breakpoint
ALTER TABLE `__new_recipe_ingredient` RENAME TO `recipe_ingredient`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `recipe_ingredient_section_idx` ON `recipe_ingredient` (`section_id`);--> statement-breakpoint
CREATE INDEX `recipe_ingredient_alternative_for_idx` ON `recipe_ingredient` (`alternative_for_id`);