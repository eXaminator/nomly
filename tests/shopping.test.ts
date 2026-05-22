import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-shopping-"));
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
  sectionId: number;
  mealPlanId: number;
  ingredientIds: { tomate: number; salz: number; mehl: number; eier: number };
  unitIds: { g: number; kg: number; ml: number; stk: number };
  categoryId: number;
};

async function seed(): Promise<Ctx> {
  const { db } = await import("@/db");
  const {
    category,
    ingredient,
    mealPlan,
    product,
    recipe,
    recipeIngredient,
    recipeSection,
    shoppingItem,
    shoppingItemSource,
    unit,
  } = await import("@/db/schema");

  // Reset every table that this suite touches. Shopping rows must go first
  // because the `shopping_item_xor` check would otherwise fire when an FK
  // set-null nulls out `ingredient_id`.
  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(mealPlan).run();
  db.delete(recipe).run();
  db.delete(ingredient).run();
  db.delete(product).run();
  db.delete(unit).run();
  db.delete(category).run();

  const insertedCat = db
    .insert(category)
    .values({ name: "Backwaren" })
    .returning({ id: category.id })
    .all();
  const categoryId = insertedCat[0].id;

  const gId = db
    .insert(unit)
    .values({ name: "g", dimension: "mass", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const kgId = db
    .insert(unit)
    .values({ name: "kg", dimension: "mass", baseUnitId: gId, factor: 1000 })
    .returning({ id: unit.id })
    .all()[0].id;
  const mlId = db
    .insert(unit)
    .values({ name: "ml", dimension: "volume", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const stkId = db
    .insert(unit)
    .values({ name: "Stk", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;

  const tomateId = db
    .insert(ingredient)
    .values({ name: "Tomate", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const salzId = db
    .insert(ingredient)
    .values({ name: "Salz", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const mehlId = db
    .insert(ingredient)
    .values({ name: "Mehl", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const eierId = db
    .insert(ingredient)
    .values({ name: "Eier", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  const recipeId = db
    .insert(recipe)
    .values({ title: "Spaghetti", servings: 2 })
    .returning({ id: recipe.id })
    .all()[0].id;
  const sectionId = db
    .insert(recipeSection)
    .values({ recipeId, title: null, instructions: "" })
    .returning({ id: recipeSection.id })
    .all()[0].id;
  db.insert(recipeIngredient)
    .values([
      { sectionId, ingredientId: tomateId, quantity: 500, unitId: gId },
      { sectionId, ingredientId: salzId, quantity: null, unitId: null, isOptional: false },
      { sectionId, ingredientId: mehlId, quantity: 200, unitId: gId },
      { sectionId, ingredientId: eierId, quantity: 3, unitId: stkId },
    ])
    .run();

  const mealPlanId = db
    .insert(mealPlan)
    .values({
      recipeId,
      date: "2026-05-23",
      servingsOverride: 4,
      sortOrder: 0,
    })
    .returning({ id: mealPlan.id })
    .all()[0].id;

  return {
    recipeId,
    sectionId,
    mealPlanId,
    ingredientIds: { tomate: tomateId, salz: salzId, mehl: mehlId, eier: eierId },
    unitIds: { g: gId, kg: kgId, ml: mlId, stk: stkId },
    categoryId,
  };
}

describe("shopping preview", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("scales by servingsOverride / recipeServings", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    expect(meals).toHaveLength(1);
    const m = meals[0];
    const tomate = m.ingredients.find((i) => i.ingredientName === "Tomate");
    expect(tomate?.qty).toBe(1000); // 500 * (4/2)
  });

  it("drops exclude_from_shopping_list ingredients", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(ingredient)
      .set({ excludeFromShoppingList: true })
      .where(eq(ingredient.id, ctx.ingredientIds.salz))
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    const names = meals[0].ingredients.map((i) => i.ingredientName);
    expect(names).not.toContain("Salz");
  });

  it("drops optional ingredients", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(recipeIngredient)
      .set({ isOptional: true })
      .where(eq(recipeIngredient.ingredientId, ctx.ingredientIds.salz))
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    const names = meals[0].ingredients.map((i) => i.ingredientName);
    expect(names).not.toContain("Salz");
  });

  it("flags alreadyOnList when a source row exists", async () => {
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { previewMeals } = await import("@/lib/shopping/preview");
    const first = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: first[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);
    const second = previewMeals("2026-05-23", 1);
    expect(second[0].alreadyOnList).toBe(true);
  });
});

describe("shopping merge-on-add", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("creates one shopping_item per (ingredient, dimension) bucket and sums quantities in base units", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    // Add a second mehl line (300 g + 200 g = 500 g; scaled by 2 → 1 kg).
    db.insert(recipeIngredient)
      .values({
        sectionId: ctx.sectionId,
        ingredientId: ctx.ingredientIds.mehl,
        quantity: 300,
        unitId: ctx.unitIds.g,
      })
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: meals[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);

    const items = listShoppingItems();
    const mehl = items.find((i) => i.name === "Mehl");
    expect(mehl).toBeDefined();
    // 200g + 300g = 500g; *2 scaling = 1000g = 1 kg (preferring kg as largest).
    expect(mehl?.quantity).toBe(1);
    expect(mehl?.unitName).toBe("kg");
  });

  it("reactivates a checked item that is still within the 24h grace window", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: meals[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);

    // Check off the Tomate item and pretend the user grabbed it 10 minutes
    // ago — well within the 24h grace window.
    const items = listShoppingItems();
    const tomate = items.find((i) => i.name === "Tomate");
    expect(tomate).toBeDefined();
    db.update(shoppingItem)
      .set({
        checked: true,
        checkedAt: Math.floor(Date.now() / 1000) - 600,
      })
      .where(eq(shoppingItem.id, tomate!.id))
      .run();

    // Add the same meal again — should reactivate (uncheck) the existing
    // item instead of creating a new one.
    const meals2 = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: [
          meals2[0].ingredients.find((i) => i.ingredientName === "Tomate")!
            .recipeIngredientId,
        ],
      },
    ]);
    const after = listShoppingItems();
    const tomateAfter = after.filter((i) => i.name === "Tomate");
    expect(tomateAfter).toHaveLength(1);
    expect(tomateAfter[0].checked).toBe(false);
  });

  it("snapshots the ingredient's default category onto the item", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: meals[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);
    const items = listShoppingItems();
    for (const item of items) {
      expect(item.categoryId).toBe(ctx.categoryId);
    }
  });
});

describe("byName resolution", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("matches an exact ingredient name", async () => {
    const { resolveByName } = await import("@/lib/shopping/byName");
    const res = resolveByName("Tomate");
    expect(res.mode).toBe("match");
    if (res.mode === "match") {
      expect(res.candidate.kind).toBe("ingredient");
      expect(res.candidate.id).toBe(ctx.ingredientIds.tomate);
    }
  });

  it("returns none when nothing matches", async () => {
    const { resolveByName } = await import("@/lib/shopping/byName");
    const res = resolveByName("Toilettenpapier");
    expect(res.mode).toBe("none");
  });

  it("addManualItem with byName creates a product on miss", async () => {
    const { addManualItem } = await import("@/lib/shopping/items");
    const result = addManualItem({ byName: "Toilettenpapier" });
    expect(result.resolved.mode).toBe("createdProduct");
    expect(result.action).toBe("created");
  });
});

describe("meal-removal subtraction", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("deleteMealAndIngredients drops items whose only source was this meal", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { deleteMealAndIngredients } = await import("@/lib/shopping/meals");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: meals[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);
    expect(listShoppingItems().length).toBeGreaterThan(0);

    const result = deleteMealAndIngredients(ctx.mealPlanId);
    expect(result.itemsDeleted).toBeGreaterThan(0);
    expect(listShoppingItems().length).toBe(0);
  });

  it("deleteMealOnly leaves shopping items intact", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { deleteMealOnly } = await import("@/lib/shopping/meals");
    const { listShoppingItems } = await import("@/lib/shopping/items");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: meals[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);
    const before = listShoppingItems().length;
    deleteMealOnly(ctx.mealPlanId);
    const after = listShoppingItems();
    expect(after.length).toBe(before);
    // Sources are gone (cascade), so the items now look manually added.
    for (const item of after) {
      expect(item.sources).toEqual([]);
    }
  });
});

describe("sweeper", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("removes items checked off more than 24h ago, leaves fresh ones", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const { sweepCheckedItems } = await import("@/lib/shopping/sweeper");
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: meals[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);

    const items = listShoppingItems();
    expect(items.length).toBeGreaterThan(1);
    const aged = items[0];
    const fresh = items[1];
    const now = Math.floor(Date.now() / 1000);
    db.update(shoppingItem)
      .set({ checked: true, checkedAt: now - 25 * 3600 })
      .where(eq(shoppingItem.id, aged.id))
      .run();
    db.update(shoppingItem)
      .set({ checked: true, checkedAt: now - 3600 })
      .where(eq(shoppingItem.id, fresh.id))
      .run();

    const { deletedIds } = sweepCheckedItems(now);
    expect(deletedIds).toContain(aged.id);
    expect(deletedIds).not.toContain(fresh.id);
  });
});

describe("meal-plan view reports shopping impact", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("hasShoppingImpact flips to true after add-meals", async () => {
    const { listByDateRange } = await import("@/lib/meal-plans/service");
    const before = listByDateRange("2026-05-23", "2026-05-23");
    expect(before[0].hasShoppingImpact).toBe(false);

    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        recipeIngredientIds: meals[0].ingredients.map((i) => i.recipeIngredientId),
      },
    ]);
    const after = listByDateRange("2026-05-23", "2026-05-23");
    expect(after[0].hasShoppingImpact).toBe(true);
  });
});
