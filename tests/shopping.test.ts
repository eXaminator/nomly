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
    const tomate = m.sections.flatMap((s) => s.ingredients).find((i) => i.ingredientName === "Tomate");
    expect(tomate?.qty).toBe(1000); // 500 * (4/2)
  });

  it("excludes leftover meals from the preview", async () => {
    const { db } = await import("@/db");
    const { mealPlan } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { previewMeals } = await import("@/lib/shopping/preview");
    expect(previewMeals("2026-05-23", 1)).toHaveLength(1);
    db.update(mealPlan)
      .set({ isLeftover: true })
      .where(eq(mealPlan.id, ctx.mealPlanId))
      .run();
    expect(previewMeals("2026-05-23", 1)).toHaveLength(0);
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
    const names = meals[0].sections.flatMap((s) => s.ingredients).map((i) => i.ingredientName);
    expect(names).not.toContain("Salz");
  });

  it("never surfaces an unassigned (ingredient_id NULL) line in the preview", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    db.insert(recipeIngredient)
      .values({
        sectionId: ctx.sectionId,
        ingredientId: null,
        displayName: "übrige Reste",
        quantity: 1,
        unitId: null,
      })
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    const names = meals[0].sections
      .flatMap((s) => s.ingredients)
      .map((i) => i.ingredientName);
    expect(names).not.toContain("übrige Reste");
  });

  it("keeps optional ingredients but flags them with isOptional", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(recipeIngredient)
      .set({ isOptional: true })
      .where(eq(recipeIngredient.ingredientId, ctx.ingredientIds.salz))
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    const salz = meals[0].sections.flatMap((s) => s.ingredients).find((i) => i.ingredientName === "Salz");
    expect(salz).toBeDefined();
    expect(salz?.isOptional).toBe(true);
    const tomate = meals[0].sections.flatMap((s) => s.ingredients).find((i) => i.ingredientName === "Tomate");
    expect(tomate?.isOptional).toBe(false);
  });

  it("collects equipment ingredients into a dedicated Ausrüstung section", async () => {
    const { db } = await import("@/db");
    const { ingredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    // Promote "Mehl" to an equipment item — synthetic, just to exercise the
    // grouping. The fixture mixes equipment with consumables inside the
    // recipe's single unnamed section; the preview should pull it into
    // its own "Ausrüstung" section at the end.
    db.update(ingredient)
      .set({ isEquipment: true })
      .where(eq(ingredient.id, ctx.ingredientIds.mehl))
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    expect(meals).toHaveLength(1);
    const sections = meals[0].sections;
    const equipmentSection = sections.find((s) => s.title === "Ausrüstung");
    expect(equipmentSection).toBeDefined();
    expect(equipmentSection?.sectionId).toBe(-1);
    expect(equipmentSection?.ingredients.map((i) => i.ingredientName)).toEqual(["Mehl"]);
    // Equipment section appended last.
    expect(sections[sections.length - 1].title).toBe("Ausrüstung");
    // Mehl is no longer in the consumable sections.
    const consumableNames = sections
      .filter((s) => s.title !== "Ausrüstung")
      .flatMap((s) => s.ingredients)
      .map((i) => i.ingredientName);
    expect(consumableNames).not.toContain("Mehl");
    expect(consumableNames).toContain("Tomate");
  });

  it("omits Ausrüstung section when no equipment items are present", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const meals = previewMeals("2026-05-23", 1);
    expect(meals[0].sections.some((s) => s.title === "Ausrüstung")).toBe(false);
  });

  it("flags alreadyOnList when a source row exists", async () => {
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { previewMeals } = await import("@/lib/shopping/preview");
    const first = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: first[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
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

  it("never adds an unassigned line to the list, even if passed directly", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const freeTextId = db
      .insert(recipeIngredient)
      .values({
        sectionId: ctx.sectionId,
        ingredientId: null,
        displayName: "übrige Reste",
        quantity: 2,
        unitId: null,
      })
      .returning({ id: recipeIngredient.id })
      .all()[0].id;
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const result = addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: [{ recipeIngredientId: freeTextId }],
      },
    ]);
    expect(result.itemsCreated).toBe(0);
    expect(listShoppingItems()).toHaveLength(0);
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);

    const items = listShoppingItems();
    const mehl = items.find((i) => i.name === "Mehl");
    expect(mehl).toBeDefined();
    // 200g + 300g = 500g; *2 scaling = 1000g = 1 kg (preferring kg as largest).
    expect(mehl?.amounts).toHaveLength(1);
    expect(mehl?.amounts[0].quantity).toBe(1);
    expect(mehl?.amounts[0].unitName).toBe("kg");
  });

  it("merges the same ingredient across incompatible dimensions into one item with two amount entries", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    // Tomate appears once as 500 g; add a second line as 2 Stk so the
    // ingredient now contributes both a mass and a count.
    db.insert(recipeIngredient)
      .values({
        sectionId: ctx.sectionId,
        ingredientId: ctx.ingredientIds.tomate,
        quantity: 2,
        unitId: ctx.unitIds.stk,
      })
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);
    const items = listShoppingItems();
    const tomatoes = items.filter((i) => i.name === "Tomate");
    expect(tomatoes).toHaveLength(1);
    const amounts = tomatoes[0].amounts;
    // mass first (500 * 2 = 1 kg) then count (2 * 2 = 4 Stk).
    expect(amounts).toHaveLength(2);
    expect(amounts[0].unitName).toBe("kg");
    expect(amounts[0].quantity).toBe(1);
    expect(amounts[1].unitName).toBe("Stk");
    expect(amounts[1].quantity).toBe(4);
  });

  it("exposes per-source recipe notes on each item", async () => {
    const { db } = await import("@/db");
    const { recipeIngredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(recipeIngredient)
      .set({ notes: "fein gehackt" })
      .where(eq(recipeIngredient.ingredientId, ctx.ingredientIds.tomate))
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);
    const items = listShoppingItems();
    const tomate = items.find((i) => i.name === "Tomate");
    expect(tomate?.sources[0].recipeNotes).toBe("fein gehackt");
  });

  it("resolves the manual-add default unit: article default, else Stück", async () => {
    const { db } = await import("@/db");
    const { ingredient, unit } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const {
      resolveDefaultUnitForIngredient,
      getStueckUnit,
    } = await import("@/lib/shopping/default-unit");

    // No "Stück" yet → no fallback for an article without a default unit.
    expect(getStueckUnit().unitId).toBeNull();
    expect(resolveDefaultUnitForIngredient(ctx.ingredientIds.salz).unitId).toBeNull();

    // Article with an explicit default unit returns that unit.
    db.update(ingredient)
      .set({ defaultUnitId: ctx.unitIds.g })
      .where(eq(ingredient.id, ctx.ingredientIds.tomate))
      .run();
    const tomate = resolveDefaultUnitForIngredient(ctx.ingredientIds.tomate);
    expect(tomate.unitId).toBe(ctx.unitIds.g);
    expect(tomate.unitName).toBe("g");

    // With "Stück" seeded, an article without its own default falls back to it.
    const stueckId = db
      .insert(unit)
      .values({ name: "Stück", dimension: "count", baseUnitId: null, factor: 1 })
      .returning({ id: unit.id })
      .all()[0].id;
    expect(getStueckUnit().unitId).toBe(stueckId);
    expect(resolveDefaultUnitForIngredient(ctx.ingredientIds.salz).unitId).toBe(stueckId);
  });

  it("derives the item category from the article's current default (live)", async () => {
    const { db } = await import("@/db");
    const { category, ingredient } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections
          .flatMap((s) => s.ingredients)
          .map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);
    const before = listShoppingItems().find((i) => i.name === "Tomate");
    expect(before?.categoryName).toBe("Backwaren");

    // Re-categorise the article — the list must reflect it without touching
    // the shopping_item row.
    const gemueseId = db
      .insert(category)
      .values({ name: "Gemüse" })
      .returning({ id: category.id })
      .all()[0].id;
    db.update(ingredient)
      .set({ defaultCategoryId: gemueseId })
      .where(eq(ingredient.id, ctx.ingredientIds.tomate))
      .run();
    const after = listShoppingItems().find((i) => i.name === "Tomate");
    expect(after?.categoryId).toBe(gemueseId);
    expect(after?.categoryName).toBe("Gemüse");
  });

  it("exposes the planned meal's note on every source from that meal", async () => {
    const { db } = await import("@/db");
    const { mealPlan } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(mealPlan)
      .set({ note: "doppelte Portion einplanen" })
      .where(eq(mealPlan.id, ctx.mealPlanId))
      .run();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections
          .flatMap((s) => s.ingredients)
          .map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);
    const items = listShoppingItems();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      for (const source of item.sources) {
        expect(source.mealNote).toBe("doppelte Portion einplanen");
      }
    }
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
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
        ingredients: [
          {
            recipeIngredientId: meals2[0].sections
              .flatMap((s) => s.ingredients)
              .find((i) => i.ingredientName === "Tomate")!.recipeIngredientId,
          },
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);
    const items = listShoppingItems();
    for (const item of items) {
      expect(item.categoryId).toBe(ctx.categoryId);
    }
  });
});

describe("shopping stock (Auf Lager)", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections
          .flatMap((s) => s.ingredients)
          .map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);
  });

  async function tomateItem() {
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const item = listShoppingItems().find((i) => i.name === "Tomate");
    if (!item) throw new Error("Tomate missing");
    return item;
  }

  // Mass total expressed in grams (the engine promotes 1000 g → 1 kg, so we
  // normalise back via the unit factor to assert in a single unit).
  function massGrams(item: Awaited<ReturnType<typeof tomateItem>>): number | null {
    const line = item.amounts.find((a) => a.dimension === "mass");
    if (!line || line.quantity == null) return null;
    const factor = line.unitId === ctx.unitIds.kg ? 1000 : 1;
    return line.quantity * factor;
  }

  it("subtracts the stock amount from the matching-dimension total", async () => {
    const { setItemStock } = await import("@/lib/shopping/items");
    const before = await tomateItem();
    // 500 g scaled 4/2 = 1000 g (shown as 1 kg).
    expect(massGrams(before)).toBe(1000);

    setItemStock(before.id, { quantity: 300, unitId: ctx.unitIds.g });
    const after = await tomateItem();
    expect(massGrams(after)).toBe(700);
    expect(after.stock).toMatchObject({ quantity: 300, unitId: ctx.unitIds.g });
  });

  it("clamps the total at zero when stock covers everything", async () => {
    const { setItemStock } = await import("@/lib/shopping/items");
    const item = await tomateItem();
    setItemStock(item.id, { quantity: 5, unitId: ctx.unitIds.kg });
    const after = await tomateItem();
    expect(massGrams(after)).toBe(0);
  });

  it("ignores stock in a non-matching dimension", async () => {
    const { setItemStock } = await import("@/lib/shopping/items");
    const item = await tomateItem();
    setItemStock(item.id, { quantity: 2, unitId: ctx.unitIds.stk });
    const after = await tomateItem();
    expect(massGrams(after)).toBe(1000);
    expect(after.stock).toMatchObject({ quantity: 2, unitId: ctx.unitIds.stk });
  });

  it("clears the stock row", async () => {
    const { setItemStock, clearItemStock } = await import("@/lib/shopping/items");
    const item = await tomateItem();
    setItemStock(item.id, { quantity: 300, unitId: ctx.unitIds.g });
    clearItemStock(item.id);
    const after = await tomateItem();
    expect(after.stock).toBeNull();
    expect(massGrams(after)).toBe(1000);
  });

  it("applies a batch and clears entries with a null quantity", async () => {
    const { setStockBatch, setItemStock } = await import("@/lib/shopping/items");
    const item = await tomateItem();
    setItemStock(item.id, { quantity: 300, unitId: ctx.unitIds.g });
    // null quantity clears it again.
    setStockBatch([{ itemId: item.id, quantity: null, unitId: null }]);
    expect((await tomateItem()).stock).toBeNull();

    setStockBatch([{ itemId: item.id, quantity: 250, unitId: ctx.unitIds.g }]);
    const after = await tomateItem();
    expect(after.stock).toMatchObject({ quantity: 250 });
    expect(massGrams(after)).toBe(750);
  });
});

describe("portion changes re-scale source contributions", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("portion change discards a manual edit and recomputes from the recipe", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const {
      listShoppingItems,
      setSourceQuantity,
    } = await import("@/lib/shopping/items");
    const { updateMeal } = await import("@/lib/meal-plans/service");

    // Recipe says 500 g for 2 portions. Planned 4 portions → scale 2 →
    // source = 1000 g.
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({
          recipeIngredientId: i.recipeIngredientId,
        })),
      },
    ]);
    const before = listShoppingItems().find((i) => i.name === "Tomate")!;
    expect(before.sources[0].contributedQuantity).toBe(1000);

    // User manually drops it to 300 g via the row editor.
    setSourceQuantity(before.id, before.sources[0].sourceId, 300);
    const edited = listShoppingItems().find((i) => i.name === "Tomate")!;
    expect(edited.sources[0].contributedQuantity).toBe(300);

    // Planner change to 6 portions → new scale 3 → recipe.qty × 3 = 1500 g.
    // The manual edit (300 g) is intentionally discarded; the planner is
    // the source of truth for what a meal contributes.
    updateMeal(ctx.mealPlanId, { servingsOverride: 6 });
    const after = listShoppingItems().find((i) => i.name === "Tomate")!;
    expect(after.sources[0].contributedQuantity).toBe(1500);
  });

  it("doubling the planned servings doubles each contributed quantity", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const { updateMeal } = await import("@/lib/meal-plans/service");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({
          recipeIngredientId: i.recipeIngredientId,
        })),
      },
    ]);
    // Recipe servings = 2, plan = 4 → scale 2. Tomate contributes 1000 g.
    const before = listShoppingItems();
    const tomate = before.find((i) => i.name === "Tomate");
    expect(tomate?.amounts[0].quantity).toBe(1); // 1000g formatted as kg
    expect(tomate?.amounts[0].unitName).toBe("kg");

    // Double the plan to 8 portions → scale 4 → 2000 g per source.
    updateMeal(ctx.mealPlanId, { servingsOverride: 8 });
    const after = listShoppingItems();
    const tomateAfter = after.find((i) => i.name === "Tomate");
    expect(tomateAfter?.amounts[0].quantity).toBe(2);
    expect(tomateAfter?.amounts[0].unitName).toBe("kg");
  });
});

describe("selective clear", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("removes one meal's contributions without deleting the meal", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const { clearShoppingListSelective } = await import("@/lib/shopping/meals");
    const { db } = await import("@/db");
    const { mealPlan } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({
          recipeIngredientId: i.recipeIngredientId,
        })),
      },
    ]);
    expect(listShoppingItems().length).toBeGreaterThan(0);

    clearShoppingListSelective({ mealPlanIds: [ctx.mealPlanId] });

    expect(listShoppingItems()).toHaveLength(0);
    const stillPlanned = db
      .select({ id: mealPlan.id })
      .from(mealPlan)
      .where(eq(mealPlan.id, ctx.mealPlanId))
      .get();
    expect(stillPlanned).toBeDefined();
  });
});

describe("amount edits scale sources (so meal removal subtracts cleanly)", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("editing 1000 g down to 500 g halves the source contribution and a delete clears the dimension", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems, setItemAmount } = await import("@/lib/shopping/items");
    const { deleteMealAndIngredients } = await import("@/lib/shopping/meals");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({
          recipeIngredientId: i.recipeIngredientId,
        })),
      },
    ]);
    // Tomate is 500 g for 2 portions × 2 scale = 1000 g (displayed as 1 kg).
    const before = listShoppingItems().find((i) => i.name === "Tomate")!;
    expect(before.amounts[0].quantity).toBe(1);
    expect(before.amounts[0].unitName).toBe("kg");

    // User halves it.
    setItemAmount(before.id, { quantity: 500, unitId: ctx.unitIds.g });
    const after = listShoppingItems().find((i) => i.name === "Tomate")!;
    expect(after.amounts[0].quantity).toBe(500);
    expect(after.amounts[0].unitName).toBe("g");
    // Source row mirrors the scale.
    expect(after.sources[0].contributedQuantity).toBe(500);

    // Removing the meal now removes the whole (scaled) contribution, not
    // a stale override.
    deleteMealAndIngredients(ctx.mealPlanId);
    expect(listShoppingItems().find((i) => i.name === "Tomate")).toBeUndefined();
  });

  it("addItemAmount stacks on top of existing source contributions", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { addItemAmount, listShoppingItems } = await import("@/lib/shopping/items");

    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({
          recipeIngredientId: i.recipeIngredientId,
        })),
      },
    ]);
    const tomate = listShoppingItems().find((i) => i.name === "Tomate")!;
    // Currently 1 kg (1000 g) from the source. Adding 200 g manually should
    // result in 1.2 kg total — never an override.
    addItemAmount(tomate.id, { quantity: 200, unitId: ctx.unitIds.g });
    const after = listShoppingItems().find((i) => i.name === "Tomate")!;
    expect(after.amounts[0].unitName).toBe("kg");
    expect(after.amounts[0].quantity).toBe(1.2);
  });
});

describe("per-dimension manual override", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await seed();
  });

  it("setItemAmount replaces the sources sum for that dimension", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems, setItemAmount } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({
          recipeIngredientId: i.recipeIngredientId,
        })),
      },
    ]);
    const before = listShoppingItems();
    const eier = before.find((i) => i.name === "Eier");
    expect(eier).toBeDefined();
    // Scaled: recipe says 3 Stk for 2 portions; planned 4 portions → 6 Stk.
    expect(eier?.amounts[0].quantity).toBe(6);

    // User says "I have 2 at home, only need 4".
    setItemAmount(eier!.id, { quantity: 4, unitId: ctx.unitIds.stk });

    const after = listShoppingItems();
    const eierAfter = after.find((i) => i.name === "Eier");
    expect(eierAfter?.amounts).toHaveLength(1);
    expect(eierAfter?.amounts[0].quantity).toBe(4);
    expect(eierAfter?.amounts[0].unitName).toBe("Stk");
  });

  it("addMealsToList honours a per-ingredient quantity override", async () => {
    const { previewMeals } = await import("@/lib/shopping/preview");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { listShoppingItems } = await import("@/lib/shopping/items");
    const meals = previewMeals("2026-05-23", 1);
    const tomate = meals[0].sections.flatMap((s) => s.ingredients).find((i) => i.ingredientName === "Tomate")!;
    addMealsToList([
      {
        mealPlanId: ctx.mealPlanId,
        ingredients: [
          // Recipe says 500 g for 2 portions (planned 4 → scaled 1000 g);
          // user types 750 instead.
          { recipeIngredientId: tomate.recipeIngredientId, quantity: 750 },
        ],
      },
    ]);
    const items = listShoppingItems();
    const t = items.find((i) => i.name === "Tomate");
    expect(t?.sources[0].contributedQuantity).toBe(750);
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

  it("addManualItem with byName creates an ingredient on miss", async () => {
    const { addManualItem } = await import("@/lib/shopping/items");
    const result = addManualItem({ byName: "Toilettenpapier" });
    expect(result.resolved.mode).toBe("createdIngredient");
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
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

  it("listShoppingItems sweeps stale checked items on read", async () => {
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);

    const before = listShoppingItems();
    expect(before.length).toBeGreaterThan(1);
    const aged = before[0];
    const now = Math.floor(Date.now() / 1000);
    db.update(shoppingItem)
      .set({ checked: true, checkedAt: now - 25 * 3600 })
      .where(eq(shoppingItem.id, aged.id))
      .run();

    const after = listShoppingItems();
    expect(after.find((i) => i.id === aged.id)).toBeUndefined();
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
        ingredients: meals[0].sections.flatMap((s) => s.ingredients).map((i) => ({ recipeIngredientId: i.recipeIngredientId })),
      },
    ]);
    const after = listByDateRange("2026-05-23", "2026-05-23");
    expect(after[0].hasShoppingImpact).toBe(true);
  });
});

describe("patchItem LWW (client-stamped newest-wins)", () => {
  let ctx: Ctx;
  beforeEach(async () => { ctx = await seed(); });

  it("applies a toggle when no clientStampedAt is provided (legacy path)", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const inserted = db
      .insert(shoppingItem)
      .values({ ingredientId: ctx.ingredientIds.salz, checked: false })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    const v = patchItem(id, { checked: true });
    expect(v.checked).toBe(true);
    expect(v.checkedAt).not.toBeNull();
  });

  it("applies when clientStampedAt is newer than updatedAt", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const inserted = db
      .insert(shoppingItem)
      .values({ ingredientId: ctx.ingredientIds.salz, checked: false, updatedAt: 1000 })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    // 2000 seconds later in ms.
    const v = patchItem(id, { checked: true }, { clientStampedAt: 2000 * 1000 });
    expect(v.checked).toBe(true);

    const row = db
      .select({ updatedAt: shoppingItem.updatedAt, checkedAt: shoppingItem.checkedAt })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, id))
      .get();
    // updatedAt was at least 2000 (capped at now in real time, but >= 2000).
    expect(row!.updatedAt).toBeGreaterThanOrEqual(2000);
  });

  it("skips the write when clientStampedAt is older than updatedAt", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const inserted = db
      .insert(shoppingItem)
      .values({
        ingredientId: ctx.ingredientIds.salz,
        checked: true,
        checkedAt: 5000,
        updatedAt: 5000,
      })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    // Stale offline replay: client thinks they unchecked at second 3000.
    const v = patchItem(id, { checked: false }, { clientStampedAt: 3000 * 1000 });
    // Returns the current (untouched) row.
    expect(v.checked).toBe(true);
    expect(v.checkedAt).toBe(5000);

    const row = db
      .select({ updatedAt: shoppingItem.updatedAt })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, id))
      .get();
    expect(row!.updatedAt).toBe(5000); // untouched
  });

  it("caps clientStampedAt at unixepoch() to defeat future-dated clocks", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const inserted = db
      .insert(shoppingItem)
      .values({ ingredientId: ctx.ingredientIds.salz, checked: false, updatedAt: 1000 })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    const farFuture = (Math.floor(Date.now() / 1000) + 10_000) * 1000;
    patchItem(id, { checked: true }, { clientStampedAt: farFuture });

    const row = db
      .select({ updatedAt: shoppingItem.updatedAt })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, id))
      .get();
    const now = Math.floor(Date.now() / 1000);
    // updatedAt clamped to "now", not the far-future client timestamp.
    expect(row!.updatedAt).toBeLessThanOrEqual(now + 2);
    expect(row!.updatedAt).toBeGreaterThanOrEqual(now - 2);
  });

  it("does not gate non-checked patches (note edits apply unconditionally)", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const inserted = db
      .insert(shoppingItem)
      .values({
        ingredientId: ctx.ingredientIds.salz,
        checked: true,
        checkedAt: 5000,
        updatedAt: 5000,
        note: "old",
      })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    // Stale clientStampedAt; note patch should still apply since it's not a check.
    const v = patchItem(id, { note: "new" }, { clientStampedAt: 3000 * 1000 });
    expect(v.note).toBe("new");
  });

  it("note-only patch with stale clientStampedAt does not lower updatedAt", async () => {
    const { db } = await import("@/db");
    const { shoppingItem } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const inserted = db
      .insert(shoppingItem)
      .values({
        ingredientId: ctx.ingredientIds.salz,
        checked: false,
        updatedAt: 8000,
      })
      .returning({ id: shoppingItem.id })
      .all();
    const id = inserted[0].id;

    const { patchItem } = await import("@/lib/shopping/items");
    patchItem(id, { note: "x" }, { clientStampedAt: 1000 * 1000 });

    const row = db
      .select({ updatedAt: shoppingItem.updatedAt })
      .from(shoppingItem)
      .where(eq(shoppingItem.id, id))
      .get();
    const now = Math.floor(Date.now() / 1000);
    // updatedAt advanced to "now", not lowered to the stale client timestamp.
    expect(row!.updatedAt).toBeGreaterThanOrEqual(now - 2);
  });
});
