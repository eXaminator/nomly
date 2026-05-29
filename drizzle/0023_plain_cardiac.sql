ALTER TABLE `ingredient` ADD `default_unit_id` integer REFERENCES unit(id);--> statement-breakpoint
ALTER TABLE `ingredient` ADD `default_sub_unit_id` integer REFERENCES ingredient_sub_unit(id);--> statement-breakpoint
ALTER TABLE `shopping_item_source` ADD `contributed_sub_unit_id` integer REFERENCES ingredient_sub_unit(id);--> statement-breakpoint
ALTER TABLE `shopping_item_staple_source` ADD `contributed_sub_unit_id` integer REFERENCES ingredient_sub_unit(id);--> statement-breakpoint
-- Backfill: re-derive the sub-unit on existing contributions so the live
-- shopping list rolls up correctly the moment this migration lands. Meal
-- sources inherit from their recipe_ingredient; staple sources from their
-- staple_group_item (when still linked).
UPDATE `shopping_item_source`
SET `contributed_sub_unit_id` = (
  SELECT ri.`sub_unit_id` FROM `recipe_ingredient` ri
  WHERE ri.`id` = `shopping_item_source`.`recipe_ingredient_id`
)
WHERE `contributed_sub_unit_id` IS NULL;--> statement-breakpoint
UPDATE `shopping_item_staple_source`
SET `contributed_sub_unit_id` = (
  SELECT sgi.`sub_unit_id` FROM `staple_group_item` sgi
  WHERE sgi.`id` = `shopping_item_staple_source`.`staple_group_item_id`
)
WHERE `staple_group_item_id` IS NOT NULL;