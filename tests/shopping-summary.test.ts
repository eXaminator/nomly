import { describe, expect, it } from "vitest";
import { computeShoppingSummary } from "@/lib/shopping/shopping-summary";

const item = (over: Partial<{ checked: boolean; categoryId: number | null; unavailableSupermarketIds: number[] }> = {}) => ({
  checked: false,
  categoryId: null,
  unavailableSupermarketIds: [],
  ...over,
});

const market = (id: number, name: string, categoryIds: number[]) => ({
  id,
  name,
  categories: categoryIds.map((categoryId) => ({ categoryId })),
});

describe("computeShoppingSummary", () => {
  it("counts open items and per-store needs, sorted by count desc then name", () => {
    const items = [
      item({ categoryId: 1 }), // carried by both
      item({ categoryId: 2 }), // only B carries cat 2
      item({ checked: true, categoryId: 1 }), // checked — ignored
      item(), // uncategorized — shows everywhere
    ];
    const summary = computeShoppingSummary(items, [
      market(1, "Aldi", [1]),
      market(2, "Bio", [1, 2]),
    ]);
    expect(summary.openCount).toBe(3);
    expect(summary.stores).toEqual([
      { id: 2, name: "Bio", count: 3 },
      { id: 1, name: "Aldi", count: 2 },
    ]);
  });

  it("hides stores with zero needed items", () => {
    const summary = computeShoppingSummary([item({ categoryId: 9 })], [market(1, "Aldi", [1])]);
    expect(summary.openCount).toBe(1);
    expect(summary.stores).toEqual([]);
  });

  it("breaks count ties by German name order", () => {
    const summary = computeShoppingSummary([item()], [market(2, "Ödland", []), market(1, "Aldi", [])]);
    expect(summary.stores.map((s) => s.name)).toEqual(["Aldi", "Ödland"]);
  });

  it("returns zero state for empty inputs", () => {
    expect(computeShoppingSummary([], [])).toEqual({ openCount: 0, stores: [] });
  });
});
