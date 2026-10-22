import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredient, ingredientPurchase } from "../../db/schema.ts";
import {
  WINDOW_SECONDS,
  computeLearnedOrder,
  hasLearnedOrder,
  type LearnedOrder,
  type PurchaseRow,
} from "./learned-order.ts";

/**
 * Learned order of every supermarket with check-off history in the last
 * {@link WINDOW_SECONDS}. One query; stores without history are absent.
 */
export function loadLearnedOrders(
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Map<number, LearnedOrder> {
  const rows = db
    .select({
      id: ingredientPurchase.id,
      supermarketId: ingredientPurchase.supermarketId,
      ingredientId: ingredientPurchase.ingredientId,
      categoryId: ingredient.defaultCategoryId,
      purchasedAt: ingredientPurchase.purchasedAt,
    })
    .from(ingredientPurchase)
    .innerJoin(ingredient, eq(ingredient.id, ingredientPurchase.ingredientId))
    .where(
      and(
        isNotNull(ingredientPurchase.supermarketId),
        gt(ingredientPurchase.purchasedAt, nowSeconds - WINDOW_SECONDS),
      ),
    )
    .orderBy(
      asc(ingredientPurchase.supermarketId),
      asc(ingredientPurchase.purchasedAt),
      asc(ingredientPurchase.id),
    )
    .all();

  const byStore = new Map<number, PurchaseRow[]>();
  for (const r of rows) {
    const storeId = r.supermarketId as number;
    const list = byStore.get(storeId) ?? [];
    list.push({
      id: r.id,
      ingredientId: r.ingredientId,
      categoryId: r.categoryId,
      purchasedAt: r.purchasedAt,
    });
    byStore.set(storeId, list);
  }
  const result = new Map<number, LearnedOrder>();
  for (const [storeId, list] of byStore) {
    const order = computeLearnedOrder(list);
    if (hasLearnedOrder(order)) result.set(storeId, order);
  }
  return result;
}
