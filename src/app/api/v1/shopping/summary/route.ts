import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { mealPlan, recipe, shoppingItemSource } from "@/db/schema";

/**
 * Groups currently on the shopping list — used to populate the "Liste
 * leeren" picker. Returns one entry per contributing meal (with title,
 * date, and item count).
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

  return NextResponse.json({
    meals: mealRows.map((r) => ({
      mealPlanId: r.mealPlanId,
      mealDate: r.mealDate,
      recipeId: r.recipeId,
      recipeTitle: r.recipeTitle,
      itemCount: Number(r.itemCount ?? 0),
    })),
  });
}
