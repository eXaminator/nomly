import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { mealPlan } from "../../db/schema.ts";
import { previewMeals } from "../shopping/preview.ts";
import { getPlannerSettings } from "../settings/planner.ts";
import { addDays } from "./dates.ts";

export type UpcomingUse = {
  mealPlanId: number;
  date: string;
  recipeId: number;
  recipeTitle: string;
  qty: number | null;
  unitName: string | null;
  notes: string | null;
  isOptional: boolean;
  alternativeForId: number | null;
};

export type UpcomingIngredientUses = {
  mealDate: string;
  daysVisible: number;
  byIngredientId: Record<number, UpcomingUse[]>;
};

export type UpcomingIngredientUsesResult =
  | { ok: true; data: UpcomingIngredientUses }
  | { ok: false; reason: "not-found" };

export function getUpcomingIngredientUses(
  mealPlanId: number,
): UpcomingIngredientUsesResult {
  const row = db
    .select({ date: mealPlan.date })
    .from(mealPlan)
    .where(eq(mealPlan.id, mealPlanId))
    .get();
  if (!row) return { ok: false, reason: "not-found" };

  const { daysVisible } = getPlannerSettings();
  const start = addDays(row.date, 1);
  const meals = previewMeals(start, daysVisible);

  const byIngredientId: Record<number, UpcomingUse[]> = {};
  for (const meal of meals) {
    // Defensive: the window starts at mealDate+1 so the source meal can't
    // appear here, but excluding by id keeps the invariant explicit.
    if (meal.mealPlanId === mealPlanId) continue;
    for (const section of meal.sections) {
      for (const ing of section.ingredients) {
        const list = byIngredientId[ing.ingredientId] ?? [];
        list.push({
          mealPlanId: meal.mealPlanId,
          date: meal.date,
          recipeId: meal.recipeId,
          recipeTitle: meal.recipeTitle,
          qty: ing.qty,
          unitName: ing.unitName,
          notes: ing.notes,
          isOptional: ing.isOptional,
          alternativeForId: ing.alternativeForId,
        });
        byIngredientId[ing.ingredientId] = list;
      }
    }
  }

  return {
    ok: true,
    data: { mealDate: row.date, daysVisible, byIngredientId },
  };
}
