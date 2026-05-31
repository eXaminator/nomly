ALTER TABLE `unit` ADD `is_noun_unit` integer DEFAULT false NOT NULL;--> statement-breakpoint
--> Seed sensible defaults: the sub-unit side (to_unit) of a CONTAINER
--> conversion is a quantity-noun (Zehe, Stange, Bund, Scheibe, …). Density
--> conversions (is_container=0, e.g. ml→g) are excluded so dimensional units
--> stay false. Users can toggle the flag afterwards in the unit Stammdaten.
UPDATE `unit` SET `is_noun_unit` = 1
WHERE `id` IN (
  SELECT DISTINCT `to_unit_id` FROM `ingredient_unit_conversion`
  WHERE `is_container` = 1
);