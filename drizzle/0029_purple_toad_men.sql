CREATE TABLE `ingredient_unit_conversion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ingredient_id` integer NOT NULL,
	`from_unit_id` integer NOT NULL,
	`to_unit_id` integer NOT NULL,
	`factor` real NOT NULL,
	`is_container` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_unit_id`) REFERENCES `unit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_unit_conversion_unique` ON `ingredient_unit_conversion` (`ingredient_id`,`from_unit_id`,`to_unit_id`);--> statement-breakpoint
--> Promote each distinct sub-unit name to a global unit (dimension count),
--> reusing an existing unit with that name; carry the plural.
INSERT INTO `unit` (`name`, `plural`, `dimension`, `factor`, `is_container`)
SELECT MIN(su.`name`), MAX(su.`plural`), 'count', 1, 0
FROM `ingredient_sub_unit` su
WHERE NOT EXISTS (SELECT 1 FROM `unit` u WHERE lower(u.`name`) = lower(su.`name`))
GROUP BY lower(su.`name`);--> statement-breakpoint
--> Repoint recipe lines from the sub-unit to its promoted global unit.
UPDATE `recipe_ingredient`
SET `unit_id` = (
  SELECT u.`id` FROM `ingredient_sub_unit` su
  JOIN `unit` u ON lower(u.`name`) = lower(su.`name`)
  WHERE su.`id` = `recipe_ingredient`.`sub_unit_id`
)
WHERE `sub_unit_id` IS NOT NULL;--> statement-breakpoint
--> Repoint canonical-name + alias default sub-units to the promoted unit.
UPDATE `ingredient`
SET `default_unit_id` = (
  SELECT u.`id` FROM `ingredient_sub_unit` su
  JOIN `unit` u ON lower(u.`name`) = lower(su.`name`)
  WHERE su.`id` = `ingredient`.`default_sub_unit_id`
)
WHERE `default_sub_unit_id` IS NOT NULL;--> statement-breakpoint
UPDATE `ingredient_alias`
SET `default_unit_id` = (
  SELECT u.`id` FROM `ingredient_sub_unit` su
  JOIN `unit` u ON lower(u.`name`) = lower(su.`name`)
  WHERE su.`id` = `ingredient_alias`.`default_sub_unit_id`
)
WHERE `default_sub_unit_id` IS NOT NULL;--> statement-breakpoint
--> Each sub-unit with a parent becomes a container conversion
--> "1 parent = parent_amount sub" (from = container/parent, to = promoted sub).
INSERT OR IGNORE INTO `ingredient_unit_conversion`
  (`ingredient_id`, `from_unit_id`, `to_unit_id`, `factor`, `is_container`)
SELECT su.`ingredient_id`, su.`parent_unit_id`, u.`id`, su.`parent_amount`, 1
FROM `ingredient_sub_unit` su
JOIN `unit` u ON lower(u.`name`) = lower(su.`name`)
WHERE su.`parent_unit_id` IS NOT NULL AND su.`parent_amount` > 0;--> statement-breakpoint
--> Each ingredient density (g/ml) becomes a normalization conversion 1 ml = d g.
INSERT OR IGNORE INTO `ingredient_unit_conversion`
  (`ingredient_id`, `from_unit_id`, `to_unit_id`, `factor`, `is_container`)
SELECT i.`id`,
  (SELECT `id` FROM `unit` WHERE lower(`name`) = 'ml'),
  (SELECT `id` FROM `unit` WHERE lower(`name`) = 'g'),
  i.`grams_per_ml`, 0
FROM `ingredient` i
WHERE i.`grams_per_ml` IS NOT NULL
  AND (SELECT `id` FROM `unit` WHERE lower(`name`) = 'ml') IS NOT NULL
  AND (SELECT `id` FROM `unit` WHERE lower(`name`) = 'g') IS NOT NULL;
--> statement-breakpoint
--> Repoint persisted shopping-list source contributions from the sub-unit to
--> its promoted global unit (sub-units are going away).
UPDATE `shopping_item_source`
SET `contributed_unit_id` = (
  SELECT u.`id` FROM `ingredient_sub_unit` su
  JOIN `unit` u ON lower(u.`name`) = lower(su.`name`)
  WHERE su.`id` = `shopping_item_source`.`contributed_sub_unit_id`
)
WHERE `contributed_sub_unit_id` IS NOT NULL;--> statement-breakpoint
UPDATE `shopping_item_staple_source`
SET `contributed_unit_id` = (
  SELECT u.`id` FROM `ingredient_sub_unit` su
  JOIN `unit` u ON lower(u.`name`) = lower(su.`name`)
  WHERE su.`id` = `shopping_item_staple_source`.`contributed_sub_unit_id`
)
WHERE `contributed_sub_unit_id` IS NOT NULL;
--> statement-breakpoint
--> Repoint staple-group items from the sub-unit to its promoted global unit.
UPDATE `staple_group_item`
SET `unit_id` = (
  SELECT u.`id` FROM `ingredient_sub_unit` su
  JOIN `unit` u ON lower(u.`name`) = lower(su.`name`)
  WHERE su.`id` = `staple_group_item`.`sub_unit_id`
)
WHERE `sub_unit_id` IS NOT NULL;
