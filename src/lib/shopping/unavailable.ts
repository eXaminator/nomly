import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import {
  ingredientSupermarketUnavailable,
  productSupermarketUnavailable,
} from "../../db/schema.ts";

export type UnavailableTarget =
  | { kind: "ingredient"; id: number }
  | { kind: "product"; id: number };

export function markUnavailable(target: UnavailableTarget, supermarketId: number): void {
  if (target.kind === "ingredient") {
    db.insert(ingredientSupermarketUnavailable)
      .values({ ingredientId: target.id, supermarketId })
      .onConflictDoNothing()
      .run();
    return;
  }
  db.insert(productSupermarketUnavailable)
    .values({ productId: target.id, supermarketId })
    .onConflictDoNothing()
    .run();
}

export function unmarkUnavailable(target: UnavailableTarget, supermarketId: number): void {
  if (target.kind === "ingredient") {
    db.delete(ingredientSupermarketUnavailable)
      .where(
        and(
          eq(ingredientSupermarketUnavailable.ingredientId, target.id),
          eq(ingredientSupermarketUnavailable.supermarketId, supermarketId),
        ),
      )
      .run();
    return;
  }
  db.delete(productSupermarketUnavailable)
    .where(
      and(
        eq(productSupermarketUnavailable.productId, target.id),
        eq(productSupermarketUnavailable.supermarketId, supermarketId),
      ),
    )
    .run();
}
