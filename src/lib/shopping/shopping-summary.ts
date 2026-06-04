import {
  countNeededItemsPerSupermarket,
  type NeededItem,
  type SupermarketCarry,
} from "./supermarket-availability";

export type SummarySupermarket = SupermarketCarry & { name: string };

export type StoreSummary = { id: number; name: string; count: number };

export type ShoppingSummary = { openCount: number; stores: StoreSummary[] };

/**
 * Open-item count + per-store needed counts for the dashboard's shopping
 * card. Pure (no DB/React) so the server page and the offline IDB overlay
 * compute identical results. Stores with nothing to buy are hidden; sorted
 * by count desc, then German name order.
 */
export function computeShoppingSummary(
  items: ReadonlyArray<NeededItem>,
  supermarkets: ReadonlyArray<SummarySupermarket>,
): ShoppingSummary {
  const openCount = items.filter((i) => !i.checked).length;
  const counts = countNeededItemsPerSupermarket(items, supermarkets);
  const stores = supermarkets
    .map((s) => ({ id: s.id, name: s.name, count: counts.get(s.id) ?? 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de"));
  return { openCount, stores };
}
