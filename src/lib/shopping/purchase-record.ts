import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredientPurchase } from "../../db/schema.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Either the top-level `db` or a transaction handle — both expose the same
 *  query builder surface used here. */
type Db = typeof db | Tx;

/**
 * Record that the shopping item `itemId` (for `ingredientId`) was checked off
 * — i.e. bought — at `purchasedAt` (unix seconds). Idempotent per item: any
 * purchase previously recorded for this item is replaced, so a repeated
 * check (offline replay, double toggle) never double-counts.
 *
 * The `shopping_item_id` link is soft (see the table note in schema.ts): the
 * item may be swept/cleared later while this purchase row lives on as history.
 */
export function recordPurchaseForCheck(
  handle: Db,
  itemId: number,
  ingredientId: number,
  purchasedAt: number,
): void {
  handle
    .delete(ingredientPurchase)
    .where(eq(ingredientPurchase.shoppingItemId, itemId))
    .run();
  handle
    .insert(ingredientPurchase)
    .values({ ingredientId, shoppingItemId: itemId, purchasedAt })
    .run();
}

/**
 * Retract the purchase a check created for `itemId`, if any. Used when an
 * item is un-checked or reactivated (re-added to the list within the 24 h
 * grace window) — the "bought" event is undone. No-op when the item has no
 * recorded purchase.
 */
export function retractPurchaseForItem(handle: Db, itemId: number): void {
  handle
    .delete(ingredientPurchase)
    .where(eq(ingredientPurchase.shoppingItemId, itemId))
    .run();
}
