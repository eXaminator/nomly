import { listShoppingItems } from "./items.ts";
import { countNeededItemsPerSupermarket } from "./supermarket-availability.ts";
import { todayIso } from "../meal-plans/dates.ts";
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

  // Skip markers are stamped with the device's local day; the server's local
  // day is the best stand-in here (both live in the same household).
  const counts = countNeededItemsPerSupermarket(items, supermarkets, todayIso());
  return supermarkets.map((s) => ({
    id: s.id,
    name: s.name,
    neededCount: counts.get(s.id) ?? 0,
  }));
}
