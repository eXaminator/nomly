import { describe, it, expect } from "vitest";
import {
  countNeededItemsPerSupermarket,
  type NeededItem,
  type SupermarketCarry,
} from "@/lib/shopping/supermarket-availability";

// Two stores: Rewe carries categories 1 + 2, Aldi carries only 1.
const SUPERMARKETS: SupermarketCarry[] = [
  { id: 10, categories: [{ categoryId: 1 }, { categoryId: 2 }] },
  { id: 20, categories: [{ categoryId: 1 }] },
];

function item(over: Partial<NeededItem> = {}): NeededItem {
  return {
    checked: false,
    categoryId: 1,
    unavailableSupermarketIds: [],
    ...over,
  };
}

describe("countNeededItemsPerSupermarket", () => {
  it("returns 0 for every supermarket when there are no items", () => {
    const counts = countNeededItemsPerSupermarket([], SUPERMARKETS);
    expect(counts.get(10)).toBe(0);
    expect(counts.get(20)).toBe(0);
  });

  it("counts an item only at stores that carry its category", () => {
    // category 2 → carried by Rewe (10), not Aldi (20)
    const counts = countNeededItemsPerSupermarket([item({ categoryId: 2 })], SUPERMARKETS);
    expect(counts.get(10)).toBe(1);
    expect(counts.get(20)).toBe(0);
  });

  it("counts uncategorized items at every store (they show everywhere)", () => {
    const counts = countNeededItemsPerSupermarket(
      [item({ categoryId: null })],
      SUPERMARKETS,
    );
    expect(counts.get(10)).toBe(1);
    expect(counts.get(20)).toBe(1);
  });

  it("excludes a store where the item is marked unavailable", () => {
    // category 1 is carried by both, but it's unavailable at Aldi (20)
    const counts = countNeededItemsPerSupermarket(
      [item({ categoryId: 1, unavailableSupermarketIds: [20] })],
      SUPERMARKETS,
    );
    expect(counts.get(10)).toBe(1);
    expect(counts.get(20)).toBe(0);
  });

  it("never counts checked (already-bought) items", () => {
    const counts = countNeededItemsPerSupermarket(
      [item({ checked: true, categoryId: 1 })],
      SUPERMARKETS,
    );
    expect(counts.get(10)).toBe(0);
    expect(counts.get(20)).toBe(0);
  });

  it("sums multiple needed items per store", () => {
    const counts = countNeededItemsPerSupermarket(
      [
        item({ categoryId: 1 }), // both
        item({ categoryId: 2 }), // Rewe only
        item({ categoryId: null }), // both
      ],
      SUPERMARKETS,
    );
    expect(counts.get(10)).toBe(3);
    expect(counts.get(20)).toBe(2);
  });
});
