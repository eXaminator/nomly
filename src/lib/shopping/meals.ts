import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  mealPlan,
  shoppingItem,
  shoppingItemAmount,
  shoppingItemSource,
} from "../../db/schema.ts";

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
 * "Mahlzeit und Zutaten entfernen". The shopping-item amounts are derived
 * from sources at read time, so removing the meal's sources is enough to
 * update displayed quantities — no recomputation of `shopping_item.quantity`
 * needed. We do, however, delete items that:
 *   - have no remaining sources AND
 *   - have no manual quantity / unit / note (i.e. they only existed because
 *     of this meal — manual additions on top of the meal-derived item stay).
 *
 * Manual edits via the editor (which set quantity/unit/note) are preserved
 * because we only delete items where those are still null.
 */
export function deleteMealAndIngredients(mealPlanId: number): {
  itemsDeleted: number;
  itemsUpdated: number;
} {
  return db.transaction((tx) => applyDeleteWithIngredients(tx, mealPlanId));
}

function applyDeleteWithIngredients(
  tx: Tx,
  mealPlanId: number,
): { itemsDeleted: number; itemsUpdated: number } {
  const result = stripMealContributions(tx, mealPlanId);
  tx.delete(mealPlan).where(eq(mealPlan.id, mealPlanId)).run();
  return result;
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

function stripMealContributions(
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

  let itemsDeleted = 0;
  let itemsUpdated = 0;

  for (const itemId of itemIds) {
    const remaining = tx
      .select({ id: shoppingItemSource.id })
      .from(shoppingItemSource)
      .where(eq(shoppingItemSource.itemId, itemId))
      .get();
    if (remaining) {
      tx.update(shoppingItem)
        .set({
          version: sql`${shoppingItem.version} + 1`,
          updatedAt: sql`unixepoch()`,
        })
        .where(eq(shoppingItem.id, itemId))
        .run();
      itemsUpdated += 1;
      continue;
    }
    const item = tx
      .select({ note: shoppingItem.note })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    const manual = tx
      .select({ id: shoppingItemAmount.id })
      .from(shoppingItemAmount)
      .where(eq(shoppingItemAmount.itemId, itemId))
      .limit(1)
      .get();
    if (
      item != null &&
      manual == null &&
      (item.note == null || item.note === "")
    ) {
      tx.delete(shoppingItem).where(eq(shoppingItem.id, itemId)).run();
      itemsDeleted += 1;
    } else {
      tx.update(shoppingItem)
        .set({
          version: sql`${shoppingItem.version} + 1`,
          updatedAt: sql`unixepoch()`,
        })
        .where(eq(shoppingItem.id, itemId))
        .run();
      itemsUpdated += 1;
    }
  }

  return { itemsDeleted, itemsUpdated };
}

/**
 * Per-group selective clear. Pass meal plan ids whose contributions should
 * be subtracted. The summed effect of one call is reported back so the UI
 * can confirm what happened.
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


