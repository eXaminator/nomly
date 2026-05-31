ALTER TABLE `ingredient` ADD `grams_per_ml` real;--> statement-breakpoint
ALTER TABLE `ingredient_sub_unit` ADD `parent_unit_id` integer REFERENCES unit(id);--> statement-breakpoint
ALTER TABLE `ingredient_sub_unit` ADD `parent_amount` real DEFAULT 1 NOT NULL;--> statement-breakpoint
--> Backfill the new per-custom-unit parent from the old ingredient-level
--> purchase unit + per_purchase. The parent is the ingredient's purchase
--> unit when set; otherwise, when `per_purchase > 1`, default it to the
--> global "Stück" unit so a dormant count relationship ("1 Stück = 10 Zehen"
--> for Knoblauch, where no explicit purchase unit was ever configured)
--> materializes as a real conversion. `per_purchase <= 1` with no purchase
--> unit stays standalone (e.g. "Stange" Zimt). amount = per_purchase (custom
--> units per parent). Runs before 0028 drops the old columns.
UPDATE `ingredient_sub_unit`
SET
  `parent_unit_id` = COALESCE(
    (SELECT `i`.`purchase_unit_id` FROM `ingredient` `i`
     WHERE `i`.`id` = `ingredient_sub_unit`.`ingredient_id`),
    CASE WHEN `per_purchase` > 1
      THEN (SELECT `id` FROM `unit` WHERE lower(`name`) = 'stück')
    END
  ),
  `parent_amount` = CASE
    WHEN `per_purchase` > 0
      AND COALESCE(
        (SELECT `i`.`purchase_unit_id` FROM `ingredient` `i`
         WHERE `i`.`id` = `ingredient_sub_unit`.`ingredient_id`),
        CASE WHEN `per_purchase` > 1
          THEN (SELECT `id` FROM `unit` WHERE lower(`name`) = 'stück')
        END
      ) IS NOT NULL
    THEN `per_purchase`
    ELSE 1
  END;