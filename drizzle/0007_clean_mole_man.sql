-- Undo the old `defaultMealPortions` silent bump.
--
-- createMeal used to set servings_override = 2 whenever the recipe was
-- authored with servings = 1 (or no value, which defaults to 1). The
-- shopping-list scaling then doubled every ingredient, e.g. a "0,33 cups
-- carrots" line shipped as "0,67 cups" on the list. The bump was a
-- household-of-two convenience, but it masked itself everywhere downstream.
--
-- Reset the override to NULL on plans that match exactly that pattern
-- (recipe.servings = 1 AND override = 2). Plans with a legitimate explicit
-- override (anything other than 2 on a 1-portion recipe, or any override on
-- a multi-portion recipe) stay untouched. A NULL override falls back to
-- recipe.servings at display time.

UPDATE meal_plan
SET servings_override = NULL
WHERE servings_override = 2
  AND EXISTS (
    SELECT 1 FROM recipe r WHERE r.id = meal_plan.recipe_id AND r.servings = 1
  );
