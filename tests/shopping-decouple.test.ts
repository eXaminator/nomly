/**
 * Once a contribution is on the shopping list it is independent of the recipe,
 * meal, or staple group it came from. Editing/reparsing a recipe, deleting a
 * meal, or deleting a staple group must never silently destroy list data — the
 * row carries snapshots and the links are soft (ON DELETE SET NULL).
 *
 * Regression for the "Burger, Bohnen-Leinsamen-Patty" bug: a recipe edit
 * cascade-deleted the shopping_item_source rows, orphaning items.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-decouple-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

type Ctx = {
  recipeId: number;
  mealPlanId: number;
  riIds: { tomate: number; salz: number; eier: number };
  ingredientIds: { tomate: number; salz: number; eier: number };
  unitIds: { g: number; stk: number };
};

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");

  for (const t of [
    s.shoppingItemStapleSource,
    s.shoppingItemSource,
    s.shoppingItemAmount,
    s.shoppingItem,
    s.stapleGroupItem,
    s.stapleGroup,
    s.recipeIngredient,
    s.recipeSection,
    s.mealPlan,
    s.recipe,
    s.ingredient,
    s.unit,
    s.category,
  ]) {
    db.delete(t).run();
  }

  const categoryId = db
    .insert(s.category)
    .values({ name: "Allerlei" })
    .returning({ id: s.category.id })
    .all()[0].id;
  const gId = db
    .insert(s.unit)
    .values({ name: "g", dimension: "mass", baseUnitId: null, factor: 1 })
    .returning({ id: s.unit.id })
    .all()[0].id;
  const stkId = db
    .insert(s.unit)
    .values({ name: "Stk", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: s.unit.id })
    .all()[0].id;

  const mkIng = (name: string) =>
    db
      .insert(s.ingredient)
      .values({ name, defaultCategoryId: categoryId })
      .returning({ id: s.ingredient.id })
      .all()[0].id;
  const tomate = mkIng("Tomate");
  const salz = mkIng("Salz");
  const eier = mkIng("Eier");

  const recipeId = db
    .insert(s.recipe)
    .values({ title: "Spaghetti", servings: 2 })
    .returning({ id: s.recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(s.recipeSection)
    .values({ recipeId, title: null, instructions: "" })
    .returning({ id: s.recipeSection.id })
    .all()[0].id;
  const riRows = db
    .insert(s.recipeIngredient)
    .values([
      { sectionId, ingredientId: tomate, quantity: 500, unitId: gId },
      { sectionId, ingredientId: salz, quantity: 1, unitId: null, fixedAmount: true },
      { sectionId, ingredientId: eier, quantity: 3, unitId: stkId },
    ])
    .returning({ id: s.recipeIngredient.id, ingredientId: s.recipeIngredient.ingredientId })
    .all();
  const riOf = (ingId: number) => riRows.find((r) => r.ingredientId === ingId)!.id;

  const mealPlanId = db
    .insert(s.mealPlan)
    .values({ recipeId, date: "2026-05-23", servingsOverride: 4, sortOrder: 0 })
    .returning({ id: s.mealPlan.id })
    .all()[0].id;

  return {
    recipeId,
    mealPlanId,
    riIds: { tomate: riOf(tomate), salz: riOf(salz), eier: riOf(eier) },
    ingredientIds: { tomate, salz, eier },
    unitIds: { g: gId, stk: stkId },
  };
}

async function addWholeMeal(ctx: Ctx) {
  const { addMealsToList } = await import("@/lib/shopping/merge");
  return addMealsToList([
    {
      mealPlanId: ctx.mealPlanId,
      ingredients: [
        { recipeIngredientId: ctx.riIds.tomate },
        { recipeIngredientId: ctx.riIds.salz },
        { recipeIngredientId: ctx.riIds.eier },
      ],
    },
  ]);
}

function recipeInputSameIngredients(ctx: Ctx) {
  // Re-save the recipe with the same ingredients — updateRecipe deletes and
  // recreates every recipe_ingredient row (new ids), exactly like an edit or
  // reparse. Pre-resolved ingredientId avoids name lookup.
  return {
    title: "Spaghetti",
    description: null,
    servings: 2,
    prepTimeMin: null,
    cookTimeMin: null,
    sourceUrl: null,
    photoPath: null,
    tags: [],
    sections: [
      {
        title: null,
        instructions: "",
        ingredients: [
          { ingredientName: "Tomate", ingredientId: ctx.ingredientIds.tomate, quantity: 500, unitId: ctx.unitIds.g, displayUnit: null, notes: null, isOptional: false, fixedAmount: false },
          { ingredientName: "Salz", ingredientId: ctx.ingredientIds.salz, quantity: 1, unitId: null, displayUnit: null, notes: null, isOptional: false, fixedAmount: true },
          { ingredientName: "Eier", ingredientId: ctx.ingredientIds.eier, quantity: 3, unitId: ctx.unitIds.stk, displayUnit: null, notes: null, isOptional: false, fixedAmount: false },
        ],
      },
    ],
  };
}

describe("shopping-list decoupling", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("keeps contributions when the recipe is edited (rows recreated)", async () => {
    await addWholeMeal(ctx);
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const { updateRecipe } = await import("@/lib/recipes/service");

    const before = listShoppingItems();
    const tomateBefore = before.find((i) => i.name === "Tomate");
    expect(tomateBefore).toBeDefined();
    expect(tomateBefore!.sources[0].contributedQuantity).toBe(1000); // 500 * 4/2

    // The bug trigger: rewrite the recipe's ingredient rows.
    updateRecipe(ctx.recipeId, recipeInputSameIngredients(ctx));

    const after = listShoppingItems();
    const tomate = after.find((i) => i.name === "Tomate");
    expect(tomate).toBeDefined(); // not orphaned away
    expect(tomate!.amounts.length).toBeGreaterThan(0); // still has an amount
    const src = tomate!.sources[0];
    expect(src.contributedQuantity).toBe(1000); // amount survived
    expect(src.recipeTitle).toBe("Spaghetti"); // snapshot label survived
    expect(src.recipeIngredientId).toBeNull(); // link detached, not destroyed
  });

  it("meal delete (keep) leaves contributions on the list, detached", async () => {
    await addWholeMeal(ctx);
    const { deleteMealOnly } = await import("@/lib/shopping/meals");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    deleteMealOnly(ctx.mealPlanId);

    const items = listShoppingItems();
    const tomate = items.find((i) => i.name === "Tomate");
    expect(tomate).toBeDefined();
    expect(tomate!.sources[0].contributedQuantity).toBe(1000);
    expect(tomate!.sources[0].mealPlanId).toBeNull(); // detached from the gone meal
  });

  it("meal delete (subtract) removes the meal's contributions", async () => {
    await addWholeMeal(ctx);
    const { deleteMealAndIngredients } = await import("@/lib/shopping/meals");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    deleteMealAndIngredients(ctx.mealPlanId);

    expect(listShoppingItems().find((i) => i.name === "Tomate")).toBeUndefined();
  });

  it("scales contributions proportionally on a servings change", async () => {
    await addWholeMeal(ctx);
    const { updateMeal } = await import("@/lib/meal-plans/service");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    // 4 → 2 portions: ratio 0.5. Tomate 1000 → 500; fixed Salz stays.
    updateMeal(ctx.mealPlanId, { servingsOverride: 2 });

    const items = listShoppingItems();
    expect(items.find((i) => i.name === "Tomate")!.sources[0].contributedQuantity).toBe(500);
    expect(items.find((i) => i.name === "Salz")!.sources[0].contributedQuantity).toBe(1); // fixed, unscaled
  });

  it("keeps staple-group contributions when the group is deleted", async () => {
    const { createGroup, addGroupItem, deleteGroup } = await import("@/lib/staples/groups");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    const groupId = createGroup("Wocheneinkauf").id;
    addGroupItem(groupId, { ingredientId: ctx.ingredientIds.salz, quantity: 2, unitId: ctx.unitIds.stk, note: null });
    addStapleGroupToList(groupId);

    deleteGroup(groupId);

    const salz = listShoppingItems().find((i) => i.name === "Salz");
    expect(salz).toBeDefined();
    expect(salz!.stapleSources[0].stapleGroupName).toBe("Wocheneinkauf"); // snapshot survived
    expect(salz!.stapleSources[0].stapleGroupId).toBeNull(); // detached
  });
});
