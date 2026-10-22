import { describe, expect, it } from "vitest";
import {
  MAX_TRIPS,
  TRIP_GAP_SECONDS,
  computeLearnedOrder,
  hasLearnedOrder,
  type PurchaseRow,
} from "@/lib/shopping/learned-order";

let nextId = 1;

/** One trip: ingredient ids checked off a minute apart, starting at `start`. */
function trip(
  start: number,
  ingredientIds: number[],
  categoryOf: (id: number) => number | null = () => null,
): PurchaseRow[] {
  return ingredientIds.map((ingredientId, i) => ({
    id: nextId++,
    ingredientId,
    categoryId: categoryOf(ingredientId),
    purchasedAt: start + i * 60,
  }));
}

const DAY = 24 * 60 * 60;

function scores(rows: PurchaseRow[]) {
  const order = computeLearnedOrder(rows);
  return {
    ingredient: new Map(order.ingredients.map((e) => [e.ingredientId, e.score])),
    category: new Map(order.categories.map((e) => [e.categoryId, e.score])),
  };
}

function ranking(rows: PurchaseRow[]): number[] {
  const { ingredient } = scores(rows);
  return [...ingredient.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

describe("computeLearnedOrder", () => {
  it("scores one trip by position: first 0, last 1", () => {
    const { ingredient } = scores(trip(0, [1, 2, 3, 4]));
    expect(ingredient.get(1)).toBe(0);
    expect(ingredient.get(2)).toBeCloseTo(1 / 3);
    expect(ingredient.get(3)).toBeCloseTo(2 / 3);
    expect(ingredient.get(4)).toBe(1);
  });

  it("is independent of input order (sorts by time, then row id)", () => {
    const rows = trip(0, [1, 2, 3]);
    expect(ranking([...rows].reverse())).toEqual([1, 2, 3]);
    // Same second: the row id decides.
    const tied: PurchaseRow[] = [
      { id: 11, ingredientId: 2, categoryId: null, purchasedAt: 500 },
      { id: 10, ingredientId: 1, categoryId: null, purchasedAt: 500 },
      { id: 12, ingredientId: 3, categoryId: null, purchasedAt: 500 },
    ];
    expect(ranking(tied)).toEqual([1, 2, 3]);
  });

  it("splits trips at gaps longer than the trip gap, even on the same day", () => {
    // Morning trip A→B→C, afternoon trip C→B→A: positions are relative to each
    // trip, so the afternoon (newest, heavier) wins without the two merging.
    const morning = trip(0, [1, 2, 3]);
    const afternoon = trip(TRIP_GAP_SECONDS + 3600, [3, 2, 1]);
    expect(ranking([...morning, ...afternoon])).toEqual([3, 2, 1]);
  });

  it("keeps the latest position when an ingredient is checked twice in one trip", () => {
    const rows = trip(0, [1, 2, 1, 3]);
    // Deduped to 2, 1, 3.
    expect(ranking(rows)).toEqual([2, 1, 3]);
  });

  it("ignores trips with a single item and emits nothing below the evidence floor", () => {
    expect(hasLearnedOrder(computeLearnedOrder(trip(0, [1])))).toBe(false);
    // A two-item trip is one comparison — below the floor of 2.
    expect(hasLearnedOrder(computeLearnedOrder(trip(0, [1, 2])))).toBe(false);
    expect(hasLearnedOrder(computeLearnedOrder(trip(0, [1, 2, 3])))).toBe(true);
  });

  it("does not let a recent two-item trip overturn a big trip", () => {
    const big = trip(0, [1, 2, 3, 4, 5]);
    const small = trip(DAY, [5, 1]);
    const order = ranking([...big, ...small]);
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(5));
  });

  it("follows an article that moved aisle once recent trips agree", () => {
    const rows: PurchaseRow[] = [];
    for (let d = 0; d < 3; d++) rows.push(...trip(d * DAY, [1, 2, 3])); // 1 first
    for (let d = 3; d < 6; d++) rows.push(...trip(d * DAY, [2, 3, 1])); // 1 last
    const { ingredient } = scores(rows);
    expect(ingredient.get(1)!).toBeGreaterThan(ingredient.get(3)!);
  });

  it("only looks at the newest MAX_TRIPS trips", () => {
    const rows: PurchaseRow[] = [];
    // Old history puts 9 first; it falls entirely outside the window.
    for (let d = 0; d < 5; d++) rows.push(...trip(d * DAY, [9, 1, 2]));
    for (let d = 5; d < 5 + MAX_TRIPS; d++) rows.push(...trip(d * DAY, [1, 2]));
    const { ingredient } = scores(rows);
    expect(ingredient.has(9)).toBe(false);
  });

  it("pools a category over its articles to place unseen articles", () => {
    // Category 100 = {1, 2} at the front, category 200 = {3, 4} at the back.
    const cat = (id: number) => (id <= 2 ? 100 : 200);
    const rows = [...trip(0, [1, 2, 3, 4], cat), ...trip(DAY, [2, 1, 4, 3], cat)];
    const { category } = scores(rows);
    expect(category.get(100)!).toBeLessThan(category.get(200)!);
  });
});
