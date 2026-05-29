import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { shoppingItem } from "../../db/schema.ts";
import { resolveByName } from "../shopping/byName.ts";
import { previewMeals } from "../shopping/preview.ts";
import { getPlannerSettings } from "../settings/planner.ts";
import { todayIso } from "../meal-plans/dates.ts";

export type IngredientUsageMeal = {
  mealPlanId: number;
  date: string;
  recipeId: number;
  recipeTitle: string;
};

/**
 * Answers "do we need <name> for anything else?" — used by the Home Assistant
 * voice intent. Resolves a free-text name, then reports the upcoming planned
 * meals (today onward, within the planner window) whose recipes use that
 * ingredient and whether it's currently on the shopping list (unchecked).
 */
export type IngredientUsageResult = {
  /** "match" = resolved to one ingredient; "ambiguous" = several; "none" = unknown. */
  match: "match" | "ambiguous" | "none";
  ingredient: { id: number; name: string } | null;
  /** Populated only when `match` is "ambiguous". */
  candidates: { id: number; name: string }[];
  onShoppingList: boolean;
  upcomingMeals: IngredientUsageMeal[];
};

export function getIngredientUsageByName(rawName: string): IngredientUsageResult {
  const empty = {
    ingredient: null,
    candidates: [] as { id: number; name: string }[],
    onShoppingList: false,
    upcomingMeals: [] as IngredientUsageMeal[],
  };

  const resolved = resolveByName(rawName);
  if (resolved.mode === "none") {
    return { match: "none", ...empty };
  }
  if (resolved.mode === "ambiguous") {
    return {
      match: "ambiguous",
      ...empty,
      candidates: resolved.candidates.map((c) => ({ id: c.id, name: c.name })),
    };
  }

  const { id, name } = resolved.candidate;

  const { daysVisible } = getPlannerSettings();
  const meals = previewMeals(todayIso(), daysVisible);
  const upcomingMeals: IngredientUsageMeal[] = [];
  for (const meal of meals) {
    const uses = meal.sections.some((section) =>
      section.ingredients.some((ing) => ing.ingredientId === id),
    );
    if (uses) {
      upcomingMeals.push({
        mealPlanId: meal.mealPlanId,
        date: meal.date,
        recipeId: meal.recipeId,
        recipeTitle: meal.recipeTitle,
      });
    }
  }

  const onList = db
    .select({ id: shoppingItem.id })
    .from(shoppingItem)
    .where(and(eq(shoppingItem.ingredientId, id), eq(shoppingItem.checked, false)))
    .get();

  return {
    match: "match",
    ingredient: { id, name },
    candidates: [],
    onShoppingList: onList != null,
    upcomingMeals,
  };
}
