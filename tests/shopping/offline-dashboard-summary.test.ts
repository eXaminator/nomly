import { describe, expect, it, beforeEach } from "vitest";
import { resetOfflineDbForTests, openOfflineDb } from "@/lib/shopping/offline/db";
import { readOfflineShoppingSummary } from "@/lib/shopping/offline/dashboard-summary";
import type { ShoppingItemView } from "@/lib/shopping/items";

function makeItem(over: Partial<ShoppingItemView> = {}): ShoppingItemView {
  return {
    id: 1, refType: "ingredient", refId: 1, name: "Mehl",
    amounts: [], categoryId: null, categoryName: null,
    checked: false, checkedAt: null, note: null,
    sortOrder: 0, version: 1, createdAt: 0, updatedAt: 0,
    unavailableSupermarketIds: [], sources: [], stapleSources: [], manualAmounts: [],
    stock: null, fullyStocked: false, defaultUnitId: null, defaultUnitName: null,
    ...over,
  };
}

describe("readOfflineShoppingSummary", () => {
  beforeEach(async () => {
    await resetOfflineDbForTests();
  });

  it("returns null when IDB was never seeded (no offline truth)", async () => {
    expect(await readOfflineShoppingSummary()).toBeNull();
  });

  it("computes the summary from IDB items + supermarkets", async () => {
    const db = await openOfflineDb();
    await db.put("meta", { key: "shoppingFetchedAt", value: 1 });
    await db.put("items", makeItem({ id: 1, categoryId: 5 }));
    await db.put("items", makeItem({ id: 2, name: "Salz", checked: true }));
    await db.put("items", makeItem({ id: 3, name: "Zucker" }));
    await db.put("supermarkets", { id: 1, name: "Aldi", categories: [{ categoryId: 5, sortOrder: 0 }] });

    const summary = await readOfflineShoppingSummary();
    expect(summary).toEqual({
      openCount: 2,
      stores: [{ id: 1, name: "Aldi", count: 2 }],
    });
  });

  it("reflects items checked off offline", async () => {
    const db = await openOfflineDb();
    await db.put("meta", { key: "shoppingFetchedAt", value: 1 });
    await db.put("items", makeItem({ id: 1, checked: true }));
    await db.put("items", makeItem({ id: 2, name: "Salz", checked: true }));

    const summary = await readOfflineShoppingSummary();
    expect(summary).toEqual({ openCount: 0, stores: [] });
  });
});
