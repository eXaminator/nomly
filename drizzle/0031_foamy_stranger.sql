ALTER TABLE `ingredient_alias` ADD `display_name` text;--> statement-breakpoint
--> Seed the rename for existing unit-compound aliases: when an alias equals its
--> canonical name + its default unit's name/plural ("Knoblauch" + "Zehe(n)" =
--> "Knoblauchzehe(n)"), pre-fill display_name with the canonical so the row
--> shows "Knoblauch" and the embedded unit isn't repeated. Visible + editable
--> per alias afterwards. Only the solid German-compound case is auto-filled;
--> anything else (e.g. an English "garlic cloves" alias) stays NULL for the
--> user to set explicitly.
UPDATE `ingredient_alias`
SET `display_name` = (
  SELECT `i`.`name` FROM `ingredient` `i` WHERE `i`.`id` = `ingredient_alias`.`ingredient_id`
)
WHERE `default_unit_id` IS NOT NULL
AND EXISTS (
  SELECT 1 FROM `ingredient` `i`, `unit` `u`
  WHERE `i`.`id` = `ingredient_alias`.`ingredient_id`
    AND `u`.`id` = `ingredient_alias`.`default_unit_id`
    AND (
      lower(`ingredient_alias`.`name`) = lower(`i`.`name`) || lower(`u`.`name`)
      OR (`u`.`plural` IS NOT NULL
          AND lower(`ingredient_alias`.`name`) = lower(`i`.`name`) || lower(`u`.`plural`))
    )
);