import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { mealPlan, shoppingItemSource } from "../../db/schema.ts";
import {
  collectStapleContributionItemIds,
  deleteStapleSources,
} from "../staples/clear.ts";
import { cleanupOrphanShoppingItems } from "./cleanup.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Number of `shopping_item_source` rows still pointing at this meal — i.e.
 * how many shopping-list items the meal currently contributes to. Used by
 * the planner to decide between the plain "Mahlzeit löschen?" confirm and
 * the shopping-aware three-button variant (§4.3.3).
 */
export function shoppingImpactForMeal(mealPlanId: number): {
  itemCount: number;
} {
  const rows = db
    .select({ itemId: shoppingItemSource.itemId })
    .from(shoppingItemSource)
    .where(eq(shoppingItemSource.mealPlanId, mealPlanId))
    .all();
  const items = new Set(rows.map((r) => r.itemId));
  return { itemCount: items.size };
}

/** "Nur Mahlzeit löschen". Cascade removes `shopping_item_source` rows. */
export function deleteMealOnly(mealPlanId: number): void {
  db.delete(mealPlan).where(eq(mealPlan.id, mealPlanId)).run();
}

/**
 * "Mahlzeit und Zutaten entfernen". Strips this meal's contributions
 * from the shopping list, then deletes the meal plan row itself. Orphan
 * items (no remaining sources, staple sources, manual amounts, or note)
 * are dropped; items with anything else holding them up survive.
 */
export function deleteMealAndIngredients(mealPlanId: number): {
  itemsDeleted: number;
  itemsUpdated: number;
} {
  return db.transaction((tx) => {
    const result = stripMealContributions(tx, mealPlanId);
    tx.delete(mealPlan).where(eq(mealPlan.id, mealPlanId)).run();
    return result;
  });
}

/**
 * Remove one meal's shopping-list contributions but leave the meal_plan
 * row itself untouched. Used by the "Liste leeren" picker so the user
 * can clear a meal's items from the list without un-planning the meal.
 */
export function removeMealFromShoppingList(mealPlanId: number): {
  itemsDeleted: number;
  itemsUpdated: number;
} {
  return db.transaction((tx) => stripMealContributions(tx, mealPlanId));
}

export function stripMealContributions(
  tx: Tx,
  mealPlanId: number,
): { itemsDeleted: number; itemsUpdated: number } {
  const touched = collectMealContributionItemIds(tx, [mealPlanId]);
  deleteMealSources(tx, [mealPlanId]);
  return cleanupOrphanShoppingItems(tx, touched);
}

function collectMealContributionItemIds(
  tx: Tx,
  mealPlanIds: number[],
): number[] {
  if (mealPlanIds.length === 0) return [];
  const rows = tx
    .select({ itemId: shoppingItemSource.itemId })
    .from(shoppingItemSource)
    .where(inArray(shoppingItemSource.mealPlanId, mealPlanIds))
    .all();
  return Array.from(new Set(rows.map((r) => r.itemId)));
}

function deleteMealSources(tx: Tx, mealPlanIds: number[]): void {
  if (mealPlanIds.length === 0) return;
  tx.delete(shoppingItemSource)
    .where(inArray(shoppingItemSource.mealPlanId, mealPlanIds))
    .run();
}

/**
 * Per-source selective clear. Pass meal plan ids and/or staple group ids
 * whose contributions should be subtracted. Both strips run inside a
 * single transaction and share one orphan-cleanup pass at the end.
 */
export function clearShoppingListSelective(input: {
  mealPlanIds: number[];
  stapleGroupIds?: number[];
}): { itemsDeleted: number; itemsUpdated: number } {
  const mealIds = input.mealPlanIds;
  const stapleIds = input.stapleGroupIds ?? [];
  if (mealIds.length === 0 && stapleIds.length === 0) {
    return { itemsDeleted: 0, itemsUpdated: 0 };
  }
  return db.transaction((tx) => {
    const touched = new Set<number>();
    for (const id of collectMealContributionItemIds(tx, mealIds)) {
      touched.add(id);
    }
    for (const id of collectStapleContributionItemIds(tx, stapleIds)) {
      touched.add(id);
    }
    deleteMealSources(tx, mealIds);
    deleteStapleSources(tx, stapleIds);
    return cleanupOrphanShoppingItems(tx, Array.from(touched));
  });
}
