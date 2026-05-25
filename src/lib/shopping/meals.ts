import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { mealPlan, shoppingItemSource } from "../../db/schema.ts";
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
  const affected = tx
    .select({ itemId: shoppingItemSource.itemId })
    .from(shoppingItemSource)
    .where(eq(shoppingItemSource.mealPlanId, mealPlanId))
    .all();
  const itemIds = Array.from(new Set(affected.map((r) => r.itemId)));

  tx.delete(shoppingItemSource)
    .where(eq(shoppingItemSource.mealPlanId, mealPlanId))
    .run();

  return cleanupOrphanShoppingItems(tx, itemIds);
}

/**
 * Per-meal selective clear. Pass meal plan ids whose contributions should
 * be subtracted. The summed effect of one call is reported back so the UI
 * can confirm what happened. (Phase 5 extends this to also accept
 * `stapleGroupIds`.)
 */
export function clearShoppingListSelective(input: {
  mealPlanIds: number[];
}): { itemsDeleted: number; itemsUpdated: number } {
  return db.transaction((tx) => {
    let itemsDeleted = 0;
    let itemsUpdated = 0;
    for (const mealId of input.mealPlanIds) {
      const r = stripMealContributions(tx, mealId);
      itemsDeleted += r.itemsDeleted;
      itemsUpdated += r.itemsUpdated;
    }
    return { itemsDeleted, itemsUpdated };
  });
}
