/**
 * Learned walking order per supermarket.
 *
 * Every check-off with a store filter active leaves an `ingredient_purchase`
 * row carrying that store. Read in time order, those rows are the sequence in
 * which the user walked the store. This module turns that history into a
 * score per ingredient and per category (0 = picked first, 1 = picked last)
 * which the shopping list can sort by.
 *
 * Model:
 *   - Rows are split into trips at gaps longer than {@link TRIP_GAP_SECONDS}.
 *     A trip keeps one row per ingredient (the latest) and needs ≥ 2 rows to
 *     say anything about order. Only the newest {@link MAX_TRIPS} count.
 *   - In a trip of n rows, the row at index i was picked after i of the n − 1
 *     others. Trip k (0 = newest) is weighted {@link DECAY}^k.
 *   - An ingredient's score is Σ w·i / Σ w·(n − 1) over its trips — the
 *     weighted share of co-bought items picked before it. Weighting by the
 *     comparison count keeps a two-item trip from throwing both items to the
 *     extremes. The denominator is the evidence; below
 *     {@link MIN_INGREDIENT_EVIDENCE} no score is emitted.
 *   - A category pools all rows of its ingredients the same way (not a mean
 *     of means), so it can place articles never bought at this store yet.
 *
 * Pure — the DB loader lives in `learned-order-db.ts`. Recomputed from rows
 * on every page load, so an undone check (which
 * retracts its purchase row) simply drops out.
 */

export const TRIP_GAP_SECONDS = 3 * 60 * 60;
export const DECAY = 0.7;
export const MAX_TRIPS = 20;
export const WINDOW_SECONDS = 365 * 24 * 60 * 60;
export const MIN_INGREDIENT_EVIDENCE = 2;
export const MIN_CATEGORY_EVIDENCE = 3;

export type LearnedOrder = {
  ingredients: Array<{ ingredientId: number; score: number }>;
  categories: Array<{ categoryId: number; score: number }>;
};

export type PurchaseRow = {
  /** Row id — breaks ties between check-offs stamped in the same second. */
  id: number;
  ingredientId: number;
  /** The ingredient's *current* default category. */
  categoryId: number | null;
  purchasedAt: number;
};

type Acc = { num: number; den: number };

function add(map: Map<number, Acc>, key: number, num: number, den: number) {
  const acc = map.get(key) ?? { num: 0, den: 0 };
  acc.num += num;
  acc.den += den;
  map.set(key, acc);
}

/** Splits time-ordered rows into trips (one row per ingredient, latest wins). */
function splitTrips(sorted: PurchaseRow[]): PurchaseRow[][] {
  const trips: PurchaseRow[][] = [];
  let current: PurchaseRow[] = [];
  let lastAt: number | null = null;
  for (const row of sorted) {
    if (lastAt != null && row.purchasedAt - lastAt > TRIP_GAP_SECONDS) {
      trips.push(current);
      current = [];
    }
    current.push(row);
    lastAt = row.purchasedAt;
  }
  if (current.length > 0) trips.push(current);
  return trips.map((trip) => {
    const lastIndex = new Map<number, number>();
    trip.forEach((r, i) => lastIndex.set(r.ingredientId, i));
    return trip.filter((r, i) => lastIndex.get(r.ingredientId) === i);
  });
}

/** Learned order for ONE supermarket from its purchase rows (any order). */
export function computeLearnedOrder(rows: PurchaseRow[]): LearnedOrder {
  const sorted = [...rows].sort(
    (a, b) => a.purchasedAt - b.purchasedAt || a.id - b.id,
  );
  const trips = splitTrips(sorted)
    .filter((t) => t.length >= 2)
    .slice(-MAX_TRIPS)
    .reverse(); // newest first → index = k

  const byIngredient = new Map<number, Acc>();
  const byCategory = new Map<number, Acc>();
  trips.forEach((trip, k) => {
    const w = DECAY ** k;
    const comparisons = trip.length - 1;
    trip.forEach((row, i) => {
      add(byIngredient, row.ingredientId, w * i, w * comparisons);
      if (row.categoryId != null) {
        add(byCategory, row.categoryId, w * i, w * comparisons);
      }
    });
  });

  const ingredients: LearnedOrder["ingredients"] = [];
  for (const [ingredientId, { num, den }] of byIngredient) {
    if (den >= MIN_INGREDIENT_EVIDENCE) {
      ingredients.push({ ingredientId, score: num / den });
    }
  }
  const categories: LearnedOrder["categories"] = [];
  for (const [categoryId, { num, den }] of byCategory) {
    if (den >= MIN_CATEGORY_EVIDENCE) {
      categories.push({ categoryId, score: num / den });
    }
  }
  return { ingredients, categories };
}

/** True when the order has anything to sort by. */
export function hasLearnedOrder(order: LearnedOrder | null | undefined): boolean {
  return (
    order != null && (order.ingredients.length > 0 || order.categories.length > 0)
  );
}
