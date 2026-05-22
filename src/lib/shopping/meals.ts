import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  mealPlan,
  shoppingItem,
  shoppingItemSource,
} from "../../db/schema.ts";
import { loadUnitsById } from "./units-db.ts";

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
 * "Mahlzeit und Zutaten entfernen". For each `shopping_item` referenced by
 * this meal:
 *   - recompute the quantity from the *remaining* sources (after dropping
 *     this meal's rows) by summing `contributed_quantity` per item in base
 *     units;
 *   - if nothing remains and the item has no unrelated contributions, delete
 *     the item;
 *   - otherwise update `quantity` (keep `unit_id`), bump `version`.
 * Then delete the meal_plan row.
 *
 * Manual edits the user made after adding the meal are lost — flagged as
 * an open question in the spec (§4.3.3).
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

  // Remove this meal's contribution rows first so the remaining-sources
  // computation only sees survivors.
  tx.delete(shoppingItemSource)
    .where(eq(shoppingItemSource.mealPlanId, mealPlanId))
    .run();

  let itemsDeleted = 0;
  let itemsUpdated = 0;

  for (const itemId of itemIds) {
    const remaining = tx
      .select({
        id: shoppingItemSource.id,
        contributedQuantity: shoppingItemSource.contributedQuantity,
        contributedUnitId: shoppingItemSource.contributedUnitId,
      })
      .from(shoppingItemSource)
      .where(eq(shoppingItemSource.itemId, itemId))
      .all();

    if (remaining.length === 0) {
      // Item still exists but has no remaining source — delete it. (Manual
      // items had no source rows to begin with, so they aren't even in
      // `itemIds`.)
      tx.delete(shoppingItem).where(eq(shoppingItem.id, itemId)).run();
      itemsDeleted += 1;
      continue;
    }

    const item = tx
      .select({
        unitId: shoppingItem.unitId,
        quantity: shoppingItem.quantity,
        version: shoppingItem.version,
      })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    if (!item) continue;

    // Sum surviving contributions in base units, format back in the item's
    // current unit (so the displayed unit doesn't flip out from under the
    // user).
    const unitIds = [item.unitId, ...remaining.map((r) => r.contributedUnitId)]
      .filter((x): x is number => x != null);
    const units = loadUnitsById(unitIds);
    const itemFactor =
      item.unitId != null ? units.get(item.unitId)?.factor ?? 1 : 1;
    let allOpenEnded = true;
    let total = 0;
    for (const r of remaining) {
      if (r.contributedQuantity == null) continue;
      allOpenEnded = false;
      const f = r.contributedUnitId != null ? units.get(r.contributedUnitId)?.factor ?? 1 : 1;
      total += r.contributedQuantity * f;
    }

    const nextQty = allOpenEnded ? null : Math.round((total / itemFactor) * 1000) / 1000;

    tx.update(shoppingItem)
      .set({
        quantity: nextQty,
        version: item.version + 1,
        updatedAt: sql`unixepoch()`,
      })
      .where(eq(shoppingItem.id, itemId))
      .run();
    itemsUpdated += 1;
  }

  tx.delete(mealPlan).where(eq(mealPlan.id, mealPlanId)).run();
  return { itemsDeleted, itemsUpdated };
}
