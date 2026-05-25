import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { ingredientSupermarketUnavailable } from "../../db/schema.ts";

export type UnavailableTarget = { kind: "ingredient"; id: number };

export function markUnavailable(target: UnavailableTarget, supermarketId: number): void {
  db.insert(ingredientSupermarketUnavailable)
    .values({ ingredientId: target.id, supermarketId })
    .onConflictDoNothing()
    .run();
}

export function unmarkUnavailable(target: UnavailableTarget, supermarketId: number): void {
  db.delete(ingredientSupermarketUnavailable)
    .where(
      and(
        eq(ingredientSupermarketUnavailable.ingredientId, target.id),
        eq(ingredientSupermarketUnavailable.supermarketId, supermarketId),
      ),
    )
    .run();
}
