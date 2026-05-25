import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-staples-clear-"));
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
  ingredientIds: { brot: number; milch: number; butter: number };
  unitId: number;
  groupAId: number;
  groupBId: number;
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
    shoppingItemAmount,
    shoppingItemSource,
    shoppingItemStapleSource,
    stapleGroup,
    stapleGroupItem,
    unit,
  } = await import("@/db/schema");
  const { createGroup, addGroupItem } = await import("@/lib/staples/groups");

  db.delete(shoppingItemStapleSource).run();
  db.delete(shoppingItemAmount).run();
  db.delete(shoppingItemSource).run();
  db.delete(shoppingItem).run();
  db.delete(stapleGroupItem).run();
  db.delete(stapleGroup).run();
  db.delete(recipeIngredient).run();
  db.delete(recipeSection).run();
  db.delete(mealPlan).run();
  db.delete(recipe).run();
  db.delete(ingredient).run();
  db.delete(unit).run();
  db.delete(category).run();

  const categoryId = db
    .insert(category)
    .values({ name: "Backwaren" })
    .returning({ id: category.id })
    .all()[0].id;
  const unitId = db
    .insert(unit)
    .values({ name: "Stk", dimension: "count", baseUnitId: null, factor: 1 })
    .returning({ id: unit.id })
    .all()[0].id;
  const brot = db
    .insert(ingredient)
    .values({ name: "Brot", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const milch = db
    .insert(ingredient)
    .values({ name: "Milch", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;
  const butter = db
    .insert(ingredient)
    .values({ name: "Butter", defaultCategoryId: categoryId })
    .returning({ id: ingredient.id })
    .all()[0].id;

  const a = createGroup("A");
  addGroupItem(a.id, { ingredientId: brot });
  addGroupItem(a.id, { ingredientId: milch });
  const b = createGroup("B");
  addGroupItem(b.id, { ingredientId: butter });

  return {
    ingredientIds: { brot, milch, butter },
    unitId,
    groupAId: a.id,
    groupBId: b.id,
  };
}

describe("clearStapleGroupsFromList", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("strips all contributions for the given groups and deletes orphan items", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { clearStapleGroupsFromList } = await import("@/lib/staples/clear");
    const { shoppingItem, shoppingItemStapleSource } = await import(
      "@/db/schema"
    );

    addStapleGroupToList(ctx.groupAId);
    addStapleGroupToList(ctx.groupBId);
    expect(db.select().from(shoppingItem).all()).toHaveLength(3);

    const result = clearStapleGroupsFromList([ctx.groupAId]);
    expect(result.itemsDeleted).toBe(2);

    const items = db.select().from(shoppingItem).all();
    expect(items).toHaveLength(1);
    expect(items[0].ingredientId).toBe(ctx.ingredientIds.butter);

    const sources = db.select().from(shoppingItemStapleSource).all();
    expect(sources).toHaveLength(1);
    expect(sources[0].stapleGroupId).toBe(ctx.groupBId);
  });

  it("preserves items that also have meal sources or manual amounts", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { clearStapleGroupsFromList } = await import("@/lib/staples/clear");
    const { upsertShoppingItemForIngredient } = await import(
      "@/lib/shopping/itemUpsert"
    );
    const {
      shoppingItem,
      shoppingItemAmount,
      shoppingItemStapleSource,
    } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    addStapleGroupToList(ctx.groupAId);
    const brotItem = db
      .select()
      .from(shoppingItem)
      .where(eq(shoppingItem.ingredientId, ctx.ingredientIds.brot))
      .get()!;
    db.insert(shoppingItemAmount)
      .values({
        itemId: brotItem.id,
        quantity: 2,
        unitId: ctx.unitId,
        dimension: "count",
      })
      .run();

    const result = clearStapleGroupsFromList([ctx.groupAId]);
    // Milch was orphan, Brot survives because of the manual amount.
    expect(result.itemsDeleted).toBe(1);
    const items = db.select().from(shoppingItem).all();
    expect(items.map((i) => i.ingredientId)).toEqual([ctx.ingredientIds.brot]);
    // The manual amount must still be there.
    expect(
      db
        .select()
        .from(shoppingItemAmount)
        .where(eq(shoppingItemAmount.itemId, brotItem.id))
        .all(),
    ).toHaveLength(1);
    // And no staple sources remain for the cleared group.
    expect(
      db.select().from(shoppingItemStapleSource).all(),
    ).toHaveLength(0);
    // Silence ts about unused upsert import.
    void upsertShoppingItemForIngredient;
  });

  it("is a no-op when none of the passed groups have live contributions", async () => {
    const { clearStapleGroupsFromList } = await import("@/lib/staples/clear");
    const result = clearStapleGroupsFromList([ctx.groupAId, ctx.groupBId]);
    expect(result.itemsDeleted).toBe(0);
    expect(result.itemsUpdated).toBe(0);
  });

  it("handles an empty groupIds array", async () => {
    const { clearStapleGroupsFromList } = await import("@/lib/staples/clear");
    const result = clearStapleGroupsFromList([]);
    expect(result.itemsDeleted).toBe(0);
  });
});

describe("clearShoppingListSelective — extended to staple groups", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ctx = await seed();
  });

  it("strips meal and staple contributions in one call with a single orphan pass", async () => {
    const { db } = await import("@/db");
    const { addStapleGroupToList } = await import("@/lib/staples/apply");
    const { addMealsToList } = await import("@/lib/shopping/merge");
    const { clearShoppingListSelective } = await import(
      "@/lib/shopping/meals"
    );
    const {
      mealPlan,
      recipe,
      recipeIngredient,
      recipeSection,
      shoppingItem,
    } = await import("@/db/schema");

    // Build a tiny recipe + meal that contributes Brot via meal source.
    const recipeId = db
      .insert(recipe)
      .values({ title: "Toast", servings: 1 })
      .returning({ id: recipe.id })
      .all()[0].id;
    const sectionId = db
      .insert(recipeSection)
      .values({ recipeId, title: null, instructions: "" })
      .returning({ id: recipeSection.id })
      .all()[0].id;
    const recipeIngredientId = db
      .insert(recipeIngredient)
      .values({
        sectionId,
        ingredientId: ctx.ingredientIds.brot,
        quantity: 2,
        unitId: ctx.unitId,
      })
      .returning({ id: recipeIngredient.id })
      .all()[0].id;
    const mealPlanId = db
      .insert(mealPlan)
      .values({ recipeId, date: "2026-05-25", sortOrder: 0 })
      .returning({ id: mealPlan.id })
      .all()[0].id;
    addMealsToList([
      {
        mealPlanId,
        ingredients: [{ recipeIngredientId }],
      },
    ]);

    // Now apply group A (Brot + Milch). Brot merges with the existing item.
    addStapleGroupToList(ctx.groupAId);
    expect(db.select().from(shoppingItem).all()).toHaveLength(2);

    // Clear meal + group A in one call. Brot has both a meal source and a
    // staple source — both get stripped, item should disappear.
    const result = clearShoppingListSelective({
      mealPlanIds: [mealPlanId],
      stapleGroupIds: [ctx.groupAId],
    });
    expect(result.itemsDeleted).toBe(2);
    expect(db.select().from(shoppingItem).all()).toHaveLength(0);
  });
});
