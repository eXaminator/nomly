/**
 * How a recipe-ingredient row renders once a specific meal's shopping
 * decision is known (the recipe opened with `?meal=<id>`).
 *
 * Alternatives exist so the cook can pick one — and the shopping list records
 * which one they picked, as `shopping_item_source.recipe_ingredient_id` for
 * that meal (see getMealShoppingChoices). Replaying that decision turns a
 * "one of these" list into "this one": the picked row reads normally, the
 * ones passed over fade back.
 *
 *   "chosen"  — this meal put the row on the shopping list. Un-dimmed and
 *               emphasized, even when it's an alternative (which would
 *               otherwise render faded).
 *   "muted"   — a sibling was picked instead. Faded harder than the default
 *               optional dimming so the contrast with "chosen" is obvious.
 *   "default" — no decision applies: no meal in context, the meal never
 *               reached the list, or the group has nothing to choose between.
 */
export type MealEmphasis = "chosen" | "muted" | "default";

/** Anything carrying a recipe_ingredient id — the recipe view's rows and the
 *  mention builder's rows both qualify. */
export type EmphasisRow = { id: number };

/**
 * Emphasis for `row` within its alternative group.
 *
 * A group is only "decided" when it actually offers a choice (more than one
 * member) AND this meal put at least one member on the list. A single-row
 * group is never muted — there was nothing to pick between, so fading it
 * would just read as "not needed". Likewise a meal that was never added to
 * the shopping list leaves every row at its default treatment rather than
 * muting the whole recipe.
 *
 * Shared by the ingredient list and the instruction-mention tooltip so the
 * two can't drift apart on what "chosen" means.
 *
 * Note the link is soft: `shopping_item_source.recipe_ingredient_id` is set
 * to NULL when the recipe is edited (which recreates the rows), so an edit
 * after shopping silently falls back to "default" for the whole group.
 */
export function mealEmphasisFor(
  row: EmphasisRow,
  members: readonly EmphasisRow[],
  chosenIngredientIds: ReadonlySet<number> | undefined,
): MealEmphasis {
  if (chosenIngredientIds == null || members.length < 2) return "default";
  if (!members.some((m) => chosenIngredientIds.has(m.id))) return "default";
  return chosenIngredientIds.has(row.id) ? "chosen" : "muted";
}
