import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-range-shopping-"));
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

beforeEach(async () => {
  const { db } = await import("@/db");
  const {
    category,
    ingredient,
    mealPlan,
    recipe,
    recipeIngredient,
    recipeSection,
    unit,
  } = await import("@/db/schema");
  for (const t of [mealPlan, recipeIngredient, recipeSection, recipe, ingredient, unit, category]) {
    db.delete(t).run();
  }

  const categoryId = db
    .insert(category)
    .values({ name: "Backwaren" })
    .returning({ id: category.id })
    .all()[0].id;
  const gId = db
    .insert(unit)
    .values({ name: "g", dimension: "mass", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const mehlId = db
    .insert(ingredient)
    .values({ name: "Mehl", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const recipeId = db
    .insert(recipe)
    .values({ title: "Teig", servings: 2 })
    .returning({ id: recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(recipeSection)
    .values({ recipeId, title: null, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;
  // A range "100–200 g Mehl": high in quantity, low in quantity_low.
  db.insert(recipeIngredient)
    .values({ sectionId, ingredientId: mehlId, quantity: 200, quantityLow: 100, unitId: gId })
    .run();
  db.insert(mealPlan)
    .values({ recipeId, date: "2026-05-23", servingsOverride: 2, sortOrder: 0 })
    .run();
});

describe("amount ranges in the shopping list", () => {
  it("contributes only the HIGH bound (low bound is display-only)", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    const mehl = meals
      .flatMap((m) => m.sections)
      .flatMap((s) => s.ingredients)
      .find((i) => i.ingredientName === "Mehl");
    // servingsOverride (2) === recipe servings (2) → scale 1 → the high bound.
    expect(mehl?.qty).toBe(200);
  });
});
