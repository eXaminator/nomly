/**
 * Pure helper for the shopping-list supermarket selector: how many
 * still-needed items each supermarket carries. Mirrors the unchecked-item
 * visibility rules in `groupByCategory` (shopping-list-view) so the count a
 * store shows matches what you'd actually see after selecting it.
 *
 * No DB / React — the inputs are plain shapes (ShoppingItemView and
 * SupermarketSummary satisfy them structurally), which keeps it unit-testable.
 */

import { isSkippedToday, localDateIso } from "./local-date.ts";

export type NeededItem = {
  checked: boolean;
  categoryId: number | null;
  unavailableSupermarketIds: number[];
  /** "Gab es hier heute nicht" markers; only today's hide the item. */
  skippedAt?: ReadonlyArray<{ supermarketId: number; on: string }>;
};

export type SupermarketCarry = {
  id: number;
  categories: ReadonlyArray<{ categoryId: number }>;
};

/**
 * Returns a Map of supermarket id → count of unchecked items that store
 * carries. A store carries an item when it isn't marked unavailable there,
 * wasn't skipped there on `today`, and either the item is uncategorized
 * (shows everywhere) or the item's category is in the store's ordering.
 */
export function countNeededItemsPerSupermarket(
  items: ReadonlyArray<NeededItem>,
  supermarkets: ReadonlyArray<SupermarketCarry>,
  today: string = localDateIso(),
): Map<number, number> {
  const counts = new Map<number, number>();
  const carriedById = new Map<number, Set<number>>();
  for (const s of supermarkets) {
    counts.set(s.id, 0);
    carriedById.set(s.id, new Set(s.categories.map((c) => c.categoryId)));
  }

  for (const item of items) {
    if (item.checked) continue;
    const unavailable = new Set(item.unavailableSupermarketIds);
    for (const s of supermarkets) {
      if (unavailable.has(s.id)) continue;
      if (isSkippedToday(item, s.id, today)) continue;
      if (
        item.categoryId != null &&
        !carriedById.get(s.id)!.has(item.categoryId)
      ) {
        continue;
      }
      counts.set(s.id, counts.get(s.id)! + 1);
    }
  }

  return counts;
}
