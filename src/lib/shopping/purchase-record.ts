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
 *
 * `supermarketId` is the store filter that was active at check-off (null when
 * none was); the per-store check-off sequence feeds the learned walking order.
 * The caller must pass an existing store id or null — the column is a real
 * foreign key.
 */
export function recordPurchaseForCheck(
  handle: Db,
  itemId: number,
  ingredientId: number,
  purchasedAt: number,
  supermarketId: number | null = null,
): void {
  handle
    .delete(ingredientPurchase)
    .where(eq(ingredientPurchase.shoppingItemId, itemId))
    .run();
  handle
    .insert(ingredientPurchase)
    .values({ ingredientId, shoppingItemId: itemId, purchasedAt, supermarketId })
    .run();
}

/**
 * Retract the purchase a check created for `itemId`, if any. Used when an
 * item is un-checked — the check was a mistake, so the "bought" event is
 * undone. No-op when the item has no recorded purchase.
 */
export function retractPurchaseForItem(handle: Db, itemId: number): void {
  handle
    .delete(ingredientPurchase)
    .where(eq(ingredientPurchase.shoppingItemId, itemId))
    .run();
}

/**
 * Cut the link between `itemId` and the purchase its check created, keeping
 * the purchase as history. Used when a checked item is reactivated (re-added
 * within the 24 h grace window): the item was bought and is simply needed
 * again — the earlier purchase stays (buying cadence, the store's learned
 * walking order) and the next check records a purchase of its own.
 */
export function detachPurchaseFromItem(handle: Db, itemId: number): void {
  handle
    .update(ingredientPurchase)
    .set({ shoppingItemId: null })
    .where(eq(ingredientPurchase.shoppingItemId, itemId))
    .run();
}
