-- Epic 5 data cleanup: the pre-refactor merge code wrote the summed amount
-- onto `shopping_item.quantity`/`unit_id` and split per (ingredient, dimension)
-- into multiple rows per ingredient. The new model derives display amounts
-- from sources and keeps only one item per ingredient, so:
--   1) collapse duplicate shopping_item rows that share an ingredient_id
--      (move sources to the lowest-id survivor, drop the rest);
--   2) clear the stale manual quantity/unit on items that still have source
--      rows — otherwise the read-time aggregator double-counts them.
-- Items with no sources keep their quantity/unit (those are user-curated
-- manual entries).

UPDATE shopping_item_source
SET item_id = (
  SELECT MIN(si2.id) FROM shopping_item si2
  WHERE si2.ingredient_id = (
    SELECT si.ingredient_id FROM shopping_item si
    WHERE si.id = shopping_item_source.item_id
  )
)
WHERE EXISTS (
  SELECT 1 FROM shopping_item si
  WHERE si.id = shopping_item_source.item_id
    AND si.ingredient_id IS NOT NULL
);
--> statement-breakpoint
DELETE FROM shopping_item
WHERE ingredient_id IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM shopping_item
    WHERE ingredient_id IS NOT NULL
    GROUP BY ingredient_id
  );
--> statement-breakpoint
UPDATE shopping_item
SET quantity = NULL, unit_id = NULL
WHERE id IN (SELECT DISTINCT item_id FROM shopping_item_source);
