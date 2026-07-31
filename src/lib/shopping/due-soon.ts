import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  category as categoryTable,
  ingredient,
  ingredientPurchase,
  shoppingItem,
} from "../../db/schema.ts";
import { loadPurchaseStats } from "../ingredients/purchase-stats.ts";
import { upsertShoppingItemForIngredient } from "./itemUpsert.ts";

const SECONDS_PER_DAY = 24 * 60 * 60;

export type DueSoonItem = {
  ingredientId: number;
  ingredientName: string;
  categoryName: string | null;
  /** Most recent purchase (unix seconds). */
  lastPurchasedAt: number;
  /** Average days between purchases (>= 3 purchases guaranteed). */
  averageIntervalDays: number;
  /** Predicted next purchase (unix seconds) = last + average interval. */
  nextDueAt: number;
  /** Whole days until due, relative to "now". Negative = already overdue. */
  dueInDays: number;
  /** True when the ingredient is already on the current shopping list. */
  alreadyOnList: boolean;
};

export type DueSoonPreview = {
  /** The window used (the planner's `daysVisible`). Echoed for the UI copy. */
  withinDays: number;
  items: DueSoonItem[];
};

/**
 * Ingredients whose predicted next purchase falls within the next
 * `withinDays` days (or is already overdue), based on their recorded buying
 * cadence. Only ingredients with an established average (≥ 3 purchases) can
 * be predicted, so anything without one is silently excluded.
 *
 * Sorted most-overdue-first. `nowSeconds` is injectable for tests.
 */
export function previewDueSoonIngredients(
  withinDays: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): DueSoonItem[] {
  const idRows = db
    .selectDistinct({ id: ingredientPurchase.ingredientId })
    .from(ingredientPurchase)
    .all();
  const purchasedIds = idRows.map((r) => r.id);
  if (purchasedIds.length === 0) return [];

  const stats = loadPurchaseStats(purchasedIds);
  const threshold = nowSeconds + withinDays * SECONDS_PER_DAY;

  const due: Array<Omit<DueSoonItem, "ingredientName" | "categoryName" | "alreadyOnList">> =
    [];
  for (const [ingredientId, s] of stats) {
    if (s.lastPurchasedAt == null || s.averageIntervalDays == null) continue;
    const nextDueAt = Math.round(
      s.lastPurchasedAt + s.averageIntervalDays * SECONDS_PER_DAY,
    );
    if (nextDueAt > threshold) continue;
    due.push({
      ingredientId,
      lastPurchasedAt: s.lastPurchasedAt,
      averageIntervalDays: s.averageIntervalDays,
      nextDueAt,
      dueInDays: Math.round((nextDueAt - nowSeconds) / SECONDS_PER_DAY),
    });
  }
  if (due.length === 0) return [];

  const ids = due.map((d) => d.ingredientId);
  const info = db
    .select({
      id: ingredient.id,
      name: ingredient.name,
      categoryName: categoryTable.name,
    })
    .from(ingredient)
    .leftJoin(categoryTable, eq(categoryTable.id, ingredient.defaultCategoryId))
    .where(inArray(ingredient.id, ids))
    .all();
  const infoById = new Map(info.map((r) => [r.id, r] as const));

  const onListRows = db
    .select({ ingredientId: shoppingItem.ingredientId })
    .from(shoppingItem)
    .where(inArray(shoppingItem.ingredientId, ids))
    .all();
  const onList = new Set(onListRows.map((r) => r.ingredientId));

  const items: DueSoonItem[] = [];
  for (const d of due) {
    const meta = infoById.get(d.ingredientId);
    if (!meta) continue; // ingredient deleted since the purchase — skip
    items.push({
      ...d,
      ingredientName: meta.name,
      categoryName: meta.categoryName,
      alreadyOnList: onList.has(d.ingredientId),
    });
  }
  items.sort(
    (a, b) =>
      a.nextDueAt - b.nextDueAt ||
      a.ingredientName.localeCompare(b.ingredientName, "de"),
  );
  return items;
}

export type AddDueSoonResult = {
  itemsCreated: number;
  itemsIncremented: number;
  itemsReactivated: number;
  affectedItemIds: number[];
};

/**
 * Add the chosen due-soon ingredients to the shopping list. Reuses the shared
 * upsert (one item per ingredient, 24 h re-activate rule) so this behaves like
 * the meals/staples add flows. Ingredients that no longer exist are skipped.
 */
export function addDueSoonToList(ingredientIds: number[]): AddDueSoonResult {
  const result: AddDueSoonResult = {
    itemsCreated: 0,
    itemsIncremented: 0,
    itemsReactivated: 0,
    affectedItemIds: [],
  };
  const unique = Array.from(new Set(ingredientIds));
  if (unique.length === 0) return result;
  return db.transaction((tx) => {
    for (const id of unique) {
      const exists = tx
        .select({ id: ingredient.id })
        .from(ingredient)
        .where(eq(ingredient.id, id))
        .get();
      if (!exists) continue;
      const up = upsertShoppingItemForIngredient(tx, id);
      if (up.created) result.itemsCreated += 1;
      else if (up.reactivated) result.itemsReactivated += 1;
      else result.itemsIncremented += 1;
      result.affectedItemIds.push(up.itemId);
    }
    return result;
  });
}
