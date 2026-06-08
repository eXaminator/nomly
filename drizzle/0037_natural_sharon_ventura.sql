PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shopping_item_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`meal_plan_id` integer,
	`recipe_ingredient_id` integer,
	`recipe_id` integer,
	`recipe_title` text,
	`meal_date` text,
	`meal_note` text,
	`recipe_notes` text,
	`fixed_amount` integer DEFAULT false NOT NULL,
	`contributed_quantity` real,
	`contributed_unit_id` integer,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipe_ingredient_id`) REFERENCES `recipe_ingredient`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contributed_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_shopping_item_source`("id", "item_id", "meal_plan_id", "recipe_ingredient_id", "contributed_quantity", "contributed_unit_id", "added_at") SELECT "id", "item_id", "meal_plan_id", "recipe_ingredient_id", "contributed_quantity", "contributed_unit_id", "added_at" FROM `shopping_item_source`;--> statement-breakpoint
DROP TABLE `shopping_item_source`;--> statement-breakpoint
ALTER TABLE `__new_shopping_item_source` RENAME TO `shopping_item_source`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `shopping_item_source_item_idx` ON `shopping_item_source` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_item_source_meal_idx` ON `shopping_item_source` (`meal_plan_id`);--> statement-breakpoint
CREATE TABLE `__new_shopping_item_staple_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`staple_group_id` integer,
	`staple_group_item_id` integer,
	`staple_group_name` text,
	`contributed_quantity` real,
	`contributed_unit_id` integer,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `shopping_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`staple_group_id`) REFERENCES `staple_group`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`staple_group_item_id`) REFERENCES `staple_group_item`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contributed_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_shopping_item_staple_source`("id", "item_id", "staple_group_id", "staple_group_item_id", "contributed_quantity", "contributed_unit_id", "added_at") SELECT "id", "item_id", "staple_group_id", "staple_group_item_id", "contributed_quantity", "contributed_unit_id", "added_at" FROM `shopping_item_staple_source`;--> statement-breakpoint
DROP TABLE `shopping_item_staple_source`;--> statement-breakpoint
ALTER TABLE `__new_shopping_item_staple_source` RENAME TO `shopping_item_staple_source`;--> statement-breakpoint
CREATE INDEX `shopping_item_staple_source_item_idx` ON `shopping_item_staple_source` (`item_id`);--> statement-breakpoint
CREATE INDEX `shopping_item_staple_source_group_idx` ON `shopping_item_staple_source` (`staple_group_id`);--> statement-breakpoint
-- Backfill snapshots on existing meal contributions from their still-intact
-- links (every row has valid links pre-migration, so coverage is complete).
UPDATE `shopping_item_source` SET
	`recipe_id` = (SELECT mp.recipe_id FROM `meal_plan` mp WHERE mp.id = `shopping_item_source`.`meal_plan_id`),
	`recipe_title` = (SELECT r.title FROM `meal_plan` mp JOIN `recipe` r ON r.id = mp.recipe_id WHERE mp.id = `shopping_item_source`.`meal_plan_id`),
	`meal_date` = (SELECT mp.date FROM `meal_plan` mp WHERE mp.id = `shopping_item_source`.`meal_plan_id`),
	`meal_note` = (SELECT mp.note FROM `meal_plan` mp WHERE mp.id = `shopping_item_source`.`meal_plan_id`),
	`recipe_notes` = (SELECT ri.notes FROM `recipe_ingredient` ri WHERE ri.id = `shopping_item_source`.`recipe_ingredient_id`),
	`fixed_amount` = COALESCE((SELECT ri.fixed_amount FROM `recipe_ingredient` ri WHERE ri.id = `shopping_item_source`.`recipe_ingredient_id`), 0);--> statement-breakpoint
UPDATE `shopping_item_staple_source` SET
	`staple_group_name` = (SELECT sg.name FROM `staple_group` sg WHERE sg.id = `shopping_item_staple_source`.`staple_group_id`);