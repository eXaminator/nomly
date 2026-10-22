import { and, eq, lt } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { shoppingItem, shoppingItemSkip, supermarket } from "../../db/schema.ts";
import { localDateIso } from "./local-date.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = typeof db | Tx;

export type MarkSkippedResult = "ok" | "item-not-found" | "store-not-found";

/**
 * Mark the list entry `itemId` as "gab es hier heute nicht" at
 * `supermarketId` for the calendar day `skippedOn` (ISO date, the device's
 * local day). Re-marking overwrites the day, so one row per (item, store).
 * The caller validates `skippedOn` as an ISO date.
 */
export function markSkipped(
  itemId: number,
  supermarketId: number,
  skippedOn: string,
): MarkSkippedResult {
  const item = db
    .select({ id: shoppingItem.id })
    .from(shoppingItem)
    .where(eq(shoppingItem.id, itemId))
    .get();
  if (!item) return "item-not-found";
  const store = db
    .select({ id: supermarket.id })
    .from(supermarket)
    .where(eq(supermarket.id, supermarketId))
    .get();
  if (!store) return "store-not-found";
  db.insert(shoppingItemSkip)
    .values({ shoppingItemId: itemId, supermarketId, skippedOn })
    .onConflictDoUpdate({
      target: [shoppingItemSkip.shoppingItemId, shoppingItemSkip.supermarketId],
      set: { skippedOn },
    })
    .run();
  return "ok";
}

/** Lift the skip marker of `itemId` at `supermarketId`, if any. */
export function unmarkSkipped(itemId: number, supermarketId: number): void {
  db.delete(shoppingItemSkip)
    .where(
      and(
        eq(shoppingItemSkip.shoppingItemId, itemId),
        eq(shoppingItemSkip.supermarketId, supermarketId),
      ),
    )
    .run();
}

/**
 * Drop every skip marker of `itemId`. Used when a checked item is reactivated
 * (re-added within the grace window): it is a fresh need, so yesterday's —
 * or this morning's — "not here" no longer applies.
 */
export function clearSkipsForItem(handle: Db, itemId: number): void {
  handle
    .delete(shoppingItemSkip)
    .where(eq(shoppingItemSkip.shoppingItemId, itemId))
    .run();
}

/**
 * Delete markers older than yesterday (server-local). A marker only hides its
 * item on the day it was set, so anything before today is inert; we keep
 * yesterday's as slack for devices whose local day runs behind the server's.
 */
export function purgeExpiredSkips(
  nowSeconds = Math.floor(Date.now() / 1000),
): number {
  const cutoff = localDateIso(new Date((nowSeconds - 24 * 60 * 60) * 1000));
  const res = db
    .delete(shoppingItemSkip)
    .where(lt(shoppingItemSkip.skippedOn, cutoff))
    .run();
  return res.changes;
}
