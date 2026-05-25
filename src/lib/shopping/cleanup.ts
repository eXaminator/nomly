import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  shoppingItem,
  shoppingItemAmount,
  shoppingItemSource,
  shoppingItemStapleSource,
} from "../../db/schema.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CleanupResult = {
  itemsDeleted: number;
  itemsUpdated: number;
};

/**
 * Garbage-collect shopping items that no longer have anything holding them
 * up. For each candidate id, delete the row when it has:
 *   - no shopping_item_source rows AND
 *   - no shopping_item_staple_source rows AND
 *   - no shopping_item_amount rows AND
 *   - no manual note (null or empty).
 *
 * Items that survive get a version bump + updatedAt touch so subscribers
 * notice the contribution change. Items not in the candidate list are
 * untouched — this is not a sweeper.
 */
export function cleanupOrphanShoppingItems(
  tx: Tx,
  candidateItemIds: number[],
): CleanupResult {
  if (candidateItemIds.length === 0) {
    return { itemsDeleted: 0, itemsUpdated: 0 };
  }
  const unique = Array.from(new Set(candidateItemIds));
  let itemsDeleted = 0;
  let itemsUpdated = 0;
  for (const itemId of unique) {
    const item = tx
      .select({ note: shoppingItem.note })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, itemId))
      .get();
    if (!item) continue;

    const hasMealSource = tx
      .select({ id: shoppingItemSource.id })
      .from(shoppingItemSource)
      .where(eq(shoppingItemSource.itemId, itemId))
      .limit(1)
      .get();
    const hasStapleSource = tx
      .select({ id: shoppingItemStapleSource.id })
      .from(shoppingItemStapleSource)
      .where(eq(shoppingItemStapleSource.itemId, itemId))
      .limit(1)
      .get();
    const hasAmount = tx
      .select({ id: shoppingItemAmount.id })
      .from(shoppingItemAmount)
      .where(eq(shoppingItemAmount.itemId, itemId))
      .limit(1)
      .get();
    const hasNote = item.note != null && item.note !== "";

    if (!hasMealSource && !hasStapleSource && !hasAmount && !hasNote) {
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

