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
    amounts: [],
    categoryId: null,
    categoryName: null,
    checked: false,
    checkedAt: null,
    note: null,
    sortOrder: 0,
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    unavailableSupermarketIds: [],
    sources: [],
    stapleSources: [],
    manualAmounts: [],
    stock: null,
    fullyStocked: false,
    defaultUnitId: null,
    defaultUnitName: null,
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
  });
});
