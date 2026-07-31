import { asc, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredientPurchase } from "../../db/schema.ts";

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * The purchase average is only meaningful once we've seen a cadence. With
 * fewer than three purchases there aren't two full intervals to average, so
 * `averageIntervalDays` stays null (spec: "wenn es mindestens 3x gekauft
 * wurde").
 */
export const MIN_PURCHASES_FOR_AVERAGE = 3;

export type IngredientPurchaseStats = {
  /** Most recent purchase (unix seconds), or null when never bought. */
  lastPurchasedAt: number | null;
  /** Distinct purchase days seen (same-day check-offs collapse to one). */
  purchaseCount: number;
  /**
   * Mean number of days between consecutive purchases. Null until at least
   * {@link MIN_PURCHASES_FOR_AVERAGE} distinct purchase days exist.
   */
  averageIntervalDays: number | null;
};

const EMPTY: IngredientPurchaseStats = {
  lastPurchasedAt: null,
  purchaseCount: 0,
  averageIntervalDays: null,
};

/** Calendar day (UTC) an epoch-seconds timestamp falls on. */
function dayIndex(purchasedAt: number): number {
  return Math.floor(purchasedAt / SECONDS_PER_DAY);
}

function statsFromTimestamps(sorted: number[]): IngredientPurchaseStats {
  if (sorted.length === 0) return EMPTY;
  // Collapse purchases that land on the same calendar day: a single shopping
  // trip that touches an item twice (re-add + re-check) must not read as a
  // zero-day interval and skew the cadence.
  const byDay = new Map<number, number>();
  for (const ts of sorted) {
    const day = dayIndex(ts);
    const prev = byDay.get(day);
    if (prev == null || ts > prev) byDay.set(day, ts);
  }
  const distinct = Array.from(byDay.values()).sort((a, b) => a - b);
  const purchaseCount = distinct.length;
  const lastPurchasedAt = distinct[purchaseCount - 1];
  let averageIntervalDays: number | null = null;
  if (purchaseCount >= MIN_PURCHASES_FOR_AVERAGE) {
    const spanSeconds = lastPurchasedAt - distinct[0];
    averageIntervalDays =
      spanSeconds / SECONDS_PER_DAY / (purchaseCount - 1);
  }
  return { lastPurchasedAt, purchaseCount, averageIntervalDays };
}

/**
 * Batch-load purchase statistics for a set of ingredient ids. Ids with no
 * recorded purchases are simply absent from the returned map (callers fall
 * back to an empty stats object). Mirrors the `loadRecipeRefCounts` pattern
 * in the ingredient stammdaten service.
 */
export function loadPurchaseStats(
  ids: number[],
): Map<number, IngredientPurchaseStats> {
  const out = new Map<number, IngredientPurchaseStats>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return out;
  const rows = db
    .select({
      ingredientId: ingredientPurchase.ingredientId,
      purchasedAt: ingredientPurchase.purchasedAt,
    })
    .from(ingredientPurchase)
    .where(inArray(ingredientPurchase.ingredientId, unique))
    .orderBy(asc(ingredientPurchase.ingredientId), asc(ingredientPurchase.purchasedAt))
    .all();

  const byIngredient = new Map<number, number[]>();
  for (const row of rows) {
    const list = byIngredient.get(row.ingredientId) ?? [];
    list.push(row.purchasedAt);
    byIngredient.set(row.ingredientId, list);
  }
  for (const [ingredientId, timestamps] of byIngredient) {
    out.set(ingredientId, statsFromTimestamps(timestamps));
  }
  return out;
}

/** Convenience single-ingredient lookup. Never null — absent history yields
 *  an empty stats object. */
export function getPurchaseStats(ingredientId: number): IngredientPurchaseStats {
  return loadPurchaseStats([ingredientId]).get(ingredientId) ?? { ...EMPTY };
}
