import { describe, expect, it } from "vitest";
import { groupShoppingItems } from "@/lib/shopping/group-items";
import type { SupermarketSummary } from "@/lib/shopping/group-items";
import type { ShoppingItemView } from "@/lib/shopping/items";

function item(overrides: Partial<ShoppingItemView>): ShoppingItemView {
  return {
    id: 1,
    refType: "ingredient",
    refId: 1,
    name: "Item",
    amounts: [], requiredAmounts: [],
    categoryId: null,
    categoryName: null,
    checked: false,
    checkedAt: null,
    note: null,
    sortOrder: 0,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    unavailableSupermarketIds: [], skippedAt: [],
    sources: [],
    stapleSources: [],
    manualAmounts: [],
    stock: null,
    fullyStocked: false,
    defaultUnitId: null,
    defaultUnitName: null,
    unspecifiedSourceCount: 0,
    ...overrides,
  };
}

const store: SupermarketSummary = {
  id: 10,
  name: "Edeka",
  // Carries categories 1 and 2, in that visual order.
  categories: [
    { categoryId: 1, sortOrder: 0 },
    { categoryId: 2, sortOrder: 1 },
  ],
};

describe("groupShoppingItems", () => {
  it("splits open and checked into separate buckets", () => {
    const items = [
      item({ id: 1, name: "Apfel", categoryId: 1, categoryName: "Obst" }),
      item({
        id: 2,
        name: "Brot",
        categoryId: 2,
        categoryName: "Backwaren",
        checked: true,
        checkedAt: 100,
      }),
    ];
    const result = groupShoppingItems(items, null, []);
    expect(result.visibleOpen).toBe(1);
    expect(result.visibleChecked).toBe(1);
    expect(result.openGroups.flatMap((g) => g.items).map((i) => i.id)).toEqual([1]);
    expect(result.checkedItems.map((i) => i.id)).toEqual([2]);
  });

  it("orders open groups by supermarket category order, uncategorized last", () => {
    const items = [
      item({ id: 1, name: "Brot", categoryId: 2, categoryName: "Backwaren" }),
      item({ id: 2, name: "Apfel", categoryId: 1, categoryName: "Obst" }),
      item({ id: 3, name: "Batterien", categoryId: null }),
    ];
    const result = groupShoppingItems(items, store.id, [store]);
    expect(result.openGroups.map((g) => g.key)).toEqual([
      "cat-1",
      "cat-2",
      "cat-none",
    ]);
  });

  it("sorts checked items by checkedAt descending, nulls last", () => {
    const items = [
      item({ id: 1, checked: true, checkedAt: 100 }),
      item({ id: 2, checked: true, checkedAt: 300 }),
      item({ id: 3, checked: true, checkedAt: null }),
      item({ id: 4, checked: true, checkedAt: 200 }),
    ];
    const result = groupShoppingItems(items, null, []);
    expect(result.checkedItems.map((i) => i.id)).toEqual([2, 4, 1, 3]);
  });

  it("hides items marked unavailable at the active store, counting open vs checked", () => {
    const items = [
      item({ id: 1, name: "Apfel", categoryId: 1, unavailableSupermarketIds: [store.id] }),
      item({
        id: 2,
        name: "Brot",
        categoryId: 2,
        checked: true,
        checkedAt: 100,
        unavailableSupermarketIds: [store.id],
      }),
      item({ id: 3, name: "Birne", categoryId: 1 }),
    ];
    const result = groupShoppingItems(items, store.id, [store]);
    expect(result.visibleOpen).toBe(1);
    expect(result.hiddenOpen).toBe(1);
    expect(result.visibleChecked).toBe(0);
    expect(result.hiddenChecked).toBe(1);
    expect(result.openGroups.flatMap((g) => g.items).map((i) => i.id)).toEqual([3]);
  });

  it("hides items whose category the active store does not carry", () => {
    const items = [
      item({ id: 1, name: "Schraube", categoryId: 99, categoryName: "Baumarkt" }),
      item({ id: 2, name: "Apfel", categoryId: 1, categoryName: "Obst" }),
    ];
    const result = groupShoppingItems(items, store.id, [store]);
    expect(result.hiddenOpen).toBe(1);
    expect(result.openGroups.flatMap((g) => g.items).map((i) => i.id)).toEqual([2]);
  });

  it("keeps uncategorized items visible under a store filter", () => {
    const items = [item({ id: 1, name: "Batterien", categoryId: null })];
    const result = groupShoppingItems(items, store.id, [store]);
    expect(result.hiddenOpen).toBe(0);
    expect(result.visibleOpen).toBe(1);
  });

  it("applies no filter and counts nothing hidden when no store is selected", () => {
    const items = [
      item({ id: 1, categoryId: 99, unavailableSupermarketIds: [10] }),
      item({ id: 2, checked: true, checkedAt: 1, unavailableSupermarketIds: [10] }),
    ];
    const result = groupShoppingItems(items, null, [store]);
    expect(result.hiddenOpen).toBe(0);
    expect(result.hiddenChecked).toBe(0);
    expect(result.visibleOpen).toBe(1);
    expect(result.visibleChecked).toBe(1);
    expect(result.unavailableHere).toEqual([]);
  });

  it("collects only explicitly-excluded articles into unavailableHere (open + checked)", () => {
    const items = [
      item({ id: 1, name: "Apfel", categoryId: 1, unavailableSupermarketIds: [store.id] }),
      item({
        id: 2,
        name: "Brot",
        categoryId: 2,
        checked: true,
        checkedAt: 100,
        unavailableSupermarketIds: [store.id],
      }),
      // Hidden because the store lacks this category — NOT an explicit
      // exclusion, so it must not appear in unavailableHere.
      item({ id: 3, name: "Schraube", categoryId: 99 }),
      item({ id: 4, name: "Birne", categoryId: 1 }),
    ];
    const result = groupShoppingItems(items, store.id, [store]);
    expect(result.unavailableHere.map((i) => i.id)).toEqual([1, 2]);
  });

  it("leaves unavailableHere empty when no store is selected", () => {
    const items = [
      item({ id: 1, unavailableSupermarketIds: [store.id] }),
    ];
    expect(groupShoppingItems(items, null, [store]).unavailableHere).toEqual([]);
  });

  describe("skip today", () => {
    const TODAY = "2026-10-22";

    it("hides an open item skipped at the active store today and lists it as skippedHere", () => {
      const items = [
        item({ id: 1, name: "Apfel", categoryId: 1, skippedAt: [{ supermarketId: store.id, on: TODAY }] }),
        item({ id: 2, name: "Birne", categoryId: 1 }),
      ];
      const result = groupShoppingItems(items, store.id, [store], { today: TODAY });
      expect(result.openGroups.flatMap((g) => g.items).map((i) => i.id)).toEqual([2]);
      expect(result.hiddenOpen).toBe(1);
      expect(result.skippedHere.map((i) => i.id)).toEqual([1]);
    });

    it("ignores a skip from another day, another store, or without a store filter", () => {
      const items = [
        item({ id: 1, name: "Apfel", categoryId: 1, skippedAt: [{ supermarketId: store.id, on: "2026-10-21" }] }),
        item({ id: 2, name: "Birne", categoryId: 1, skippedAt: [{ supermarketId: 99, on: TODAY }] }),
      ];
      const atStore = groupShoppingItems(items, store.id, [store], { today: TODAY });
      expect(atStore.visibleOpen).toBe(2);
      expect(atStore.skippedHere).toEqual([]);
      const noStore = groupShoppingItems(
        [item({ id: 3, skippedAt: [{ supermarketId: store.id, on: TODAY }] })],
        null,
        [store],
        { today: TODAY },
      );
      expect(noStore.visibleOpen).toBe(1);
    });

    it("lists an item that is also permanently unavailable only under unavailableHere", () => {
      const items = [
        item({
          id: 1,
          categoryId: 1,
          unavailableSupermarketIds: [store.id],
          skippedAt: [{ supermarketId: store.id, on: TODAY }],
        }),
      ];
      const result = groupShoppingItems(items, store.id, [store], { today: TODAY });
      expect(result.unavailableHere.map((i) => i.id)).toEqual([1]);
      expect(result.skippedHere).toEqual([]);
    });

    it("does not hide a checked item because of a skip", () => {
      const items = [
        item({ id: 1, categoryId: 1, checked: true, checkedAt: 5, skippedAt: [{ supermarketId: store.id, on: TODAY }] }),
      ];
      const result = groupShoppingItems(items, store.id, [store], { today: TODAY });
      expect(result.visibleChecked).toBe(1);
      expect(result.skippedHere).toEqual([]);
    });
  });

  describe("learned order", () => {
    const learnedStore: SupermarketSummary = {
      ...store,
      learnedOrder: {
        // Ingredient 30 (Milch) is picked first, ingredient 10 (Apfel) last.
        ingredients: [
          { ingredientId: 30, score: 0.1 },
          { ingredientId: 10, score: 0.9 },
        ],
        // Category 2 (Backwaren) sits mid-store.
        categories: [{ categoryId: 2, score: 0.5 }],
      },
    };
    const items = [
      item({ id: 1, refId: 10, name: "Apfel", categoryId: 1, categoryName: "Obst" }),
      item({ id: 2, refId: 20, name: "Brot", categoryId: 2, categoryName: "Backwaren" }),
      item({ id: 3, refId: 30, name: "Milch", categoryId: 2, categoryName: "Backwaren" }),
      item({ id: 4, refId: 40, name: "Batterien", categoryId: null }),
      item({ id: 5, refId: 50, name: "Birne", categoryId: 1, categoryName: "Obst" }),
    ];

    it("returns one flat, headerless group: own score, then category score, then store order, uncategorized last", () => {
      const result = groupShoppingItems(items, learnedStore.id, [learnedStore], {
        sortMode: "learned",
      });
      expect(result.learnedOrderApplied).toBe(true);
      expect(result.openGroups).toHaveLength(1);
      expect(result.openGroups[0].label).toBeNull();
      // Milch 0.1, Brot 0.5 (category), Apfel 0.9, Birne (unlearned, store
      // order of Obst), Batterien (uncategorized, no score).
      expect(result.openGroups[0].items.map((i) => i.id)).toEqual([3, 2, 1, 5, 4]);
    });

    it("keeps the category groups when the mode is off", () => {
      const result = groupShoppingItems(items, learnedStore.id, [learnedStore], {
        sortMode: "category",
      });
      expect(result.learnedOrderApplied).toBe(false);
      expect(result.openGroups.map((g) => g.key)).toEqual(["cat-1", "cat-2", "cat-none"]);
    });

    it("falls back to category groups without a store or without learned data", () => {
      const noStore = groupShoppingItems(items, null, [learnedStore], { sortMode: "learned" });
      expect(noStore.learnedOrderApplied).toBe(false);
      const noData = groupShoppingItems(items, store.id, [store], { sortMode: "learned" });
      expect(noData.learnedOrderApplied).toBe(false);
      expect(noData.openGroups.map((g) => g.key)).toEqual(["cat-1", "cat-2", "cat-none"]);
    });
  });
});
