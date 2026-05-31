import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-density-standalone-"));
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

/**
 * Seed cinnamon: density 0.5 g/ml, a standalone sub-unit "Stange", units g
 * (mass base), ml (volume base), TL (5 ml). One recipe line of `tlQty` TL and
 * one of `stangeQty` Stange. Returns the meal/recipe-ingredient ids.
 */
async function seed(tlQty: number, stangeQty: number) {
  const { db } = await import("@/db");
  const {
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

  for (const t of [
    shoppingItemSource,
    shoppingItem,
    recipeIngredient,
    recipeSection,
    mealPlan,
    recipe,
    ingredientSubUnit,
    ingredient,
    unit,
  ])
    db.delete(t).run();

  const gId = db
    .insert(unit)
    .values({ name: "g", dimension: "mass", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const mlId = db
    .insert(unit)
    .values({ name: "ml", dimension: "volume", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const tlId = db
    .insert(unit)
    .values({ name: "TL", dimension: "volume", baseUnitId: mlId, factor: 5 })
    .returning({ id: unit.id })
    .all()[0].id;
  void gId;

  const ingredientId = db
    .insert(ingredient)
    .values({ name: "Zimt", gramsPerMl: 0.5 })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const stangeId = db
    .insert(ingredientSubUnit)
    .values({ ingredientId, name: "Stange", plural: "Stangen", parentUnitId: null })
    .returning({ id: ingredientSubUnit.id })
    .all()[0].id;

  const recipeId = db
    .insert(recipe)
    .values({ title: "Zimtschnecken", servings: 1 })
    .returning({ id: recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(recipeSection)
    .values({ recipeId, title: null, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;
  const tlRi = db
    .insert(recipeIngredient)
    .values({ sectionId, ingredientId, quantity: tlQty, unitId: tlId, subUnitId: null })
    .returning({ id: recipeIngredient.id })
    .all()[0].id;
  const stangeRi = db
    .insert(recipeIngredient)
    .values({ sectionId, ingredientId, quantity: stangeQty, unitId: null, subUnitId: stangeId })
    .returning({ id: recipeIngredient.id })
    .all()[0].id;
  const mealPlanId = db
    .insert(mealPlan)
    .values({ recipeId, date: "2026-05-30", servingsOverride: 1, sortOrder: 0 })
    .returning({ id: mealPlan.id })
    .all()[0].id;

  return { mealPlanId, tlRi, stangeRi };
}

beforeEach(() => seed(2, 2));

describe("shopping aggregation — density + standalone", () => {
  it("converts volume to grams via density and keeps a standalone sub-unit as its own line", async () => {
    const { mealPlanId, tlRi, stangeRi } = await seed(2, 2);
    const { addMealsToList } = await import("@/lib/shopping/merge");
    addMealsToList([
      {
        mealPlanId,
        ingredients: [
          { recipeIngredientId: tlRi },
          { recipeIngredientId: stangeRi },
        ],
      },
    ]);

    const { listShoppingItems } = await import("@/lib/shopping/items");
    const items = listShoppingItems({ skipSweep: true });
    expect(items).toHaveLength(1);
    const amounts = items[0].amounts;

    // 2 TL = 10 ml × 0.5 g/ml = 5 g.
    const mass = amounts.find((a) => a.dimension === "mass");
    expect(mass?.quantity).toBe(5);
    expect(mass?.unitName).toBe("g");

    // Stange has no parent → standalone line, pluralised.
    const standalone = amounts.find((a) => a.unitName === "Stangen");
    expect(standalone?.quantity).toBe(2);

    // No leftover volume line — it was converted to grams.
    expect(amounts.find((a) => a.dimension === "volume")).toBeUndefined();
  });
});
