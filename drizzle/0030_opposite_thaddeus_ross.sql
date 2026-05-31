PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`default_category_id` integer,
	`default_unit_id` integer,
	`exclude_from_shopping_list` integer DEFAULT false NOT NULL,
	`is_equipment` integer DEFAULT false NOT NULL,
	`dietary_class` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`default_category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`default_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ingredient`("id", "name", "default_category_id", "default_unit_id", "exclude_from_shopping_list", "is_equipment", "dietary_class", "created_at", "updated_at") SELECT "id", "name", "default_category_id", "default_unit_id", "exclude_from_shopping_list", "is_equipment", "dietary_class", "created_at", "updated_at" FROM `ingredient`;--> statement-breakpoint
DROP TABLE `ingredient`;--> statement-breakpoint
ALTER TABLE `__new_ingredient` RENAME TO `ingredient`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_name_unique` ON `ingredient` (`name`);--> statement-breakpoint
CREATE TABLE `__new_ingredient_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ingredient_id` integer NOT NULL,
	`name` text NOT NULL,
	`default_unit_id` integer,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ingredient_alias`("id", "ingredient_id", "name", "default_unit_id") SELECT "id", "ingredient_id", "name", "default_unit_id" FROM `ingredient_alias`;--> statement-breakpoint
DROP TABLE `ingredient_alias`;--> statement-breakpoint
ALTER TABLE `__new_ingredient_alias` RENAME TO `ingredient_alias`;--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_alias_name_unique` ON `ingredient_alias` (`name`);--> statement-breakpoint
CREATE TABLE `__new_recipe_ingredient` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_id` integer NOT NULL,
	`ingredient_id` integer,
	`display_name` text,
	`quantity` real,
	`unit_id` integer,
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
	FOREIGN KEY (`alternative_for_id`) REFERENCES `recipe_ingredient`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_recipe_ingredient`("id", "section_id", "ingredient_id", "display_name", "quantity", "unit_id", "display_unit", "notes", "is_optional", "fixed_amount", "raw_line", "sort_order", "alternative_for_id") SELECT "id", "section_id", "ingredient_id", "display_name", "quantity", "unit_id", "display_unit", "notes", "is_optional", "fixed_amount", "raw_line", "sort_order", "alternative_for_id" FROM `recipe_ingredient`;--> statement-breakpoint
DROP TABLE `recipe_ingredient`;--> statement-breakpoint
ALTER TABLE `__new_recipe_ingredient` RENAME TO `recipe_ingredient`;--> statement-breakpoint
CREATE INDEX `recipe_ingredient_section_idx` ON `recipe_ingredient` (`section_id`);--> statement-breakpoint
CREATE INDEX `recipe_ingredient_alternative_for_idx` ON `recipe_ingredient` (`alternative_for_id`);--> statement-breakpoint
CREATE TABLE `__new_shopping_item_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`meal_plan_id` integer NOT NULL,
	`recipe_ingredient_id` integer NOT NULL,
	`contributed_quantity` real,
	`contributed_unit_id` integer,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_ingredient_id`) REFERENCES `recipe_ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributed_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_shopping_item_source`("id", "item_id", "meal_plan_id", "recipe_ingredient_id", "contributed_quantity", "contributed_unit_id", "added_at") SELECT "id", "item_id", "meal_plan_id", "recipe_ingredient_id", "contributed_quantity", "contributed_unit_id", "added_at" FROM `shopping_item_source`;--> statement-breakpoint
DROP TABLE `shopping_item_source`;--> statement-breakpoint
ALTER TABLE `__new_shopping_item_source` RENAME TO `shopping_item_source`;--> statement-breakpoint
CREATE INDEX `shopping_item_source_item_idx` ON `shopping_item_source` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_item_source_meal_idx` ON `shopping_item_source` (`meal_plan_id`);--> statement-breakpoint
CREATE TABLE `__new_shopping_item_staple_source` (
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
INSERT INTO `__new_shopping_item_staple_source`("id", "item_id", "staple_group_id", "staple_group_item_id", "contributed_quantity", "contributed_unit_id", "added_at") SELECT "id", "item_id", "staple_group_id", "staple_group_item_id", "contributed_quantity", "contributed_unit_id", "added_at" FROM `shopping_item_staple_source`;--> statement-breakpoint
DROP TABLE `shopping_item_staple_source`;--> statement-breakpoint
ALTER TABLE `__new_shopping_item_staple_source` RENAME TO `shopping_item_staple_source`;--> statement-breakpoint
CREATE INDEX `shopping_item_staple_source_item_idx` ON `shopping_item_staple_source` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_item_staple_source_group_idx` ON `shopping_item_staple_source` (`staple_group_id`);--> statement-breakpoint
CREATE TABLE `__new_staple_group_item` (
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
INSERT INTO `__new_staple_group_item`("id", "group_id", "ingredient_id", "quantity", "unit_id", "note", "sort_order") SELECT "id", "group_id", "ingredient_id", "quantity", "unit_id", "note", "sort_order" FROM `staple_group_item`;--> statement-breakpoint
DROP TABLE `staple_group_item`;--> statement-breakpoint
ALTER TABLE `__new_staple_group_item` RENAME TO `staple_group_item`;--> statement-breakpoint
CREATE UNIQUE INDEX `staple_group_item_unique` ON `staple_group_item` (`group_id`,`ingredient_id`);--> statement-breakpoint
CREATE INDEX `staple_group_item_group_idx` ON `staple_group_item` (`group_id`);--> statement-breakpoint
DROP TABLE `ingredient_sub_unit`;
