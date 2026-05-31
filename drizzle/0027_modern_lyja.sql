ALTER TABLE `ingredient` ADD `grams_per_ml` real;--> statement-breakpoint
ALTER TABLE `ingredient_sub_unit` ADD `parent_unit_id` integer REFERENCES unit(id);--> statement-breakpoint
ALTER TABLE `ingredient_sub_unit` ADD `parent_amount` real DEFAULT 1 NOT NULL;--> statement-breakpoint
--> Backfill the new per-custom-unit parent from the old ingredient-level
--> purchase unit + per_purchase, preserving today's shopping rollup exactly:
--> parent = the ingredient's purchase unit (NULL -> standalone, as before),
--> amount = per_purchase (custom units per parent, e.g. "1 Stueck = 10 Zehen").
--> Runs before 0028 drops the old columns.
UPDATE `ingredient_sub_unit`
SET
  `parent_unit_id` = (
    SELECT `i`.`purchase_unit_id` FROM `ingredient` `i`
    WHERE `i`.`id` = `ingredient_sub_unit`.`ingredient_id`
  ),
  `parent_amount` = CASE
    WHEN `per_purchase` > 0
      AND (
        SELECT `i`.`purchase_unit_id` FROM `ingredient` `i`
        WHERE `i`.`id` = `ingredient_sub_unit`.`ingredient_id`
      ) IS NOT NULL
    THEN `per_purchase`
    ELSE 1
  END;