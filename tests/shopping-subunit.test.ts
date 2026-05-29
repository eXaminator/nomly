import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-shopping-subunit-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ctx = {
  recipeId: number;
  mealPlanId: number;
  ingredientId: number;
  subUnitId: number;
  packungId: number;
};

/**
 * Seed an ingredient "Gemüsestäbchen" with a sub-unit "Stäbchen" (16 per
 * Packung) and purchase unit "Packung", a recipe whose single line is
 * "N Stäbchen", and a meal plan. Returns ids the tests scale against.
 */
async function seed(staebchenQty: number, purchaseUnit = true): Promise<Ctx> {
  const { db } = await import("@/db");
  const {
    category,
    ingredient,
    ingredientSubUnit,
    mealPlan,
    recipe,
    recipeIngredient,
    recipeSection,
    shoppingItem,
    shoppingItemSource,
    unit,
  } = await import("@/db/schema");

  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(mealPlan).run();
  db.delete(recipe).run();
  db.delete(ingredientSubUnit).run();
  db.delete(ingredient).run();
  db.delete(unit).run();
  db.delete(category).run();

  const categoryId = db
    .insert(category)
    .values({ name: "Tiefkühl" })
    .returning({ id: category.id })
    .all()[0].id;
  const packungId = db
    .insert(unit)
    .values({ name: "Packung", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;

  const ingredientId = db
    .insert(ingredient)
    .values({
      name: "Gemüsestäbchen",
      defaultCategoryId: categoryId,
      purchaseUnitId: purchaseUnit ? packungId : null,
    })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const subUnitId = db
    .insert(ingredientSubUnit)
    .values({ ingredientId, name: "Stäbchen", perPurchase: 16 })
    .returning({ id: ingredientSubUnit.id })
    .all()[0].id;

  const recipeId = db
    .insert(recipe)
    .values({ title: "Auflauf", servings: 1 })
    .returning({ id: recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(recipeSection)
    .values({ recipeId, title: null, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;
  db.insert(recipeIngredient)
    .values({
      sectionId,
      ingredientId,
      quantity: staebchenQty,
      unitId: null,
      subUnitId,
    })
    .run();

  const mealPlanId = db
    .insert(mealPlan)
    .values({ recipeId, date: "2026-05-30", servingsOverride: 1, sortOrder: 0 })
    .returning({ id: mealPlan.id })
    .all()[0].id;

  return { recipeId, mealPlanId, ingredientId, subUnitId, packungId };
}

beforeEach(() => seed(5));

describe("sub-unit shopping aggregation", () => {
  it("rolls summed Stäbchen across meals up to whole Packungen", async () => {
    // Two meals: 5 Stäbchen + 17 Stäbchen = 22 → 2 Packung.
    const five = await seed(5);
    const { db } = await import("@/db");
    const { mealPlan, recipe, recipeSection, recipeIngredient } = await import(
      "@/db/schema"
    );
    // A second recipe with 17 Stäbchen of the same ingredient.
    const recipe2 = db
      .insert(recipe)
      .values({ title: "Wok", servings: 1 })
      .returning({ id: recipe.id })
      .all()[0].id;
    const section2 = db
      .insert(recipeSection)
      .values({ recipeId: recipe2, title: null, instructions: "" })
      .returning({ id: recipeSection.id })
      .all()[0].id;
    db.insert(recipeIngredient)
      .values({
        sectionId: section2,
        ingredientId: five.ingredientId,
        quantity: 17,
        unitId: null,
        subUnitId: five.subUnitId,
      })
      .run();
    const meal2 = db
      .insert(mealPlan)
      .values({ recipeId: recipe2, date: "2026-05-31", servingsOverride: 1, sortOrder: 0 })
      .returning({ id: mealPlan.id })
      .all()[0].id;

    const { addMealsToList } = await import("@/lib/shopping/merge");
    const ri1 = db
      .select({ id: recipeIngredient.id })
      .from(recipeIngredient)
      .all();
    addMealsToList([
      { mealPlanId: five.mealPlanId, ingredients: [{ recipeIngredientId: ri1[0].id }] },
      { mealPlanId: meal2, ingredients: [{ recipeIngredientId: ri1[1].id }] },
    ]);

    const { listShoppingItems } = await import("@/lib/shopping/items");
    const items = listShoppingItems({ skipSweep: true });
    expect(items).toHaveLength(1);
    const item = items[0];
    // Aggregated total: 2 Packung, purchase unit only.
    expect(item.amounts).toHaveLength(1);
    expect(item.amounts[0].quantity).toBe(2);
    expect(item.amounts[0].unitName).toBe("Packung");
    // Source lines keep the entered sub-unit.
    const subUnitLines = item.sources.map((s) => ({
      qty: s.contributedQuantity,
      unit: s.contributedSubUnit,
    }));
    expect(subUnitLines).toEqual(
      expect.arrayContaining([
        { qty: 5, unit: "Stäbchen" },
        { qty: 17, unit: "Stäbchen" },
      ]),
    );
  });

  it("falls back to a per-sub-unit total when no purchase unit is set", async () => {
    const ctx = await seed(22, /* purchaseUnit */ false);
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const ri = db.select({ id: recipeIngredient.id }).from(recipeIngredient).all()[0];

    const { addMealsToList } = await import("@/lib/shopping/merge");
    addMealsToList([
      { mealPlanId: ctx.mealPlanId, ingredients: [{ recipeIngredientId: ri.id }] },
    ]);

    const { listShoppingItems } = await import("@/lib/shopping/items");
    const item = listShoppingItems({ skipSweep: true })[0];
    expect(item.amounts).toHaveLength(1);
    expect(item.amounts[0].quantity).toBe(22);
    expect(item.amounts[0].unitName).toBe("Stäbchen");
  });
});
