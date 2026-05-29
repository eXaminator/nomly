import { listShoppingItems } from "./items.ts";
import { countNeededItemsPerSupermarket } from "./supermarket-availability.ts";
import {
  getSupermarketDetail,
  listSupermarkets,
} from "../stammdaten/supermarket/service.ts";

export type StoreAvailability = {
  id: number;
  name: string;
  /** Unchecked items currently on the list that this store carries. */
  neededCount: number;
};

/**
 * Per-supermarket count of still-needed items, for the Home Assistant geofence
 * automation: it only fires the "you're at <store>" notification when that
 * store's `neededCount > 0`. Mirrors the list's own visibility rules via
 * `countNeededItemsPerSupermarket`.
 */
export function getStoreAvailability(): StoreAvailability[] {
  const items = listShoppingItems();
  const supermarkets = listSupermarkets()
    .map((s) => getSupermarketDetail(s.id))
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => ({
      id: s.id,
      name: s.name,
      categories: s.orderedCategories.map((c) => ({ categoryId: c.categoryId })),
    }));

  const counts = countNeededItemsPerSupermarket(items, supermarkets);
  return supermarkets.map((s) => ({
    id: s.id,
    name: s.name,
    neededCount: counts.get(s.id) ?? 0,
  }));
}
