-- New table: ingredient-scoped sub-units (Zehe of Knoblauch, Zweig of
-- Petersilie, …). Replaces Zehe / Zweig as global units.
CREATE TABLE `ingredient_sub_unit` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `ingredient_id` integer NOT NULL,
  `name` text NOT NULL,
  `per_purchase` real DEFAULT 1 NOT NULL,
  FOREIGN KEY (`ingredient_id`) REFERENCES `ingredient`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredient_sub_unit_unique` ON `ingredient_sub_unit` (`ingredient_id`, `name`);
--> statement-breakpoint
ALTER TABLE `ingredient` ADD `purchase_unit_id` integer REFERENCES `unit`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `ingredient_alias` ADD `default_sub_unit_id` integer REFERENCES `ingredient_sub_unit`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `recipe_ingredient` ADD `sub_unit_id` integer REFERENCES `ingredient_sub_unit`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
-- Data migration: every (ingredient, unit) combination on recipe_ingredient
-- where unit is "Zehe" or "Zweig" becomes a sub_unit row on that ingredient
-- (per_purchase defaults to 1 — user adjusts via Stammdaten UI). Then point
-- recipe_ingredient at the new sub_unit and clear unit_id.
INSERT OR IGNORE INTO ingredient_sub_unit (ingredient_id, name, per_purchase)
SELECT DISTINCT ri.ingredient_id, u.name, 1
FROM recipe_ingredient ri
JOIN unit u ON u.id = ri.unit_id
WHERE u.name IN ('Zehe', 'Zweig');
--> statement-breakpoint
UPDATE recipe_ingredient
SET sub_unit_id = (
  SELECT isu.id FROM ingredient_sub_unit isu
  JOIN unit u ON u.name = isu.name
  WHERE isu.ingredient_id = recipe_ingredient.ingredient_id
    AND u.id = recipe_ingredient.unit_id
),
    unit_id = NULL
WHERE unit_id IN (SELECT id FROM unit WHERE name IN ('Zehe', 'Zweig'));
--> statement-breakpoint
-- Same migration on ingredient_alias.default_unit_id → default_sub_unit_id.
INSERT OR IGNORE INTO ingredient_sub_unit (ingredient_id, name, per_purchase)
SELECT DISTINCT ia.ingredient_id, u.name, 1
FROM ingredient_alias ia
JOIN unit u ON u.id = ia.default_unit_id
WHERE u.name IN ('Zehe', 'Zweig');
--> statement-breakpoint
UPDATE ingredient_alias
SET default_sub_unit_id = (
  SELECT isu.id FROM ingredient_sub_unit isu
  JOIN unit u ON u.name = isu.name
  WHERE isu.ingredient_id = ingredient_alias.ingredient_id
    AND u.id = ingredient_alias.default_unit_id
),
    default_unit_id = NULL
WHERE default_unit_id IN (SELECT id FROM unit WHERE name IN ('Zehe', 'Zweig'));
--> statement-breakpoint
-- Remove the old global units (their aliases cascade).
DELETE FROM unit WHERE name IN ('Zehe', 'Zweig');
