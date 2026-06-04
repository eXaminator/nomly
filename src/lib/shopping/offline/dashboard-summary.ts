import { openOfflineDb } from "./db";
import {
  computeShoppingSummary,
  type ShoppingSummary,
} from "@/lib/shopping/shopping-summary";

/**
 * Shopping summary from the offline store, for the dashboard card while not
 * online. The `items` store already carries optimistic offline toggles, so
 * the result reflects what the user checked off offline.
 *
 * Returns null when IDB holds no shopping truth yet (this device never loaded
 * /einkauf) or on any failure — the caller keeps the server-rendered snapshot
 * in that case. Errors are deliberately swallowed: a broken IDB must degrade
 * to "no overlay", never break the dashboard.
 */
export async function readOfflineShoppingSummary(): Promise<ShoppingSummary | null> {
  try {
    const db = await openOfflineDb();
    const seeded = await db.get("meta", "shoppingFetchedAt");
    if (!seeded) return null;
    const [items, supermarkets] = await Promise.all([
      db.getAll("items"),
      db.getAll("supermarkets"),
    ]);
    return computeShoppingSummary(items, supermarkets);
  } catch {
    return null;
  }
}
