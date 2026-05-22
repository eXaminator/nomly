import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  mealPlan,
  shoppingItem,
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
  const affected = tx
    .select({ itemId: shoppingItemSource.itemId })
    .from(shoppingItemSource)
    .where(eq(shoppingItemSource.mealPlanId, mealPlanId))
    .all();
  const itemIds = Array.from(new Set(affected.map((r) => r.itemId)));

  // Drop this meal's contribution rows so the remaining-sources check is
  // accurate.
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
      // Sources survived → the read-side aggregation reflects the new
      // total automatically. Just bump version so clients refetch.
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
    // No source left. Drop the item iff the user hasn't put a manual
    // amount or note on it.
    const item = tx
      .select({
        quantity: shoppingItem.quantity,
        unitId: shoppingItem.unitId,
        note: shoppingItem.note,
      })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    if (
      item != null &&
      item.quantity == null &&
      item.unitId == null &&
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

  tx.delete(mealPlan).where(eq(mealPlan.id, mealPlanId)).run();
  return { itemsDeleted, itemsUpdated };
}

