import { inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { shoppingItemStapleSource } from "../../db/schema.ts";
import { cleanupOrphanShoppingItems } from "../shopping/cleanup.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ClearStapleResult = {
  itemsDeleted: number;
  itemsUpdated: number;
};

/**
 * Strip every `shopping_item_staple_source` row for the given groups, then
 * run orphan cleanup on the touched items. Mirrors the meal-clear flow.
 *
 * For callers that also need to strip meal contributions, prefer
 * `clearShoppingListSelective` (in `shopping/meals.ts`) so both strips
 * happen inside the same transaction with a single orphan-cleanup pass.
 */
export function clearStapleGroupsFromList(
  groupIds: number[],
): ClearStapleResult {
  if (groupIds.length === 0) {
    return { itemsDeleted: 0, itemsUpdated: 0 };
  }
  return db.transaction((tx) => {
    const touched = collectStapleContributionItemIds(tx, groupIds);
    deleteStapleSources(tx, groupIds);
    return cleanupOrphanShoppingItems(tx, touched);
  });
}

/** Strip + cleanup inside an existing transaction. Used by tests and by
 *  legacy callers that want the cleanup baked in. */
export function stripStapleContributions(
  tx: Tx,
  groupIds: number[],
): ClearStapleResult {
  if (groupIds.length === 0) {
    return { itemsDeleted: 0, itemsUpdated: 0 };
  }
  const touched = collectStapleContributionItemIds(tx, groupIds);
  deleteStapleSources(tx, groupIds);
  return cleanupOrphanShoppingItems(tx, touched);
}

/** Returns the set of shopping item ids that currently receive a contribution
 *  from any of the passed groups. Pure read — no mutation. */
export function collectStapleContributionItemIds(
  tx: Tx,
  groupIds: number[],
): number[] {
  if (groupIds.length === 0) return [];
  const rows = tx
    .select({ itemId: shoppingItemStapleSource.itemId })
    .from(shoppingItemStapleSource)
    .where(inArray(shoppingItemStapleSource.stapleGroupId, groupIds))
    .all();
  return Array.from(new Set(rows.map((r) => r.itemId)));
}

/** Strip-only (no cleanup). Caller must run cleanupOrphanShoppingItems on
 *  the touched ids when ready. Used by clearShoppingListSelective to batch
 *  the cleanup across meal + staple strips. */
export function deleteStapleSources(tx: Tx, groupIds: number[]): void {
  if (groupIds.length === 0) return;
  tx.delete(shoppingItemStapleSource)
    .where(inArray(shoppingItemStapleSource.stapleGroupId, groupIds))
    .run();
}
