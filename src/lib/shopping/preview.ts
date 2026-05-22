import { asc, between, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredient,
  mealPlan,
  recipe,
  recipeIngredient,
  recipeSection,
  shoppingItemSource,
  unit,
} from "../../db/schema.ts";
import { addDays } from "../meal-plans/dates.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(d: string): void {
  if (!ISO_DATE.test(d)) {
    throw new Error(`invalid ISO date: ${d}`);
  }
}

export type PreviewIngredient = {
  recipeIngredientId: number;
  ingredientId: number;
  ingredientName: string;
  qty: number | null;
  unitId: number | null;
  unitName: string | null;
  notes: string | null;
};

export type PreviewMeal = {
  mealPlanId: number;
  date: string;
  recipeId: number;
  recipeTitle: string;
  servings: number;
  alreadyOnList: boolean;
  ingredients: PreviewIngredient[];
};

/**
 * Build the "Mahlzeiten hinzufügen" dialog payload per spec §4.3.1.
 * - meals in [start, start + lengthDays - 1]
 * - ingredient quantities scaled by `servings_override / recipe.servings`
 * - drop ingredients flagged `exclude_from_shopping_list`
 * - drop optional ingredients (spec: "the shopping-list builder skips them")
 * - drop meals that end up with zero remaining lines
 * - alreadyOnList = true when a `shopping_item_source` row still references
 *   the meal (transitively → item still exists, since FK is ON DELETE CASCADE)
 */
export function previewMeals(start: string, lengthDays: number): PreviewMeal[] {
  assertIsoDate(start);
  if (!Number.isInteger(lengthDays) || lengthDays < 1 || lengthDays > 60) {
    throw new Error(`lengthDays out of range: ${lengthDays}`);
  }
  const end = addDays(start, lengthDays - 1);

  const meals = db
    .select({
      mealPlanId: mealPlan.id,
      date: mealPlan.date,
      servingsOverride: mealPlan.servingsOverride,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      recipeServings: recipe.servings,
    })
    .from(mealPlan)
    .innerJoin(recipe, eq(recipe.id, mealPlan.recipeId))
    .where(between(mealPlan.date, start, end))
    .orderBy(asc(mealPlan.date), asc(mealPlan.sortOrder))
    .all();

  if (meals.length === 0) return [];

  const recipeIds = Array.from(new Set(meals.map((m) => m.recipeId)));
  const lines = db
    .select({
      recipeId: recipeSection.recipeId,
      recipeIngredientId: recipeIngredient.id,
      ingredientId: recipeIngredient.ingredientId,
      ingredientName: ingredient.name,
      qty: recipeIngredient.quantity,
      unitId: recipeIngredient.unitId,
      unitName: unit.name,
      notes: recipeIngredient.notes,
      isOptional: recipeIngredient.isOptional,
      excludeFromShoppingList: ingredient.excludeFromShoppingList,
    })
    .from(recipeIngredient)
    .innerJoin(recipeSection, eq(recipeSection.id, recipeIngredient.sectionId))
    .innerJoin(ingredient, eq(ingredient.id, recipeIngredient.ingredientId))
    .leftJoin(unit, eq(unit.id, recipeIngredient.unitId))
    .where(inArray(recipeSection.recipeId, recipeIds))
    .orderBy(asc(recipeIngredient.sortOrder))
    .all();

  const linesByRecipe = new Map<number, typeof lines>();
  for (const l of lines) {
    if (l.isOptional || l.excludeFromShoppingList) continue;
    const arr = linesByRecipe.get(l.recipeId) ?? [];
    arr.push(l);
    linesByRecipe.set(l.recipeId, arr);
  }

  const mealPlanIds = meals.map((m) => m.mealPlanId);
  const sourceHits = mealPlanIds.length
    ? db
        .select({
          mealPlanId: shoppingItemSource.mealPlanId,
          count: sql<number>`COUNT(*)`,
        })
        .from(shoppingItemSource)
        .where(inArray(shoppingItemSource.mealPlanId, mealPlanIds))
        .groupBy(shoppingItemSource.mealPlanId)
        .all()
    : [];
  const alreadyOnList = new Set(
    sourceHits.filter((r) => Number(r.count) > 0).map((r) => r.mealPlanId),
  );

  const out: PreviewMeal[] = [];
  for (const m of meals) {
    const recipeLines = linesByRecipe.get(m.recipeId) ?? [];
    if (recipeLines.length === 0) continue;
    const servings = m.servingsOverride ?? m.recipeServings;
    const scale = m.recipeServings > 0 ? servings / m.recipeServings : 1;
    const ingredients: PreviewIngredient[] = recipeLines.map((l) => ({
      recipeIngredientId: l.recipeIngredientId,
      ingredientId: l.ingredientId,
      ingredientName: l.ingredientName,
      qty: l.qty == null ? null : l.qty * scale,
      unitId: l.unitId,
      unitName: l.unitName,
      notes: l.notes,
    }));
    out.push({
      mealPlanId: m.mealPlanId,
      date: m.date,
      recipeId: m.recipeId,
      recipeTitle: m.recipeTitle,
      servings,
      alreadyOnList: alreadyOnList.has(m.mealPlanId),
      ingredients,
    });
  }

  return out;
}

export function isSourceLinkedToMeal(mealPlanId: number): boolean {
  const row = db
    .select({ id: shoppingItemSource.id })
    .from(shoppingItemSource)
    .where(eq(shoppingItemSource.mealPlanId, mealPlanId))
    .limit(1)
    .get();
  return row != null;
}

export function _internal_assertIsoDate(d: string): void {
  assertIsoDate(d);
}
