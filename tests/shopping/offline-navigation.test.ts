import { describe, expect, it, beforeEach } from "vitest";
import {
  resetOfflineDbForTests,
  openOfflineDb,
} from "@/lib/shopping/offline/db";
import {
  hydrateFromIDB,
  toggleItemOptimistic,
} from "@/lib/shopping/offline/store";
import type { ShoppingItemView } from "@/lib/shopping/items";

function makeItem(over: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: 1, refType: "ingredient", refId: 1, name: "Mehl",
    amounts: [], categoryId: null, categoryName: null,
    checked: false, checkedAt: null, note: null,
    sortOrder: 0, version: 1, createdAt: 0, updatedAt: 0,
    unavailableSupermarketIds: [], sources: [], stapleSources: [], manualAmounts: [],
    defaultUnitId: null, defaultUnitName: null,
    ...over,
  };
}

describe("offline navigation regression — IDB survives the cached shell mount", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("does not wipe IDB when the page mounts with an empty initialItems (offline shell case)", async () => {
    // Simulate a previous online visit that populated IDB.
    await hydrateFromIDB([
      makeItem({ id: 1, name: "Mehl" }),
      makeItem({ id: 2, name: "Salz" }),
      makeItem({ id: 3, name: "Zucker" }),
    ]);

    // Simulate the user toggling one item while offline.
    await toggleItemOptimistic(2, true);

    // Now the user navigates to /einkauf via the SW-cached data-less shell.
    // initialItems === [] because the cached shell carried no data.
    const merged = await hydrateFromIDB([]);

    expect(merged).toHaveLength(3);
    expect(merged.find((i) => i.id === 2)?.checked).toBe(true);

    // IDB still holds all three rows and the queued mutation.
    const db = await openOfflineDb();
    expect(await db.getAll("items")).toHaveLength(3);
    expect(await db.getAll("mutationQueue")).toHaveLength(1);
  });

  it("does not wipe IDB when the page mounts with null initialItems", async () => {
    await hydrateFromIDB([makeItem({ id: 1 }), makeItem({ id: 2 })]);
    const merged = await hydrateFromIDB(null);
    expect(merged).toHaveLength(2);
  });
});
