import { eq } from "drizzle-orm";
import type { db } from "../../db/index.ts";
import {
  shoppingItemAmount,
  shoppingItemSource,
  shoppingItemStapleSource,
  shoppingItemStock,
} from "../../db/schema.ts";
import { detachPurchaseFromItem } from "./purchase-record.ts";
import { clearSkipsForItem } from "./skip.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Everything that has to happen when a checked item comes back onto the list
 * within the 24 h grace window (re-added via meals, staples, due-soon or by
 * hand) — besides un-checking the row itself, which each caller does with its
 * own column updates.
 *
 * The checked amount was bought (or deliberately skipped), so the item starts
 * from zero: every contribution that made up the old amount goes — meal and
 * staple sources, manual amounts, the "Auf Lager" line — and only what the
 * caller adds next counts. Without this, re-adding the same meal would show
 * its amount twice. It is exactly what the 24 h sweep does to a checked row,
 * just without losing the row.
 *
 * The purchase the check recorded stays as history (buying cadence, learned
 * store order), detached from the row so the next check records its own.
 * "Gab es hier heute nicht" markers belonged to the old need and go too.
 */
export function resetItemForReactivation(tx: Tx, itemId: number): void {
  tx.delete(shoppingItemSource).where(eq(shoppingItemSource.itemId, itemId)).run();
  tx.delete(shoppingItemStapleSource)
    .where(eq(shoppingItemStapleSource.itemId, itemId))
    .run();
  tx.delete(shoppingItemAmount).where(eq(shoppingItemAmount.itemId, itemId)).run();
  tx.delete(shoppingItemStock).where(eq(shoppingItemStock.itemId, itemId)).run();
  detachPurchaseFromItem(tx, itemId);
  clearSkipsForItem(tx, itemId);
}
