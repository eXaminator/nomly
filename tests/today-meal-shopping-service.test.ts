import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-today-meal-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Create a recipe with one section and the given ingredients; returns the
 *  recipe id and the recipe_ingredient ids (in order). */
async function makeRecipe(
  title: string,
  ings: Array<{ ingredientId: number; quantity: number; unitId: number | null }>,
): Promise<{ recipeId: number; recipeIngredientIds: number[] }> {
  const { db } = await import("@/db");
  const { recipe, recipeSection, recipeIngredient } = await import("@/db/schema");
  const recipeId = db
    .insert(recipe)
    .values({ title, servings: 1 })
    .returning({ id: recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(recipeSection)
    .values({ recipeId, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;
  const recipeIngredientIds = ings.map(
    (i) =>
      db
        .insert(recipeIngredient)
        .values({
          sectionId,
          ingredientId: i.ingredientId,
          quantity: i.quantity,
          unitId: i.unitId,
        })
        .returning({ id: recipeIngredient.id })
        .all()[0].id,
  );
  return { recipeId, recipeIngredientIds };
}

/** Plan a recipe on a date and push its ingredients onto the shopping list. */
async function planAndShop(
  recipeId: number,
  recipeIngredientIds: number[],
  date: string,
  isLeftover = false,
): Promise<number> {
  const { createMeal } = await import("@/lib/meal-plans/service");
  const { addMealsToList } = await import("@/lib/shopping/merge");
  const mealPlanId = createMeal({ recipeId, date, isLeftover });
  if (!isLeftover) {
    addMealsToList([
      {
        mealPlanId,
        ingredients: recipeIngredientIds.map((id) => ({
          recipeIngredientId: id,
        })),
      },
    ]);
  }
  return mealPlanId;
}

async function checkItemByIngredient(ingredientId: number): Promise<void> {
  const { db } = await import("@/db");
  const { shoppingItem } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  db.update(shoppingItem)
    .set({ checked: true })
    .where(eq(shoppingItem.ingredientId, ingredientId))
    .run();
}

type Ctx = {
  today: string;
  yesterday: string;
  gemueseCatId: number;
  fleischCatId: number;
  tomateId: number;
  zwiebelId: number;
  hackId: number;
  stueckId: number;
  asdaId: number;
  tescoId: number;
};

async function reset(): Promise<Ctx> {
  const { db } = await import("@/db");
  const schema = await import("@/db/schema");
  const { createSupermarket } = await import(
    "@/lib/stammdaten/supermarket/service"
  );
  const { todayIso, addDays } = await import("@/lib/meal-plans/dates");

  // Wipe in FK-safe order.
  db.delete(schema.shoppingItemSource).run();
  db.delete(schema.shoppingItemStapleSource).run();
  db.delete(schema.shoppingItemAmount).run();
  db.delete(schema.shoppingItemStock).run();
  db.delete(schema.shoppingItem).run();
  db.delete(schema.ingredientSupermarketUnavailable).run();
  db.delete(schema.supermarketCategory).run();
  db.delete(schema.supermarket).run();
  db.delete(schema.mealPlan).run();
  db.delete(schema.recipeIngredient).run();
  db.delete(schema.recipeSection).run();
  db.delete(schema.recipe).run();
  db.delete(schema.ingredient).run();
  db.delete(schema.category).run();
  db.delete(schema.unit).run();

  const stueckId = db
    .insert(schema.unit)
    .values({ name: "Stück", dimension: "count" })
    .returning({ id: schema.unit.id })
    .all()[0].id;

  const gemueseCatId = db
    .insert(schema.category)
    .values({ name: "Gemüse" })
    .returning({ id: schema.category.id })
    .all()[0].id;
  const fleischCatId = db
    .insert(schema.category)
    .values({ name: "Fleisch" })
    .returning({ id: schema.category.id })
    .all()[0].id;

  const mkIng = (name: string, catId: number) =>
    db
      .insert(schema.ingredient)
      .values({ name, defaultCategoryId: catId })
      .returning({ id: schema.ingredient.id })
      .all()[0].id;

  const tomateId = mkIng("Tomate", gemueseCatId);
  const zwiebelId = mkIng("Zwiebel", gemueseCatId);
  const hackId = mkIng("Hackfleisch", fleischCatId);

  // ASDA carries both categories; Tesco only carries Gemüse.
  const asda = createSupermarket({
    name: "ASDA",
    orderedCategoryIds: [gemueseCatId, fleischCatId],
  });
  const tesco = createSupermarket({
    name: "Tesco",
    orderedCategoryIds: [gemueseCatId],
  });

  return {
    today: todayIso(),
    yesterday: addDays(todayIso(), -1),
    gemueseCatId,
    fleischCatId,
    tomateId,
    zwiebelId,
    hackId,
    stueckId,
    asdaId: asda.id,
    tescoId: tesco.id,
  };
}

describe("getTodayMealShoppingStatus", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await reset();
  });

  it("reports today's meal with only its unchecked items and shop coverage", async () => {
    const { recipeId, recipeIngredientIds } = await makeRecipe("Bolognese", [
      { ingredientId: ctx.tomateId, quantity: 2, unitId: ctx.stueckId },
      { ingredientId: ctx.zwiebelId, quantity: 1, unitId: ctx.stueckId },
      { ingredientId: ctx.hackId, quantity: 500, unitId: ctx.stueckId },
    ]);
    const mealPlanId = await planAndShop(recipeId, recipeIngredientIds, ctx.today);
    // Buy the onion already → 2 items still unchecked.
    await checkItemByIngredient(ctx.zwiebelId);

    const { getTodayMealShoppingStatus } = await import(
      "@/lib/shopping/today-meal-shopping"
    );
    const status = getTodayMealShoppingStatus();

    expect(status.date).toBe(ctx.today);
    expect(status.needsShopping).toBe(true);
    expect(status.totalUncheckedItems).toBe(2);
    expect(status.meals).toHaveLength(1);

    const meal = status.meals[0];
    expect(meal.mealPlanId).toBe(mealPlanId);
    expect(meal.recipeTitle).toBe("Bolognese");
    expect(meal.uncheckedItemCount).toBe(2);
    expect(meal.items.map((i) => i.name).sort()).toEqual([
      "Hackfleisch",
      "Tomate",
    ]);

    // ASDA carries Gemüse + Fleisch → both unchecked items (2).
    // Tesco carries only Gemüse → just the tomato (1).
    const asda = meal.supermarkets.find((s) => s.id === ctx.asdaId);
    const tesco = meal.supermarkets.find((s) => s.id === ctx.tescoId);
    expect(asda?.carriesCount).toBe(2);
    expect(tesco?.carriesCount).toBe(1);
    // Sorted by carriesCount desc → ASDA before Tesco.
    expect(meal.supermarkets.map((s) => s.id)).toEqual([ctx.asdaId, ctx.tescoId]);
  });

  it("returns needsShopping=false when today's meal is fully checked", async () => {
    const { recipeId, recipeIngredientIds } = await makeRecipe("Salat", [
      { ingredientId: ctx.tomateId, quantity: 2, unitId: ctx.stueckId },
    ]);
    await planAndShop(recipeId, recipeIngredientIds, ctx.today);
    await checkItemByIngredient(ctx.tomateId);

    const { getTodayMealShoppingStatus } = await import(
      "@/lib/shopping/today-meal-shopping"
    );
    const status = getTodayMealShoppingStatus();
    expect(status.needsShopping).toBe(false);
    expect(status.meals).toHaveLength(0);
    expect(status.totalUncheckedItems).toBe(0);
  });

  it("ignores meals planned on other days", async () => {
    const { recipeId, recipeIngredientIds } = await makeRecipe("Gestern", [
      { ingredientId: ctx.tomateId, quantity: 2, unitId: ctx.stueckId },
    ]);
    await planAndShop(recipeId, recipeIngredientIds, ctx.yesterday);

    const { getTodayMealShoppingStatus } = await import(
      "@/lib/shopping/today-meal-shopping"
    );
    const status = getTodayMealShoppingStatus();
    expect(status.needsShopping).toBe(false);
    expect(status.meals).toHaveLength(0);
  });

  it("excludes leftover meals planned today", async () => {
    const { recipeId, recipeIngredientIds } = await makeRecipe("Reste", [
      { ingredientId: ctx.tomateId, quantity: 2, unitId: ctx.stueckId },
    ]);
    await planAndShop(recipeId, recipeIngredientIds, ctx.today, true);

    const { getTodayMealShoppingStatus } = await import(
      "@/lib/shopping/today-meal-shopping"
    );
    const status = getTodayMealShoppingStatus();
    expect(status.needsShopping).toBe(false);
    expect(status.meals).toHaveLength(0);
  });

  it("counts a shared item under each of today's meals but once in the total", async () => {
    const a = await makeRecipe("Sugo", [
      { ingredientId: ctx.tomateId, quantity: 2, unitId: ctx.stueckId },
    ]);
    const b = await makeRecipe("Suppe", [
      { ingredientId: ctx.tomateId, quantity: 3, unitId: ctx.stueckId },
    ]);
    await planAndShop(a.recipeId, a.recipeIngredientIds, ctx.today);
    await planAndShop(b.recipeId, b.recipeIngredientIds, ctx.today);

    const { getTodayMealShoppingStatus } = await import(
      "@/lib/shopping/today-meal-shopping"
    );
    const status = getTodayMealShoppingStatus();
    expect(status.meals).toHaveLength(2);
    expect(status.meals.every((m) => m.uncheckedItemCount === 1)).toBe(true);
    // The tomato merges into one shopping item shared by both meals.
    expect(status.totalUncheckedItems).toBe(1);
  });

  it("drops a shop marked unable to carry one of the meal's items", async () => {
    const { recipeId, recipeIngredientIds } = await makeRecipe("Bolognese", [
      { ingredientId: ctx.tomateId, quantity: 2, unitId: ctx.stueckId },
    ]);
    await planAndShop(recipeId, recipeIngredientIds, ctx.today);

    const { markUnavailable } = await import("@/lib/shopping/unavailable");
    markUnavailable({ kind: "ingredient", id: ctx.tomateId }, ctx.tescoId);

    const { getTodayMealShoppingStatus } = await import(
      "@/lib/shopping/today-meal-shopping"
    );
    const meal = getTodayMealShoppingStatus().meals[0];
    // Tesco no longer carries the only item → dropped from the list.
    expect(meal.supermarkets.find((s) => s.id === ctx.tescoId)).toBeUndefined();
    expect(meal.supermarkets.find((s) => s.id === ctx.asdaId)?.carriesCount).toBe(1);
  });
});
