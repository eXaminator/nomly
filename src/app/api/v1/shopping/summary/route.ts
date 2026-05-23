import { NextResponse } from "next/server";
import { asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  mealPlan,
  product,
  recipe,
  shoppingItem,
  shoppingItemSource,
} from "@/db/schema";

/**
 * Groups currently on the shopping list — used to populate the "Liste
 * leeren" picker. Returns one entry per contributing meal (with title,
 * date, and item count) plus the count of product-type items so the
 * picker can offer them as a separate group.
 */
export async function GET() {
  const mealRows = db
    .select({
      mealPlanId: mealPlan.id,
      mealDate: mealPlan.date,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      itemCount: sql<number>`COUNT(DISTINCT ${shoppingItemSource.itemId})`,
    })
    .from(shoppingItemSource)
    .innerJoin(mealPlan, eq(mealPlan.id, shoppingItemSource.mealPlanId))
    .innerJoin(recipe, eq(recipe.id, mealPlan.recipeId))
    .groupBy(mealPlan.id)
    .orderBy(asc(mealPlan.date), asc(recipe.title))
    .all();

  const productCountRow = db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(shoppingItem)
    .innerJoin(product, eq(product.id, shoppingItem.productId))
    .where(isNotNull(shoppingItem.productId))
    .get();

  return NextResponse.json({
    meals: mealRows.map((r) => ({
      mealPlanId: r.mealPlanId,
      mealDate: r.mealDate,
      recipeId: r.recipeId,
      recipeTitle: r.recipeTitle,
      itemCount: Number(r.itemCount ?? 0),
    })),
    productCount: Number(productCountRow?.count ?? 0),
  });
}
