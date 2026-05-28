import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-upcoming-"));
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
  recipeIds: { spaghetti: number; salat: number };
  ingredientIds: { tomate: number; salz: number; mehl: number };
  unitIds: { g: number; stk: number };
  mealIds: { mon: number; tue: number; thu: number };
};

async function seed(opts: { daysVisible?: number } = {}): Promise<Ctx> {
  const { db } = await import("@/db");
  const {
    appSetting,
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

  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(mealPlan).run();
  db.delete(recipe).run();
  db.delete(ingredient).run();
  db.delete(unit).run();
  db.delete(category).run();
  db.delete(appSetting).run();

  // Set planner.days_visible. Default fallback is 7 if absent, so we exercise
  // the read path explicitly for each test.
  const days = opts.daysVisible ?? 7;
  db.insert(appSetting)
    .values({ key: "planner.days_visible", value: String(days) })
    .run();

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
  const stkId = db
    .insert(unit)
    .values({ name: "Stk", dimension: "count", baseUnitId: null, factor: 1 })
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
  const mehlId = db
    .insert(ingredient)
    .values({ name: "Mehl", defaultCategoryId: catId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  const spaghettiId = db
    .insert(recipe)
    .values({ title: "Spaghetti", servings: 2 })
    .returning({ id: recipe.id })
    .all()[0].id;
  const salatId = db
    .insert(recipe)
    .values({ title: "Salat", servings: 2 })
    .returning({ id: recipe.id })
    .all()[0].id;

  const sec1 = db
    .insert(recipeSection)
    .values({ recipeId: spaghettiId, title: null, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;
  const sec2 = db
    .insert(recipeSection)
    .values({ recipeId: salatId, title: null, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;

  // Spaghetti uses Tomate (500 g) + Salz; Salat uses Tomate (3 Stk) + Mehl
  // (so Tomate appears in two upcoming recipes, Mehl appears in one).
  db.insert(recipeIngredient)
    .values([
      { sectionId: sec1, ingredientId: tomateId, quantity: 500, unitId: gId },
      { sectionId: sec1, ingredientId: salzId, quantity: null, unitId: null },
      { sectionId: sec2, ingredientId: tomateId, quantity: 3, unitId: stkId },
      { sectionId: sec2, ingredientId: mehlId, quantity: 200, unitId: gId },
    ])
    .run();

  const monId = db
    .insert(mealPlan)
    .values({
      recipeId: spaghettiId,
      date: "2026-05-25",
      servingsOverride: 2,
      sortOrder: 0,
    })
    .returning({ id: mealPlan.id })
    .all()[0].id;
  const tueId = db
    .insert(mealPlan)
    .values({
      recipeId: salatId,
      date: "2026-05-26",
      servingsOverride: 4,
      sortOrder: 0,
    })
    .returning({ id: mealPlan.id })
    .all()[0].id;
  const thuId = db
    .insert(mealPlan)
    .values({
      recipeId: spaghettiId,
      date: "2026-05-28",
      servingsOverride: 2,
      sortOrder: 0,
    })
    .returning({ id: mealPlan.id })
    .all()[0].id;

  return {
    recipeIds: { spaghetti: spaghettiId, salat: salatId },
    ingredientIds: { tomate: tomateId, salz: salzId, mehl: mehlId },
    unitIds: { g: gId, stk: stkId },
    mealIds: { mon: monId, tue: tueId, thu: thuId },
  };
}

describe("getUpcomingIngredientUses", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("returns 'not-found' for a non-existent meal id", async () => {
    const { getUpcomingIngredientUses } = await import(
      "@/lib/meal-plans/upcoming-uses"
    );
    const result = getUpcomingIngredientUses(999999);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-found");
  });

  it("groups upcoming uses by ingredient_id, scaled by the future meal's servings", async () => {
    const { getUpcomingIngredientUses } = await import(
      "@/lib/meal-plans/upcoming-uses"
    );
    const result = getUpcomingIngredientUses(ctx.mealIds.mon);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mealDate).toBe("2026-05-25");
    expect(result.data.daysVisible).toBe(7);

    // Tomate appears in tue (4 portions / 2 base = scale 2 → 6 Stk) and thu
    // (Spaghetti, 2/2 = scale 1 → 500 g).
    const tomateUses = result.data.byIngredientId[ctx.ingredientIds.tomate];
    expect(tomateUses).toBeDefined();
    expect(tomateUses.length).toBe(2);
    const byMeal = new Map(tomateUses.map((u) => [u.mealPlanId, u]));
    expect(byMeal.get(ctx.mealIds.tue)?.qty).toBe(6);
    expect(byMeal.get(ctx.mealIds.tue)?.unitName).toBe("Stk");
    expect(byMeal.get(ctx.mealIds.thu)?.qty).toBe(500);
    expect(byMeal.get(ctx.mealIds.thu)?.unitName).toBe("g");

    // Mehl appears only in tue.
    const mehlUses = result.data.byIngredientId[ctx.ingredientIds.mehl];
    expect(mehlUses?.length).toBe(1);
    expect(mehlUses?.[0].mealPlanId).toBe(ctx.mealIds.tue);
  });

  it("excludes the source meal even if it shares the same recipe with a future meal", async () => {
    // Anchoring on the Thursday spaghetti meal: the source recipe (spaghetti)
    // is the same as the Monday spaghetti meal, but the window starts at
    // mealDate+1 so the Monday meal is already in the past and naturally
    // excluded.
    const { getUpcomingIngredientUses } = await import(
      "@/lib/meal-plans/upcoming-uses"
    );
    const result = getUpcomingIngredientUses(ctx.mealIds.thu);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No future meals after Thursday → empty map.
    expect(Object.keys(result.data.byIngredientId)).toEqual([]);
  });

  it("respects planner.daysVisible as the lookahead window", async () => {
    // With daysVisible=1 from Mon, only Tue is in the window; Thu is dropped.
    ctx = await seed({ daysVisible: 1 });
    const { getUpcomingIngredientUses } = await import(
      "@/lib/meal-plans/upcoming-uses"
    );
    const result = getUpcomingIngredientUses(ctx.mealIds.mon);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.daysVisible).toBe(1);
    const tomateUses = result.data.byIngredientId[ctx.ingredientIds.tomate];
    expect(tomateUses?.length).toBe(1);
    expect(tomateUses?.[0].mealPlanId).toBe(ctx.mealIds.tue);
  });

  it("inherits previewMeals filters (excludeFromShoppingList drops the ingredient)", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(ingredient)
      .set({ excludeFromShoppingList: true })
      .where(eq(ingredient.id, ctx.ingredientIds.mehl))
      .run();
    const { getUpcomingIngredientUses } = await import(
      "@/lib/meal-plans/upcoming-uses"
    );
    const result = getUpcomingIngredientUses(ctx.mealIds.mon);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.byIngredientId[ctx.ingredientIds.mehl]).toBeUndefined();
    // Tomate is unaffected.
    expect(result.data.byIngredientId[ctx.ingredientIds.tomate]).toBeDefined();
  });
});
