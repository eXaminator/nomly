import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-ingredient-usage-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ctx = { tomateId: number; salzId: number; todayMealId: number };

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const {
    category,
    ingredient,
    mealPlan,
    recipe,
    recipeIngredient,
    recipeSection,
    shoppingItem,
    shoppingItemSource,
    unit,
  } = await import("@/db/schema");
  const { todayIso, addDays } = await import("@/lib/meal-plans/dates");
  const { addManualItem } = await import("@/lib/shopping/items");

  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(mealPlan).run();
  db.delete(recipe).run();
  db.delete(ingredient).run();
  db.delete(unit).run();
  db.delete(category).run();

  const catId = db
    .insert(category)
    .values({ name: "Kat" })
    .returning({ id: category.id })
    .all()[0].id;
  const gId = db
    .insert(unit)
    .values({ name: "g", dimension: "mass", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;

  const tomateId = db
    .insert(ingredient)
    .values({ name: "Tomate", defaultCategoryId: catId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const salzId = db
    .insert(ingredient)
    .values({ name: "Salz", defaultCategoryId: catId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  const spaghettiId = db
    .insert(recipe)
    .values({ title: "Spaghetti", servings: 2 })
    .returning({ id: recipe.id })
    .all()[0].id;
  const sec = db
    .insert(recipeSection)
    .values({ recipeId: spaghettiId, title: null, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;
  db.insert(recipeIngredient)
    .values([
      { sectionId: sec, ingredientId: tomateId, quantity: 500, unitId: gId },
      { sectionId: sec, ingredientId: salzId, quantity: null, unitId: null },
    ])
    .run();

  const today = todayIso();
  const todayMealId = db
    .insert(mealPlan)
    .values({ recipeId: spaghettiId, date: today, servingsOverride: 2, sortOrder: 0 })
    .returning({ id: mealPlan.id })
    .all()[0].id;
  // A meal in the past — outside the [today, +window] preview, so it must not
  // appear in upcomingMeals.
  db.insert(mealPlan)
    .values({
      recipeId: spaghettiId,
      date: addDays(today, -3),
      servingsOverride: 2,
      sortOrder: 0,
    })
    .run();

  // Tomate is on the list (unchecked); Salz is not.
  addManualItem({ ingredientId: tomateId });

  return { tomateId, salzId, todayMealId };
}

describe("getIngredientUsageByName", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("reports the upcoming meal and on-list status for a matched ingredient", async () => {
    const { getIngredientUsageByName } = await import("@/lib/ingredients/usage");
    const res = getIngredientUsageByName("Tomate");
    expect(res.match).toBe("match");
    expect(res.ingredient?.id).toBe(ctx.tomateId);
    expect(res.onShoppingList).toBe(true);
    // Exactly the today meal (the past one is excluded).
    expect(res.upcomingMeals.map((m) => m.mealPlanId)).toEqual([ctx.todayMealId]);
    expect(res.upcomingMeals[0].recipeTitle).toBe("Spaghetti");
  });

  it("matches an ingredient that is used but not on the list", async () => {
    const { getIngredientUsageByName } = await import("@/lib/ingredients/usage");
    const res = getIngredientUsageByName("Salz");
    expect(res.match).toBe("match");
    expect(res.ingredient?.id).toBe(ctx.salzId);
    expect(res.onShoppingList).toBe(false);
    expect(res.upcomingMeals.map((m) => m.mealPlanId)).toEqual([ctx.todayMealId]);
  });

  it("returns 'none' for an unknown name", async () => {
    const { getIngredientUsageByName } = await import("@/lib/ingredients/usage");
    const res = getIngredientUsageByName("Quinoa-Quallen-Püree");
    expect(res.match).toBe("none");
    expect(res.ingredient).toBeNull();
    expect(res.upcomingMeals).toEqual([]);
  });
});
