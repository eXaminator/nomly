import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { shoppingItem } from "../../db/schema.ts";

const GRACE_SECONDS = 24 * 60 * 60;

/**
 * Delete every shopping item that has been checked off for more than 24 h.
 * The cascade on `shopping_item_source` cleans up contribution rows, which
 * is what makes the source meals re-eligible for the "bereits auf der Liste"
 * badge.
 *
 * Returns the ids of removed items so callers (server.mts boot, the hourly
 * interval) can broadcast deletions when WS lands in Epic 9.
 */
export function sweepCheckedItems(nowSeconds = Math.floor(Date.now() / 1000)): {
  deletedIds: number[];
} {
  const cutoff = nowSeconds - GRACE_SECONDS;
  const stale = db
    .select({ id: shoppingItem.id })
    .from(shoppingItem)
    .where(
      and(
        eq(shoppingItem.checked, true),
        isNotNull(shoppingItem.checkedAt),
        lt(shoppingItem.checkedAt, cutoff),
      ),
    )
    .all();
  if (stale.length === 0) return { deletedIds: [] };
  const ids = stale.map((r) => r.id);
  db.delete(shoppingItem)
    .where(
      and(
        eq(shoppingItem.checked, true),
        lt(shoppingItem.checkedAt, cutoff),
      ),
    )
    .run();
  return { deletedIds: ids };
}

export { GRACE_SECONDS as SHOPPING_SWEEP_GRACE_SECONDS };
